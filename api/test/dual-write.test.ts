// Double ecriture : une ecriture part vers les deux bases, une lecture vers la
// primaire seule, et un echec secondaire ne doit jamais rendre la requete.
// L'ordre primaire -> secondaire est le contrat le plus important : il garantit
// qu'un echec primaire n'a pas laisse une ecriture orpheline d'un seul cote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DualDb, type DbLike } from '../src/dual-write.ts';
import { isWriteSql, isDdlSql, isDataWriteSql } from '../src/sql-kind.ts';

// Faux D1 : enregistre chaque appel dans l'ordre, et peut echouer sur demande.
function fakeDb(name: string, calls: string[], opts: { failRun?: boolean } = {}): DbLike {
  const stmt = (sql: string, params: unknown[]) => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    run: async () => {
      calls.push(`${name}:run:${sql}`);
      if (opts.failRun) throw new Error(`${name} refuse`);
      return { success: true, results: [], meta: { changes: 1, last_row_id: 0 } };
    },
    all: async () => {
      calls.push(`${name}:all:${sql}`);
      return { results: [], success: true, meta: {} };
    },
    first: async () => {
      calls.push(`${name}:first:${sql}`);
      return null;
    },
  });
  return {
    prepare: (sql: string) => stmt(sql, []),
    batch: async (s: any[]) => {
      calls.push(`${name}:batch:${s.length}`);
      return s.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
}

test('sql-kind : les ecritures de donnees sont reconnues, pas le DDL ni les lectures', () => {
  for (const sql of [
    'INSERT INTO org_tasks (id) VALUES (?)',
    'UPDATE org_tasks SET status = ? WHERE id = ?',
    'DELETE FROM org_notes WHERE id = ?',
    'REPLACE INTO societes (id, raison_sociale) VALUES (?, ?)',
    '  insert into t values (1)',
    '-- hint du traducteur\nINSERT INTO t (a) VALUES (1)',
  ]) assert.equal(isDataWriteSql(sql), true, sql);

  for (const sql of [
    'SELECT id FROM org_tasks',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'EXPLAIN QUERY PLAN SELECT 1',
  ]) assert.equal(isDataWriteSql(sql), false, sql);

  // DDL : jamais double-ecrit (les migrations passent par wrangler, et DDL ne
  // veut pas dire la meme chose des deux cotes : sequence PG vs AUTOINCREMENT).
  for (const sql of ['CREATE INDEX i ON t(a)', 'DROP TABLE t', 'ALTER TABLE t ADD COLUMN c TEXT']) {
    assert.equal(isDdlSql(sql), true, sql);
    assert.equal(isDataWriteSql(sql), false, sql);
  }
  assert.equal(isWriteSql('CREATE TABLE t (a)'), true, 'le DDL reste une ecriture au sens large');
});

test('double ecriture : une lecture ne touche que la primaire', async () => {
  const calls: string[] = [];
  const db = new DualDb(fakeDb('prim', calls), fakeDb('sec', calls));
  await db.prepare('SELECT id FROM t').all();
  await db.prepare('SELECT id FROM t WHERE id = ?').bind('a').first();
  assert.deepEqual(calls, ['prim:all:SELECT id FROM t', 'prim:first:SELECT id FROM t WHERE id = ?']);
});

test('double ecriture : une ecriture part vers les deux bases, primaire d abord', async () => {
  const calls: string[] = [];
  const db = new DualDb(fakeDb('prim', calls), fakeDb('sec', calls));
  await db.prepare('INSERT INTO t (a) VALUES (?)').bind(1).run();
  assert.deepEqual(calls, ['prim:run:INSERT INTO t (a) VALUES (?)', 'sec:run:INSERT INTO t (a) VALUES (?)']);
});

test('double ecriture : un echec secondaire ne rend pas la requete', async () => {
  const calls: string[] = [];
  const gaps: string[] = [];
  const db = new DualDb(
    fakeDb('prim', calls),
    fakeDb('sec', calls, { failRun: true }),
    { onSecondaryFailure: (_e, sql) => gaps.push(sql) },
  );
  // La primaire a reussi : le retour de run() doit etre celui de la primaire,
  // sans exception — l'utilisateur a son resultat.
  const r = await db.prepare('INSERT INTO t (a) VALUES (?)').bind(7).run();
  assert.equal(r.success, true);
  assert.equal(gaps.length, 1, 'l ecart est signale une fois');
  assert.match(gaps[0], /^INSERT INTO t/);
});

test('double ecriture : un echec primaire n ecrit PAS sur la seconde base', async () => {
  const calls: string[] = [];
  const db = new DualDb(fakeDb('prim', calls, { failRun: true }), fakeDb('sec', calls));
  await assert.rejects(() => db.prepare('INSERT INTO t (a) VALUES (?)').bind(1).run(), /refuse/);
  // Verrou de coherence : si la seconde avait ete ecrite, la requete aurait
  // echoue pour l utilisateur tout en ayant cree la ligne d un cote.
  assert.deepEqual(calls, ['prim:run:INSERT INTO t (a) VALUES (?)']);
});

test('double ecriture : batch ecrit les deux cotes', async () => {
  const calls: string[] = [];
  const db = new DualDb(fakeDb('prim', calls), fakeDb('sec', calls));
  const stmts = [
    db.prepare('INSERT INTO t (a) VALUES (?)').bind(1),
    db.prepare('UPDATE t SET a = ? WHERE id = ?').bind(2, 'x'),
  ];
  await db.batch(stmts);
  assert.deepEqual(calls, ['prim:batch:2', 'sec:batch:2']);
});

test('double ecriture : sans base secondaire, tout reste sur la primaire', async () => {
  const calls: string[] = [];
  const db = new DualDb(fakeDb('prim', calls), null);
  await db.prepare('DELETE FROM t WHERE id = ?').bind('x').run();
  assert.deepEqual(calls, ['prim:run:DELETE FROM t WHERE id = ?']);
});

test('double ecriture : un hook qui leve ne casse pas la requete', async () => {
  const calls: string[] = [];
  const db = new DualDb(fakeDb('prim', calls), fakeDb('sec', calls, { failRun: true }), {
    onSecondaryFailure: () => { throw new Error('le rappel est cense etre infaillible'); },
  });
  const r = await db.prepare('INSERT INTO t (a) VALUES (?)').bind(1).run();
  assert.equal(r.success, true);
});
