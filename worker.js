export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // AI chat API
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
            details: error.message
          },
          { status: 500 }
        );
      }
    }

    // Serve the website
    return env.ASSETS.fetch(request);
  }
};
