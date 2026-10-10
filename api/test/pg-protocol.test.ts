// Protocole PostgreSQL v3 : encodage des messages + FrameParser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startup, parseMessage, bindMessage, describePortal, executeMessage,
  syncMessage, terminateMessage, concatBytes, FrameParser,
  passwordMessage, passwordMessageNul,
} from '../src/pg/protocol.ts';

function frame(type: string, body: number[]): Uint8Array {
  const out = new Uint8Array(1 + 4 + body.length);
  out[0] = type.charCodeAt(0);
  new DataView(out.buffer).setInt32(1, 4 + body.length, false);
  out.set(body, 5);
  return out;
}
function cstr(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  out.push(0);
  return out;
}
function i32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function i16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

test('startup : longueur + version 196608 + parametres user/database/encoding', () => {
  const b = startup('alice', 'eurex');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assert.equal(view.getInt32(0, false), b.length);
  assert.equal(view.getInt32(4, false), 196608);
  assert.equal(Buffer.from(b.slice(8)).toString('latin1'), 'user\x00alice\x00database\x00eurex\x00client_encoding\x00UTF8\x00\x00');
});

test('FrameParser : message fragmente en morceaux de 1/3/5 octets', () => {
  const parser = new FrameParser();
  const auth = frame('R', [...i32(10), ...cstr('SCRAM-SHA-256')]);
  const ready = frame('Z', [0x49]);
  const whole = concatBytes([auth, ready]);

  const got = [];
  let off = 0;
  for (const size of [1, 3, 5, whole.length]) {
    const end = Math.min(off + size, whole.length);
    if (off < end) got.push(...parser.push(whole.subarray(off, end)));
    off = end;
  }
  assert.equal(got.length, 2);
  assert.equal(got[0].t, 'auth');
  assert.equal(got[0].t === 'auth' && got[0].kind, 10);
  assert.equal(got[1].t, 'ready');
  assert.equal(got[1].t === 'ready' && got[1].status, 'I');
});

test('FrameParser : plusieurs messages dans un seul chunk', () => {
  const parser = new FrameParser();
  const all = concatBytes([frame('1', []), frame('2', []), frame('C', cstr('INSERT 0 3'))]);
  const got = parser.push(all);
  assert.deepEqual(got.map((m) => m.t), ['parseComplete', 'bindComplete', 'command']);
  assert.equal(got[2].t === 'command' && got[2].tag, 'INSERT 0 3');
});

test('FrameParser : frame incomplet reste bufferise', () => {
  const parser = new FrameParser();
  const full = frame('R', [...i32(0)]);
  assert.deepEqual(parser.push(full.subarray(0, 6)), []); // pas assez
  const got = parser.push(full.subarray(6));
  assert.equal(got.length, 1);
  assert.equal(got[0].t, 'auth');
  assert.equal(got[0].t === 'auth' && got[0].kind, 0);
});

test('RowDescription : decode 2 champs (varchar, int4) + DataRow null/texte', () => {
  const parser = new FrameParser();
  const field = (name: string, oid: number): number[] => [
    ...cstr(name), ...i32(0), ...i16(1), ...i32(oid), ...i16(-1), ...i32(-1), ...i16(0),
  ];
  const td = [
    ...i16(2),
    ...field('login', 1043),
    ...field('n', 23),
  ];
  const dd = [
    ...i16(2),
    ...i32(-1),                       // NULL
    ...i32(3), 0x61, 0x62, 0x63,      // 'abc'
  ];
  const got = parser.push(concatBytes([frame('T', td), frame('D', dd), frame('C', cstr('SELECT 2')), frame('Z', [0x49])]));
  assert.deepEqual(got.map((m) => m.t), ['rowDesc', 'dataRow', 'command', 'ready']);
  const rd = got[0];
  assert.equal(rd.t === 'rowDesc' && rd.fields.map((f) => f.name).join(','), 'login,n');
  assert.equal(rd.t === 'rowDesc' && rd.fields[1].oid, 23);
  const dr = got[1];
  assert.equal(dr.t === 'dataRow' && dr.values[0], null);
  assert.equal(dr.t === 'dataRow' && dr.values[1], 'abc');
});

test('FrameParser : gros resultat en tout petits morceaux (regression O(n^2))', () => {
  // Regression 2026-10-10 (prod) : l'ancien parser faisait this.buf.slice()
  // par message, donc O(n^2) en octets. Au-dela de ~15 Ko de reponse le seul
  // decodage depassait le budget CPU de 10 ms des Workers (503 error 1102 sur
  // /api/org/clients, /dossiers, /comptables, /alerts). On verifie ici qu'un
  // gros volume arrive en morceaux minuscules reste correct ET rapide.
  const parser = new FrameParser();
  const N = 4000;
  const val = 'valeur_de_vingt_oct'; // 20 octets
  const parts: Uint8Array[] = [
    frame('T', [...i16(1), ...cstr('x'), ...i32(0), ...i16(1), ...i32(25), ...i16(-1), ...i32(-1), ...i16(0)]),
  ];
  for (let i = 0; i < N; i++) {
    parts.push(frame('D', [...i16(1), ...i32(val.length), ...[...val].map((c) => c.charCodeAt(0))]));
  }
  parts.push(frame('C', cstr('SELECT ' + N)));
  parts.push(frame('Z', [0x49]));
  const whole = concatBytes(parts);

  let rows = 0, desc = false, ready = false, cmd = '';
  const started = Date.now();
  for (let off = 0; off < whole.length; off += 7) {
    const end = Math.min(off + 7, whole.length);
    for (const m of parser.push(whole.subarray(off, end))) {
      if (m.t === 'rowDesc') desc = true;
      else if (m.t === 'dataRow') rows++;
      else if (m.t === 'ready') ready = true;
      else if (m.t === 'command') cmd = m.tag;
    }
  }
  const elapsed = Date.now() - started;
  assert.equal(rows, N);
  assert.equal(cmd, 'SELECT ' + N);
  assert.ok(desc && ready);
  // Large marge : l'ancien code prenait plusieurs secondes sur ~120 Ko.
  assert.ok(elapsed < 3000, `decodage trop lent : ${elapsed} ms`);
});

test('ErrorResponse : champs S/C/M/D', () => {
  const parser = new FrameParser();
  const body = [
    0x53, ...cstr('ERROR'), 0x43, ...cstr('42P01'),
    0x4d, ...cstr('relation "x" does not exist'), 0x44, ...cstr('DETAIL...'), 0,
  ];
  const got = parser.push(frame('E', body));
  assert.equal(got[0].t, 'error');
  const e = got[0];
  assert.equal(e.t === 'error' && e.code, '42P01');
  assert.equal(e.t === 'error' && e.message, 'relation "x" does not exist');
  assert.equal(e.t === 'error' && e.detail, 'DETAIL...');
});

test('Bind : structure portal/statement/formats/params', () => {
  const b = bindMessage(['42', null, 'x']);
  assert.equal(b[0], 0x42);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assert.equal(view.getInt32(1, false), b.length - 1); // len inclut ses 4 octets
  // layout : B(0) len(1-4) portal\0(5) statement\0(6) fmt(7-8) n(9-10) p0...
  const body = Buffer.from(b.slice(5)).toString('latin1');
  assert.equal(body.slice(0, 2), '\x00\x00'); // portal + statement vides
  assert.equal(view.getInt16(7, false), 0);   // nb formats
  assert.equal(view.getInt16(9, false), 3);   // nb params
  assert.equal(view.getInt32(11, false), 2);  // param0 len
  assert.equal(Buffer.from(b.slice(15, 17)).toString('latin1'), '42');
  assert.equal(view.getInt32(17, false), -1); // param1 = NULL
  assert.equal(view.getInt32(21, false), 1);  // param2 len
});

test('Parse/Describe/Execute/Sync/Terminate : enveloppes', () => {
  const p = parseMessage('SELECT 1');
  assert.equal(p[0], 0x50);
  const pBody = Buffer.from(p.slice(5)).toString('latin1');
  assert.equal(pBody, '\x00SELECT 1\x00\x00\x00'); // statement vide + query + nb types 0

  const d = describePortal();
  assert.equal(d[0], 0x44);
  assert.equal(d[5], 0x50); // 'P'
  assert.equal(d[6], 0);    // nom vide

  const e = executeMessage(10);
  assert.equal(e[0], 0x45);
  const eView = new DataView(e.buffer, e.byteOffset, e.byteLength);
  assert.equal(eView.getInt32(6, false), 10);

  assert.deepEqual(Array.from(syncMessage()), [0x53, 0, 0, 0, 4]);
  assert.deepEqual(Array.from(terminateMessage()), [0x58, 0, 0, 0, 4]);
});

test('Notice (N) : decodee sans casser le flux', () => {
  const parser = new FrameParser();
  const body = [
    0x53, ...cstr('NOTICE'),   // S = severity
    0x43, ...cstr('00000'),    // C = code
    0x4d, ...cstr('coucou'),   // M = message
    0,
  ];
  const got = parser.push(frame('N', body));
  assert.equal(got[0].t, 'notice');
  assert.equal(got[0].t === 'notice' && got[0].message, 'coucou');
});

test('passwordMessage : brut, SANS zero terminal (etapes SASL)', () => {
  // SASLResponse = 'p' + longueur + donnees, sans terminaison C.
  const b = passwordMessage('p=abc=');
  assert.equal(String.fromCharCode(b[0]), 'p');
  assert.equal(new DataView(b.buffer).getInt32(1, false), 4 + 6);
  assert.equal(new TextDecoder().decode(b.slice(5)), 'p=abc=');
  assert.notEqual(b[b.length - 1], 0);
});

test('passwordMessageNul : String terminee par zero (auth MD5/cleartext)', () => {
  // Regression 2026-10-10 : l'absence de ce zero faisait echouer Hyperdrive
  // avec FATAL 58000 "Internal error." apres la reponse MD5.
  const md5 = 'md5d6f407104ca5ba8553d598fed7df90e0';
  const b = passwordMessageNul(md5);
  assert.equal(String.fromCharCode(b[0]), 'p');
  // longueur = 4 (len) + 35 (mot de passe) + 1 (zero)
  assert.equal(new DataView(b.buffer).getInt32(1, false), 4 + md5.length + 1);
  assert.equal(b[b.length - 1], 0);
  assert.equal(new TextDecoder().decode(b.slice(5, -1)), md5);
});
