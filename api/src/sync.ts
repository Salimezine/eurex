// Reprise de la main sur D1 apres une bascule vers Supabase.
//
// Pendant la bascule les ecritures vont dans PostgreSQL (Supabase) : D1 reste
// fige sur son contenu d'avant incident. Pour retourner sur D1 il faut donc
// d'abord y reporter ce qui a change, sinon toutes les ecritures faites
// pendant la bascule seraient perdues. C'est le cron quotidien 00:05 UTC
// (le quota de lignes lues de D1 se remet a zero a 00:00 UTC).
//
// Methode, en deux passes :
//   1. lecture de PostgreSQL (source de verite) puis upsert dans D1, meres
//      d'abord (les cles etrangeres sont actives dans D1, verifie le
//      2026-10-10 par SQLITE_CONSTRAINT_FOREIGNKEY) ;
//   2. purge des lignes que Supabase n'a plus, filles d'abord (ordre inverse).
//
// Un echec en cours de route n'a aucune consequence visible : la bascule
// n'a lieu qu'apres reussite complete, donc D1 n'est jamais servi a moitie
// a jour ; et la synchronisation est refaite integralement au passage
// suivant (elle est idempotente). On reste alors sur Supabase, qui sert
// toujours les requetes.
import { PgClient, type TransportFactory } from './pg/client.ts';
import { cloudflareTransport } from './pg/transport.ts';

// Cle KV posee pendant la synchronisation : les requetes attendent la fin au
// lieu d'etre servies (cf. index.ts). Sans ce verrou, une ecriture faite
// pendant que D1 est deja ecrit partirait dans Supabase et disparaitrait au
// retour. Auto-expire apres 15 min si le Worker plante en route.
export const SYNC_KEY = '__backend/sync';

// --- Interfaces structurelles ------------------------------------------------
// Evite d'importer Env depuis index.ts (qui importe ce module) et garde le
// module testable avec des doubles.

export interface D1StmtLike {
  bind(...params: unknown[]): D1StmtLike;
  run(): Promise<unknown>;
  all(): Promise<{ results: any[] }>;
}

export interface D1Like {
  prepare(sql: string): D1StmtLike;
  batch(stmts: D1StmtLike[]): Promise<unknown[]>;
}

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SyncEnv {
  HYPERDRIVE?: { connectionString: string } | null;
  SUPABASE_DB_URL?: string;
  DB: D1Like;
  DOCS_KV?: KVLike | null;
}

export interface Schema {
  tables: string[];
  pk: Record<string, string[]>;   // table -> colonnes de la cle primaire
  refs: Record<string, string[]>; // table -> tables qu'elle reference (meres)
}

// --- Quota D1 ---------------------------------------------------------------
// D1 impose en gratuit un plafond de lignes lues par jour (remis a zero a
// 00:00 UTC). Le message exact bouge d'une version a l'autre ; on reconnait
// plutot le theme (D1 + plafond de lecture) que la phrase complete.
export function isD1QuotaError(e: unknown): boolean {
  const m = String((e as any)?.message ?? e ?? '');
  if (!/\bd1\b/i.test(m)) return false;
  return /(free tier|row read|read limit|rows read|quota)/i.test(m);
}

// --- SQL ---------------------------------------------------------------------
const q = (id: string) => '"' + String(id).replace(/"/g, '""') + '"';

// Upser SQLite via ON CONFLICT plutot que INSERT OR REPLACE : OR REPLACE
// supprime la ligne en conflit avant de la reecrire, ce qui declenche les cles
// etrangeres qui la referencent — une simple mise a jour de "organizations"
// echouerait a cause de org_users.organization_id. DO UPDATE fait une vraie
// mise a jour, sans supprimee.
export function upsertSql(table: string, cols: string[], pk: string[]): string {
  const target = pk.map(q).join(', ');
  const values = cols.map(() => '?').join(', ');
  const set = cols.filter((c) => !pk.includes(c)).map((c) => `${q(c)} = excluded.${q(c)}`).join(', ');
  // Table ou toutes les colonnes font partie de la cle : la ligne est soit
  // absente, soit deja identique -> rien a mettre a jour.
  if (!set) {
    return `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${values}) ON CONFLICT (${target}) DO NOTHING`;
  }
  return `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${values}) ON CONFLICT (${target}) DO UPDATE SET ${set}`;
}

export function deleteSql(table: string, pk: string[]): string {
  return `DELETE FROM ${q(table)} WHERE ${pk.map((c) => `${q(c)} = ?`).join(' AND ')}`;
}

// Valeur lue dans PostgreSQL -> valeur attendue par SQLite (D1). Le schema ne
// contient que text/bigint/double precision (verifie le 2026-10-10), donc pas
// de boolean ni de timestamp a traduire : ces branches sont par prudence.
function cell(v: unknown): null | number | string | Uint8Array {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  return String(v);
}

// Cle primaire sous forme de chaine comparable entre les deux bases. Postgres
// peut rendre un bigint la ou SQLite rend un nombre, ou l'inverse : on
// normalise en passant par Number() quand c'est possible.
export function pkKey(row: Record<string, unknown>, pk: string[]): string {
  return pk
    .map((c) => {
      const v = row[c];
      if (v === undefined || v === null) return '';
      const n = Number(v);
      return String(Number.isNaN(n) ? v : n);
    })
    .join('\u0000');
}

// --- Tri topologique --------------------------------------------------------
// Les meres doivent etre inscrites avant les filles (cle etrangere), les
// filles supprimees avant les meres. Un cycle (qui n'existe pas dans ce
// schema) est signale en empilant le reste : D1 reclamera alors, ce qui
// n'empeche pas la bascule puisqu'elle n'a lieu qu'en cas de reussite.
export function topoSort(tables: string[], refs: Record<string, string[]>): string[] {
  const known = new Set(tables);
  const out: string[] = [];
  const done = new Set<string>();
  for (;;) {
    let added = false;
    for (const t of tables) {
      if (done.has(t)) continue;
      const parents = (refs[t] || []).filter((p) => p !== t && known.has(p));
      if (parents.every((p) => done.has(p))) { out.push(t); done.add(t); added = true; }
    }
    if (!added) break;
  }
  for (const t of tables) if (!done.has(t)) { out.push(t); done.add(t); }
  return out;
}

// --- Lecture du schema Supabase ----------------------------------------------
// Les cles etrangeres sont lues dans PostgreSQL, pas dans D1 : pendant la
// bascule D1 peut etre a court de quota de lecture, et il ne faut surtout pas
// en dependre pour pouvoir repondre a l'incident.
async function readSchema(pg: PgClient): Promise<Schema> {
  const t = await pg.query(
    "SELECT table_name AS tbl FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const p = await pg.query(
    "SELECT tc.table_name AS tbl, kcu.column_name AS col FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' ORDER BY tc.table_name, kcu.ordinal_position",
  );
  const f = await pg.query(
    "SELECT tc.table_name AS tbl, ccu.table_name AS parent FROM information_schema.table_constraints tc JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'",
  );
  const tables = t.rows.map((r) => String((r as any).tbl));
  const pk: Record<string, string[]> = {};
  for (const r of p.rows) {
    const k = String((r as any).tbl);
    (pk[k] = pk[k] || []).push(String((r as any).col));
  }
  const refs: Record<string, string[]> = {};
  for (const r of f.rows) {
    const c = String((r as any).tbl);
    const parent = String((r as any).parent);
    if (!c || !parent || c === parent) continue; // auto-reference : sans effet sur l'ordre
    (refs[c] = refs[c] || []).push(parent);
  }
  for (const k of Object.keys(refs)) refs[k] = [...new Set(refs[k])];
  return { tables, pk, refs };
}

// Source des donnees : PostgreSQL reellement, ou un double (tests, serveur
// local sans cloudflare:sockets).
export interface SupaSource {
  schema(): Promise<Schema>;
  rows(table: string): Promise<Record<string, unknown>[]>;
  close(): void;
}

class PgSource implements SupaSource {
  private pg: PgClient;
  private s: Schema | null = null;
  constructor(url: string, tf: TransportFactory) { this.pg = new PgClient(url, tf); }
  async schema(): Promise<Schema> { if (!this.s) this.s = await readSchema(this.pg); return this.s; }
  async rows(table: string): Promise<Record<string, unknown>[]> {
    const r = await this.pg.query(`SELECT * FROM ${q(table)}`);
    return r.rows as Record<string, unknown>[];
  }
  close(): void { try { this.pg.close(); } catch { /* deja ferme */ } }
}

// --- Purge des orphelins -----------------------------------------------------
// Supprime de D1 les lignes que Supabase n'a plus. Les cles primaires de D1
// sont lues une par une (et non `WHERE pk NOT IN (...)`) : D1 refuse plus de
// 100 parametres lies par requete, et certaines tables en des milliers.
export async function purgeOrphans(
  d1: D1Like,
  table: string,
  pk: string[],
  keep: Set<string>,
  batchSize = 50,
): Promise<number> {
  if (!pk.length) return 0;
  const { results } = await d1.prepare(`SELECT ${pk.map(q).join(', ')} FROM ${q(table)}`).all();
  let gone = 0;
  let batch: D1StmtLike[] = [];
  const del = deleteSql(table, pk);
  for (const row of results as any[]) {
    if (keep.has(pkKey(row, pk))) continue;
    batch.push(d1.prepare(del).bind(...pk.map((c) => row[c])));
    gone++;
    if (batch.length >= batchSize) { await d1.batch(batch); batch = []; }
  }
  if (batch.length) await d1.batch(batch);
  return gone;
}

// --- Synchronisation ---------------------------------------------------------
export interface ResyncReport {
  ok: boolean;
  dry?: boolean;
  tables: number;
  rows: number;   // lignes relues dans Supabase (et reecrites dans D1)
  purged: number; // lignes supprimees de D1 (absentes de Supabase)
  ms: number;
  order: string[];
  warnings: string[];
  error?: string;
}

export interface ResyncOptions {
  // Ne fait que lire Supabase et rendre le plan : ne touche ni a D1 ni au KV.
  dry?: boolean;
  // Appele une fois la reussite confirmee, AVANT la levee du verrou. C'est
  // index.ts qui bascule le KV : l'ordre "flip puis verrou libre" est ce qui
  // garantit qu'aucune ecriture ne passe entre la fin de la copie et la bascule.
  onSuccess?: () => Promise<void>;
  log?: (msg: string) => void;
  // Source substituable : PostgreSQL en production, un double en test.
  source?: SupaSource;
}

export async function resyncSupabaseToD1(
  env: SyncEnv,
  opts: ResyncOptions = {},
): Promise<ResyncReport> {
  const t0 = Date.now();
  const log = opts.log || (() => {});
  const report: ResyncReport = {
    ok: false, dry: !!opts.dry, tables: 0, rows: 0, purged: 0, ms: 0, order: [], warnings: [],
  };
  const kv = env.DOCS_KV || null;
  const url = env.HYPERDRIVE?.connectionString || env.SUPABASE_DB_URL;
  const src = opts.source || (url ? new PgSource(url, cloudflareTransport as TransportFactory) : null);
  if (!src) {
    report.error = 'aucune connexion Supabase (HYPERDRIVE ou SUPABASE_DB_URL)';
    report.ms = Date.now() - t0;
    return report;
  }

  let locked = false;
  try {
    if (!opts.dry && kv) {
      await kv.put(SYNC_KEY, new Date().toISOString(), { expirationTtl: 900 });
      locked = true;
    }

    const schema = await src.schema();
    const order = topoSort(schema.tables, schema.refs);
    report.order = order;
    report.tables = order.length;
    log(`${order.length} tables ; ordre : ${order.slice(0, 5).join(', ')} ...`);

    // Passe 1 : relecture de Supabase puis upsert dans D1, meres d'abord.
    const keeps = new Map<string, Set<string>>();
    for (const t of order) {
      const pk = schema.pk[t];
      if (!pk || !pk.length) throw new Error(`table "${t}" sans cle primaire : synchronisation impossible`);
      const rows = await src.rows(t);
      const keep = new Set<string>();
      for (const row of rows) keep.add(pkKey(row as any, pk));
      keeps.set(t, keep);
      report.rows += rows.length;
      if (rows.length === 0) { log(`${t}: vide`); continue; }
      if (opts.dry) continue;

      const cols = Object.keys(rows[0] as any);
      const sql = upsertSql(t, cols, pk);
      let batch: D1StmtLike[] = [];
      try {
        for (const row of rows as any[]) {
          batch.push(env.DB.prepare(sql).bind(...cols.map((c) => cell(row[c]))));
          if (batch.length >= 50) { await env.DB.batch(batch); batch = []; }
        }
        if (batch.length) await env.DB.batch(batch);
      } catch (e: any) {
        // Nom de la table dans le message : sans cela, un refus de D1 (limite
        // de parametres, cle etrangere) est impossible a diagnostiquer dans les
        // logs du cron.
        throw new Error(`table "${t}" : ${e?.message || e}`);
      }
      log(`${t}: ${rows.length} lignes`);
    }

    // Passe 2 : purge des orphelins, filles d'abord (une fille referencant une
    // mere encore presente doit etre supprimee avant elle).
    if (!opts.dry) {
      for (const t of [...order].reverse()) {
        const purged = await purgeOrphans(env.DB, t, schema.pk[t] || [], keeps.get(t) || new Set());
        report.purged += purged;
        if (purged) log(`${t}: ${purged} orphelin(s) supprime(s)`);
      }
    }

    if (opts.onSuccess) await opts.onSuccess();
    report.ok = true;
  } catch (e: any) {
    report.error = String(e?.message || e);
  } finally {
    // Verrou libere en dernier : si la bascule a eu lieu, elle est deja
    // inscrite en KV avant que les requetes ne reprennent.
    if (locked && kv) { try { await kv.delete(SYNC_KEY); } catch { /* auto-expire par TTL */ } }
    try { src.close(); } catch { /* deja ferme */ }
    report.ms = Date.now() - t0;
  }
  return report;
}
