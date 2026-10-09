// Client PG avec le faux serveur partage (handshake SCRAM complet,
// requetes, erreur, reconnexion, transactions, file d'attente).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgError } from '../src/pg/client.ts';
import { makeClient } from './fake-pg.ts';

test('handshake complet + requete : valeurs decodees par type OID', async () => {
  const { client, sessions } = makeClient();
  const res = await client.query('SELECT 1 AS n, 42 AS m');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].state, 3, 'handshake termine');
  assert.equal(res.rowCount, 1);
  assert.deepEqual(res.rows, [{ n: 1, m: 42 }]);
  assert.equal(res.tag, 'SELECT 2');
  client.close();
});

test('bool -> 0/1, texte null conserve, tags Lignes', async () => {
  const { client } = makeClient();
  const res = await client.query('SELECT nom, actif FROM societes');
  assert.deepEqual(res.rows, [
    { nom: 'ACME', actif: 1 },
    { nom: null, actif: 0 },
  ]);
  client.close();
});

test('serialisation des params : bool->0/1, null conserve, dates', async () => {
  const { client, sessions } = makeClient();
  await client.query('INSERT INTO t (a) VALUES ($1)', [true]);
  await client.query('INSERT INTO t (a) VALUES ($1)', [null]);
  await client.query('INSERT INTO t (a) VALUES ($1)', [new Date('2026-01-02T03:04:05Z')]);
  assert.deepEqual(sessions[0].bindParams, ['1', null, '2026-01-02 03:04:05']);
  client.close();
});

test('erreur SQL : PgError avec code, pas de retry', async () => {
  const { client, sessions } = makeClient();
  await assert.rejects(() => client.query('BOOM'), (e: unknown) => {
    assert.ok(e instanceof PgError);
    assert.equal(e.code, '42601');
    assert.match(e.message, /syntax error/);
    return true;
  });
  assert.equal(sessions.length, 1, 'pas de reconnexion sur erreur SQL');
  client.close();
});

test('perte de connexion : reset + 1 reprise avec re-handshake', async () => {
  const { client, sessions } = makeClient({ closeOnQuery: true }); // session 0 meurt
  const res = await client.query('SELECT 1 AS n, 42 AS m');
  assert.equal(res.rowCount, 1);
  assert.equal(sessions.length, 2, 'seconde connexion ouverte');
  assert.equal(sessions[1].state, 3, 're-handshake effectue');
  client.close();
});

test('transaction : BEGIN/COMMIT envoyes dans l\'ordre via queryFn', async () => {
  const { client, sessions } = makeClient();
  const out = await client.transaction(async (q) => {
    await q('SELECT 1 AS n, 42 AS m');
    return 'ok';
  });
  assert.equal(out, 'ok');
  assert.deepEqual(sessions[0].sqls, ['BEGIN', 'SELECT 1 AS n, 42 AS m', 'COMMIT']);
  client.close();
});

test('transaction qui echoue : ROLLBACK envoye', async () => {
  const { client, sessions } = makeClient();
  await assert.rejects(() => client.transaction(async (q) => {
    await q('BOOM');
  }), PgError);
  assert.deepEqual(sessions[0].sqls, ['BEGIN', 'BOOM', 'ROLLBACK']);
  client.close();
});

test('file d\'attente : deux requetes concurrentes serialisees', async () => {
  const { client, sessions } = makeClient();
  const [a, b] = await Promise.all([
    client.query('SELECT 1 AS n, 42 AS m'),
    client.query('SELECT nom, actif FROM societes'),
  ]);
  assert.equal(a.rowCount, 1);
  assert.equal(b.rowCount, 2);
  assert.deepEqual(sessions[0].sqls, ['SELECT 1 AS n, 42 AS m', 'SELECT nom, actif FROM societes']);
  client.close();
});
