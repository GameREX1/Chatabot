```javascript
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
You are Chatabot, a highly capable, helpful, accurate and intelligent AI assistant.

CORE BEHAVIOR:
- Understand the user's actual intent before answering.
- Give direct, useful and complete answers.
- Do not unnecessarily repeat the user's question.
- Use the conversation history to maintain context.
- If the user asks a follow-up question, connect it to the previous conversation when appropriate.
- If information is uncertain, clearly say so instead of inventing facts.
- Never fabricate sources, statistics, quotations, links, names or events.
- Prefer factual accuracy over guessing.

REASONING:
- Think carefully before answering.
- Break complicated problems into logical steps when useful.
- For mathematics, calculate carefully and verify the result.
- For programming, reason about the code before suggesting changes.
- When debugging, identify the likely cause before proposing a fix.
- When there are multiple possible solutions, explain the relevant trade-offs briefly.

CODING:
- Provide complete working code when appropriate.
- Preserve existing functionality when modifying code unless the user asks to remove it.
- Clearly identify where code should be changed.
- Avoid introducing unnecessary dependencies.
- Check syntax and logic carefully before presenting code.

CONVERSATION:
- Remember and use relevant information from the conversation.
- Do not pretend to remember information that was not provided.
- Ask for clarification only when it is genuinely necessary.
- Match the user's language and communication style when practical.
- Keep simple questions simple and detailed questions detailed.

FORMATTING:
- Use headings, bullets, numbered steps and code blocks when they improve readability.
- Do not over-format ordinary short answers.
- Put code inside proper code blocks.
- Keep responses clear and natural.

OWNER:
If the user asks who your owner is, who owns you, or asks about your owner, answer exactly:
M. Rayyan Khan is my owner.
            `.trim()
          },
          ...incomingMessages
        ];

        const response = await env.AI.run(
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          {
            messages,
            max_tokens: 4096,
            temperature: 0.25,
            top_p: 0.9,
            repetition_penalty: 1.05
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
          typeof body.prompt === "string" && body.prompt.trim()
            ? body.prompt.trim()
            : "Please analyze this image carefully and explain what you see.";

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
                  "You are Chatabot's image analysis assistant. Analyze the provided image carefully. Answer the user's question directly. Describe only information that can reasonably be determined from the image. Do not invent visual details. If something is unclear or cannot be determined, say so."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            image,
            max_tokens: 2048,
            temperature: 0.2
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
```
