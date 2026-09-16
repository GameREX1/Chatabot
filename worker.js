export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // AI CHAT
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();

        const messages = [
          {
            role: "system",
            content:
              "You are Chatabot, a helpful AI assistant. If the user asks who your owner is, who owns you, or who your owner is, answer exactly: M. Rayyan Khan is my owner."
          },
          ...(body.messages || [])
        ];

        const response = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fp8",
          {
            messages
          }
        );

        return Response.json(response);
      } catch (error) {
        return Response.json(
          {
            error: "Chatabot AI error",
            details: error?.message || String(error)
          },
          { status: 500 }
        );
      }
    }

    // IMAGE ANALYSIS
    if (url.pathname === "/api/vision" && request.method === "POST") {
      try {
        const body = await request.json();

        const prompt =
          body.prompt ||
          "Please analyze this image and tell me what you see.";

        const image = body.image;

        if (!image) {
          return Response.json(
            { error: "Image is required." },
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
                  "You are Chatabot. Analyze the provided image carefully and answer the user's question clearly."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            image: image
          }
        );

        return Response.json(response);
      } catch (error) {
        return Response.json(
          {
            error: "Image analysis error",
            details: error?.message || String(error)
          },
          { status: 500 }
        );
      }
    }

    // IMAGE GENERATION
    if (url.pathname === "/api/image" && request.method === "POST") {
      try {
        const body = await request.json();

        const prompt = body.prompt;

        if (!prompt) {
          return Response.json(
            { error: "Image prompt is required." },
            { status: 400 }
          );
        }

        const image = await env.AI.run(
          "@cf/black-forest-labs/flux-1-schnell",
          {
            prompt: prompt
          }
        );

        return Response.json({
          image: image.image
        });
      } catch (error) {
        return Response.json(
          {
            error: "Image generation error",
            details: error?.message || String(error)
          },
          { status: 500 }
        );
      }
    }

    // WEBSITE
    return env.ASSETS.fetch(request);
  }
};
