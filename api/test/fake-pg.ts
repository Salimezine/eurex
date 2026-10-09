// Faux serveur PostgreSQL pour tests : handshake SCRAM-SHA-256 complet
// (signature serveur calculee reellement), protocole extended, reponses
// scriptables via `responder`. Partage entre pg-client.test et
// supabase-adapter.test.
import assert from 'node:assert/strict';
import { PgClient, type PgTransport } from '../src/pg/client.ts';

// --- helpers cryptographiques cote « serveur » -------------------------------

async function pbkdf2(pw: string, salt: Uint8Array, iters: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, key, 256);
  return new Uint8Array(bits);
}
async function hmac(key: Uint8Array, ...msgs: string[]): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const joined = new TextEncoder().encode(msgs.join(''));
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, joined));
}
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

const SALT = new TextEncoder().encode('saltsalt1234567890123456'); // 24 octets
const SALT_B64 = b64(SALT);

// --- wire --------------------------------------------------------------------

type Frame = { type: string | null; body: Uint8Array }; // type null = startup

function parseClientFrames(buf: Uint8Array): Frame[] {
  const out: Frame[] = [];
  let off = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (;;) {
    // Startup : aucun octet de type, longueur a l'offset 0, version 3.0 a [4..7]
    if (out.length === 0 && off === 0 && buf.length >= 8 && buf[4] === 0 && buf[5] === 3) {
      const len = view.getInt32(0, false);
      if (buf.length < len) break;
      out.push({ type: null, body: buf.subarray(0, len) });
      off = len;
      continue;
    }
    // Messages cote client : type(1) + len(4, incluant len) + corps(len-4)
    if (buf.length - off < 5) break;
    const len = view.getInt32(off + 1, false);
    if (len < 4 || buf.length - off < 1 + len) break;
    out.push({ type: String.fromCharCode(buf[off]), body: buf.subarray(off + 5, off + 1 + len) });
    off += 1 + len;
  }
  return out;
}

function frame(type: string, body: number[]): Uint8Array {
  const out = new Uint8Array(1 + 4 + body.length);
  out[0] = type.charCodeAt(0);
  new DataView(out.buffer).setInt32(1, 4 + body.length, false);
  out.set(body, 5);
  return out;
}
const cstr = (s: string): number[] => [...Buffer.from(s, 'latin1'), 0];
const i32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const i16 = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];
function readCString(b: Uint8Array, pos: number): [string, number] {
  let end = pos;
  while (end < b.length && b[end] !== 0) end++;
  return [Buffer.from(b.subarray(pos, end)).toString('latin1'), end + 1];
}
const auth = (kind: number, data: number[] = []) => frame('R', [...i32(kind), ...data]);
const ready = () => frame('Z', [0x49]);
function paramStatus(name: string, value: string): Uint8Array {
  return frame('S', [...cstr(name), ...cstr(value)]);
}
function rowDesc(fields: [string, number][]): number[] {
  const out = [...i16(fields.length)];
  for (const [name, oid] of fields) {
    out.push(...cstr(name), ...i32(0), ...i16(1), ...i32(oid), ...i16(-1), ...i32(-1), ...i16(0));
  }
  return out;
}
function dataRow(values: (string | null)[]): number[] {
  const out = [...i16(values.length)];
  for (const v of values) {
    if (v === null) out.push(...i32(-1));
    else { out.push(...i32(v.length)); for (const ch of v) out.push(ch.charCodeAt(0) & 0xff); }
  }
  return out;
}
const err = (code: string, message: string): Uint8Array =>
  frame('E', [0x53, ...cstr('ERROR'), 0x43, ...cstr(code), 0x4d, ...cstr(message), 0]);
const cmd = (tag: string) => frame('C', cstr(tag));

// --- reponses scriptables ----------------------------------------------------

export interface QuerySpec {
  fields?: [string, number][];
  rows?: (string | null)[][];
  tag?: string;
  error?: [string, string]; // [code SQLSTATE, message]
}
export type Responder = (sql: string) => QuerySpec | null;

// PK reel du schema (meme contenu que DEFAULT_PK du traducteur)
const PK_SPEC: QuerySpec = {
  fields: [['tbl', 25], ['col', 25]],
  rows: [
    ['org_fiscal_alerts', 'id'],
    ['org_alert_dones', 'alert_id'],
    ['org_alert_dones', 'due_date'],
    ['rapport_modes', 'id'],
    ['rubriques_paie', 'id'],
  ],
};

// --- faux serveur ------------------------------------------------------------

export class FakeServer implements PgTransport {
  state = 0;
  clientFirstBare = '';
  serverFirst = '';
  bindParams: (string | null)[] = [];
  sqls: string[] = [];
  private session: number;
  private closeOnQuery: boolean;
  private responder: Responder | undefined;

  constructor(session: number, opts: { closeOnQuery?: boolean; responder?: Responder } = {}) {
    this.session = session;
    this.closeOnQuery = opts.closeOnQuery || false;
    this.responder = opts.responder;
  }

  private dataCb: ((b: Uint8Array) => void) | null = null;
  private closeCb: ((e: Error | null) => void) | null = null;

  async write(bytes: Uint8Array): Promise<void> {
    const frames = parseClientFrames(bytes);
    for (const f of frames) await this.handle(f);
  }
  onData(cb: (b: Uint8Array) => void): void { this.dataCb = cb; }
  onClose(cb: (e: Error | null) => void): void { this.closeCb = cb; }
  close(): void { if (this.closeCb) this.closeCb(null); }

  private emit(...msgs: Uint8Array[]): void {
    for (const m of msgs) if (this.dataCb) this.dataCb(m);
  }
  private die(): void { if (this.closeCb) this.closeCb(null); }

  private async handle(f: Frame): Promise<void> {
    if (f.type === null) {
      // startup : verifie version + user, propose SCRAM-SHA-256
      const s = Buffer.from(f.body).toString('latin1');
      assert.ok(/user\x00[^\x00]+\x00/.test(s), 'user present dans startup');
      assert.equal((f.body[4] << 24) | (f.body[5] << 16) | (f.body[6] << 8) | f.body[7], 196608);
      this.emit(auth(10, cstr('SCRAM-SHA-256')));
      this.state = 1;
      return;
    }
    if (f.type === 'p' && this.state === 1) {
      // SASLInitialResponse : mecanism\0 int32 len donnees
      const [mech, p1] = readCString(f.body, 0);
      assert.equal(mech, 'SCRAM-SHA-256');
      const len = new DataView(f.body.buffer, f.body.byteOffset + p1, 4).getInt32(0, false);
      const clientFirst = Buffer.from(f.body.subarray(p1 + 4, p1 + 4 + len)).toString('latin1');
      const nonce = clientFirst.slice(clientFirst.indexOf('r=') + 2);
      this.clientFirstBare = clientFirst.slice('n,,'.length);
      this.serverFirst = `r=${nonce},s=${SALT_B64},i=1`;
      this.emit(auth(11, [...Buffer.from(this.serverFirst, 'latin1')]));
      this.state = 2;
      return;
    }
    if (f.type === 'p' && this.state === 2) {
      const clientFinal = Buffer.from(f.body).toString('latin1');
      const withoutProof = clientFinal.slice(0, clientFinal.indexOf(',p='));
      const authMsg = `${this.clientFirstBare},${this.serverFirst},${withoutProof}`;
      const salted = await pbkdf2('secret', SALT, 1);
      const serverKey = await hmac(salted, 'Server Key');
      const sig = await hmac(serverKey, authMsg);
      this.emit(
        auth(12, [...Buffer.from('v=' + b64(sig), 'latin1')]),
        auth(0),
        paramStatus('server_version', '17.4'),
        paramStatus('client_encoding', 'UTF8'),
        ready(),
      );
      this.state = 3;
      return;
    }
    if (this.state >= 3 && f.type === 'P') {
      if (this.closeOnQuery && this.session === 0) { this.die(); return; }
      const [, p1] = readCString(f.body, 0);
      const [sql] = readCString(f.body, p1);
      this.sqls.push(sql);
      this.respond(sql);
    }
    if (f.type === 'B') {
      let pos = 0;
      const [, p1] = readCString(f.body, 0);
      const [, p2] = readCString(f.body, p1);
      pos = p2 + 2; // formats
      const n = new DataView(f.body.buffer, f.body.byteOffset + pos, 2).getInt16(0, false);
      pos += 2;
      const params: (string | null)[] = [];
      for (let i = 0; i < n; i++) {
        const len = new DataView(f.body.buffer, f.body.byteOffset + pos, 4).getInt32(0, false);
        pos += 4;
        if (len === -1) params.push(null);
        else { params.push(Buffer.from(f.body.subarray(pos, pos + len)).toString('latin1')); pos += len; }
      }
      this.bindParams.push(...params);
    }
  }

  private emitSpec(spec: QuerySpec): void {
    if (spec.error) { this.emit(err(spec.error[0], spec.error[1]), ready()); return; }
    const msgs: Uint8Array[] = [frame('1', []), frame('2', [])];
    if (spec.fields) {
      msgs.push(frame('T', rowDesc(spec.fields)));
      for (const row of spec.rows || []) msgs.push(frame('D', dataRow(row)));
    }
    msgs.push(cmd(spec.tag || (spec.fields ? 'SELECT ' + (spec.rows || []).length : 'OK')), ready());
    this.emit(...msgs);
  }

  private respond(sql: string): void {
    if (this.responder) {
      const spec = this.responder(sql);
      if (spec) { this.emitSpec(spec); return; }
    }
    // defaut : PK map (requete de l'adaptateur Supabase)
    if (sql.includes('information_schema.table_constraints')) {
      this.emitSpec(PK_SPEC);
      return;
    }
    if (sql.startsWith('SELECT 1 AS n, 42 AS m')) {
      this.emitSpec({
        fields: [['n', 23], ['m', 23]],
        rows: [['1', '42']],
        tag: 'SELECT 2',
      });
    } else if (sql.startsWith('SELECT nom, actif')) {
      this.emitSpec({
        fields: [['nom', 25], ['actif', 16]],
        rows: [['ACME', 't'], [null, 'f']],
        tag: 'SELECT 2',
      });
    } else if (sql === 'BOOM') {
      this.emitSpec({ error: ['42601', 'syntax error: BOOM'] });
    } else if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      this.emit(cmd(sql), ready());
    } else if (sql.startsWith('INSERT')) {
      this.emitSpec({ tag: 'INSERT 0 1' });
    } else if (sql.startsWith('WITH RECURSIVE') || sql.startsWith('SELECT')) {
      this.emitSpec({ fields: [['ok', 23]], rows: [['7']], tag: 'SELECT 1' });
    } else {
      this.emit(cmd('OK'), ready());
    }
  }
}

// --- factory ------------------------------------------------------------------

export const TEST_URL = 'postgresql://alice:secret@db.test/eurex';

export interface MakeClientOpts {
  closeOnQuery?: boolean;
  responder?: Responder;
  url?: string;
}

export function makeClient(opts: MakeClientOpts = {}): { client: PgClient; sessions: FakeServer[] } {
  const sessions: FakeServer[] = [];
  const client = new PgClient(opts.url || TEST_URL, async () => {
    const s = new FakeServer(sessions.length, opts);
    sessions.push(s);
    return s as PgTransport;
  });
  return { client, sessions };
}
