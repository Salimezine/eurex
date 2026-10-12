// Test de lint SQL : PostgreSQL refuse une colonne nue qui n'est ni dans le
// GROUP BY ni agregee, alors que SQLite l'accepte silencieusement (colonnes
// "bare" libres). Une telle requete passe sur D1 et casse en 500 sur Supabase
// — bogue invisible tant que le basculement automatique D1->Supabase n'a pas
// lieu (constate en production sur /org/comptables/:id/detail).
//
// Filet de securite : toute requete .prepare() de index.ts doit satisfaire la
// regle de groupement de PostgreSQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractLiterals, type Lit } from './extract-lits.ts';

const SRC = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

// --- memes criteres que sql-inventory.test.ts : uniquement les literals .prepare()
const LITS: Lit[] = extractLiterals(SRC);
const isPrepare = (l: Lit): boolean => {
  const ctx = SRC.slice(Math.max(0, l.pos - 600), l.pos);
  const idx = ctx.lastIndexOf('.prepare(');
  if (idx === -1) return false;
  const between = ctx.slice(idx + '.prepare('.length);
  return /^\s*$/.test(between.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''));
};
const PREPARES = LITS.filter(isPrepare);

// --- mots-cles au niveau 0 : parenthèses respectées, chaines/commentaires SQL sautés
interface Tok { w: string; at: number; end: number }
function tokens(sql: string): Tok[] {
  const out: Tok[] = [];
  let depth = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      i++;
      while (i < n && sql[i] !== c) {
        if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === '\\') i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') { while (i < n && sql[i] !== '\n') i++; continue; }
    if (c === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i + 2); i = j === -1 ? n : j + 2; continue; }
    if (c === '(') { depth++; i++; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); i++; continue; }
    if (depth === 0 && /[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < n && /[a-zA-Z_0-9$]/.test(sql[j])) j++;
      out.push({ w: sql.slice(i, j).toLowerCase(), at: i, end: j });
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"') {
      i++;
      while (i < s.length && s[i] !== c) {
        if (s[i] === c && s[i + 1] === c) i += 2;
        else if (s[i] === '\\') i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
    i++;
  }
  out.push(s.slice(start));
  return out;
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

// Fonctions agregées : un terme qui en contient une est deja "agrege"
const AGG = /\b(count|sum|avg|min|max|string_agg|array_agg|bool_and|bool_or|json_agg|group_concat|total|stdev)\s*\(/i;
// Terminateur de clause GROUP BY
const END_OF_GROUP = new Set(['having', 'order', 'limit', 'offset', 'fetch', 'for', 'union', 'intersect', 'except', 'window']);

interface Violation { sql: string; item: string; line: number }
const lineOf = (pos: number): number => SRC.slice(0, pos).split('\n').length;

/** Renvoie la liste des termes SELECT ni groupes ni agreges d'une requete. */
function ungroupedTerms(sql: string): string[] {
  const toks = tokens(sql);
  const groups = toks.filter((t, i) => t.w === 'group' && toks[i + 1]?.w === 'by');
  const bad: string[] = [];
  for (const g of groups) {
    const gi = toks.indexOf(g);
    const selIdx = toks.findLastIndex((t, i) => i < gi && t.w === 'select');
    if (selIdx === -1) continue;
    const sel = toks[selIdx];
    const fromIdx = toks.findIndex((t, i) => i > selIdx && t.w === 'from');
    if (fromIdx === -1 || fromIdx > gi) continue;
    const from = toks[fromIdx];
    const byIdx = gi + 1;
    const endIdx = toks.findIndex((t, i) => i > byIdx && END_OF_GROUP.has(t.w));
    const groupSpan = sql.slice(toks[byIdx].end, endIdx === -1 ? sql.length : toks[endIdx].at);
    const groupKeys = new Set(splitTop(groupSpan).map(norm));
    let list = sql.slice(sel.end, from.at).trim();
    list = list.replace(/^(distinct|all)\s+/i, '');
    for (const rawItem of splitTop(list)) {
      const item = rawItem.trim();
      if (!item) continue;
      if (item === '*' || /\.\*\s*$/.test(item)) continue;            // colonnes etendues : non verifiables
      if (AGG.test(item)) continue;                                   // deja agrege
      if (/\(\s*select\b/i.test(item)) continue;                      // sous-select : non verifiables
      if (/^[?0-9'\"]/.test(item)) continue;                          // literal / placeholder
      const asMatch = /\s+as\s+([a-zA-Z_][a-zA-Z_0-9]*)\s*$/i.exec(item);
      const alias = asMatch ? asMatch[1] : null;
      const expr = asMatch ? item.slice(0, asMatch.index) : item;
      if (groupKeys.has(norm(alias ?? ''))) continue;
      if (groupKeys.has(norm(expr))) continue;
      bad.push(item.replace(/\s+/g, ' '));
    }
  }
  return bad;
}

// --- le lint lui-meme est eprouve sur des cas connus (regression) ---
test('le lint detecte bien les colonnes nues absentes du GROUP BY', () => {
  assert.deepEqual(
    ungroupedTerms('SELECT a, b, SUM(c) as s FROM t GROUP BY a'),
    ['b'],
    'colonne nue non groupee doit etre signalee',
  );
  assert.deepEqual(
    ungroupedTerms('SELECT a, b, SUM(c) as s FROM t GROUP BY a, b'),
    [],
    'colonne explicitement groupee doit passer',
  );
  assert.deepEqual(
    ungroupedTerms('SELECT t.a, u.name, COUNT(*) as n FROM t JOIN u ON u.id = t.uid GROUP BY t.a'),
    ['u.name'],
    'colonne d\'une table differente que celle groupee doit etre signalee',
  );
  assert.deepEqual(
    ungroupedTerms('SELECT date(datetime(x, \'+1 day\')) as d, SUM(y) as s FROM t GROUP BY d'),
    [],
    'alias de sortie reference par le GROUP BY doit passer',
  );
  assert.deepEqual(
    ungroupedTerms('SELECT id FROM t WHERE id IN (SELECT id FROM u GROUP BY id) LIMIT 1'),
    [],
    'GROUP BY d\'une sous-requete n\'engage pas la liste SELECT externe',
  );
  assert.deepEqual(
    ungroupedTerms('SELECT id, COUNT(*) as n FROM t GROUP BY id HAVING COUNT(*) > 1'),
    [],
    'aggregate + HAVING doit passer',
  );
  assert.deepEqual(
    ungroupedTerms('SELECT id, MAX(v) FROM t GROUP BY id'),
    [],
    'aggregate sans alias doit passer',
  );
});

// --- volume : eviter qu'un souci d'extraction fasse passer le test pour rien
const GROUP_BY_QUERIES = PREPARES.filter(l => /\bgroup\s+by\b/i.test(l.text));

test('volume : des requetes GROUP BY sont bien extraites de index.ts', () => {
  assert.ok(
    GROUP_BY_QUERIES.length >= 5,
    `requetes GROUP BY extraites: ${GROUP_BY_QUERIES.length} (>=5 attendu)`,
  );
});

test('chaque GROUP BY satisfait la regle stricte de PostgreSQL', () => {
  const violations: Violation[] = [];
  for (const lit of GROUP_BY_QUERIES) {
    const sql = lit.text;
    for (const item of ungroupedTerms(sql)) violations.push({ sql, item, line: lineOf(lit.pos) });
  }
  const report = violations
    .map(v => `\n  - index.ts:${v.line} — terme: ${v.item}\n    requete: ${v.sql.slice(0, 220)}`)
    .join('');
  assert.equal(
    violations.length,
    0,
    `PostgreSQL refuse ${violations.length} terme(s) SELECT non agrege(s) ni presente(s) `
      + `dans le GROUP BY (SQLite les autorise — echec en mode Supabase, OK en mode D1):${report}`,
  );
});
