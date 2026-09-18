export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // GEMINI INTERACTIONS HELPER
    // =========================
    async function geminiInteraction(payload) {
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error?.message ||
          data?.message ||
          `Gemini API error (${response.status})`
        );
      }

      return data;
    }

    // =========================
    // EXTRACT TEXT FROM INTERACTION
    // =========================
    function extractText(data) {
      if (typeof data?.output_text === "string") {
        return data.output_text.trim();
      }

      const outputs = Array.isArray(data?.outputs)
        ? data.outputs
        : [];

      const outputText = outputs
        .filter(
          (item) =>
            item &&
            (
              item.type === "text" ||
              item.type === "model_output"
            )
        )
        .flatMap((item) => {
          if (typeof item.text === "string") {
            return [item.text];
          }

          if (Array.isArray(item.content)) {
            return item.content
              .filter(
                (content) =>
                  content &&
                  content.type === "text" &&
                  typeof content.text === "string"
              )
              .map((content) => content.text);
          }

          return [];
        })
        .join("")
        .trim();

      if (outputText) {
        return outputText;
      }

      const steps = Array.isArray(data?.steps)
        ? data.steps
        : [];

      return steps
        .filter(
          (step) =>
            step &&
            (
              step.type === "model_output" ||
              step.type === "text"
            )
        )
        .flatMap((step) => {
          if (typeof step.text === "string") {
            return [step.text];
          }

          if (Array.isArray(step.content)) {
            return step.content
              .filter(
                (content) =>
                  content &&
                  content.type === "text" &&
                  typeof content.text === "string"
              )
              .map((content) => content.text);
          }

          return [];
        })
        .join("")
        .trim();
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
    if (
      url.pathname === "/api/chat" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const incomingMessages = Array.isArray(body.messages)
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

          if (typeof message.content === "string") {
            input.push({
              type: "text",
              text:
                role === "model"
                  ? `Assistant: ${message.content}`
                  : message.content
            });

            continue;
          }

          if (Array.isArray(message.content)) {
            const textParts = message.content
              .filter(
                (part) =>
                  part &&
                  part.type === "text" &&
                  typeof part.text === "string"
              )
              .map((part) => part.text);

            if (textParts.length) {
              input.push({
                type: "text",
                text:
                  role === "model"
                    ? `Assistant: ${textParts.join("\n")}`
                    : textParts.join("\n")
              });
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
          model: "gemini-3.8-flash",
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
          { status: 500 }
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
            { status: 400 }
          );
        }

        let mimeType =
          typeof body.mimeType === "string" &&
          body.mimeType.trim()
            ? body.mimeType.trim()
            : "image/jpeg";

        // Convert data URL into pure base64.
        if (imageData.startsWith("data:")) {
          const match = imageData.match(
            /^data:([^;]+);base64,(.*)$/s
          );

          if (!match) {
            return Response.json(
              {
                error: "Invalid image data."
              },
              { status: 400 }
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
          model: "gemini-3.8-flash",
          system_instruction:
            "You are Chatabot's image analysis assistant. Carefully analyze the provided image and answer the user's question directly. Only describe information that can reasonably be determined from the image. Never invent visual details. If something is unclear, say that it is unclear.",
          input,
          store: false
        });

        const text = extractText(response);

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
          { status: 500 }
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
            { status: 400 }
          );
        }

        const response = await geminiInteraction({
          model: "gemini-3.1-flash-image",
          input: prompt,
          response_format: {
            type: "image",
            mime_type: "image/png",
            aspect_ratio: "1:1",
            image_size: "1K"
          },
          store: false
        });

        const imageData =
          response?.output_image?.data ||
          response?.outputs
            ?.flatMap((item) =>
              Array.isArray(item?.content)
                ? item.content
                : []
            )
            ?.find(
              (content) =>
                content?.type === "image" &&
                typeof content?.data === "string"
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
          { status: 500 }
        );
      }
    }

    // =========================
    // WEBSITE
    // =========================
    return env.ASSETS.fetch(request);
  }
};
