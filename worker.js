export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // CHATABOT CONFIGURATION
    // =========================================================

    const GEMINI_CHAT_MODEL = "gemini-2.5-flash";

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

      if (
        /\b(generate|create|make|draw)\b/.test(value) &&
        /\b(image|picture|photo|art|wallpaper|logo)\b/.test(value)
      ) {
        return "image-generation";
      }

      if (
        /\b(generate|create|make)\b/.test(value) &&
        /\b(video|animation|clip)\b/.test(value)
      ) {
        return "video-generation";
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
          seed: Math.floor(
            Math.random() * 1000000000
          ),
        }
      );

      if (!result) {
        throw new Error(
          "FLUX.1 Schnell returned an empty response."
        );
      }

      if (
        typeof result.image !== "string" ||
        !result.image
      ) {
        throw new Error(
          "FLUX.1 Schnell did not return an image."
        );
      }

      return result.image;
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
        // VIDEO REQUESTS
        // -------------------------------------------------------

        if (
          agent ===
          "video-generation"
        ) {
          return jsonResponse({
            success: false,
            type:
              "video-generation",
            agent:
              "Video Generation Agent",
            message:
              "Video generation is not connected yet. The Chatabot routing system is ready for a dedicated video-generation provider.",
          });
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
                text: answer,
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
              text: answer,
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
