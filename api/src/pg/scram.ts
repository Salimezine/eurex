// SCRAM-SHA-256 (RFC 5802 / 7677) — cote client, via Web Crypto (Workers + Node).
const enc = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

function esc(s: string): string {
  return s.replace(/=/g, '=3D').replace(/,/g, '=2C');
}

export interface ScramState {
  nonce: string;
  clientFirstBare: string;
}

export function scramStart(username: string, nonce?: string): { state: ScramState; clientFirstMessage: string } {
  if (!nonce) {
    const rnd = new Uint8Array(18);
    crypto.getRandomValues(rnd);
    nonce = toB64(rnd);
  }
  const clientFirstBare = 'n=' + esc(username) + ',r=' + nonce;
  return {
    state: { nonce, clientFirstBare },
    // gs2 header "n,," (authentification salée, channel binding non supporte)
    clientFirstMessage: 'n,,' + clientFirstBare,
  };
}

function parseAttrs(s: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of s.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    m.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return m;
}

export interface ScramFinal {
  clientFinalMessage: string;
  // Verifie le ServerSignature (v=) recu dans le message final du serveur
  verifyServer(serverFinalMessage: string): boolean;
}

export async function scramFinal(
  state: ScramState,
  serverFirstMessage: string,
  password: string,
): Promise<ScramFinal> {
  const attrs = parseAttrs(serverFirstMessage);
  const serverNonce = attrs.get('r') || '';
  const saltB64 = attrs.get('s') || '';
  const iterations = Number(attrs.get('i') || '0');
  if (!serverNonce.startsWith(state.nonce)) throw new Error('SCRAM: nonce du serveur ne continue pas le nonce client');
  if (!saltB64 || !iterations) throw new Error('SCRAM: message serveur invalide (s/i manquants)');

  const withoutProof = 'c=' + toB64(enc.encode('n,,')) + ',r=' + serverNonce;
  const authMessage = state.clientFirstBare + ',' + serverFirstMessage + ',' + withoutProof;

  const salted = await pbkdf2(password, fromB64(saltB64), iterations);
  const clientKey = await hmac(salted, 'Client Key');
  const storedKey = await sha256(clientKey);
  const clientSig = await hmac(storedKey, authMessage);
  const proof = xor(clientKey, clientSig);

  const serverKey = await hmac(salted, 'Server Key');
  const serverSig = await hmac(serverKey, authMessage);

  return {
    clientFinalMessage: withoutProof + ',p=' + toB64(proof),
    verifyServer(serverFinalMessage: string): boolean {
      const a = parseAttrs(serverFinalMessage);
      const v = a.get('v');
      if (!v) return false;
      const expected = toB64(serverSig);
      if (v.length !== expected.length) return false;
      let diff = 0;
      for (let i = 0; i < v.length; i++) diff |= v.charCodeAt(i) ^ expected.charCodeAt(i);
      return diff === 0;
    },
  };
}
