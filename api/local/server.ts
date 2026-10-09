// Serveur local EUREX : execute le Worker (`src/index.ts`) directement dans Node.
//   DB         -> SQLite local (api/local/data/eurex.db) via adapter-d1.ts
//   DOCS_KV    -> disque (api/local/data/kv) via kv-disk.ts
//   AI         -> relais vers /internal/ai du Worker Cloudflare (Workers AI)
// Usage : npm run local (dans api/) — voir local/.env.example
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './adapter-d1.ts';
import { KVDisk } from './kv-disk.ts';
import { makeAIRelay } from './ai-relay.ts';
import worker from '../src/index.ts';

const __dir = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.EUREX_PORT || 8787);
const DATA = process.env.EUREX_DATA_DIR || path.join(__dir, 'data');
const DB_PATH = process.env.EUREX_DB_PATH || path.join(DATA, 'eurex.db');
const WORKER_URL = (process.env.EUREX_WORKER_URL || 'https://eurex-api.ezzinesalim21.workers.dev').replace(/\/+$/, '');
const SECRET = process.env.EUREX_INTERNAL_SECRET || '';
const TUNNEL_URL = (process.env.EUREX_TUNNEL_URL || '').replace(/\/+$/, '');

if (!fs.existsSync(DB_PATH)) {
  console.error('Base introuvable: ' + DB_PATH);
  console.error('Importez un dump: npm run migrate -- <dump.sql>');
  process.exit(1);
}

const d1 = openDatabase(DB_PATH);
const kv = new KVDisk(path.join(DATA, 'kv'));

const env: any = {
  DB: d1,
  COPY_DB: d1,
  DOCS_KV: kv,
  AI: makeAIRelay(WORKER_URL, SECRET),
  AI_FALLBACK_URLS: process.env.EUREX_AI_FALLBACK_URLS || '',
  ENVIRONMENT: 'local',
};

function toRequest(req: http.IncomingMessage, body?: Buffer): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    const l = k.toLowerCase();
    if (l === 'content-length' || l === 'transfer-encoding' || l === 'connection' || l === 'keep-alive') continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const host = (req.headers.host as string) || '127.0.0.1';
  const init: RequestInit = { method: req.method || 'GET', headers };
  if (body && body.length) (init as any).body = body;
  return new Request(`http://${host}${req.url}`, init);
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  try {
    if (req.url === '/_local/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, db: DB_PATH, ts: new Date().toISOString() }));
      return;
    }
    if (req.url === '/_local/backup') {
      await localBackup(new Date(), true);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, dir: path.join(DATA, 'backups') }));
      return;
    }
    let body: Buffer | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      if (chunks.length) body = Buffer.concat(chunks);
    }
    const resp = await worker.fetch(toRequest(req, body), env);
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      const l = k.toLowerCase();
      if (l === 'content-length' || l === 'transfer-encoding') return;
      headers[k] = v;
    });
    const buf = resp.body ? Buffer.from(await resp.arrayBuffer()) : Buffer.alloc(0);
    res.writeHead(resp.status, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
    console.log(`${req.method} ${req.url} -> ${resp.status} (${Date.now() - t0}ms)`);
  } catch (e: any) {
    console.error(`ERREUR ${req.method} ${req.url}:`, e?.stack || e);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Serveur local: ' + (e?.message || String(e)) }));
    } else res.end();
  }
});

// --- Crons locaux (UTC, comme Cloudflare) -----------------------------------
const fakeCtx: any = {
  waitUntil(p: any) { if (p?.catch) p.catch((e: any) => console.error('waitUntil:', e?.message || e)); },
  passThroughOnException() {},
};
let lastRollover = '';
let lastBackup = '';

async function localBackup(now: Date, force = false) {
  const day = now.toISOString().slice(0, 10);
  if (lastBackup === day && !force) return;
  lastBackup = day;
  const dir = path.join(DATA, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `eurex-${day}.db`);
  try {
    d1.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(dir).filter(f => f.startsWith('eurex-')).sort();
    while (old.length > 7) fs.unlinkSync(path.join(dir, old.shift()!));
    console.log(`[cron] backup local -> ${target}`);
  } catch (e: any) {
    console.error('[cron] backup FAILED:', e?.message || e);
    return;
  }
  // Copie cloud : gzip + POST /internal/backup (Worker KV, gardees 7 jours)
  if (SECRET) {
    try {
      const gz = gzipSync(fs.readFileSync(target));
      const res = await fetch(WORKER_URL + '/internal/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': SECRET },
        body: JSON.stringify({ name: path.basename(target) + '.gz', data_b64: gz.toString('base64') }),
        signal: AbortSignal.timeout(60_000),
      });
      const data: any = await res.json().catch(() => null);
      console.log(res.ok && data?.ok
        ? `[cron] backup cloud OK (${data.size} o -> KV)`
        : `[cron] backup cloud KO: HTTP ${res.status} ${JSON.stringify(data)}`);
    } catch (e: any) {
      console.error('[cron] backup cloud FAILED:', e?.message || e);
    }
  }
}

async function tick() {
  const now = new Date();
  const h = now.getUTCHours(), m = now.getUTCMinutes();
  if (h === 2 && m === 0) await localBackup(now);
  const year = now.getUTCFullYear();
  if (now.getUTCMonth() === 0 && now.getUTCDate() === 1 && h === 0 && m === 15 && lastRollover !== String(year)) {
    lastRollover = String(year);
    try {
      await worker.scheduled({ cron: '15 0 1 1 *' } as any, env, fakeCtx);
      console.log('[cron] rollover exercice ' + year);
    } catch (e: any) {
      console.error('[cron] rollover FAILED:', e?.message || e);
    }
  }
}

// --- Relais : annonce au Worker l'URL du tunnel (P2 : /internal/*) ---------
let lastBeat = 0;
let lastBeatMode = '';
async function heartbeat() {
  if (!TUNNEL_URL || !SECRET) return;
  const now = Date.now();
  if (now - lastBeat < 60_000) return;
  lastBeat = now;
  try {
    const res = await fetch(WORKER_URL + '/internal/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': SECRET },
      body: JSON.stringify({ url: TUNNEL_URL, db: path.basename(DB_PATH) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return; // endpoint pas encore deploye (P2)
    const data: any = await res.json().catch(() => null);
    if (!res.ok) { console.warn('[relay] heartbeat HTTP ' + res.status); return; }
    if (data?.mode !== lastBeatMode) {
      lastBeatMode = data?.mode || '?';
      console.log('[relay] heartbeat -> mode=' + lastBeatMode + (lastBeatMode === 'cloud' ? ' (pas encore bascule, relais inactif)' : ' (relais actif)'));
    }
  } catch (e: any) {
    if (lastBeatMode !== 'KO') console.warn('[relay] heartbeat KO:', e?.message || e);
    lastBeatMode = 'KO';
  }
}

server.listen(PORT, '0.0.0.0', async () => {
  console.log('EUREX local -> http://127.0.0.1:' + PORT);
  console.log('  DB    : ' + DB_PATH);
  console.log('  KV    : ' + path.join(DATA, 'kv'));
  console.log('  Worker: ' + WORKER_URL + (TUNNEL_URL ? '  (tunnel ' + TUNNEL_URL + ')' : ''));
  await tick();
  setInterval(tick, 30_000);
  setInterval(heartbeat, 30_000);
  heartbeat();
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log('\nArrêt du serveur local.');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  });
}
