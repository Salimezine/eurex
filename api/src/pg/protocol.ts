// Protocole PostgreSQL v3 : encodage des messages cote client et decodage
// des messages serveur (format texte pour les donnees).

// --- encodage --------------------------------------------------------------

class Writer {
  private buf: number[] = [];

  i8(v: number) { this.buf.push(v & 0xff); }
  i16(v: number) { this.buf.push((v >> 8) & 0xff, v & 0xff); }
  i32(v: number) { this.buf.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); }
  cstr(s: string) {
    for (let i = 0; i < s.length; i++) this.buf.push(s.charCodeAt(i) & 0xff);
    this.buf.push(0);
  }
  bytes(b: Uint8Array) { for (const x of b) this.buf.push(x); }

  // frame : type unique + longueur (4 octets, incluant la longueur elle-meme)
  frame(type: string): Uint8Array {
    const body = this.take();
    const out = new Uint8Array(1 + 4 + body.length);
    out[0] = type.charCodeAt(0);
    new DataView(out.buffer).setInt32(1, 4 + body.length, false);
    out.set(body, 5);
    return out;
  }

  take(): Uint8Array {
    const b = new Uint8Array(this.buf);
    this.buf = [];
    return b;
  }
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// StartupMessage : pas de type, longueur seule, protocole 196608 (3.0)
export function startup(user: string, database: string): Uint8Array {
  const w = new Writer();
  w.i32(196608);
  w.cstr('user'); w.cstr(user);
  w.cstr('database'); w.cstr(database);
  w.cstr('client_encoding'); w.cstr('UTF8');
  w.i8(0);
  const body = w.take();
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setInt32(0, 4 + body.length, false);
  out.set(body, 4);
  return out;
}

// SASLInitialResponse : 'p' + mecanisme\0 + int32 len + donnees
export function saslInitial(mechanism: string, data: string): Uint8Array {
  const w = new Writer();
  w.cstr(mechanism);
  const bytes = new TextEncoder().encode(data);
  w.i32(bytes.length);
  w.bytes(bytes);
  return w.frame('p');
}

// PasswordMessage (etapes SASL suivantes) : 'p' + donnees brutes
export function passwordMessage(data: string): Uint8Array {
  const w = new Writer();
  const bytes = new TextEncoder().encode(data);
  w.bytes(bytes);
  return w.frame('p');
}

export function parseMessage(sql: string): Uint8Array {
  const w = new Writer();
  w.cstr('');      // nom du statement (unnamed)
  w.cstr(sql);
  w.i16(0);        // nb de types de parametres (inference par le serveur)
  return w.frame('P');
}

export function bindMessage(params: (string | null)[]): Uint8Array {
  const w = new Writer();
  w.cstr('');      // portal
  w.cstr('');      // statement
  w.i16(0);        // format des parametres : tous texte
  w.i16(params.length);
  for (const p of params) {
    if (p === null) {
      w.i32(-1);
    } else {
      const bytes = new TextEncoder().encode(p);
      w.i32(bytes.length);
      w.bytes(bytes);
    }
  }
  w.i16(0);        // format des resultats : tous texte
  return w.frame('B');
}

export function describePortal(): Uint8Array {
  const w = new Writer();
  w.i8('P'.charCodeAt(0));
  w.cstr('');
  return w.frame('D');
}

export function executeMessage(maxRows = 0): Uint8Array {
  const w = new Writer();
  w.cstr('');
  w.i32(maxRows);
  return w.frame('E');
}

export function closePortal(): Uint8Array {
  const w = new Writer();
  w.i8('P'.charCodeAt(0));
  w.cstr('');
  return w.frame('C');
}

export function syncMessage(): Uint8Array { return new Writer().frame('S'); }
export function terminateMessage(): Uint8Array { return new Writer().frame('X'); }

// --- decodage --------------------------------------------------------------

export interface Field {
  name: string;
  oid: number;
}

export type BackendMsg =
  | { t: 'auth'; kind: number; data: Uint8Array }
  | { t: 'paramStatus'; name: string; value: string }
  | { t: 'backendKey'; pid: number; key: number }
  | { t: 'ready'; status: string }
  | { t: 'rowDesc'; fields: Field[] }
  | { t: 'dataRow'; values: (string | null)[] }
  | { t: 'command'; tag: string }
  | { t: 'error'; severity: string; code: string; message: string; detail: string }
  | { t: 'notice'; message: string }
  | { t: 'parseComplete' | 'bindComplete' | 'noData' | 'portalSuspended' | 'emptyQuery' | 'closeComplete' };

const DECODERS = new TextDecoder('utf-8');

function readCString(buf: Uint8Array, pos: number): [string, number] {
  let end = pos;
  while (end < buf.length && buf[end] !== 0) end++;
  return [DECODERS.decode(buf.subarray(pos, end)), end + 1];
}

function readErrorFields(body: Uint8Array): { severity: string; code: string; message: string; detail: string } {
  let pos = 0;
  let severity = '', code = '', message = '', detail = '';
  while (pos < body.length && body[pos] !== 0) {
    const key = String.fromCharCode(body[pos]);
    const [val, next] = readCString(body, pos + 1);
    if (key === 'S') severity = val;
    else if (key === 'C') code = val;
    else if (key === 'M') message = val;
    else if (key === 'D') detail = val;
    pos = next;
  }
  return { severity, code, message, detail };
}

export class FrameParser {
  private buf = new Uint8Array(0);

  // Alimente le parser ; retourne les messages complets au fur et a mesure.
  push(chunk: Uint8Array): BackendMsg[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const out: BackendMsg[] = [];
    while (this.buf.length >= 5) {
      // view recree a chaque iteration : this.buf est remplace par slice()
      const view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      const total = 1 + view.getInt32(1, false);
      if (total < 5 || this.buf.length < total) break;
      const type = String.fromCharCode(this.buf[0]);
      const body = this.buf.subarray(5, total);
      out.push(this.decode(type, body));
      this.buf = this.buf.slice(total);
    }
    return out;
  }

  private decode(type: string, body: Uint8Array): BackendMsg {
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    switch (type) {
      case 'R': {
        const kind = view.getInt32(0, false);
        return { t: 'auth', kind, data: body.subarray(4) };
      }
      case 'S': {
        const [name, p] = readCString(body, 0);
        const [value] = readCString(body, p);
        return { t: 'paramStatus', name, value };
      }
      case 'K':
        return { t: 'backendKey', pid: view.getInt32(0, false), key: view.getInt32(4, false) };
      case 'Z':
        return { t: 'ready', status: String.fromCharCode(body[0]) };
      case 'T': {
        const n = view.getInt16(0, false);
        const fields: Field[] = [];
        let pos = 2;
        for (let i = 0; i < n; i++) {
          const [name, p1] = readCString(body, pos);
          const oid = view.getInt32(p1 + 6, false);
          fields.push({ name, oid });
          pos = p1 + 18;
        }
        return { t: 'rowDesc', fields };
      }
      case 'D': {
        const n = view.getInt16(0, false);
        const values: (string | null)[] = [];
        let pos = 2;
        for (let i = 0; i < n; i++) {
          const len = view.getInt32(pos, false);
          pos += 4;
          if (len === -1) {
            values.push(null);
          } else {
            values.push(DECODERS.decode(body.subarray(pos, pos + len)));
            pos += len;
          }
        }
        return { t: 'dataRow', values };
      }
      case 'C': {
        const [tag] = readCString(body, 0);
        return { t: 'command', tag };
      }
      case 'E': {
        const f = readErrorFields(body);
        return { t: 'error', ...f };
      }
      case 'N': {
        const f = readErrorFields(body);
        return { t: 'notice', message: f.message };
      }
      case '1': return { t: 'parseComplete' };
      case '2': return { t: 'bindComplete' };
      case 'n': return { t: 'noData' };
      case 's': return { t: 'portalSuspended' };
      case 'I': return { t: 'emptyQuery' };
      case '3': return { t: 'closeComplete' };
      default:
        // Messages non geres (CopyData...) : ignore
        return { t: 'notice', message: 'ignored:' + type };
    }
  }
}
