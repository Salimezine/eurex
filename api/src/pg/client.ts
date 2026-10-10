// Client PostgreSQL minimal pour Cloudflare Workers : connexion TLS via
// cloudflare:sockets (transport injecte), authentification SCRAM-SHA-256,
// protocole etendu (Parse/Bind/Execute), file d'attente serialisant les
// requetes sur une connexion unique.
import { scramStart, scramFinal } from './scram.ts';
import { md5PasswordResponse } from './md5.ts';
import * as P from './protocol.ts';

export interface PgTransport {
  write(bytes: Uint8Array): Promise<void>;
  onData(cb: (bytes: Uint8Array) => void): void;
  onClose(cb: (err: Error | null) => void): void;
  close(): void;
}

export type TransportFactory = (url: URL) => Promise<PgTransport>;

export interface QueryResult {
  fields: P.Field[];
  rows: Record<string, unknown>[];
  rowCount: number;
  tag: string;
}

export type QueryFn = (sql: string, params?: unknown[]) => Promise<QueryResult>;

export class PgError extends Error {
  code: string;
  detail: string;
  constructor(m: string, code = '', detail = '') {
    super(m);
    this.name = 'PgError';
    this.code = code;
    this.detail = detail;
  }
}

// Erreur de transport/protocole : la connexion est rejetable et reconnectable
class PgConnError extends Error {
  constructor(m: string) {
    super(m);
    this.name = 'PgConnError';
  }
}

function ser(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) {
    let hex = '';
    for (const b of v) hex += b.toString(16).padStart(2, '0');
    return '\\x' + hex;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  return String(v);
}

function changesFromTag(tag: string): number {
  const m = tag.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

const HANDSHAKE_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 30_000;

export class PgClient {
  private url: URL;
  private tf: TransportFactory;
  private transport: PgTransport | null = null;
  private parser = new P.FrameParser();
  private msgs: P.BackendMsg[] = [];
  private mi = 0; // index de lecture dans msgs (evite des shift() en O(n^2))
  private wake: (() => void) | null = null;
  private closed = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(url: string | URL, tf: TransportFactory) {
    this.url = typeof url === 'string' ? new URL(url) : url;
    this.tf = tf;
  }

  // --- file d'attente -------------------------------------------------------

  private acquire(): Promise<() => void> {
    let release!: () => void;
    const done = new Promise<void>(r => { release = r; });
    const prev = this.chain;
    this.chain = prev.then(() => done, () => done);
    return prev.then(() => release, () => release);
  }

  // --- connexion ------------------------------------------------------------

  private onBytes = (chunk: Uint8Array) => {
    for (const m of this.parser.push(chunk)) {
      this.msgs.push(m);
    }
    const w = this.wake;
    this.wake = null;
    if (w) w();
  };

  private onClosed = (err: Error | null) => {
    this.transport = null;
    if (this.msgs.length === this.mi) {
      this.msgs.push({ t: 'notice', message: 'CONN_CLOSED' });
    }
    const w = this.wake;
    this.wake = null;
    if (w) w();
    if (err) this.lastCloseErr = err;
  };

  private lastCloseErr: Error | null = null;

  // Retrait synchrone d'un message deja recu : aucun await/promise cree par
  // message (indispensable quand une requete renvoie des milliers de lignes).
  private takeBuffered(): P.BackendMsg | null {
    if (this.msgs.length > this.mi) {
      const m = this.msgs[this.mi++];
      if (this.mi === this.msgs.length) { this.msgs = []; this.mi = 0; }
      if (m.t === 'notice' && m.message === 'CONN_CLOSED') {
        throw new PgConnError('connexion au serveur fermee' + (this.lastCloseErr ? ': ' + this.lastCloseErr.message : ''));
      }
      return m;
    }
    return null;
  }

  private async nextMsg(timeoutMs: number): Promise<P.BackendMsg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const m = this.takeBuffered();
      if (m) return m;
      if (this.closed) throw new PgConnError('client ferme');
      const remain = deadline - Date.now();
      if (remain <= 0) throw new PgConnError('timeout serveur (' + timeoutMs + ' ms)');
      await new Promise<void>(resolve => {
        const t = setTimeout(resolve, remain);
        this.wake = () => { clearTimeout(t); resolve(); };
      });
      if (this.msgs.length === this.mi && this.transport === null && !this.closed) {
        throw new PgConnError('connexion perdue' + (this.lastCloseErr ? ': ' + this.lastCloseErr.message : ''));
      }
    }
  }

  private async connect(): Promise<void> {
    const transport = await this.tf(this.url);
    this.transport = transport;
    this.parser = new P.FrameParser();
    this.msgs = [];
    this.mi = 0;
    transport.onData(this.onBytes);
    transport.onClose(this.onClosed);

    const user = decodeURIComponent(this.url.username);
    const database = this.url.pathname.replace(/^\//, '') || user.split('.')[0];
    await transport.write(P.startup(user, database));

    const deadline = Date.now() + HANDSHAKE_TIMEOUT_MS;
    let scram: { state: import('./scram.ts').ScramState; clientFirstMessage: string } | null = null;
    let final: Awaited<ReturnType<typeof scramFinal>> | null = null;

    for (;;) {
      const remain = deadline - Date.now();
      if (remain <= 0) throw new PgConnError('timeout handshake');
      const m = await this.nextMsg(remain);
      switch (m.t) {
        case 'auth': {
          if (m.kind === 10) {
            // SASL : mechanismes proposes (liste de cstrings)
            const mechs: string[] = [];
            let pos = 0;
            while (pos < m.data.length && m.data[pos] !== 0) {
              let end = pos;
              while (end < m.data.length && m.data[end] !== 0) end++;
              mechs.push(new TextDecoder().decode(m.data.subarray(pos, end)));
              pos = end + 1;
            }
            if (!mechs.includes('SCRAM-SHA-256')) {
              throw new PgConnError('SCRAM-SHA-256 non propose (requis): ' + mechs.join(','));
            }
            scram = scramStart(user);
            await transport.write(P.saslInitial('SCRAM-SHA-256', scram.clientFirstMessage));
          } else if (m.kind === 11) {
            if (!scram) throw new PgConnError('SASLContinue sans initiale');
            const serverFirst = new TextDecoder().decode(m.data);
            final = await scramFinal(scram.state, serverFirst, decodeURIComponent(this.url.password));
            await transport.write(P.passwordMessage(final.clientFinalMessage));
          } else if (m.kind === 12) {
            if (!final) throw new PgConnError('SASLFinal inattendu');
            const serverFinal = new TextDecoder().decode(m.data);
            if (!final.verifyServer(serverFinal)) throw new PgConnError('SCRAM : signature serveur invalide');
          } else if (m.kind === 5) {
            // AuthenticationMD5Password — utilise par l'endpoint local
            // d'Hyperdrive (les drivers standards le gerent, pas nous avant).
            await transport.write(
              P.passwordMessageNul(md5PasswordResponse(decodeURIComponent(this.url.password), user, m.data)),
            );
          } else if (m.kind === 0) {
            // AuthenticationOk
          } else {
            throw new PgConnError('methode d\'authentification non supportee: ' + m.kind);
          }
          break;
        }
        case 'ready':
          return;
        case 'error':
          throw new PgError(m.message, m.code, m.detail);
        case 'paramStatus':
        case 'backendKey':
        case 'notice':
          break;
        default:
          break;
      }
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new PgConnError('client ferme');
    if (this.transport) return;
    await this.connect();
  }

  private reset(): void {
    this.msgs = [];
    this.mi = 0;
    this.wake = null;
    this.parser = new P.FrameParser();
    if (this.transport) {
      try { this.transport.close(); } catch { /* deja ferme */ }
    }
    this.transport = null;
    this.lastCloseErr = null;
  }

  // --- requetes -------------------------------------------------------------

  // Exeute sans passer par la file (appel interne, la connexion est deja reservée).
  private async queryRaw(sql: string, params: unknown[]): Promise<QueryResult> {
    const encoded = params.map(ser);
    const batch = P.concatBytes([
      P.parseMessage(sql),
      P.bindMessage(encoded),
      P.describePortal(),
      P.executeMessage(0),
      P.syncMessage(),
    ]);
    await this.transport!.write(batch);

    let fields: P.Field[] = [];
    const rows: Record<string, unknown>[] = [];
    let tag = '';
    let err: PgError | null = null;
    const deadline = Date.now() + QUERY_TIMEOUT_MS;

    for (;;) {
      const m = this.takeBuffered() ?? await this.nextMsg(deadline - Date.now());
      if (m.t === 'rowDesc') {
        fields = m.fields;
      } else if (m.t === 'dataRow') {
        const row: Record<string, unknown> = {};
        for (let i = 0; i < fields.length; i++) {
          row[fields[i].name] = decodeValue(fields[i].oid, m.values[i]);
        }
        rows.push(row);
      } else if (m.t === 'command') {
        tag = m.tag;
      } else if (m.t === 'error') {
        err = new PgError(m.message, m.code, m.detail);
      } else if (m.t === 'ready') {
        break;
      } else if (m.t === 'notice' && m.message === 'CONN_CLOSED') {
        throw new PgConnError('connexion fermee pendant la requete');
      }
      // parseComplete/bindComplete/noData/paramStatus/notice : ignore
    }

    if (err) throw err;
    if (!tag) tag = fields.length ? 'SELECT ' + rows.length : '';
    return { fields, rows, rowCount: rows.length, tag };
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const release = await this.acquire();
    try {
      try {
        await this.ensureConnected();
        return await this.queryRaw(sql, params);
      } catch (e) {
        if (e instanceof PgConnError) {
          // reconnexion + une seule reprise (la requete n'a pas de reponse)
          this.reset();
          await this.ensureConnected();
          return await this.queryRaw(sql, params);
        }
        throw e;
      }
    } finally {
      release();
    }
  }

  // fn recoit un queryFn deja « dans » la transaction (sans re-acquerir la
  // file d'attente) : appeler this.query() depuis fn provoquerait un
  // deadlock (lock non réentrant).
  async transaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      await this.ensureConnected();
      await this.queryRaw('BEGIN', []);
      const q: QueryFn = (sql, params = []) => this.queryRaw(sql, params);
      try {
        const out = await fn(q);
        await this.queryRaw('COMMIT', []);
        return out;
      } catch (e) {
        try { await this.queryRaw('ROLLBACK', []); } catch { /* connexion perdue : le serveur roule deja */ }
        throw e;
      }
    } finally {
      release();
    }
  }

  close(): void {
    this.closed = true;
    this.reset();
  }
}

function decodeValue(oid: number, v: string | null): unknown {
  if (v === null) return null;
  switch (oid) {
    case 16: return v === 't' ? 1 : 0;            // bool -> 0/1 (comme SQLite)
    case 20: case 21: case 23: case 26: return Number(v); // int8/int2/int4/oid
    case 700: case 701: case 1700: return Number(v);      // float4/float8/numeric
    case 17: {                                        // bytea -> Uint8Array
      const hex = v.startsWith('\\x') ? v.slice(2) : v;
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
      return out;
    }
    default: return v;
  }
}
