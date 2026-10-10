// Transport TCP/TLS via cloudflare:sockets — import dynamique pour que ce
// module puisse etre charge cote Node (serveur local) sans evaluation.
//
// TLS : secureTransport:'starttls' + startTls() et NON secureTransport:'on'.
// Mesure (2026-10-10) depuis un Worker : 'on' echoue systematiquement avec
//   "proxy request failed, cannot connect to the specified address"
// sur host:5432 et host:6543 (Supabase direct + pooler), alors que le meme
// hote en TCP brut ouvre sans probleme. Le pattern 'starttls' + startTls()
// est celui documente par Cloudflare pour les protocoles de bases de donnees.
//
// Et surtout : Postgres n'entame le TLS qu'apres un SSLRequest envoye EN CLAIR.
//   client -> Int32(8) Int32(80877103)
//   server -> 1 octet 'S' (ou 'N' = refuse)
//   puis   -> handshake TLS, puis StartupMessage dedans.
// Un ClientHello intempestif fait fermer la connexion par le serveur
// (observe en local : "EOF inattendu de 0 octet", en Worker : "TLS Handshake
// Failed"), exactement ce que produisait ce transport avant cette correction.
// PgClient ecrit P.startup() des que le transport est prêt, donc tout ce
// rituel appartient ici.
import type { PgTransport } from './client.ts';

/** Int32(8) suivi du code de demande SSL (80877103 = 0x04D2162F). */
const SSL_REQUEST = new Uint8Array([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]);
const SSL_OK = 0x53; // 'S'
const SSL_REFUSED = 0x4e; // 'N'
const SSL_EXCHANGE_TIMEOUT_MS = 15_000;

/**
 * Envoie un SSLRequest et rend la decision TLS, comme le `sslmode=prefer` de
 * libpq :
 *   'S' -> le serveur accepte le TLS, il faut appeler startTls() ;
 *   'N' -> le serveur refuse, on reste en clair (cas d'Hyperdrive, dont
 *          l'endpoint est interne a Cloudflare en TCP clair).
 *   autre / fermeture -> erreur.
 */
async function sslHandshake(plain: {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}): Promise<boolean> {
  const writer = plain.writable.getWriter();
  try {
    await writer.write(SSL_REQUEST);
  } finally {
    writer.releaseLock();
  }

  const reader = plain.readable.getReader();
  let reply: number | undefined;
  try {
    const deadline = Date.now() + SSL_EXCHANGE_TIMEOUT_MS;
    for (;;) {
      if (Date.now() > deadline) throw new Error('SSLRequest : pas de reponse du serveur');
      const { done, value } = await reader.read();
      if (done || !value || value.length === 0) throw new Error('SSLRequest : connexion fermee sans reponse');
      if (reply === undefined) reply = value[0];
      // Le serveur ne renvoie qu'un unique octet avant d'attendre la suite :
      // tout octet supplementaire serait perdu par startTls().
      if (value.length > 1) throw new Error(`SSLRequest : ${value.length} octets recus au lieu de 1`);
      break;
    }
  } finally {
    reader.releaseLock();
  }

  if (reply === SSL_OK) return true;
  if (reply === SSL_REFUSED) return false;
  throw new Error(`SSLRequest : reponse inattendue 0x${(reply ?? 0).toString(16)}`);
}

export async function cloudflareTransport(url: URL): Promise<PgTransport> {
  const mod = await import('cloudflare:sockets');
  const plain = mod.connect(
    { hostname: url.hostname, port: url.port ? Number(url.port) : 5432 },
    { secureTransport: 'starttls', allowHalfOpen: false },
  );
  await plain.opened;
  // startTls() ferme le socket d'origine : tous les lecteurs/ecrivains
  // ci-dessous doivent etre pris sur le socket securise.
  const useTls = await sslHandshake(plain);
  const socket = useTls ? plain.startTls() : plain;
  if (useTls) await socket.opened;

  const writer = socket.writable.getWriter();
  // Callbacks dans un objet : le narrowing sur des variables captuees par des
  // closures (IIFE de lecture) se termine en `never` avec strict + flux ici.
  const cbs: { data?: (b: Uint8Array) => void; close?: (e: Error | null) => void } = {};
  let closed = false;

  const fireClose = (e: Error | null) => {
    if (closed) return;
    closed = true;
    if (cbs.close) cbs.close(e);
  };

  (async () => {
    const reader = socket.readable.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && cbs.data) cbs.data(value);
      }
      fireClose(null);
    } catch (e) {
      fireClose(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return {
    async write(bytes: Uint8Array) {
      try {
        await writer.write(bytes);
      } catch (e) {
        fireClose(e instanceof Error ? e : new Error(String(e)));
        throw e;
      }
    },
    onData(cb) { cbs.data = cb; },
    onClose(cb) { cbs.close = cb; if (closed) cb(null); },
    close() {
      try { socket.close(); } catch { /* deja ferme */ }
      fireClose(null);
    },
  };
}
