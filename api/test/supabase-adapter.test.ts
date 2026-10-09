// Adaptateur Supabase : interface D1 (prepare/bind/first/all/run/batch)
// verifiee contre le faux serveur PG partage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAdapter, type SupabaseStatement } from '../src/supabase-adapter.ts';
import { PgError } from '../src/pg/client.ts';
import { makeClient, type Responder } from './fake-pg.ts';

function makeAdapter(responder?: Responder): { adapter: SupabaseAdapter; sessions: ReturnType<typeof makeClient>['sessions'] } {
  const { client, sessions } = makeClient({ responder });
  return { adapter: new SupabaseAdapter(client), sessions };
}

const isPkMap = (sql: string) => sql.includes('information_schema.table_constraints');
const appSqls = (sqls: string[]) => sqls.filter(s => !isPkMap(s));

test('all() : interface D1 — results/success/meta', async () => {
  const { adapter, sessions } = makeAdapter(() => ({
    fields: [['id', 25], ['nom', 25]],
    rows: [['s1', 'ACME'], [null, 'SARL X']],
    tag: 'SELECT 2',
  }));
  const r = await adapter.prepare('SELECT id, nom FROM societes').all();
  assert.equal(r.success, true);
  assert.equal(r.meta.served_by, 'supabase');
  assert.deepEqual(r.results, [
    { id: 's1', nom: 'ACME' },
    { id: null, nom: 'SARL X' },
  ]);
  assert.equal(sessions[0].state, 3, 'connecte');
  adapter.close();
});

test('first() : objet unique ou null', async () => {
  const { adapter } = makeAdapter((sql) => {
    if (isPkMap(sql)) return null;
    return { fields: [['id', 25], ['n', 23]], rows: [['s1', '5']], tag: 'SELECT 1' };
  });
  const row = await adapter.prepare('SELECT id, n FROM t WHERE id = ?').bind('s1').first();
  assert.deepEqual(row, { id: 's1', n: 5 });
  adapter.close();

  const { adapter: a2 } = makeAdapter(() => ({ fields: [['id', 25]], rows: [], tag: 'SELECT 0' }));
  assert.equal(await a2.prepare('SELECT id FROM t').first(), null);
  a2.close();
});

test('run() : meta.changes depuis le tag PG', async () => {
  const { adapter } = makeAdapter(() => ({ tag: 'INSERT 0 3' }));
  const r = await adapter.prepare('INSERT INTO t (a) VALUES (?)').bind(1).run();
  assert.equal(r.meta.changes, 3);
  assert.equal(r.meta.last_row_id, 0);
  assert.deepEqual(r.results, []);
  adapter.close();
});

test('traduction a la volee : ? -> $n, datetime -> to_char (SQL vu par PG)', async () => {
  const { adapter, sessions } = makeAdapter(() => ({ tag: 'SELECT 0', fields: [['id', 25]], rows: [] }));
  await adapter
    .prepare("SELECT id FROM t WHERE created_at >= datetime('now', '-' || ? || ' days') AND nom LIKE ?")
    .bind(7, '%x%')
    .all();
  const sql = appSqls(sessions[0].sqls)[0];
  assert.ok(sql.includes('to_char'), 'datetime() traduit: ' + sql);
  assert.ok(!/datetime\s*\(/i.test(sql), 'aucun datetime() residuel');
  assert.ok(sql.includes('$1') && sql.includes('$2'), 'placeholders numerotes');
  assert.ok(!sql.includes('?'), 'aucun ? residuel');
  assert.ok(sql.includes('ILIKE'), 'LIKE -> ILIKE');
  assert.deepEqual(sessions[0].bindParams, ['7', '%x%']);
  adapter.close();
});

test('casse : colonne bonsachat renvoyee en bonsAchat', async () => {
  const { adapter } = makeAdapter((sql) => {
    if (isPkMap(sql)) return null;
    return { fields: [['bonsachat', 23]], rows: [['42']], tag: 'SELECT 1' };
  });
  const row = await adapter.prepare('SELECT bonsAchat FROM rapport_modes').first();
  assert.deepEqual(row, { bonsAchat: 42 });
  adapter.close();
});

test('INSERT OR REPLACE : PK map chargee puis ON CONFLICT genere', async () => {
  const { adapter, sessions } = makeAdapter((sql) => {
    if (isPkMap(sql)) return null; // defaut : PK_SPEC
    return { tag: 'INSERT 0 1' };
  });
  await adapter
    .prepare('INSERT OR REPLACE INTO org_fiscal_alerts (id, organization_id, title) VALUES (?, ?, ?)')
    .bind('a1', 'o1', 'TVA')
    .run();
  const sqls = appSqls(sessions[0].sqls);
  assert.equal(sqls.length, 1, 'seul l\'INSERT passe le filtre pkMap');
  assert.ok(isPkMap(sessions[0].sqls[0]), 'pkMap en premier');
  assert.ok(sqls[0].includes('INSERT INTO org_fiscal_alerts'), 'INSERT simple');
  assert.ok(!/INSERT\s+OR/i.test(sqls[0]), 'INSERT OR REPLACE elimine');
  assert.ok(sqls[0].includes('ON CONFLICT (id) DO UPDATE'), 'cible PK: ' + sqls[0]);
  assert.ok(sqls[0].includes('title = EXCLUDED.title'), 'colonnes updatable');
  adapter.close();
});

test('INSERT OR IGNORE : ON CONFLICT DO NOTHING sans PK map', async () => {
  const { adapter, sessions } = makeAdapter(() => ({ tag: 'INSERT 0 0' }));
  await adapter.prepare('INSERT OR IGNORE INTO org_notifications (id, user_id) VALUES (?, ?)').bind('n1', 'u1').run();
  const sql = appSqls(sessions[0].sqls)[0];
  assert.ok(sql.includes('ON CONFLICT DO NOTHING'), sql);
  adapter.close();
});

test('batch() : transaction BEGIN/COMMIT, aucune requete via client.query', async () => {
  const { adapter, sessions } = makeAdapter(() => ({ tag: 'INSERT 0 1' }));
  const stmts = [
    adapter.prepare('INSERT INTO t (a) VALUES (?)').bind(1) as SupabaseStatement,
    adapter.prepare('INSERT INTO t (b) VALUES (?)').bind(2) as SupabaseStatement,
  ];
  const out = await adapter.batch(stmts);
  assert.equal(out.length, 2);
  assert.equal(out[0].meta.changes, 1);
  const sqls = appSqls(sessions[0].sqls);
  assert.deepEqual(sqls.slice(0, 3), ['BEGIN', 'INSERT INTO t (a) VALUES ($1)', 'INSERT INTO t (b) VALUES ($1)']);
  assert.equal(sqls[3], 'COMMIT');
  assert.deepEqual(sessions[0].bindParams, ['1', '2']);
  adapter.close();
});

test('batch() vide : aucune connexion requise', async () => {
  const { adapter, sessions } = makeAdapter();
  assert.deepEqual(await adapter.batch([]), []);
  assert.equal(sessions.length, 0);
  adapter.close();
});

test('erreur SQL : PgError propage, code conserve', async () => {
  const { adapter } = makeAdapter((sql) => {
    if (isPkMap(sql)) return null;
    return { error: ['42601', 'syntax error'] };
  });
  await assert.rejects(() => adapter.prepare('BOOM').all(), (e: unknown) => {
    assert.ok(e instanceof PgError);
    assert.equal(e.code, '42601');
    return true;
  });
  adapter.close();
});

test('pkMap : chargee une seule fois (cache adapter)', async () => {
  const { adapter, sessions } = makeAdapter(() => ({ fields: [['id', 25]], rows: [], tag: 'SELECT 0' }));
  await adapter.prepare('SELECT id FROM t LIMIT 1').first();
  await adapter.prepare('SELECT id FROM t LIMIT 1').first();
  const pkCalls = sessions[0].sqls.filter(isPkMap);
  assert.equal(pkCalls.length, 1, 'une seule requete information_schema');
  adapter.close();
});
