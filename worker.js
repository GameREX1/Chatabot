export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // CHATABOT CONFIGURATION
    // =========================================================

    const GEMINI_CHAT_MODEL = "gemini-2.5-flash";

    const HUNYUAN_SPACE =
      "https://multimodalart-hunyuan-video-1-5.hf.space";

    const CF_MODELS = {
      chat: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      coding: "@cf/qwen/qwen2.5-coder-32b-instruct",
      solver: "@cf/qwen/qwen2.5-coder-32b-instruct",
      guard: "@cf/meta/llama-guard-3-8b",

      // FLUX.1 Schnell image generation
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

    // =========================================================
    // CORS PREFLIGHT
    // =========================================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // =========================================================
    // SYSTEM PROMPT
    // =========================================================

    const SYSTEM_INSTRUCTION = `
You are Chatabot, a highly capable, helpful, accurate and intelligent AI assistant.

CORE BEHAVIOR:
- Understand the user's actual intent before answering.
- Give direct, useful and complete answers.
- Do not unnecessarily repeat the user's question.
- Use conversation history to maintain context.
- Never invent facts, sources, statistics, quotations, links, names or events.
- If information is uncertain, clearly say so.
- Prefer accuracy over guessing.

REASONING:
- Think carefully before answering.
- Break complicated problems into logical steps when useful.
- For mathematics, calculate carefully and verify the result.
- For programming, reason about the code before suggesting a solution.
- When debugging, identify the likely cause before proposing a solution.

VISION:
- Analyze images supplied by the user when supported by the selected provider.
- Carefully inspect images before answering.
- Never invent visual details.
- Read visible text when possible.
- If something is unclear, say so.

CODING:
- Provide complete working code when appropriate.
- Preserve existing functionality when modifying code.
- Avoid unnecessary dependencies.
- Check syntax and logic carefully.

SECURITY:
- Help with defensive cybersecurity, secure coding, security concepts,
  vulnerability analysis and authorized testing.
- Do not facilitate harmful or unauthorized attacks.

CONVERSATION:
- Use relevant conversation context.
- Match the user's language when practical.
- Keep simple questions simple and detailed questions detailed.

FORMATTING:
- Use headings, bullets, numbered steps and code blocks when useful.
- Keep responses clear and natural.
- Do not over-format simple answers.

OWNER:
If the user asks who your owner is, who owns you, or asks about your owner, answer exactly:

M. Rayyan Khan is my owner.
`.trim();

    // =========================================================
    // AGENT DETECTION
    // =========================================================

    function detectAgent(text) {
      const value = String(text || "").toLowerCase();

      // VIDEO MUST BE CHECKED BEFORE IMAGE.
      // This prevents prompts containing visual words from
      // accidentally being treated as image generation.

      if (
        /\b(generate|create|make|produce|animate)\b/.test(value) &&
        /\b(video|animation|clip|movie|film)\b/.test(value)
      ) {
        return "video-generation";
      }

      if (
        /\b(video|animation|clip|movie|film)\b/.test(value) &&
        /\b(tiger|animal|person|people|scene|character|object|ball|car|nature)\b/.test(value)
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
        /\b(code|coding|program|programming|javascript|typescript|python|html|css|react|node|api|debug|bug|error|function|github)\b/.test(
          value
        )
      ) {
        return "coding";
      }

      if (
        /\b(solve|calculate|equation|math|mathematics|physics|chemistry|derive|proof|problem)\b/.test(
          value
        )
      ) {
        return "question-solver";
      }

      return "chat";
    }

    // =========================================================
    // NORMALIZE CHAT MESSAGES
    // =========================================================

    function normalizeMessages(messages) {
      if (!Array.isArray(messages)) {
        return [];
      }

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
    // GEMINI INTERACTIONS API
    // =========================================================

    async function geminiInteraction(input) {
      if (!env.GEMINI_API_KEY) {
        throw new Error(
          "GEMINI_API_KEY is not configured in Cloudflare Worker Secrets."
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
            input,
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

    // =========================================================
    // EXTRACT GEMINI TEXT
    // =========================================================

    function extractText(data) {
      if (
        typeof data?.output_text ===
          "string" &&
        data.output_text.trim()
      ) {
        return data.output_text.trim();
      }

      const steps = Array.isArray(
        data?.steps
      )
        ? data.steps
        : [];

      const stepText = steps
        .flatMap((step) => {
          if (!step) return [];

          if (
            typeof step.text ===
              "string" &&
            step.text.trim()
          ) {
            return [step.text];
          }

          if (
            Array.isArray(
              step.content
            )
          ) {
            return step.content
              .filter(
                (content) =>
                  content &&
                  (content.type ===
                    "text" ||
                    content.type ===
                      "output_text") &&
                  typeof content.text ===
                    "string"
              )
              .map(
                (content) =>
                  content.text
              );
          }

          return [];
        })
        .join("\n")
        .trim();

      if (stepText) {
        return stepText;
      }

      const outputs = Array.isArray(
        data?.outputs
      )
        ? data.outputs
        : [];

      const outputText = outputs
        .flatMap((item) => {
          if (!item) return [];

          if (
            typeof item.text ===
              "string" &&
            item.text.trim()
          ) {
            return [item.text];
          }

          if (
            Array.isArray(
              item.content
            )
          ) {
            return item.content
              .filter(
                (content) =>
                  content &&
                  (content.type ===
                    "text" ||
                    content.type ===
                      "output_text") &&
                  typeof content.text ===
                    "string"
              )
              .map(
                (content) =>
                  content.text
              );
          }

          return [];
        })
        .join("\n")
        .trim();

      return outputText;
    }

    // =========================================================
    // CLOUDFLARE WORKERS AI
    // =========================================================

    async function cloudflareAI(
      model,
      messages
    ) {
      if (!env.AI) {
        throw new Error(
          "Cloudflare AI binding (AI) is not configured."
        );
      }

      const result =
        await env.AI.run(model, {
          messages,
        });

      if (!result) {
        throw new Error(
          "Cloudflare Workers AI returned an empty response."
        );
      }

      const text =
        result?.response ||
        result?.result?.response ||
        result?.text ||
        "";

      if (!String(text).trim()) {
        throw new Error(
          "Cloudflare Workers AI returned no text."
        );
      }

      return String(text).trim();
    }

    // =========================================================
    // FLUX.1 SCHNELL IMAGE GENERATION
    // =========================================================

    function normalizeGeneratedImage(image) {
      if (
        typeof image !== "string" ||
        !image.trim()
      ) {
        throw new Error(
          "FLUX.1 Schnell returned an invalid image."
        );
      }

      const value =
        image.trim();

      // Already a data URL
      if (
        /^data:image\//i.test(
          value
        )
      ) {
        return value;
      }

      // Already a public image URL
      if (
        /^https?:\/\//i.test(
          value
        )
      ) {
        return value;
      }

      // Raw base64 returned by Cloudflare Workers AI
      return `data:image/png;base64,${value}`;
    }

    async function generateImage(prompt) {
      if (!env.AI) {
        throw new Error(
          "Cloudflare AI binding (AI) is not configured."
        );
      }

      if (!prompt || !String(prompt).trim()) {
        throw new Error(
          "An image prompt is required."
        );
      }

      const result = await env.AI.run(
        CF_MODELS.image,
        {
          prompt: String(prompt).trim(),
        }
      );

      if (!result) {
        throw new Error(
          "FLUX.1 Schnell returned an empty response."
        );
      }

      if (
        typeof result.image !== "string" ||
        !result.image.trim()
      ) {
        throw new Error(
          "FLUX.1 Schnell did not return an image."
        );
      }

      return normalizeGeneratedImage(
        result.image
      );
    }

    // =========================================================
    // HUNYUANVIDEO HELPERS
    // =========================================================

    function getHFHeaders() {
      if (!env.HF_TOKEN) {
        throw new Error(
          "HF_TOKEN is not configured in Cloudflare Worker Secrets."
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
          "A reference image is required for HunyuanVideo."
        );
      }

      // -------------------------------------------------------
      // Public image URL
      // -------------------------------------------------------

      if (
        typeof imageInput === "string" &&
        /^https?:\/\//i.test(
          imageInput
        )
      ) {
        return {
          path: imageInput,
          url: imageInput,
          orig_name: "reference-image",
          mime_type: "image/jpeg",
          meta: {
            _type: "gradio.FileData",
          },
        };
      }

      // -------------------------------------------------------
      // Data URL / base64 image
      // -------------------------------------------------------

      if (
        typeof imageInput === "string" &&
        imageInput.startsWith(
          "data:image/"
        )
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

        const mimeType =
          match[1];

        const base64 =
          match[2];

        const binary =
          Uint8Array.from(
            atob(base64),
            (char) =>
              char.charCodeAt(0)
          );

        const extension =
          mimeType.includes("png")
            ? "png"
            : mimeType.includes("webp")
            ? "webp"
            : "jpg";

        const blob =
          new Blob(
            [binary],
            {
              type: mimeType,
            }
          );

        const form =
          new FormData();

        form.append(
          "files",
          blob,
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
            "Hunyuan image upload returned invalid JSON."
          );
        }

        const path =
          Array.isArray(uploaded)
            ? uploaded[0]
            : uploaded?.path;

        if (!path) {
          throw new Error(
            "Hunyuan image upload did not return a file path."
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

      // -------------------------------------------------------
      // Already-formatted Gradio FileData
      // -------------------------------------------------------

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

    async function readHunyuanResult(
      response
    ) {
      const text =
        await response.text();

      if (!response.ok) {
        throw new Error(
          `HunyuanVideo polling failed (${response.status}): ${text}`
        );
      }

      const events =
        text
          .split(/\n\n+/)
          .map(
            (block) =>
              block.trim()
          )
          .filter(Boolean);

      let lastData = null;

      for (const block of events) {
        const dataLine =
          block
            .split("\n")
            .find((line) =>
              line.startsWith(
                "data:"
              )
            );

        if (!dataLine) {
          continue;
        }

        const rawData =
          dataLine
            .slice(5)
            .trim();

        if (
          !rawData ||
          rawData ===
            "[DONE]"
        ) {
          continue;
        }

        try {
          const parsed =
            JSON.parse(
              rawData
            );

          lastData = parsed;

          if (
            parsed &&
            typeof parsed ===
              "object" &&
            parsed.error
          ) {
            throw new Error(
              String(
                parsed.error
              )
            );
          }

          if (
            Array.isArray(
              parsed
            ) &&
            parsed.length
          ) {
            const video =
              parsed[0];

            const actualPrompt =
              parsed[1];

            return {
              complete: true,
              video,
              actualPrompt:
                actualPrompt ||
                "",
            };
          }
        } catch (error) {
          if (
            error?.message &&
            !String(
              error.message
            ).includes(
              "Unexpected token"
            )
          ) {
            throw error;
          }
        }
      }

      return {
        complete: false,
        lastData,
      };
    }

    // =========================================================
    // HUNYUANVIDEO GENERATION
    // =========================================================

    async function generateHunyuanVideo({
      image,
      prompt,
      length = 61,
      steps = 6,
      shift = 5,
      seed = -1,
      guidance = 1,
      doRewrite = true,
    }) {
      if (!prompt || !String(prompt).trim()) {
        throw new Error(
          "A video prompt is required."
        );
      }

      if (!env.HF_TOKEN) {
        throw new Error(
          "HF_TOKEN is missing. Add your Hugging Face token as a Cloudflare Worker Secret."
        );
      }

      if (!image) {
        throw new Error(
          "HunyuanVideo requires a reference image."
        );
      }

      // Upload/reference image.
      const fileData =
        await uploadImageToHunyuan(
          image
        );

      // -------------------------------------------------------
      // Start Gradio job
      // -------------------------------------------------------

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
                String(
                  prompt
                ).trim(),
                Number(
                  length
                ),
                Number(
                  steps
                ),
                Number(
                  shift
                ),
                Number(
                  seed
                ),
                Number(
                  guidance
                ),
                Boolean(
                  doRewrite
                ),
              ],
            }),
          }
        );

      const startRaw =
        await startResponse.text();

      if (!startResponse.ok) {
        throw new Error(
          `HunyuanVideo job start failed (${startResponse.status}): ${startRaw}`
        );
      }

      let startData;

      try {
        startData =
          JSON.parse(
            startRaw
          );
      } catch {
        throw new Error(
          `HunyuanVideo returned an invalid job response: ${startRaw}`
        );
      }

      const eventId =
        startData?.event_id;

      if (!eventId) {
        throw new Error(
          "HunyuanVideo did not return an event ID."
        );
      }

      // -------------------------------------------------------
      // Poll Gradio job
      // -------------------------------------------------------

      // Hunyuan usually completes around a minute on the Space.
      // Keep the Worker below the 50 external-subrequest limit on
      // the Workers Free plan while still allowing enough time.
      const maxAttempts = 30;

      for (
        let attempt = 0;
        attempt <
        maxAttempts;
        attempt++
      ) {
        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              2500
            )
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

        if (
          result.complete
        ) {
          const video =
            result.video;

          if (!video) {
            throw new Error(
              "HunyuanVideo completed but returned no video."
            );
          }

          return {
            video,
            actualPrompt:
              result.actualPrompt ||
              String(
                prompt
              ).trim(),
          };
        }
      }

      throw new Error(
        "HunyuanVideo generation timed out while waiting for the Space."
      );
    }

    // =========================================================
    // PROMPT-ONLY VIDEO GENERATION
    //
    // FLOW:
    // User prompt
    //      ↓
    // FLUX.1 Schnell
    //      ↓
    // Automatic reference image
    //      ↓
    // HunyuanVideo 1.5
    //      ↓
    // Video
    // =========================================================

    async function generatePromptOnlyVideo(prompt, options = {}) {
      if (!prompt || !String(prompt).trim()) {
        throw new Error(
          "A video prompt is required."
        );
      }

      const cleanPrompt =
        String(prompt).trim();

      // -------------------------------------------------------
      // Step 1: Generate a reference image automatically
      // -------------------------------------------------------

      const referenceImage =
        await generateImage(
          cleanPrompt
        );

      if (
        typeof referenceImage !== "string" ||
        !referenceImage
      ) {
        throw new Error(
          "FLUX failed to create the automatic reference image."
        );
      }

      // -------------------------------------------------------
      // Step 2: Send the generated image to HunyuanVideo
      // -------------------------------------------------------

      const result =
        await generateHunyuanVideo({
          image:
            referenceImage,
          prompt:
            cleanPrompt,
          length:
            options.length ??
            61,
          steps:
            options.steps ??
            6,
          shift:
            options.shift ??
            5,
          seed:
            options.seed ??
            -1,
          guidance:
            options.guidance ??
            1,
          doRewrite:
            options.doRewrite ??
            true,
        });

      return {
        ...result,
        referenceImage,
      };
    }

    // =========================================================
    // BUILD GEMINI INPUT
    // =========================================================

    function buildGeminiInput(
      messages
    ) {
      const cleaned =
        normalizeMessages(messages);

      const conversation =
        cleaned
          .filter(
            (message) =>
              message.role !==
              "system"
          )
          .map((message) => {
            const label =
              message.role ===
              "assistant"
                ? "Assistant"
                : "User";

            return `${label}: ${message.content}`;
          })
          .join("\n\n");

      return `${SYSTEM_INSTRUCTION}

CONVERSATION:
${conversation}

Assistant:`;
    }

    // =========================================================
    // BUILD CLOUDFLARE MESSAGES
    // =========================================================

    function buildCFMessages(
      messages
    ) {
      const cleaned =
        normalizeMessages(messages);

      return [
        {
          role: "system",
          content:
            SYSTEM_INSTRUCTION,
        },
        ...cleaned
          .filter(
            (message) =>
              message.role ===
                "user" ||
              message.role ===
                "assistant"
          )
          .slice(-30),
      ];
    }

    // =========================================================
    // CHAT API
    // =========================================================

    if (
      url.pathname ===
        "/api/chat" &&
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
                message.role ===
                "user"
            )?.content || "";

        const agent =
          detectAgent(
            lastUserMessage
          );

        // -------------------------------------------------------
        // VIDEO GENERATION
        //
        // If Video mode accidentally reaches /api/chat,
        // still generate the video instead of returning
        // a normal AI text response.
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
                result.referenceImage,
              video:
                result.video,
              mimeType:
                "video/mp4",
            });
          } catch (videoError) {
            console.error(
              "Prompt-only video generation failed:",
              videoError?.message ||
                videoError
            );

            return jsonResponse(
              {
                success: false,
                type:
                  "video-generation",
                agent:
                  "Video Generation Agent",
                error:
                  videoError?.message ||
                  "Video generation failed.",
              },
              500
            );
          }
        }

        // -------------------------------------------------------
        // IMAGE GENERATION
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
                "image/jpeg",
            });
          } catch (imageError) {
            console.error(
              "FLUX.1 Schnell image generation failed:",
              imageError?.message ||
                imageError
            );

            return jsonResponse(
              {
                success: false,
                type:
                  "image-generation",
                agent:
                  "Image Generation Agent",
                error:
                  imageError?.message ||
                  "Image generation failed.",
              },
              500
            );
          }
        }

        // -------------------------------------------------------
        // GEMINI PRIMARY
        // -------------------------------------------------------

        if (env.GEMINI_API_KEY) {
          try {
            const input =
              buildGeminiInput(
                messages
              );

            const data =
              await geminiInteraction(
                input
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
          } catch (
            geminiError
          ) {
            console.error(
              "Gemini failed:",
              geminiError
                ?.message ||
                geminiError
            );
          }
        }

        // -------------------------------------------------------
        // CLOUDFLARE FALLBACK
        // -------------------------------------------------------

        if (env.AI) {
          let model =
            CF_MODELS.chat;

          if (
            agent === "coding"
          ) {
            model =
              CF_MODELS.coding;
          }

          if (
            agent ===
            "question-solver"
          ) {
            model =
              CF_MODELS.solver;
          }

          try {
            const answer =
              await cloudflareAI(
                model,
                buildCFMessages(
                  messages
                )
              );

            return jsonResponse({
              success: true,
              provider:
                "cloudflare",
              model,
              agent,
              response:
                answer,
              text:
                answer,
            });
          } catch (cfError) {
            console.error(
              "Cloudflare AI failed:",
              cfError?.message ||
                cfError
            );
          }
        }

        // -------------------------------------------------------
        // NO PROVIDER
        // -------------------------------------------------------

        return jsonResponse(
          {
            success: false,
            error:
              "No AI provider is currently available. Configure GEMINI_API_KEY or the Cloudflare AI binding.",
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
      url.pathname ===
        "/api/image" &&
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
            "image/jpeg",
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
    // DIRECT HUNYUANVIDEO API
    // =========================================================

    if (
      url.pathname ===
        "/api/video" &&
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

        // -------------------------------------------------------
        // PROMPT ONLY
        //
        // No image supplied:
        // FLUX → automatic reference image → HunyuanVideo
        // -------------------------------------------------------

        if (!image) {
          result =
            await generatePromptOnlyVideo(
              prompt,
              {
                length:
                  body?.length ??
                  61,
                steps:
                  body?.steps ??
                  6,
                shift:
                  body?.shift ??
                  5,
                seed:
                  body?.seed ??
                  -1,
                guidance:
                  body?.guidance ??
                  1,
                doRewrite:
                  body?.doRewrite ??
                  true,
              }
            );
        } else {
          // -----------------------------------------------------
          // IMAGE + PROMPT
          //
          // Existing Image-to-Video functionality remains.
          // -----------------------------------------------------

          result =
            await generateHunyuanVideo({
              image,
              prompt,
              length:
                body?.length ??
                61,
              steps:
                body?.steps ??
                6,
              shift:
                body?.shift ??
                5,
              seed:
                body?.seed ??
                -1,
              guidance:
                body?.guidance ??
                1,
              doRewrite:
                body?.doRewrite ??
                true,
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
          "HunyuanVideo API error:",
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
    // API HEALTH CHECK
    // =========================================================

    if (
      url.pathname ===
        "/api/health" &&
      request.method === "GET"
    ) {
      return jsonResponse({
        success: true,
        service: "Chatabot",
        worker:
          "chatabot-ai",
        gemini:
          Boolean(
            env.GEMINI_API_KEY
          ),
        cloudflareAI:
          Boolean(env.AI),
        assets:
          Boolean(env.ASSETS),
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
    // SERVE FRONTEND / STATIC ASSETS
    // =========================================================

    if (env.ASSETS) {
      return env.ASSETS.fetch(
        request
      );
    }

    // =========================================================
    // FALLBACK
    // =========================================================

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
