export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // CHATBOT CONFIG
    // =========================================================
    // Free-tier Gemini model for text + image/video understanding.
    // We intentionally do NOT call paid image/video generation
    // models from this worker.
    const CHAT_MODEL = "gemini-2.5-flash";

    // =========================================================
    // CORS
    // =========================================================
    function corsHeaders() {
      return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      };
    }

    function jsonResponse(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders()
        }
      });
    }

    // =========================================================
    // OPTIONS / CORS PREFLIGHT
    // =========================================================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    // =========================================================
    // GEMINI INTERACTIONS HELPER
    // =========================================================
    async function geminiInteraction(payload) {
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
            "x-goog-api-key": env.GEMINI_API_KEY
          },
          body: JSON.stringify(payload)
        }
      );

      const rawText = await response.text();

      let data;

      try {
        data = JSON.parse(rawText);
      } catch {
        data = {
          raw: rawText
        };
      }

      if (!response.ok) {
        throw new Error(
          data?.error?.message ||
          data?.message ||
          data?.raw ||
          `Gemini API error (${response.status})`
        );
      }

      return data;
    }

    // =========================================================
    // EXTRACT TEXT FROM GEMINI INTERACTION
    // =========================================================
    function extractText(data) {
      if (
        typeof data?.output_text === "string" &&
        data.output_text.trim()
      ) {
        return data.output_text.trim();
      }

      const outputs = Array.isArray(data?.outputs)
        ? data.outputs
        : [];

      const outputText = outputs
        .flatMap((item) => {
          if (!item) return [];

          if (
            typeof item.text === "string" &&
            item.text.trim()
          ) {
            return [item.text];
          }

          if (Array.isArray(item.content)) {
            return item.content
              .filter(
                (content) =>
                  content &&
                  (
                    content.type === "text" ||
                    content.type === "output_text"
                  ) &&
                  typeof content.text === "string"
              )
              .map((content) => content.text);
          }

          return [];
        })
        .join("\n")
        .trim();

      if (outputText) {
        return outputText;
      }

      const steps = Array.isArray(data?.steps)
        ? data.steps
        : [];

      const stepText = steps
        .flatMap((step) => {
          if (!step) return [];

          if (
            typeof step.text === "string" &&
            step.text.trim()
          ) {
            return [step.text];
          }

          if (Array.isArray(step.content)) {
            return step.content
              .filter(
                (content) =>
                  content &&
                  (
                    content.type === "text" ||
                    content.type === "output_text"
                  ) &&
                  typeof content.text === "string"
              )
              .map((content) => content.text);
          }

          return [];
        })
        .join("\n")
        .trim();

      return stepText;
    }

    // =========================================================
    // EXTRACT IMAGE FROM GEMINI RESPONSE
    // =========================================================
    function extractImage(data) {
      if (
        typeof data?.output_image?.data === "string" &&
        data.output_image.data
      ) {
        return data.output_image.data;
      }

      const steps = Array.isArray(data?.steps)
        ? data.steps
        : [];

      for (const step of steps) {
        if (!Array.isArray(step?.content)) continue;

        for (const content of step.content) {
          if (
            content?.type === "image" &&
            typeof content.data === "string"
          ) {
            return content.data;
          }
        }
      }

      const outputs = Array.isArray(data?.outputs)
        ? data.outputs
        : [];

      for (const output of outputs) {
        if (!Array.isArray(output?.content)) continue;

        for (const content of output.content) {
          if (
            content?.type === "image" &&
            typeof content.data === "string"
          ) {
            return content.data;
          }
        }
      }

      return "";
    }

    // =========================================================
    // SYSTEM INSTRUCTION
    // =========================================================
    const SYSTEM_INSTRUCTION = `
You are Chatabot, a highly capable, helpful, accurate and intelligent AI assistant.

CORE BEHAVIOR:
- Understand the user's actual intent before answering.
- Give direct, useful and complete answers.
- Do not unnecessarily repeat the user's question.
- Use conversation history to maintain context.
- If the user asks a follow-up question, connect it to previous messages.
- Never invent facts, sources, statistics, quotations, links, names or events.
- If information is uncertain, clearly say so.
- Prefer accuracy over guessing.

REASONING:
- Think carefully before answering.
- Break complicated problems into logical steps when useful.
- For mathematics, calculate carefully and verify the result.
- For programming, reason about the code before suggesting changes.
- When debugging, identify the likely cause before proposing a fix.

VISION:
- You can analyze images supplied by the user.
- Carefully inspect the image before answering.
- Only describe things that can reasonably be determined from the image.
- Never invent visual details.
- If something is unclear, say that it is unclear.
- If the user asks about text inside an image, read it carefully.
- If the image contains code, explain or debug it when requested.

CODING:
- Provide complete working code when appropriate.
- Preserve existing functionality when modifying code.
- Avoid unnecessary dependencies.
- Check syntax and logic carefully.

CONVERSATION:
- Use relevant conversation context.
- Do not pretend to remember information that was not provided.
- Ask for clarification only when genuinely necessary.
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
    // AI CHAT
    // =========================================================
    if (
      url.pathname === "/api/chat" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const incomingMessages = Array.isArray(body?.messages)
          ? body.messages
          : [];

        const input = [];

        for (const message of incomingMessages) {
          if (!message) continue;

          const role =
            message.role === "assistant"
              ? "model"
              : message.role === "model"
                ? "model"
                : message.role === "user"
                  ? "user"
                  : null;

          if (!role) continue;

          // -----------------------------------------
          // STRING MESSAGE
          // -----------------------------------------
          if (typeof message.content === "string") {
            const text = message.content.trim();

            if (!text) continue;

            input.push({
              type: "text",
              text:
                role === "model"
                  ? `Assistant: ${text}`
                  : text
            });

            continue;
          }

          // -----------------------------------------
          // MULTIMODAL MESSAGE
          // -----------------------------------------
          if (Array.isArray(message.content)) {
            for (const part of message.content) {
              if (!part) continue;

              // Text part
              if (
                part.type === "text" &&
                typeof part.text === "string" &&
                part.text.trim()
              ) {
                input.push({
                  type: "text",
                  text:
                    role === "model"
                      ? `Assistant: ${part.text.trim()}`
                      : part.text.trim()
                });

                continue;
              }

              // Image part
              if (
                part.type === "image" &&
                typeof part.data === "string" &&
                part.data.trim()
              ) {
                let imageData = part.data.trim();

                let mimeType =
                  typeof part.mime_type === "string" &&
                  part.mime_type.trim()
                    ? part.mime_type.trim()
                    : "image/jpeg";

                // Support data URLs
                if (imageData.startsWith("data:")) {
                  const match = imageData.match(
                    /^data:([^;]+);base64,(.*)$/s
                  );

                  if (match) {
                    mimeType = match[1] || mimeType;
                    imageData = match[2];
                  }
                }

                input.push({
                  type: "image",
                  data: imageData,
                  mime_type: mimeType
                });
              }
            }
          }
        }

        if (!input.length) {
          input.push({
            type: "text",
            text: "Hello"
          });
        }

        const response = await geminiInteraction({
          model: CHAT_MODEL,
          system_instruction: SYSTEM_INSTRUCTION,
          input,
          store: false
        });

        const text = extractText(response);

        if (!text) {
          throw new Error(
            "Gemini returned an empty response."
          );
        }

        return jsonResponse({
          response: text,
          model: CHAT_MODEL
        });

      } catch (error) {
        console.error(
          "Chatabot Gemini chat error:",
          error
        );

        return jsonResponse(
          {
            error: "Chatabot AI error",
            details:
              error?.message ||
              String(error)
          },
          500
        );
      }
    }

    // =========================================================
    // IMAGE ANALYSIS
    // =========================================================
    if (
      url.pathname === "/api/vision" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const prompt =
          typeof body?.prompt === "string" &&
          body.prompt.trim()
            ? body.prompt.trim()
            : "Please analyze this image carefully and explain what you see.";

        let imageData =
          typeof body?.image === "string" &&
          body.image.trim()
            ? body.image.trim()
            : typeof body?.imageData === "string" &&
              body.imageData.trim()
              ? body.imageData.trim()
              : "";

        if (!imageData) {
          return jsonResponse(
            {
              error: "Image is required."
            },
            400
          );
        }

        let mimeType =
          typeof body?.mimeType === "string" &&
          body.mimeType.trim()
            ? body.mimeType.trim()
            : "image/jpeg";

        // -----------------------------------------
        // Convert data URL to pure base64
        // -----------------------------------------
        if (imageData.startsWith("data:")) {
          const match = imageData.match(
            /^data:([^;]+);base64,(.*)$/s
          );

          if (!match) {
            return jsonResponse(
              {
                error: "Invalid image data."
              },
              400
            );
          }

          mimeType = match[1] || mimeType;
          imageData = match[2];
        }

        const input = [
          {
            type: "text",
            text: prompt
          },
          {
            type: "image",
            data: imageData,
            mime_type: mimeType
          }
        ];

        const response = await geminiInteraction({
          model: CHAT_MODEL,
          system_instruction: `
You are Chatabot's image analysis assistant.

Analyze the supplied image carefully.

Rules:
- Describe only what can reasonably be determined from the image.
- Do not invent visual details.
- If something is blurry or uncertain, clearly say so.
- Read visible text when possible.
- Answer the user's specific question directly.
- If the user asks for identification, distinguish between what is visible and what is uncertain.
          `.trim(),
          input,
          store: false
        });

        const text = extractText(response);

        if (!text) {
          throw new Error(
            "Gemini returned an empty image analysis response."
          );
        }

        return jsonResponse({
          response: text,
          analysis: text,
          model: CHAT_MODEL
        });

      } catch (error) {
        console.error(
          "Chatabot Gemini Vision error:",
          error
        );

        return jsonResponse(
          {
            error: "Image analysis error",
            details:
              error?.message ||
              String(error)
          },
          500
        );
      }
    }

    // =========================================================
    // IMAGE GENERATION
    // =========================================================
    // Intentionally disabled in the free-only worker.
    //
    // Google's current Gemini API pricing does not list
    // Nano Banana image generation as having a free tier.
    // This prevents accidental paid API usage.
    // =========================================================
    if (
      url.pathname === "/api/image" &&
      request.method === "POST"
    ) {
      return jsonResponse(
        {
          error: "Image generation is not enabled in the free-only mode.",
          message:
            "Chatabot's free mode currently supports AI chat and image analysis. Image generation requires a Gemini image-generation model with paid API access."
        },
        403
      );
    }

    // =========================================================
    // VIDEO GENERATION
    // =========================================================
    // Intentionally disabled in the free-only worker.
    //
    // Veo / Gemini Omni video generation can incur API charges,
    // so this worker never calls those models automatically.
    // =========================================================
    if (
      url.pathname === "/api/video" &&
      request.method === "POST"
    ) {
      return jsonResponse(
        {
          error: "Video generation is not enabled in the free-only mode.",
          message:
            "Chatabot's current free mode does not make paid video-generation API calls."
        },
        403
      );
    }

    // =========================================================
    // HEALTH CHECK
    // =========================================================
    if (
      url.pathname === "/api/health" &&
      request.method === "GET"
    ) {
      return jsonResponse({
        ok: true,
        service: "Chatabot",
        chatModel: CHAT_MODEL,
        chat: true,
        imageAnalysis: true,
        imageGeneration: false,
        videoGeneration: false
      });
    }

    // =========================================================
    // WEBSITE / CLOUDFLARE ASSETS
    // =========================================================
    return env.ASSETS.fetch(request);
  }
};
