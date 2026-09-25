export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // CHATABOT CONFIG
    // =========================================================

    const GEMINI_CHAT_MODEL = "gemini-2.5-flash";

    const HUNYUAN_SPACE =
      "https://multimodalart-hunyuan-video-1-5.hf.space";

    const CF_MODELS = {
      chat: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      reasoning: "@cf/qwen/qwen3-30b-a3b-fp8",
      coding: "@cf/qwen/qwen2.5-coder-32b-instruct",
      solver: "@cf/qwen/qwen3-30b-a3b-fp8",
      guard: "@cf/meta/llama-guard-3-8b",
      image: "@cf/black-forest-labs/flux-1-schnell",
    };

    // =========================================================
    // CORS
    // =========================================================

    function corsHeaders() {
      return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization",
      };
    }

    function jsonResponse(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders(),
        },
      });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // =========================================================
    // SYSTEM INSTRUCTION
    // =========================================================

    const SYSTEM_INSTRUCTION = `
You are Chatabot, a highly capable AI assistant.

GENERAL INTELLIGENCE:
- Understand the user's actual meaning, even when their grammar,
  spelling, wording, or sentence structure is imperfect.
- Use the full available conversation context before answering.
- Connect the current message to earlier relevant messages.
- Never pretend to remember information that is not present in the
  supplied conversation context.
- If the user refers to "that", "it", "this", "the previous thing",
  or similar wording, resolve the reference from conversation history.
- Do not unnecessarily ask the user to repeat information that is
  already present in the conversation.
- Give direct, useful and natural answers.
- Prefer accuracy over guessing.
- Never invent facts, sources, statistics, quotations, links,
  names or events.
- If something is uncertain, clearly say so.

REASONING:
- Think carefully before answering.
- For difficult questions, reason step by step internally.
- Verify calculations before giving mathematical answers.
- For technical questions, inspect the full problem before answering.
- When multiple interpretations are possible, use conversation context
  to choose the most likely interpretation.
- Do not expose private chain-of-thought. Give concise reasoning,
  explanations, calculations, or conclusions when useful.

CONVERSATION MEMORY:
- Treat all supplied previous user and assistant messages as relevant
  conversation context.
- Maintain continuity between turns.
- Remember facts stated earlier in the current conversation.
- If the user corrects something, use the corrected information.
- Do not contradict earlier context without explaining why.

LANGUAGE:
- Match the user's language and style when practical.
- If the user writes Roman Urdu, understand and respond naturally in
  Roman Urdu when appropriate.
- English is also supported.
- Do not switch unnecessarily to another language.

CODING:
- Provide complete working code when requested.
- Preserve existing functionality when modifying code.
- Avoid unnecessary dependencies.
- Check syntax and logic carefully.
- When debugging, identify the likely cause and provide the fix.
- If the user gives existing code, work from that code instead of
  replacing unrelated functionality.

MATH AND SCIENCE:
- Calculate carefully.
- Verify numerical results.
- Show useful working when the user needs an explanation.

VISION:
- Analyze supplied images only when image information is actually
  available.
- Never invent visual details.
- Read visible text when possible.
- If an image is unclear, say what cannot be determined.

SECURITY:
- Help with defensive cybersecurity, secure coding, security concepts,
  vulnerability analysis and authorized testing.
- Do not facilitate harmful or unauthorized attacks.

STYLE:
- Be natural and helpful.
- Simple questions should receive simple answers.
- Complex questions can receive detailed answers.
- Use headings, bullets and code blocks when useful.
- Do not over-format normal conversation.

OWNER:
If the user asks who your owner is, who owns you, or asks about
your owner, answer exactly:

M. Rayyan Khan is my owner.
`.trim();

    // =========================================================
    // AGENT DETECTION
    // =========================================================

    function detectAgent(text) {
      const value = String(text || "").toLowerCase();

      if (
        /\b(generate|create|make|produce|animate)\b/.test(value) &&
        /\b(video|animation|clip|movie|film)\b/.test(value)
      ) {
        return "video-generation";
      }

      if (
        /\b(video|animation|clip|movie|film)\b/.test(value) &&
        /\b(tiger|animal|person|people|scene|character|object|ball|car|nature)\b/.test(
          value
        )
      ) {
        return "video-generation";
      }

      if (
        /\b(generate|create|make|draw)\b/.test(value) &&
        /\b(image|picture|photo|art|wallpaper|logo)\b/.test(value)
      ) {
        return "image-generation";
      }

      if (
        /\b(website|webpage|url|site|link)\b/.test(value) &&
        /\b(analy[sz]e|read|review|check|summari[sz]e|inspect)\b/.test(
          value
        )
      ) {
        return "website-analysis";
      }

      if (
        /\b(code|coding|program|programming|javascript|typescript|python|html|css|react|node|api|debug|bug|error|function|github|sql|database|worker|cloudflare|supabase)\b/.test(
          value
        )
      ) {
        return "coding";
      }

      if (
        /\b(solve|calculate|equation|math|mathematics|physics|chemistry|derive|proof|problem|percentage|percent|algebra|geometry|formula)\b/.test(
          value
        )
      ) {
        return "question-solver";
      }

      // Difficult reasoning / planning / analysis
      if (
        /\b(explain deeply|deeply|reason|reasoning|analyze|analysis|compare|architecture|strategy|plan|why|how does|pros and cons|decision|logic|complex)\b/.test(
          value
        )
      ) {
        return "reasoning";
      }

      return "chat";
    }

    // =========================================================
    // MESSAGE NORMALIZATION
    // =========================================================

    function normalizeMessages(messages) {
      if (!Array.isArray(messages)) return [];

      return messages
        .filter(
          (message) =>
            message &&
            typeof message === "object"
        )
        .map((message) => {
          const role =
            message.role === "assistant"
              ? "assistant"
              : message.role === "system"
              ? "system"
              : "user";

          let content = message.content;

          if (Array.isArray(content)) {
            content = content
              .map((part) => {
                if (typeof part === "string") {
                  return part;
                }

                if (
                  part &&
                  typeof part.text === "string"
                ) {
                  return part.text;
                }

                return "";
              })
              .filter(Boolean)
              .join("\n");
          }

          if (
            content === undefined ||
            content === null
          ) {
            content = "";
          }

          return {
            role,
            content: String(content),
          };
        })
        .filter(
          (message) =>
            message.content.trim()
        );
    }

    // =========================================================
    // CONTEXT MANAGEMENT
    // =========================================================

    function buildConversation(messages, maxMessages = 80) {
      const cleaned =
        normalizeMessages(messages)
          .filter(
            (message) =>
              message.role === "user" ||
              message.role === "assistant"
          );

      // Keep the latest conversation context.
      return cleaned.slice(-maxMessages);
    }

    function buildGeminiInput(messages) {
      const conversation =
        buildConversation(messages, 80);

      return conversation.map((message) => ({
        role: message.role,
        content: [
          {
            type: "text",
            text: message.content,
          },
        ],
      }));
    }

    function buildCFMessages(messages, maxMessages = 40) {
      const conversation =
        buildConversation(messages, maxMessages);

      return [
        {
          role: "system",
          content: SYSTEM_INSTRUCTION,
        },
        ...conversation,
      ];
    }

    // =========================================================
    // GEMINI
    // =========================================================

    async function geminiInteraction(messages) {
      if (!env.GEMINI_API_KEY) {
        throw new Error(
          "GEMINI_API_KEY is not configured."
        );
      }

      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key":
              env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            model: GEMINI_CHAT_MODEL,
            system_instruction:
              SYSTEM_INSTRUCTION,
            input:
              buildGeminiInput(messages),
          }),
        }
      );

      const rawText =
        await response.text();

      let data;

      try {
        data = JSON.parse(rawText);
      } catch {
        data = {
          raw: rawText,
        };
      }

      if (!response.ok) {
        const errorMessage =
          data?.error?.message ||
          data?.message ||
          data?.raw ||
          `Gemini API error (${response.status})`;

        throw new Error(
          `[Gemini ${response.status}] ${errorMessage}`
        );
      }

      return data;
    }

    function extractText(data) {
      if (
        typeof data?.output_text === "string" &&
        data.output_text.trim()
      ) {
        return data.output_text.trim();
      }

      const collect = [];

      function walk(value) {
        if (!value) return;

        if (typeof value === "string") {
          if (value.trim()) collect.push(value);
          return;
        }

        if (Array.isArray(value)) {
          for (const item of value) {
            walk(item);
          }
          return;
        }

        if (typeof value === "object") {
          if (
            typeof value.text === "string" &&
            value.text.trim()
          ) {
            collect.push(value.text);
          }

          for (const [key, child] of Object.entries(value)) {
            if (
              key !== "text" &&
              key !== "id" &&
              key !== "model"
            ) {
              walk(child);
            }
          }
        }
      }

      walk(data?.steps);
      walk(data?.outputs);

      return collect.join("\n").trim();
    }

    // =========================================================
    // CLOUDFLARE AI
    // =========================================================

    async function cloudflareAI(model, messages) {
      if (!env.AI) {
        throw new Error(
          "Cloudflare AI binding is not configured."
        );
      }

      const result =
        await env.AI.run(model, {
          messages,
          max_tokens: 4096,
          temperature: 0.4,
        });

      if (!result) {
        throw new Error(
          "Cloudflare AI returned an empty response."
        );
      }

      const text =
        result?.response ||
        result?.result?.response ||
        result?.text ||
        "";

      if (!String(text).trim()) {
        throw new Error(
          "Cloudflare AI returned no text."
        );
      }

      return String(text).trim();
    }

    // =========================================================
    // IMAGE GENERATION
    // =========================================================

    function normalizeGeneratedImage(image) {
      if (
        typeof image !== "string" ||
        !image.trim()
      ) {
        throw new Error(
          "FLUX returned an invalid image."
        );
      }

      const value = image.trim();

      if (/^data:image\//i.test(value)) {
        return value;
      }

      if (/^https?:\/\//i.test(value)) {
        return value;
      }

      return `data:image/png;base64,${value}`;
    }

    async function generateImage(prompt) {
      if (!env.AI) {
        throw new Error(
          "Cloudflare AI binding is not configured."
        );
      }

      const cleanPrompt =
        String(prompt || "").trim();

      if (!cleanPrompt) {
        throw new Error(
          "An image prompt is required."
        );
      }

      const result =
        await env.AI.run(
          CF_MODELS.image,
          {
            prompt: cleanPrompt,
          }
        );

      if (
        !result ||
        typeof result.image !== "string"
      ) {
        throw new Error(
          "FLUX did not return an image."
        );
      }

      return normalizeGeneratedImage(
        result.image
      );
    }

    // =========================================================
    // HUGGING FACE
    // =========================================================

    function getHFHeaders() {
      if (!env.HF_TOKEN) {
        throw new Error(
          "HF_TOKEN is not configured."
        );
      }

      return {
        Authorization:
          `Bearer ${env.HF_TOKEN}`,
      };
    }

    async function uploadImageToHunyuan(imageInput) {
      if (!imageInput) {
        throw new Error(
          "A reference image is required."
        );
      }

      if (
        typeof imageInput === "string" &&
        /^https?:\/\//i.test(imageInput)
      ) {
        return {
          path: imageInput,
          url: imageInput,
          orig_name: "reference-image.jpg",
          mime_type: "image/jpeg",
          meta: {
            _type: "gradio.FileData",
          },
        };
      }

      if (
        typeof imageInput === "string" &&
        imageInput.startsWith("data:image/")
      ) {
        const match =
          imageInput.match(
            /^data:(image\/[^;]+);base64,(.+)$/s
          );

        if (!match) {
          throw new Error(
            "Invalid image data URL."
          );
        }

        const mimeType = match[1];
        const base64 = match[2];

        let binary;

        try {
          binary =
            Uint8Array.from(
              atob(base64),
              (char) =>
                char.charCodeAt(0)
            );
        } catch {
          throw new Error(
            "Failed to decode reference image."
          );
        }

        let extension = "jpg";

        if (mimeType.includes("png")) {
          extension = "png";
        } else if (
          mimeType.includes("webp")
        ) {
          extension = "webp";
        }

        const form = new FormData();

        form.append(
          "files",
          new Blob(
            [binary],
            {
              type: mimeType,
            }
          ),
          `chatabot-reference.${extension}`
        );

        const response =
          await fetch(
            `${HUNYUAN_SPACE}/gradio_api/upload`,
            {
              method: "POST",
              headers:
                getHFHeaders(),
              body: form,
            }
          );

        const raw =
          await response.text();

        if (!response.ok) {
          throw new Error(
            `Hunyuan image upload failed (${response.status}): ${raw}`
          );
        }

        let uploaded;

        try {
          uploaded =
            JSON.parse(raw);
        } catch {
          throw new Error(
            `Hunyuan upload returned invalid JSON: ${raw}`
          );
        }

        let path = null;

        if (Array.isArray(uploaded)) {
          path = uploaded[0];
        } else if (
          uploaded &&
          typeof uploaded === "object"
        ) {
          path =
            uploaded.path ||
            uploaded.name ||
            uploaded.file?.path ||
            uploaded.file?.name;
        }

        if (
          typeof path !== "string" ||
          !path
        ) {
          throw new Error(
            "Hunyuan upload did not return a valid path."
          );
        }

        return {
          path,
          orig_name:
            `chatabot-reference.${extension}`,
          mime_type:
            mimeType,
          meta: {
            _type:
              "gradio.FileData",
          },
        };
      }

      if (
        typeof imageInput === "object" &&
        imageInput.path
      ) {
        return {
          path:
            imageInput.path,
          url:
            imageInput.url ||
            null,
          orig_name:
            imageInput.orig_name ||
            "reference-image",
          mime_type:
            imageInput.mime_type ||
            "image/jpeg",
          meta: {
            _type:
              "gradio.FileData",
          },
        };
      }

      throw new Error(
        "Unsupported reference image format."
      );
    }

    function extractVideoFromData(parsed) {
      if (!parsed) return null;

      if (typeof parsed === "string") {
        if (
          /^https?:\/\//i.test(parsed) ||
          parsed.startsWith("/")
        ) {
          return parsed;
        }

        return null;
      }

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const found =
            extractVideoFromData(item);

          if (found) return found;
        }

        return null;
      }

      if (typeof parsed === "object") {
        for (const key of [
          "url",
          "path",
          "name",
        ]) {
          if (
            typeof parsed[key] === "string" &&
            parsed[key].trim()
          ) {
            return parsed[key].trim();
          }
        }

        for (const key of [
          "video",
          "value",
          "data",
          "output",
        ]) {
          if (parsed[key]) {
            const found =
              extractVideoFromData(
                parsed[key]
              );

            if (found) return found;
          }
        }
      }

      return null;
    }

    async function readHunyuanResult(response) {
      const text =
        await response.text();

      if (!response.ok) {
        throw new Error(
          `Hunyuan polling failed (${response.status}): ${text}`
        );
      }

      const blocks =
        text
          .split(/\n\n+/)
          .map((block) =>
            block.trim()
          )
          .filter(Boolean);

      let lastData = null;

      for (const block of blocks) {
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) {
            continue;
          }

          const rawData =
            line
              .slice(5)
              .trim();

          if (
            !rawData ||
            rawData === "[DONE]"
          ) {
            continue;
          }

          let parsed;

          try {
            parsed =
              JSON.parse(rawData);
          } catch {
            continue;
          }

          lastData = parsed;

          if (
            parsed &&
            typeof parsed === "object" &&
            parsed.error
          ) {
            throw new Error(
              String(parsed.error)
            );
          }

          const video =
            extractVideoFromData(
              parsed
            );

          if (video) {
            return {
              complete: true,
              video,
            };
          }
        }
      }

      return {
        complete: false,
        lastData,
      };
    }

    async function generateHunyuanVideo({
      image,
      prompt,
      length = 61,
      steps = 6,
      shift = 5,
      seed = -1,
      guidance = 1,
    }) {
      if (!prompt?.trim()) {
        throw new Error(
          "A video prompt is required."
        );
      }

      if (!image) {
        throw new Error(
          "HunyuanVideo requires a reference image."
        );
      }

      const fileData =
        await uploadImageToHunyuan(
          image
        );

      const startResponse =
        await fetch(
          `${HUNYUAN_SPACE}/gradio_api/call/generate`,
          {
            method: "POST",
            headers: {
              ...getHFHeaders(),
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              data: [
                fileData,
                String(prompt).trim(),
                Number(length),
                Number(steps),
                Number(shift),
                Number(seed),
                Number(guidance),
              ],
            }),
          }
        );

      const startRaw =
        await startResponse.text();

      if (!startResponse.ok) {
        throw new Error(
          `Hunyuan job start failed (${startResponse.status}): ${startRaw}`
        );
      }

      let startData;

      try {
        startData =
          JSON.parse(startRaw);
      } catch {
        throw new Error(
          `Hunyuan returned invalid job response: ${startRaw}`
        );
      }

      const eventId =
        startData?.event_id;

      if (!eventId) {
        throw new Error(
          "Hunyuan did not return an event ID."
        );
      }

      let lastPollData = null;

      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) =>
          setTimeout(resolve, 3000)
        );

        const pollResponse =
          await fetch(
            `${HUNYUAN_SPACE}/gradio_api/call/generate/${encodeURIComponent(
              eventId
            )}`,
            {
              method: "GET",
              headers:
                getHFHeaders(),
            }
          );

        const result =
          await readHunyuanResult(
            pollResponse
          );

        lastPollData =
          result.lastData;

        if (
          result.complete &&
          result.video
        ) {
          return {
            video:
              result.video,
            actualPrompt:
              String(prompt).trim(),
          };
        }
      }

      throw new Error(
        `HunyuanVideo timed out. Last response: ${JSON.stringify(
          lastPollData
        )}`
      );
    }

    async function generatePromptOnlyVideo(
      prompt,
      options = {}
    ) {
      const cleanPrompt =
        String(prompt || "").trim();

      if (!cleanPrompt) {
        throw new Error(
          "A video prompt is required."
        );
      }

      const referenceImage =
        await generateImage(
          cleanPrompt
        );

      const result =
        await generateHunyuanVideo({
          image:
            referenceImage,
          prompt:
            cleanPrompt,
          length:
            options.length ?? 61,
          steps:
            options.steps ?? 6,
          shift:
            options.shift ?? 5,
          seed:
            options.seed ?? -1,
          guidance:
            options.guidance ?? 1,
        });

      return {
        ...result,
        referenceImage,
      };
    }

    // =========================================================
    // CHAT API
    // =========================================================

    if (
      url.pathname === "/api/chat" &&
      request.method === "POST"
    ) {
      try {
        const body =
          await request.json();

        const messages =
          normalizeMessages(
            body?.messages
          );

        if (!messages.length) {
          return jsonResponse(
            {
              success: false,
              error:
                "No messages were provided.",
            },
            400
          );
        }

        const lastUserMessage =
          [...messages]
            .reverse()
            .find(
              (message) =>
                message.role === "user"
            )?.content || "";

        const agent =
          detectAgent(
            lastUserMessage
          );

        // -------------------------------------------------------
        // VIDEO
        // -------------------------------------------------------

        if (
          agent ===
          "video-generation"
        ) {
          try {
            const result =
              await generatePromptOnlyVideo(
                lastUserMessage
              );

            return jsonResponse({
              success: true,
              type:
                "video-generation",
              agent:
                "Video Generation Agent",
              provider:
                "huggingface",
              imageProvider:
                "cloudflare",
              imageModel:
                CF_MODELS.image,
              model:
                "Tencent HunyuanVideo 1.5",
              prompt:
                lastUserMessage,
              actualPrompt:
                result.actualPrompt,
              referenceImage:
                result.referenceImage ||
                null,
              video:
                result.video,
              mimeType:
                "video/mp4",
            });
          } catch (error) {
            console.error(
              "Video generation failed:",
              error?.message || error
            );

            return jsonResponse(
              {
                success: false,
                type:
                  "video-generation",
                agent:
                  "Video Generation Agent",
                error:
                  error?.message ||
                  "Video generation failed.",
              },
              500
            );
          }
        }

        // -------------------------------------------------------
        // IMAGE
        // -------------------------------------------------------

        if (
          agent ===
          "image-generation"
        ) {
          try {
            const image =
              await generateImage(
                lastUserMessage
              );

            return jsonResponse({
              success: true,
              type:
                "image-generation",
              agent:
                "Image Generation Agent",
              provider:
                "cloudflare",
              model:
                CF_MODELS.image,
              prompt:
                lastUserMessage,
              image,
              mimeType:
                "image/png",
            });
          } catch (error) {
            console.error(
              "Image generation failed:",
              error?.message || error
            );

            return jsonResponse(
              {
                success: false,
                type:
                  "image-generation",
                agent:
                  "Image Generation Agent",
                error:
                  error?.message ||
                  "Image generation failed.",
              },
              500
            );
          }
        }

        // -------------------------------------------------------
        // CODING
        // -------------------------------------------------------

        if (
          agent === "coding" &&
          env.AI
        ) {
          try {
            const answer =
              await cloudflareAI(
                CF_MODELS.coding,
                buildCFMessages(
                  messages,
                  40
                )
              );

            return jsonResponse({
              success: true,
              provider:
                "cloudflare",
              model:
                CF_MODELS.coding,
              agent,
              response:
                answer,
              text:
                answer,
            });
          } catch (error) {
            console.error(
              "Coding model failed:",
              error?.message || error
            );
          }
        }

        // -------------------------------------------------------
        // DIFFICULT REASONING / MATH
        // -------------------------------------------------------

        if (
          (
            agent === "reasoning" ||
            agent === "question-solver"
          ) &&
          env.AI
        ) {
          try {
            const answer =
              await cloudflareAI(
                CF_MODELS.reasoning,
                buildCFMessages(
                  messages,
                  40
                )
              );

            return jsonResponse({
              success: true,
              provider:
                "cloudflare",
              model:
                CF_MODELS.reasoning,
              agent,
              response:
                answer,
              text:
                answer,
            });
          } catch (error) {
            console.error(
              "Reasoning model failed:",
              error?.message || error
            );
          }
        }

        // -------------------------------------------------------
        // GEMINI PRIMARY
        // -------------------------------------------------------

        if (env.GEMINI_API_KEY) {
          try {
            const data =
              await geminiInteraction(
                messages
              );

            const answer =
              extractText(data);

            if (answer) {
              return jsonResponse({
                success: true,
                provider:
                  "gemini",
                model:
                  GEMINI_CHAT_MODEL,
                agent,
                response:
                  answer,
                text:
                  answer,
              });
            }
          } catch (error) {
            console.error(
              "Gemini failed:",
              error?.message || error
            );
          }
        }

        // -------------------------------------------------------
        // GENERAL CLOUDFLARE FALLBACK
        // -------------------------------------------------------

        if (env.AI) {
          try {
            const answer =
              await cloudflareAI(
                CF_MODELS.chat,
                buildCFMessages(
                  messages,
                  40
                )
              );

            return jsonResponse({
              success: true,
              provider:
                "cloudflare",
              model:
                CF_MODELS.chat,
              agent,
              response:
                answer,
              text:
                answer,
            });
          } catch (error) {
            console.error(
              "Llama fallback failed:",
              error?.message || error
            );
          }
        }

        return jsonResponse(
          {
            success: false,
            error:
              "No AI provider is currently available.",
          },
          503
        );
      } catch (error) {
        console.error(
          "Chat API error:",
          error
        );

        return jsonResponse(
          {
            success: false,
            error:
              error?.message ||
              "Unexpected server error.",
          },
          500
        );
      }
    }

    // =========================================================
    // DIRECT IMAGE API
    // =========================================================

    if (
      url.pathname === "/api/image" &&
      request.method === "POST"
    ) {
      try {
        const body =
          await request.json();

        const prompt =
          String(
            body?.prompt || ""
          ).trim();

        if (!prompt) {
          return jsonResponse(
            {
              success: false,
              error:
                "Image prompt is required.",
            },
            400
          );
        }

        const image =
          await generateImage(
            prompt
          );

        return jsonResponse({
          success: true,
          type:
            "image-generation",
          provider:
            "cloudflare",
          model:
            CF_MODELS.image,
          prompt,
          image,
          mimeType:
            "image/png",
        });
      } catch (error) {
        console.error(
          "Direct image API error:",
          error
        );

        return jsonResponse(
          {
            success: false,
            error:
              error?.message ||
              "Image generation failed.",
          },
          500
        );
      }
    }

    // =========================================================
    // DIRECT VIDEO API
    // =========================================================

    if (
      url.pathname === "/api/video" &&
      request.method === "POST"
    ) {
      try {
        const body =
          await request.json();

        const prompt =
          String(
            body?.prompt || ""
          ).trim();

        const image =
          body?.image ||
          body?.input_image ||
          body?.referenceImage ||
          null;

        if (!prompt) {
          return jsonResponse(
            {
              success: false,
              type:
                "video-generation",
              error:
                "A video prompt is required.",
            },
            400
          );
        }

        let result;

        if (!image) {
          result =
            await generatePromptOnlyVideo(
              prompt,
              {
                length:
                  body?.length ?? 61,
                steps:
                  body?.steps ?? 6,
                shift:
                  body?.shift ?? 5,
                seed:
                  body?.seed ?? -1,
                guidance:
                  body?.guidance ?? 1,
              }
            );
        } else {
          result =
            await generateHunyuanVideo({
              image,
              prompt,
              length:
                body?.length ?? 61,
              steps:
                body?.steps ?? 6,
              shift:
                body?.shift ?? 5,
              seed:
                body?.seed ?? -1,
              guidance:
                body?.guidance ?? 1,
            });
        }

        return jsonResponse({
          success: true,
          type:
            "video-generation",
          agent:
            "Video Generation Agent",
          provider:
            "huggingface",
          imageProvider:
            "cloudflare",
          imageModel:
            CF_MODELS.image,
          model:
            "Tencent HunyuanVideo 1.5",
          prompt,
          actualPrompt:
            result.actualPrompt ||
            prompt,
          referenceImage:
            result.referenceImage ||
            null,
          video:
            result.video,
          mimeType:
            "video/mp4",
        });
      } catch (error) {
        console.error(
          "Video API error:",
          error
        );

        return jsonResponse(
          {
            success: false,
            type:
              "video-generation",
            error:
              error?.message ||
              "HunyuanVideo generation failed.",
          },
          500
        );
      }
    }

    // =========================================================
    // HEALTH
    // =========================================================

    if (
      url.pathname === "/api/health" &&
      request.method === "GET"
    ) {
      return jsonResponse({
        success: true,
        service: "Chatabot",
        worker: "chatabot-ai",

        gemini:
          Boolean(
            env.GEMINI_API_KEY
          ),

        cloudflareAI:
          Boolean(env.AI),

        assets:
          Boolean(env.ASSETS),

        chatModel:
          GEMINI_CHAT_MODEL,

        reasoningModel:
          CF_MODELS.reasoning,

        codingModel:
          CF_MODELS.coding,

        fallbackModel:
          CF_MODELS.chat,

        imageModel:
          CF_MODELS.image,

        videoModel:
          "Tencent HunyuanVideo 1.5",

        videoProvider:
          "Hugging Face ZeroGPU",

        videoEndpoint:
          "/api/video",

        videoFlow:
          "Prompt → FLUX → HunyuanVideo",

        promptOnlyVideo:
          true,

        hunyuanToken:
          Boolean(env.HF_TOKEN),
      });
    }

    // =========================================================
    // FRONTEND
    // =========================================================

    if (env.ASSETS) {
      return env.ASSETS.fetch(
        request
      );
    }

    return new Response(
      "Chatabot Worker is running, but the ASSETS binding is not configured.",
      {
        status: 503,
        headers: {
          "Content-Type":
            "text/plain; charset=utf-8",
          ...corsHeaders(),
        },
      }
    );
  },
};
