// Migration : dump SQL D1 (wrangler d1 export) -> SQLite local.
// Usage : node api/local/migrate.ts <dump.sql> [chemin.db] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const force = args.includes('--force');
const pos = args.filter(a => !a.startsWith('--'));
const dumpPath = pos[0];
const dbPath = pos[1] || path.join(__dir, 'data', 'eurex.db');

if (!dumpPath) {
  console.error('Usage: node migrate.ts <dump.sql> [chemin.db] [--force]');
  process.exit(1);
}
if (!fs.existsSync(dumpPath)) { console.error('Dump introuvable: ' + dumpPath); process.exit(1); }
if (fs.existsSync(dbPath)) {
  if (!force) { console.error('La base existe deja: ' + dbPath + ' (utiliser --force pour ecraser)'); process.exit(1); }
  fs.rmSync(dbPath); fs.rmSync(dbPath + '-wal', { force: true }); fs.rmSync(dbPath + '-shm', { force: true });
}
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sql = fs.readFileSync(dumpPath, 'utf8');
console.log('Import de ' + path.basename(dumpPath) + ' (' + (sql.length / 1024 / 1024).toFixed(1) + ' Mo)...');

const t0 = Date.now();
const db = new DatabaseSync(dbPath);
try {
  db.exec(sql);
} catch (e: any) {
  console.error('ERREUR import: ' + (e?.message || e));
  process.exit(1);
}

const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name"
).all() as { name: string }[];
let total = 0;
const lines: string[] = [];
for (const t of tables) {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as any;
  total += Number(r.n);
  lines.push('  ' + t.name.padEnd(28) + r.n);
}
console.log(lines.join('\n'));
console.log(`OK: ${tables.length} tables, ${total} lignes, ${(Date.now() - t0) / 1000}s -> ${dbPath}`);
db.close();
