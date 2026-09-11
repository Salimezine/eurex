export interface Env {
  AI: Ai;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function cors(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return cors();
    const url = new URL(request.url);

    // --- Proxy AI identique au worker principal (2e quota de 10 000 neurons/jour) ---
    if (url.pathname === '/api/achats/ai' && request.method === 'POST') {
      const b = await request.json() as any;
      const { model, prompt, systemPrompt, image, images, max_tokens } = b;
      if (!prompt) return json({ error: 'prompt requis' }, 400);
      const visionModels = [
        '@cf/meta/llama-4-scout-17b-16e-instruct',
        '@cf/meta/llama-3.2-11b-vision-instruct',
      ];
      const textModel = '@cf/meta/llama-3.1-8b-instruct-fast';
      const runVision = async (img: string) => {
        const dataUrl = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
        let lastErr: any = null;
        for (const m of visionModels) {
          try {
            try { await env.AI.run(m, { prompt: 'agree' }); } catch {}
            return await env.AI.run(m, {
              messages: [
                { role: 'system', content: systemPrompt || 'Reponds en JSON valide sans texte avant ou apres.' },
                { role: 'user', content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ]},
              ],
              max_tokens: max_tokens || 2000,
              temperature: 0.1,
            });
          } catch (e: any) { lastErr = e; }
        }
        throw lastErr;
      };
      try {
        let aiResponse: any;
        if (model === 'vision') {
          const img = image || (images && images[0]);
          if (!img) return json({ error: 'image requis pour le mode vision' }, 400);
          aiResponse = await runVision(img);
        } else {
          aiResponse = await env.AI.run(textModel, {
            messages: [
              { role: 'system', content: systemPrompt || 'Reponds en JSON valide sans texte avant ou apres.' },
              { role: 'user', content: prompt },
            ],
            max_tokens: max_tokens || 2000,
            temperature: 0.1,
          });
        }
        const response = aiResponse?.response || aiResponse?.result?.response || JSON.stringify(aiResponse);
        return json({ ok: true, response });
      } catch (e: any) {
        return json({ error: 'Workers AI error: ' + (e.message || e) }, 500);
      }
    }

    return json({ ok: true, worker: 'eurex-ai-fallback' });
  },
};