// Generation du fichier SQL Postgres d'import des donnees SQLite -> Supabase.
// Usage : node api/supabase/import.ts [chemin.db] [--out fichier.sql] [--batch n] [--no-replica]
//   --out        fichier de sortie (defaut : api/supabase/data.sql, gitignore)
//   --batch      lignes par INSERT (defaut 100)
//   --no-replica ne pas desactiver temporairement les FK (session_replication_role)
// Lit l'ordre des tables (FK) et les colonnes cibles depuis schema.sql ; les
// colonnes absentes du schema PG sont signalees et ignorees.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
const pos: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (k === 'no-replica') flags[k] = true;
    else flags[k] = args[++i];
  } else pos.push(a);
}
const dbPath = pos[0] || path.join(__dir, '..', 'local', 'data', 'eurex.db');
const outPath = String(flags.out || path.join(__dir, 'data.sql'));
const batch = Number(flags.batch || 100);
const replica = !flags['no-replica'];

if (!fs.existsSync(dbPath)) {
  console.error('Base introuvable: ' + dbPath);
  process.exit(1);
}
const schemaPath = path.join(__dir, 'schema.sql');
if (!fs.existsSync(schemaPath)) {
  console.error('schema.sql introuvable: ' + schemaPath);
  process.exit(1);
}
const schema = fs.readFileSync(schemaPath, 'utf8');

// --- Tables cibles, dans l'ordre FK du schema -----------------------------
const tableRe = /CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;
const order: string[] = [];
const colsByTable = new Map<string, string[]>();
let m: RegExpExecArray | null;
while ((m = tableRe.exec(schema))) {
  const name = m[1];
  order.push(name);
  // Extraire le corps du CREATE TABLE (parentheses equilibrees)
  let i = tableRe.lastIndex;
  let depth = 1;
  while (i < schema.length && depth > 0) {
    const c = schema[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  const body = schema.slice(m.index + m[0].length, i - 1);
  const cols: string[] = [];
  let d = 0;
  for (const raw of body.split('\n')) {
    const ln = raw.trim();
    const atRoot = d === 0;
    d += (ln.match(/\(/g) || []).length - (ln.match(/\)/g) || []).length;
    if (!atRoot) continue; // ligne interne a une contrainte multi-lignes
    if (!ln || /^(CONSTRAINT|UNIQUE|PRIMARY KEY|CHECK|FOREIGN KEY|EXCLUDE)\b/i.test(ln)) continue;
    const cm = ln.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?\s/);
    if (cm) cols.push(cm[1].toLowerCase());
  }
  colsByTable.set(name, cols);
}
console.log('Schema: ' + order.length + ' tables, ' + [...colsByTable.values()].reduce((a, c) => a + c.length, 0) + ' colonnes cibles');

// --- Lecture SQLite ---------------------------------------------------------
const db = new DatabaseSync(dbPath, { readOnly: true });

function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return "'NaN'";
    if (v === Infinity) return "'Infinity'";
    if (v === -Infinity) return "'-Infinity'";
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Uint8Array) {
    let hex = '';
    for (const b of v) hex += b.toString(16).padStart(2, '0');
    return "'\\x" + hex + "'";
  }
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const lines: string[] = [];
lines.push('-- Genere par api/supabase/import.ts le ' + new Date().toISOString());
lines.push('-- Source : ' + path.resolve(dbPath));
if (replica) {
  lines.push('BEGIN;');
  lines.push('SET LOCAL session_replication_role = replica;');
} else {
  lines.push('BEGIN;');
}

let totalRows = 0;
const warnings: string[] = [];

for (const table of order) {
  const targetCols = colsByTable.get(table)!;
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  if (!exists) {
    warnings.push(table + ': absente de la base SQLite (ignoree)');
    continue;
  }
  const info = db.prepare('PRAGMA table_info("' + table + '")').all() as { name: string }[];
  const srcCols = info.map(c => c.name.toLowerCase());
  const cols = targetCols.filter(c => srcCols.includes(c));
  const missingInSchema = srcCols.filter(c => !targetCols.includes(c));
  const missingInSqlite = targetCols.filter(c => !srcCols.includes(c));
  if (missingInSchema.length) warnings.push(table + ': colonnes SQLite ignorees (pas dans schema.sql): ' + missingInSchema.join(', '));
  if (missingInSqlite.length) warnings.push(table + ': colonnes schema.sql absentes de SQLite (NULL utilise): ' + missingInSqlite.join(', '));
  if (!cols.length) continue;

  const rows = db.prepare('SELECT * FROM "' + table + '"').all() as Record<string, unknown>[];
  if (!rows.length) continue;
  totalRows += rows.length;

  // Les cles retournees par SQLite gardent la casse d'origine : on re-mappe en minuscules
  const low = rows.map(r => {
    const o: Record<string, unknown> = {};
    for (const k in r) o[k.toLowerCase()] = r[k];
    return o;
  });

  const colList = cols.join(', ');
  for (let i = 0; i < low.length; i += batch) {
    const chunk = low.slice(i, i + batch);
    const tuples = chunk.map(r => '(' + cols.map(c => sqlValue(r[c])).join(', ') + ')');
    lines.push('INSERT INTO ' + table + ' (' + colList + ') VALUES ' + tuples.join(',\n') + ';');
  }
  console.log('  ' + table.padEnd(26) + rows.length);
}

lines.push('COMMIT;');
if (replica) lines.push('SET session_replication_role = origin;');
lines.push('');

fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
db.close();

const size = fs.statSync(outPath).size;
console.log('');
for (const w of warnings) console.log('  ! ' + w);
console.log('OK: ' + totalRows + ' lignes -> ' + outPath + ' (' + (size / 1024 / 1024).toFixed(2) + ' Mo)');
if (replica) console.log('FK desactivees pendant la transaction (session_replication_role=replica, requiert le role postgres).');
