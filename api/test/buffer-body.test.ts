// Corps conserve pour le rejou apres bascule automatique (D1 -> Supabase).
// Le contrat est subtil et a deja casse la production une fois : la
// conservation CONSOMME le corps de la requete d'origine, il faut donc servir
// la copie. Sans ce test, l'erreur "Body has already been used" revient au
// moindre ajout de code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bufferBody } from '../src/index.ts';

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://api.test/api/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'content-length': String(body.length), ...headers },
    body,
  });
}

test('bufferBody : GET/HOST sans corps -> pas de conservation (rejouable tel quel)', async () => {
  assert.equal(await bufferBody(new Request('https://api.test/api/x')), null);
  assert.equal(await bufferBody(new Request('https://api.test/api/x', { method: 'HEAD' })), null);
});

test('bufferBody : POST conserve le corps, la copie reenvoie les memes octets', async () => {
  const req = post('{"a":1}');
  const buffered = await bufferBody(req);
  assert.ok(buffered, 'corps conserve');
  assert.equal(req.bodyUsed, true, 'le flux d\'origine est consomme');

  const copy = buffered.fresh();
  assert.equal(await copy.json().then((r: any) => r.a), 1, 'la copie porte le corps');
  // Et on peut la rejouer : chaque appel fabrique une copie neuve.
  assert.equal(await buffered.fresh().json().then((r: any) => r.a), 1, 'rejoueable');
});

test('bufferBody : sans content-length (flux piece par piece) -> pas de conservation', async () => {
  const req = new Request('https://api.test/api/x', { method: 'POST', body: 'abc' });
  assert.equal(await bufferBody(req), null);
});

test('bufferBody : corps trop volumineux -> pas de conservation (memoire)', async () => {
  const big = 'x'.repeat(1_000_001);
  assert.equal(await bufferBody(post(big)), null);
  assert.equal((await bufferBody(post(big, { 'content-length': '9999999999' }))), null);
});

test('bufferBody : la copie conserve la methode et les en-tetes (auth, content-type)', async () => {
  const req = new Request('https://api.test/api/x', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: '{}',
  });
  // curl/les navigateurs ne posent pas toujours content-length : on s'appuie
  // alors sur la longueur du corps deja lu ? Non : on refuse (pas de repli).
  assert.equal(await bufferBody(req), null, 'sans content-length, pas de conservation');
  assert.equal(req.bodyUsed, false, 'le corps reste intact pour le dispatch normal');
});
