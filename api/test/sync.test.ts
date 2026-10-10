// Synchronisation Supabase -> D1 (reprise de la main apres une bascule) :
// ordre topologique des cles etrangeres, upsert, purge des orphelins, verrou.
// Tout tourne sur des doubles : ni reseau, ni D1 reel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNC_KEY,
  isD1QuotaError,
  topoSort,
  upsertSql,
  deleteSql,
  pkKey,
  purgeOrphans,
  resyncSupabaseToD1,
  type D1Like,
  type D1StmtLike,
  type KVLike,
  type Schema,
  type SupaSource,
  type SyncEnv,
} from '../src/sync.ts';

// --- Doubles -----------------------------------------------------------------

// D1 simule : rejoue le SQL le moins mal possible pour controler l'effet reel.
class FakeD1 implements D1Like {
  execs: { sql: string; binds: unknown[] }[] = [];
  data = new Map<string, Record<string, unknown>[]>();
  failSql: string | null = null;

  prepare(sql: string): D1StmtLike {
    let binds: unknown[] = [];
    const d1 = this;
    const stmt: D1StmtLike = {
      bind(...p: unknown[]) { binds = p; return stmt; },
      async run() { return d1.apply(sql, binds); },
      async all() {
        d1.execs.push({ sql, binds: [] }); // trace aussi les lectures (parcours de purge)
        const m = /FROM "([^"]+)"\s*$/.exec(sql);
        const table = m ? m[1] : '';
        const cols = sql
          .replace(/^SELECT\s+/, '')
          .replace(/\s+FROM\s+"[^"]+"\s*$/, '')
          .split(',')
          .map((s) => s.trim().replace(/"/g, ''));
        const rows = d1.data.get(table) || [];
        return { results: rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))) };
      },
    };
    return stmt;
  }

  async batch(stmts: D1StmtLike[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }

  apply(sql: string, binds: unknown[]) {
    if (this.failSql && sql.includes(this.failSql)) throw new Error('boom ' + this.failSql);
    this.execs.push({ sql, binds });

    const up = /^INSERT INTO "([^"]+)" \(([^)]+)\) VALUES \([^)]+\) ON CONFLICT \(([^)]+)\) DO (UPDATE SET|NOTHING)/.exec(sql);
    if (up) {
      const table = up[1];
      const cols = up[2].split(', ').map((c) => c.replace(/"/g, ''));
      const pk = up[3].split(', ').map((c) => c.replace(/"/g, ''));
      const row = Object.fromEntries(cols.map((c, i) => [c, binds[i] ?? null]));
      const rows = this.data.get(table) || [];
      const hit = rows.findIndex((r) => pk.every((c) => String(r[c]) === String(row[c])));
      if (hit >= 0) {
        if (up[4] === 'UPDATE SET') rows[hit] = row; // pas de supprimee : pas de declenchement de cle etrangere
      } else rows.push(row);
      this.data.set(table, rows);
      return { ok: true };
    }

    const del = /^DELETE FROM "([^"]+)" WHERE (.+)$/.exec(sql);
    if (del) {
      const table = del[1];
      const pk = del[2].split(' AND ').map((s) => s.trim().replace(/"/g, '').replace(/ = \?$/, ''));
      const rows = (this.data.get(table) || []).filter((r) => !pk.every((c, i) => String(r[c]) === String(binds[i])));
      this.data.set(table, rows);
      return { ok: true };
    }

    const sel = /^SELECT (.+) FROM "([^"]+)"$/.exec(sql);
    if (sel) {
      const cols = sel[1].split(', ').map((c) => c.replace(/"/g, ''));
      const rows = this.data.get(sel[2]) || [];
      return { results: rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))) };
    }

    throw new Error('SQL inattendu dans FakeD1 : ' + sql);
  }
}

class FakeKV implements KVLike {
  m = new Map<string, string>();
  ops: string[] = [];
  async get(k: string) { return this.m.get(k) ?? null; }
  async put(k: string, v: string) { this.m.set(k, v); this.ops.push('put:' + k); }
  async delete(k: string) { this.m.delete(k); this.ops.push('del:' + k); }
}

function fakeSource(schema: Schema, data: Record<string, Record<string, unknown>[]>): SupaSource {
  return {
    async schema() { return schema; },
    async rows(t: string) { return data[t] || []; },
    close() { /* rien */ },
  };
}

// --- Detection du quota D1 ---------------------------------------------------

test('quota D1 : les messages de plafond de lignes lues sont reconnus', () => {
  assert.equal(isD1QuotaError(new Error("exceeded D1's free tier daily row read limit")), true);
  assert.equal(isD1QuotaError(new Error('too many rows read for D1 free tier (5000000/5000000)')), true);
  assert.equal(isD1QuotaError(new Error('D1 read quota exceeded')), true);
});

test('quota D1 : les erreurs ordinaires ne declenchent pas la bascule', () => {
  assert.equal(isD1QuotaError(new Error('FOREIGN KEY constraint failed')), false);
  assert.equal(isD1QuotaError(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed')), false);
  assert.equal(isD1QuotaError(new Error('network timeout')), false);
  assert.equal(isD1QuotaError(null), false);
  // Une erreur de Postgres parlant "read limit" mais pas de D1 ne doit pas non plus
  assert.equal(isD1QuotaError(new Error('permission denied for table org_tasks')), false);
});

// --- Tri topologique ---------------------------------------------------------

test('topoSort : les meres sont inscrites avant les filles', () => {
  const refs = {
    org_users: ['organizations'],
    org_clients: ['organizations', 'org_users'],
    org_dossiers: ['org_users', 'org_clients'],
    org_tasks: ['org_users', 'org_dossiers'],
  };
  const tables = ['org_tasks', 'org_dossiers', 'org_clients', 'org_users', 'organizations'];
  const order = topoSort(tables, refs);
  const at = (t: string) => order.indexOf(t);
  assert.ok(at('organizations') < at('org_users'), 'organizations avant org_users');
  assert.ok(at('org_users') < at('org_clients'), 'org_users avant org_clients');
  assert.ok(at('org_clients') < at('org_dossiers'), 'org_clients avant org_dossiers');
  assert.ok(at('org_dossiers') < at('org_tasks'), 'org_dossiers avant org_tasks');
  assert.equal(order.length, tables.length, 'toutes les tables sont presentes');
});

test('topoSort : les tables sans dependance sont conservees, les cycles toleres', () => {
  const order = topoSort(['b', 'a', 'c'], { a: ['b'], b: ['a'] });
  assert.ok(order.includes('a') && order.includes('b') && order.includes('c'));
  assert.ok(order.indexOf('c') < order.indexOf('a') || order.indexOf('c') < order.indexOf('b'),
    'table independante en premier');
  // Cycle a<->b : on complete quand meme (D1 reclamera, la bascule n'aura pas lieu)
  assert.equal(topoSort(['a', 'b'], { a: ['b'], b: ['a'] }).length, 2);
});

// --- SQL genere --------------------------------------------------------------

test('upsertSql : ON CONFLICT DO UPDATE et pas INSERT OR REPLACE', () => {
  const sql = upsertSql('org_users', ['id', 'full_name', 'is_active'], ['id']);
  // OR REPLACE supprime la ligne en conflit et declencherait les cles etrangeres
  assert.ok(!sql.includes('OR REPLACE'), 'pas de OR REPLACE');
  assert.equal(
    sql,
    'INSERT INTO "org_users" ("id", "full_name", "is_active") VALUES (?, ?, ?) ON CONFLICT ("id") DO UPDATE SET "full_name" = excluded."full_name", "is_active" = excluded."is_active"',
  );
});

test('upsertSql : cle composite + colonnes a guillemets', () => {
  const sql = upsertSql('t', ['a', 'b', 'v'], ['a', 'b']);
  assert.ok(sql.endsWith('ON CONFLICT ("a", "b") DO UPDATE SET "v" = excluded."v"'), sql);
  assert.equal(upsertSql('a"b', ['c'], ['c']), 'INSERT INTO "a""b" ("c") VALUES (?) ON CONFLICT ("c") DO NOTHING');
});

test('upsertSql : table entierement couverte par la cle -> DO NOTHING', () => {
  // Rien a mettre a jour : la ligne est absente, ou deja identique.
  assert.equal(
    upsertSql('jointure', ['a', 'b'], ['a', 'b']),
    'INSERT INTO "jointure" ("a", "b") VALUES (?, ?) ON CONFLICT ("a", "b") DO NOTHING',
  );
});

test('deleteSql : une ligne par cle primaire (D1 refuse >100 parametres)', () => {
  assert.equal(deleteSql('org_users', ['id']), 'DELETE FROM "org_users" WHERE "id" = ?');
  assert.equal(deleteSql('t', ['a', 'b']), 'DELETE FROM "t" WHERE "a" = ? AND "b" = ?');
});

test('pkKey : Postgres et SQLite peuvent rendre le meme entier de type different', () => {
  assert.equal(pkKey({ id: 7 }, ['id']), pkKey({ id: '7' }, ['id']));
  assert.equal(pkKey({ id: 0 }, ['id']), pkKey({ id: '0' }, ['id']));
  assert.equal(pkKey({ a: 'x', b: 2 }, ['a', 'b']), 'x\u00002');
  assert.notEqual(pkKey({ id: 1 }, ['id']), pkKey({ id: 2 }, ['id']));
  assert.equal(pkKey({ id: null }, ['id']), '', 'null = absence');
});

// --- Purge des orphelins -----------------------------------------------------

test('purgeOrphans : ne supprime que ce que Supabase n\'a plus', async () => {
  const d1 = new FakeD1();
  d1.data.set('org_users', [{ id: 'u1' }, { id: 'u2' }, { id: 'gone' }]);
  const n = await purgeOrphans(d1, 'org_users', ['id'], new Set(['u1', 'u2']));
  assert.equal(n, 1, 'une seule orpheline');
  assert.deepEqual((d1.data.get('org_users') || []).map((r) => r.id), ['u1', 'u2']);
});

test('purgeOrphans : pas de requete quand la table est deja conforme', async () => {
  const d1 = new FakeD1();
  d1.data.set('org_users', [{ id: 'u1' }]);
  const n = await purgeOrphans(d1, 'org_users', ['id'], new Set(['u1']));
  assert.equal(n, 0);
  assert.equal(d1.execs.filter((e) => e.sql.startsWith('DELETE')).length, 0);
});

// --- Synchronisation complete ------------------------------------------------

const SCHEMA: Schema = {
  tables: ['org_tasks', 'org_users', 'organizations'],
  pk: { organizations: ['id'], org_users: ['id'], org_tasks: ['id'] },
  refs: { org_users: ['organizations'], org_tasks: ['org_users'] },
};

function makeEnv(kv: FakeKV, d1: FakeD1): SyncEnv {
  return { DB: d1 as unknown as D1Like, DOCS_KV: kv as KVLike } as SyncEnv;
}

test('resync : ecrit les meres d\'abord puis purge les orphelins, filles d\'abord', async () => {
  const kv = new FakeKV();
  const d1 = new FakeD1();
  // D1 a un utilisateur de trop et n'a pas encore la 3e tache
  d1.data.set('organizations', [{ id: 'org1', name: 'EUREX' }]);
  d1.data.set('org_users', [{ id: 'u1' }, { id: 'u2' }, { id: 'zombie' }]);
  d1.data.set('org_tasks', [{ id: 't1' }]);

  const src = fakeSource(SCHEMA, {
    organizations: [{ id: 'org1', name: 'EUREX (maj)' }],
    org_users: [{ id: 'u1', full_name: 'Omar' }, { id: 'u2', full_name: 'Nawel' }],
    org_tasks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
  });

  let flipped = false;
  const report = await resyncSupabaseToD1(makeEnv(kv, d1), {
    source: src,
    onSuccess: async () => {
      // Le verrou est toujours pose au moment de la bascule : c'est ce qui
      // empeche une ecriture de passer entre la copie et le retour sur D1.
      assert.ok(await kv.get(SYNC_KEY), 'verrou pose pendant la bascule');
      flipped = true;
    },
  });

  assert.equal(report.ok, true, report.error);
  assert.equal(flipped, true, 'onSuccess appele');
  assert.equal(report.tables, 3);
  assert.equal(report.rows, 6);
  assert.equal(report.purged, 1);

  // Donnees conformes a Supabase
  assert.deepEqual(d1.data.get('organizations'), [{ id: 'org1', name: 'EUREX (maj)' }]);
  assert.deepEqual((d1.data.get('org_users') || []).map((r) => r.id), ['u1', 'u2']);
  assert.deepEqual((d1.data.get('org_tasks') || []).map((r) => r.id), ['t1', 't2', 't3']);

  // Les meres sont ecrites avant les filles, la purge dans l'ordre inverse
  const written = d1.execs.filter((e) => e.sql.startsWith('INSERT')).map((e) => /"([^"]+)" \(/.exec(e.sql)![1]);
  assert.deepEqual([...new Set(written)], ['organizations', 'org_users', 'org_tasks']);
  // La purge ne supprime que l'orpheline, mais elle PARCOURT les tables en
  // ordre inverse : une fille ne peut pas etre supprimee apres sa mere.
  const purged = d1.execs.filter((e) => e.sql.startsWith('SELECT')).map((e) => /FROM "([^"]+)"/.exec(e.sql)![1]);
  assert.deepEqual(purged, ['org_tasks', 'org_users', 'organizations'], 'purge en ordre inverse (filles d\'abord)');
  const deleted = d1.execs.filter((e) => e.sql.startsWith('DELETE')).map((e) => /FROM "([^"]+)"/.exec(e.sql)![1]);
  assert.deepEqual(deleted, ['org_users'], 'seule l\'orpheline disparait');

  // Verrou libere en tout dernier
  assert.equal(kv.m.has(SYNC_KEY), false, 'verrou libere');
  assert.equal(kv.ops[kv.ops.length - 1], 'del:' + SYNC_KEY, 'verrou libere apres la bascule');
});

test('resync : echec de D1 -> pas de bascule, verrou libere, on reste sur Supabase', async () => {
  const kv = new FakeKV();
  const d1 = new FakeD1();
  d1.failSql = 'org_users'; // la copie casse en plein milieu
  let flipped = false;

  const report = await resyncSupabaseToD1(makeEnv(kv, d1), {
    source: fakeSource(SCHEMA, {
      organizations: [{ id: 'org1' }],
      org_users: [{ id: 'u1' }],
      org_tasks: [],
    }),
    onSuccess: async () => { flipped = true; },
  });

  assert.equal(report.ok, false);
  assert.equal(flipped, false, 'aucune bascule sans reussite complete');
  assert.match(report.error || '', /org_users/, 'le message nomme la table en cause');
  assert.equal(kv.m.has(SYNC_KEY), false, 'verrou libere malgre l\'echec');
  assert.equal(kv.m.has('__backend/mode'), false, 'le mode n\'a pas bouge');
});

test('resync : dry ne touche ni a D1 ni au KV', async () => {
  const kv = new FakeKV();
  const d1 = new FakeD1();
  const report = await resyncSupabaseToD1(makeEnv(kv, d1), {
    dry: true,
    source: fakeSource(SCHEMA, { organizations: [{ id: 'org1' }], org_users: [], org_tasks: [] }),
  });
  assert.equal(report.ok, true, report.error);
  assert.equal(d1.execs.length, 0, 'aucune ecriture D1');
  assert.equal(kv.ops.length, 0, 'aucun verrou pose');
  assert.equal(report.rows, 1, 'le plan est pourtant rendu');
});

test('resync : sans connexion Supabase, erreur claire et rien n\'est fait', async () => {
  const kv = new FakeKV();
  const d1 = new FakeD1();
  const report = await resyncSupabaseToD1({ DB: d1 as unknown as D1Like, DOCS_KV: kv } as SyncEnv);
  assert.equal(report.ok, false);
  assert.match(report.error || '', /HYPERDRIVE/);
  assert.equal(kv.ops.length, 0);
});

test('resync : une table sans cle primaire est refusee plutot que corrompue', async () => {
  const kv = new FakeKV();
  const d1 = new FakeD1();
  const schema: Schema = { tables: ['sans_pk'], pk: {}, refs: {} };
  const report = await resyncSupabaseToD1(makeEnv(kv, d1), {
    source: fakeSource(schema, { sans_pk: [{ a: 1 }] }),
  });
  assert.equal(report.ok, false);
  assert.match(report.error || '', /sans cle primaire/);
});
