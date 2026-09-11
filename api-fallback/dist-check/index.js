var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
__name(json, "json");
function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
__name(cors, "cors");
var index_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return cors();
    const url = new URL(request.url);
    if (url.pathname === "/api/achats/ai" && request.method === "POST") {
      const b = await request.json();
      const { model, prompt, systemPrompt, image, images, max_tokens } = b;
      if (!prompt) return json({ error: "prompt requis" }, 400);
      const visionModels = [
        "@cf/meta/llama-4-scout-17b-16e-instruct",
        "@cf/meta/llama-3.2-11b-vision-instruct"
      ];
      const textModel = "@cf/meta/llama-3.1-8b-instruct-fast";
      const runVision = /* @__PURE__ */ __name(async (img) => {
        const dataUrl = img.startsWith("data:") ? img : `data:image/png;base64,${img}`;
        let lastErr = null;
        for (const m of visionModels) {
          try {
            try {
              await env.AI.run(m, { prompt: "agree" });
            } catch {
            }
            return await env.AI.run(m, {
              messages: [
                { role: "system", content: systemPrompt || "Reponds en JSON valide sans texte avant ou apres." },
                { role: "user", content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: dataUrl } }
                ] }
              ],
              max_tokens: max_tokens || 2e3,
              temperature: 0.1
            });
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr;
      }, "runVision");
      try {
        let aiResponse;
        if (model === "vision") {
          const img = image || images && images[0];
          if (!img) return json({ error: "image requis pour le mode vision" }, 400);
          aiResponse = await runVision(img);
        } else {
          aiResponse = await env.AI.run(textModel, {
            messages: [
              { role: "system", content: systemPrompt || "Reponds en JSON valide sans texte avant ou apres." },
              { role: "user", content: prompt }
            ],
            max_tokens: max_tokens || 2e3,
            temperature: 0.1
          });
        }
        const response = aiResponse?.response || aiResponse?.result?.response || JSON.stringify(aiResponse);
        return json({ ok: true, response });
      } catch (e) {
        return json({ error: "Workers AI error: " + (e.message || e) }, 500);
      }
    }
    return json({ ok: true, worker: "eurex-ai-fallback" });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
