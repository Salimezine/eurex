// SCRAM-SHA-256 : vecteur de test officiel RFC 5802 (section 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scramStart, scramFinal } from '../src/pg/scram.ts';

const RFC = {
  username: 'user',
  password: 'pencil',
  clientNonce: 'rOprNGfwEbeRWgbNEkqO',
  serverFirst:
    'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
  clientFinalExpected:
    'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,'
    + 'p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=',
  serverFinal: 'v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=',
};

test('client-first : gs2 header + nonce fourni', () => {
  const { state, clientFirstMessage } = scramStart(RFC.username, RFC.clientNonce);
  assert.equal(state.clientFirstBare, 'n=user,r=rOprNGfwEbeRWgbNEkqO');
  assert.equal(clientFirstMessage, 'n,,n=user,r=rOprNGfwEbeRWgbNEkqO');
});

test('echange complet : proof et signature serveur conformes RFC 5802', async () => {
  const { state } = scramStart(RFC.username, RFC.clientNonce);
  const final = await scramFinal(state, RFC.serverFirst, RFC.password);
  assert.equal(final.clientFinalMessage, RFC.clientFinalExpected);
  assert.equal(final.verifyServer(RFC.serverFinal), true);
});

test('signature serveur falsifiee rejetee', async () => {
  const { state } = scramStart(RFC.username, RFC.clientNonce);
  const final = await scramFinal(state, RFC.serverFirst, RFC.password);
  assert.equal(final.verifyServer('v=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='), false);
  assert.equal(final.verifyServer('e=proof-failed'), false);
});

test('nonce serveur ne continuant pas le nonce client -> erreur', async () => {
  const { state } = scramStart(RFC.username, RFC.clientNonce);
  await assert.rejects(
    () => scramFinal(state, 'r=OTHER,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096', RFC.password),
    /nonce du serveur/,
  );
});

test('especial caracteres du username echappes ( = , )', () => {
  const { state, clientFirstMessage } = scramStart('a=b,c');
  assert.equal(state.clientFirstBare, 'n=a=3Db=2Cc,r=' + state.nonce);
  assert.ok(clientFirstMessage.startsWith('n,,n=a=3Db=2Cc,r='));
});
