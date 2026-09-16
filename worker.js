export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // AI CHAT
    // =========================
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();

        const incomingMessages = Array.isArray(body.messages)
          ? body.messages
          : [];

        const messages = [
          {
            role: "system",
            content: `
You are Chatabot, a helpful, accurate, intelligent AI assistant.

IMPORTANT RULES:
- Give complete answers and do not stop unnecessarily early.
- Explain difficult questions step by step when useful.
- For mathematics, calculate carefully and verify the final answer.
- For science and medical topics, provide accurate educational information and clearly mention uncertainty when appropriate.
- Do not invent facts, sources, statistics, or references.
- If you are unsure about something, say so instead of making up an answer.
- Keep answers relevant to the user's question.
- Use clear formatting with headings, numbered steps, bullet points, and code blocks when useful.
- For coding questions, provide complete working solutions when possible.
- Remember the conversation context provided in the messages.
- If the user asks who your owner is, who owns you, or asks about your owner, answer exactly:
M. Rayyan Khan is my owner.
            `.trim()
          },
          ...incomingMessages
        ];

        const response = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fp8",
          {
            messages,
            max_tokens: 2048,
            temperature: 0.3,
            top_p: 0.9
          }
        );

        return Response.json(response);

      } catch (error) {
        console.error("Chatabot AI error:", error);

        return Response.json(
          {
            error: "Chatabot AI error",
            details: error?.message || String(error)
          },
          { status: 500 }
        );
      }
    }


    // =========================
    // IMAGE ANALYSIS
    // =========================
    if (url.pathname === "/api/vision" && request.method === "POST") {
      try {
        const body = await request.json();

        const prompt =
          body.prompt ||
          "Please analyze this image carefully and explain what you see.";

        const image = body.image;

        if (!image) {
          return Response.json(
            {
              error: "Image is required."
            },
            { status: 400 }
          );
        }

        const response = await env.AI.run(
          "@cf/meta/llama-3.2-11b-vision-instruct",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are Chatabot. Analyze images carefully and answer the user's question accurately. Do not invent details that cannot be determined from the image."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            image,
            max_tokens: 1024,
            temperature: 0.3
          }
        );

        return Response.json(response);

      } catch (error) {
        console.error("Image analysis error:", error);

        return Response.json(
          {
            error: "Image analysis error",
            details: error?.message || String(error)
          },
          { status: 500 }
        );
      }
    }


    // =========================
    // IMAGE GENERATION
    // =========================
    if (url.pathname === "/api/image" && request.method === "POST") {
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

        const image = await env.AI.run(
          "@cf/black-forest-labs/flux-1-schnell",
          {
            prompt
          }
        );

        return Response.json({
          image: image.image
        });

      } catch (error) {
        console.error("Image generation error:", error);

        return Response.json(
          {
            error: "Image generation error",
            details: error?.message || String(error)
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
