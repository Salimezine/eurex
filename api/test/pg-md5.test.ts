// MD5 : vecteurs de test officiels RFC 1321 (annexe A.5) + formule libpq
// d'AuthenticationMD5Password. Implemente a la main pour eviter toute
// dependance a node:crypto (module charge dans le Worker ET en local).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md5Hex, md5PasswordResponse } from '../src/pg/md5.ts';

test('md5 : vecteurs RFC 1321 (annexe A.5)', () => {
  assert.equal(md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5Hex('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
  assert.equal(
    md5Hex('abcdefghijklmnopqrstuvwxyz'),
    'c3fcd3d76192e4007dfb496cca67e13b',
  );
  assert.equal(
    md5Hex('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'),
    'd174ab98d277d9f5a5611c2c9f419d9f',
  );
  assert.equal(
    md5Hex('12345678901234567890123456789012345678901234567890123456789012345678901234567890'),
    '57edf4a22be3c955ac49da2e2107b67a',
  );
});

test('md5 : entrees binaires et multibloc (au-dela de 64 octets)', () => {
  // 55 octets = cas limite de la methode de remplissage (le padding tient
  // encore dans le meme bloc), 64 = passage au bloc suivant.
  assert.equal(md5Hex(new Uint8Array(55)).length, 32);
  assert.equal(md5Hex(new Uint8Array(64)).length, 32);
  assert.notEqual(md5Hex(new Uint8Array(55)), md5Hex(new Uint8Array(56)));
});

test('md5PasswordResponse : formule libpq md5(md5(pass+user)+sel)', () => {
  // Valeur obtenue par un calcul independant (Python hashlib) — c'est la
  // reference contre laquelle il faut valider, pas notre propre code.
  const salt = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
  assert.equal(
    md5PasswordResponse('password', 'user', salt),
    'md5d6f407104ca5ba8553d598fed7df90e0',
  );
});

test('md5PasswordResponse : le sel ne fait que 4 octets', () => {
  const salt = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0xaa, 0xbb, 0xcc, 0xdd]);
  const court = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
  assert.equal(
    md5PasswordResponse('password', 'user', salt),
    md5PasswordResponse('password', 'user', court),
  );
});

test('md5PasswordResponse : depend bien du mot de passe, de l\'utilisateur et du sel', () => {
  const salt = new Uint8Array([1, 2, 3, 4]);
  const base = md5PasswordResponse('password', 'user', salt);
  assert.notEqual(md5PasswordResponse('passworD', 'user', salt), base);
  assert.notEqual(md5PasswordResponse('password', 'User', salt), base);
  assert.notEqual(md5PasswordResponse('password', 'user', new Uint8Array([1, 2, 3, 5])), base);
  assert.match(base, /^md5[0-9a-f]{32}$/);
});
