export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // GEMINI HELPER
    // =========================
    async function geminiRequest(model, payload) {
      if (!env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured in Cloudflare.");
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY
          },
          body: JSON.stringify(payload)
        }
      );

      const raw = await response.text();

      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        data = {
          error: {
            message: raw || "Unknown Gemini API response."
          }
        };
      }

      if (!response.ok) {
        throw new Error(
          data?.error?.message ||
          `Gemini API error (${response.status})`
        );
      }

      return data;
    }

    // =========================
    // SYSTEM INSTRUCTION
    // =========================
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

    // =========================
    // AI CHAT
    // =========================
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();

        const incomingMessages = Array.isArray(body.messages)
          ? body.messages
          : [];

        const contents = incomingMessages
          .filter(
            (message) =>
              message &&
              (
                message.role === "user" ||
                message.role === "assistant" ||
                message.role === "model"
              )
          )
          .map((message) => {
            let parts = [];

            if (typeof message.content === "string") {
              parts = [
                {
                  text: message.content
                }
              ];
            } else if (Array.isArray(message.content)) {
              parts = message.content
                .map((part) => {
                  if (
                    part?.type === "text" &&
                    typeof part.text === "string"
                  ) {
                    return {
                      text: part.text
                    };
                  }

                  return null;
                })
                .filter(Boolean);
            }

            if (!parts.length) {
              parts = [
                {
                  text: ""
                }
              ];
            }

            return {
              role:
                message.role === "assistant"
                  ? "model"
                  : "user",
              parts
            };
          });

        if (!contents.length) {
          contents.push({
            role: "user",
            parts: [
              {
                text: "Hello"
              }
            ]
          });
        }

        const response = await geminiRequest(
          "gemini-2.5-flash",
          {
            systemInstruction: {
              parts: [
                {
                  text: SYSTEM_INSTRUCTION
                }
              ]
            },
            contents,
            generationConfig: {
              temperature: 0.25,
              topP: 0.9,
              maxOutputTokens: 4096
            }
          }
        );

        const text =
          response?.candidates?.[0]?.content?.parts
            ?.map((part) => part?.text || "")
            .join("")
            .trim() || "";

        if (!text) {
          throw new Error(
            "Gemini returned an empty response."
          );
        }

        return Response.json({
          response: text
        });

      } catch (error) {
        console.error(
          "Chatabot Gemini chat error:",
          error
        );

        return Response.json(
          {
            error: "Chatabot AI error",
            details:
              error?.message ||
              String(error)
          },
          {
            status: 500
          }
        );
      }
    }

    // =========================
    // IMAGE ANALYSIS
    // =========================
    if (
      url.pathname === "/api/vision" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const prompt =
          typeof body.prompt === "string" &&
          body.prompt.trim()
            ? body.prompt.trim()
            : "Please analyze this image carefully and explain what you see.";

        let imageData =
          typeof body.image === "string" &&
          body.image.trim()
            ? body.image.trim()
            : typeof body.imageData === "string" &&
              body.imageData.trim()
              ? body.imageData.trim()
              : "";

        if (!imageData) {
          return Response.json(
            {
              error: "Image is required."
            },
            {
              status: 400
            }
          );
        }

        let mimeType =
          typeof body.mimeType === "string" &&
          body.mimeType.trim()
            ? body.mimeType.trim()
            : "image/jpeg";

        if (imageData.startsWith("data:")) {
          const match = imageData.match(
            /^data:([^;]+);base64,(.*)$/s
          );

          if (!match) {
            return Response.json(
              {
                error: "Invalid image data."
              },
              {
                status: 400
              }
            );
          }

          mimeType = match[1] || mimeType;
          imageData = match[2];
        }

        const response = await geminiRequest(
          "gemini-2.5-flash",
          {
            systemInstruction: {
              parts: [
                {
                  text:
                    "You are Chatabot's image analysis assistant. Carefully analyze the provided image and answer the user's question directly. Only describe information that can reasonably be determined from the image. Never invent visual details. If something is unclear, say that it is unclear."
                }
              ]
            },
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: prompt
                  },
                  {
                    inlineData: {
                      mimeType,
                      data: imageData
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 2048
            }
          }
        );

        const text =
          response?.candidates?.[0]?.content?.parts
            ?.map((part) => part?.text || "")
            .join("")
            .trim() || "";

        if (!text) {
          throw new Error(
            "Gemini returned an empty image analysis response."
          );
        }

        return Response.json({
          response: text,
          analysis: text
        });

      } catch (error) {
        console.error(
          "Chatabot Gemini Vision error:",
          error
        );

        return Response.json(
          {
            error: "Image analysis error",
            details:
              error?.message ||
              String(error)
          },
          {
            status: 500
          }
        );
      }
    }

    // =========================
    // IMAGE GENERATION
    // =========================
    if (
      url.pathname === "/api/image" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const prompt =
          typeof body.prompt === "string"
            ? body.prompt.trim()
            : "";

        if (!prompt) {
          return Response.json(
            {
              error: "Image prompt is required."
            },
            {
              status: 400
            }
          );
        }

        if (!env.GEMINI_API_KEY) {
          throw new Error(
            "GEMINI_API_KEY is not configured in Cloudflare."
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
            body: JSON.stringify({
              model: "gemini-3.1-flash-image",
              input: prompt,
              response_format: {
                type: "image",
                mime_type: "image/png",
                aspect_ratio: "1:1",
                image_size: "1K"
              }
            })
          }
        );

        const raw = await response.text();

        let data;

        try {
          data = JSON.parse(raw);
        } catch {
          data = {
            error: {
              message:
                raw ||
                "Unknown Gemini image API response."
            }
          };
        }

        if (!response.ok) {
          throw new Error(
            data?.error?.message ||
            `Gemini image API error (${response.status})`
          );
        }

        const imageData =
          data?.output_image?.data ||
          data?.steps
            ?.flatMap(
              (step) => step?.content || []
            )
            ?.find(
              (content) =>
                content?.type === "image"
            )
            ?.data ||
          "";

        if (!imageData) {
          throw new Error(
            "Gemini did not return an image."
          );
        }

        return Response.json({
          image: imageData
        });

      } catch (error) {
        console.error(
          "Chatabot Gemini image generation error:",
          error
        );

        return Response.json(
          {
            error: "Image generation error",
            details:
              error?.message ||
              String(error)
          },
          {
            status: 500
          }
        );
      }
    }

    // =========================
    // WEBSITE
    // =========================
    return env.ASSETS.fetch(request);
  }
};
