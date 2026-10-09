// Test d'inventaire : TOUTES les chaines JS de index.ts passees a .prepare()
// ou contenant un marqueur de dialecte SQLite doivent traduire sans erreur.
// Filet de securite contre toute nouvelle construction SQL du code applicatif
// non couverte par le traducteur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toPg } from '../src/pg/translate.ts';
import { extractLiterals, type Lit } from './extract-lits.ts';

const SRC = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

const DIALECT = /datetime\s*\(|strftime\s*\(|INSERT\s+OR\s|sqlite_master|\bGLOB\b/i;

const LITS = extractLiterals(SRC);
const isPrepare = (l: Lit): boolean => {
  // dernier .prepare( avant le literal, suivi uniquement de blancs
  const ctx = SRC.slice(Math.max(0, l.pos - 600), l.pos);
  const idx = ctx.lastIndexOf('.prepare(');
  if (idx === -1) return false;
  const between = ctx.slice(idx + '.prepare('.length);
  return /^\s*$/.test(between.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''));
};
const PREPARES = LITS.filter(isPrepare);
const DIALECTS = LITS.filter(l => DIALECT.test(l.text));
const CANDIDATES = LITS.filter(l => isPrepare(l) || DIALECT.test(l.text));

test('inventaire : volume extrait coherent avec index.ts', () => {
  assert.ok(PREPARES.length >= 400, `requetes .prepare() extraites: ${PREPARES.length} (>=400 attendu)`);
  assert.ok(DIALECTS.length >= 50, `fragments a marqueur SQLite extraits: ${DIALECTS.length} (>=50 attendu)`);
});

test('chaque requete .prepare() et fragment SQLite traduit sans erreur', () => {
  const failures: { sample: string; err: string }[] = [];
  for (const l of CANDIDATES) {
    try {
      toPg(l.text, { pk: {} }); // DEFAULT_PK couvre les 4 INSERT OR REPLACE
    } catch (e) {
      failures.push({ sample: l.text.slice(0, 160).replace(/\s+/g, ' '), err: (e as Error).message.slice(0, 220) });
    }
  }
  assert.deepEqual(failures, [], `${failures.length} chaine(s) non traduite(s):\n`
    + failures.map((f, i) => `[${i}] ${f.sample}\n    -> ${f.err}`).join('\n'));
});

test('traduction idempotente : le PG produit ne re-leve plus rien', () => {
  let n = 0;
  for (const l of CANDIDATES) {
    const pg = toPg(l.text, { pk: {} });
    toPg(pg, { pk: {} }); // deuxieme passe : aucun motif SQLite residuel
    n++;
  }
  assert.ok(n >= 450, `chaines double-passe: ${n}`);
});
