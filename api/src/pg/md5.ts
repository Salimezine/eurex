// AuthenticationMD5Password (code de protocole 5).
//
// Presente par les drivers standards (node-postgres, libpq) mais absente de
// notre client, qui ne gerait que SCRAM. Mesure du 2026-10-10 : l'endpoint
// local d'Hyperdrive (.hyperdrive.local) repond 'N' au SSLRequest puis demande
// une auth MD5 — donc indispensable pour passer par Hyperdrive.
//
// Algorithme tel que defini par libpq (fe-auth.c) :
//   hash  = md5( md5( motdepasse || nom_utilisateur ) || sel_4_octets )
//   reponse = "md5" + hash_hexa
//
// Le MD5 n'est ici qu'un echange de mot de passe historique (eviter de le
// transmettre en clair), pas un primitive de securite. Implementation MD5
// ecrite a la main (RFC 1321) plutot que node:crypto : ce module est charge
// dans le Worker ET dans le serveur local, sans dependance de typings.

/** Constantes de rotation de la RFC 1321 (section 3.4). */
const S = new Uint8Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]);

/** K[i] = floor(2^32 * abs(sin(i+1))) — table de la RFC 1321 (section 3.4). */
const K = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

/** Digest MD5 (RFC 1321) sur 16 octets. */
function md5(input: Uint8Array): Uint8Array {
  const len = input.length;
  // Longueur = multiple de 64 octets : bits de longueur originaux + 0x80
  // + zeros, le tout sur un bloc de plus si necessaire.
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(input);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLen = len * 8;
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const m = new Uint32Array(16);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) m[i] = dv.getUint32(off + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      // Somme en virgule flottante puis ramenee a 32 bits : le total reste
      // < 2^34, donc exact dans une mantisse de 53 bits.
      const sum = f + a + K[i] + m[g];
      a = d;
      d = c;
      c = b;
      const rot = (sum << S[i]) | (sum >>> (32 - S[i]));
      b = (b + rot) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return out;
}

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += HEX[b >> 4] + HEX[b & 15];
  return s;
}

/** Digest MD5 hexa — expose pour les vecteurs de test (RFC 1321, annexe A.5). */
export function md5Hex(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return toHex(md5(bytes));
}

/**
 * Construit le corps du PasswordMessage pour AuthenticationMD5Password :
 *   "md5" + hex( md5( hex( md5(user+pass) ) + sel ) )
 */
export function md5PasswordResponse(password: string, username: string, salt: Uint8Array): string {
  const enc = new TextEncoder();
  const innerHex = md5Hex(enc.encode(password + username));
  const inner = enc.encode(innerHex);
  const withSalt = new Uint8Array(inner.length + 4);
  withSalt.set(inner, 0);
  withSalt.set(salt.subarray(0, 4), inner.length);
  return 'md5' + md5Hex(withSalt);
}
