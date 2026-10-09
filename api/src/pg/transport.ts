// Transport TCP/TLS via cloudflare:sockets — import dynamique pour que ce
// module puisse etre charge cote Node (serveur local) sans evaluation.
import type { PgTransport } from './client.ts';

export async function cloudflareTransport(url: URL): Promise<PgTransport> {
  const mod = await import('cloudflare:sockets');
  const socket = mod.connect(
    { hostname: url.hostname, port: url.port ? Number(url.port) : 5432 },
    { secureTransport: 'on', allowHalfOpen: false },
  );
  await socket.opened;

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
