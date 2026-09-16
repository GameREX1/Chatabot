export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // AI CHAT
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();

        const response = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fp8",
          {
            messages: body.messages || []
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
