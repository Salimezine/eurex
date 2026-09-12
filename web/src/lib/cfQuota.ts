export interface QuotaStatus {
  mode: 'exact' | 'probe' | 'error';
  available: boolean;
  usedNeurons: number | null;
  remainingNeurons: number | null;
  message: string;
}

const CF_ACCOUNT_ID = '7923ab56e04f76467ba94aa508a8f018';
const DAILY_BUDGET = 10000;

const CF_API_TOKEN = import.meta.env.VITE_CF_API_TOKEN as string | undefined;
const CF_ANALYTICS_TOKEN = import.meta.env.VITE_CF_ANALYTICS_TOKEN as string | undefined;
const PROBE_MODEL = '@cf/meta/llama-3.2-1b-instruct';

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function todayUTC(): { start: string; end: string } {
  const d = new Date();
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return { start: `${date}T00:00:00Z`, end: `${date}T23:59:59Z` };
}

function formatNumber(n: number): string {
  return n.toLocaleString('fr-FR');
}

async function queryUsedNeurons(token: string): Promise<number | null> {
  const { start, end } = todayUTC();
  const query = `{
    viewer {
      accounts(filter: {accountTag: "${CF_ACCOUNT_ID}"}) {
        aiInferenceAdaptiveGroups(
          limit: 5
          filter: {datetime_geq: "${start}", datetime_leq: "${end}"}
        ) {
          sum {
            totalNeurons
          }
        }
      }
    }
  }`;

  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const data = await r.json();

  if (!data || data.errors || !data.data) return null;
  const nodes = data.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
  if (!nodes || nodes.length === 0) return 0;
  const used = nodes.reduce((s: number, n: any) => s + (n?.sum?.totalNeurons || 0), 0);
  return used;
}

async function probeQuota(): Promise<boolean> {
  if (!CF_API_TOKEN) return false;
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${PROBE_MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
        }),
      }
    );
    const data = await r.json();
    if (data && data.success) return true;
    if (Array.isArray(data?.errors) && data.errors.some((e: any) => e.code === 4006)) return false;
    return false;
  } catch {
    return false;
  }
}

export async function checkQuota(): Promise<QuotaStatus> {
  const tokens = [CF_ANALYTICS_TOKEN, CF_API_TOKEN].filter((t): t is string => !!t);

  if (tokens.length > 0) {
    for (const token of tokens) {
      try {
        const used = await queryUsedNeurons(token);
        if (used !== null) {
          const remaining = DAILY_BUDGET - used;
          return {
            mode: 'exact',
            available: remaining > 0,
            usedNeurons: used,
            remainingNeurons: remaining,
            message: `${formatNumber(used)} / ${formatNumber(DAILY_BUDGET)} neurons`,
          };
        }
      } catch {
        // try next token
      }
    }
  }

  if (CF_API_TOKEN) {
    const ok = await probeQuota();
    return {
      mode: 'probe',
      available: ok,
      usedNeurons: null,
      remainingNeurons: null,
      message: ok ? 'Quota AI disponible' : 'Quota AI épuisé (10k/jour)',
    };
  }

  return {
    mode: 'error',
    available: false,
    usedNeurons: null,
    remainingNeurons: null,
    message: 'Token AI manquant (VITE_CF_API_TOKEN)',
  };
}