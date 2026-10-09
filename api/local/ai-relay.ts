// Env.AI local : relais vers l'endpoint interne /internal/ai du Worker Cloudflare
// (Workers AI + quota 10k neurons/jour restent côté Cloudflare).
export function makeAIRelay(workerUrl: string, secret: string) {
  return {
    async run(model: string, opts: any): Promise<any> {
      const res = await fetch(workerUrl.replace(/\/$/, '') + '/internal/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
        body: JSON.stringify({ model, opts }),
      });
      const data: any = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || 'AI relay HTTP ' + res.status);
      if (!data || !data.ok) throw new Error((data && data.error) || 'AI relay erreur');
      return data.result;
    },
  };
}
