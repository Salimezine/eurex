// Adaptateur Supabase : interface D1 (prepare/bind/first/all/run/batch)
// identique a env.DB, executee contre PostgreSQL via PgClient. Le SQL source
// reste en dialecte SQLite ; la traduction est appliquee a la volee (toPg).
import { toPg, type PkMap } from './pg/translate.ts';
import { PgClient, type TransportFactory } from './pg/client.ts';
import { cloudflareTransport } from './pg/transport.ts';

// Casse des identifiants : PG plie les identifiants non quotes (bonsAchat ->
// bonsachat) mais l'app lit la casse SQLite d'origine. Une seule colonne
// camelCase existe dans le schema (voir api/supabase/README.md).
const CASE_MAP: Record<string, string> = { bonsachat: 'bonsAchat' };

type SqlParam = null | number | bigint | string | Uint8Array;

function norm(v: unknown): SqlParam {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  return String(v);
}

function applyCase(row: Record<string, unknown>): Record<string, unknown> {
  let needs = false;
  for (const k in row) {
    if (k in CASE_MAP) { needs = true; break; }
  }
  if (!needs) return row;
  const out: Record<string, unknown> = {};
  for (const k in row) out[CASE_MAP[k] || k] = row[k];
  return out;
}

export class SupabaseStatement {
  readonly adapter: SupabaseAdapter;
  readonly sql: string;
  readonly params: unknown[];

  constructor(adapter: SupabaseAdapter, sql: string, params: unknown[] = []) {
    this.adapter = adapter;
    this.sql = sql;
    this.params = params;
  }

  bind(...params: unknown[]): SupabaseStatement {
    return new SupabaseStatement(this.adapter, this.sql, params);
  }

  async first<T = any>(): Promise<T | null> {
    const r = await this.adapter.exec(this.sql, this.params);
    if (r.rows.length === 0) return null;
    return applyCase(r.rows[0]) as T;
  }

  async all<T = any>(): Promise<{ results: T[]; success: boolean; meta: any }> {
    const r = await this.adapter.exec(this.sql, this.params);
    return {
      results: r.rows.map(row => applyCase(row)) as T[],
      success: true,
      meta: { changes: r.rowCount, served_by: 'supabase' },
    };
  }

  async run(): Promise<{ success: boolean; results: any[]; meta: { changes: number; last_row_id: number } }> {
    const r = await this.adapter.exec(this.sql, this.params);
    const m = r.tag.match(/(\d+)\s*$/);
    return {
      success: true,
      results: [],
      meta: { changes: m ? Number(m[1]) : 0, last_row_id: 0 },
    };
  }
}

export class SupabaseAdapter {
  // Le socket est ouvert dans le contexte D'UNE requete et ne peut pas en
  // traverser une autre (Workers : "Cannot perform I/O on behalf of a different
  // request"). On garde l'adaptateur en singleton — pour son cache pkMap, qui
  // lui est portable — mais la connexion est ouverte par requete puis rendue
  // via endRequest(). Fabrique plutot que client : le constructeur accepte
  // toujours un client direct (tests).
  private mkClient: () => PgClient;
  private client: PgClient | null = null;
  private pk: PkMap | null = null;
  private pkLoading: Promise<PkMap> | null = null;

  constructor(client: PgClient | (() => PgClient)) {
    this.mkClient = typeof client === 'function' ? client : () => client;
  }

  private get c(): PgClient {
    if (!this.client) this.client = this.mkClient();
    return this.client;
  }

  // Fin de requete : referme la connexion, la prochaine en ouvrira une autre.
  endRequest(): void {
    const c = this.client;
    this.client = null;
    if (c) { try { c.close(); } catch { /* deja ferme */ } }
  }

  prepare(sql: string): SupabaseStatement {
    return new SupabaseStatement(this, sql);
  }

  // D1 batch est atomique : meme comportement via transaction PostgreSQL.
  // Les requetes passent par le queryFn fourni par transaction() : les
  // appeler via client.query() re-acquerirait la file -> deadlock.
  async batch(stmts: SupabaseStatement[]): Promise<any[]> {
    if (stmts.length === 0) return [];
    const pk = await this.pkMap();
    return this.c.transaction(async (q) => {
      const out: any[] = [];
      for (const s of stmts) {
        const r = await q(toPg(s.sql, { pk }), s.params);
        const m = r.tag.match(/(\d+)\s*$/);
        out.push({ success: true, results: [], meta: { changes: m ? Number(m[1]) : 0, last_row_id: 0 } });
      }
      return out;
    });
  }

  async exec(sql: string, params: unknown[]) {
    const pk = await this.pkMap();
    return this.c.query(toPg(sql, { pk }), params);
  }

  // PK de toutes les tables (une requete) : necessaire a INSERT OR REPLACE
  private async pkMap(): Promise<PkMap> {
    if (this.pk) return this.pk;
    if (!this.pkLoading) {
      this.pkLoading = (async () => {
        const r = await this.c.query(
          "SELECT tc.table_name AS tbl, kcu.column_name AS col FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' ORDER BY tc.table_name, kcu.ordinal_position",
        );
        const map: PkMap = {};
        for (const row of r.rows) {
          const t = String(row.tbl);
          (map[t] = map[t] || []).push(String(row.col));
        }
        this.pk = map;
        return map;
      })().catch(e => {
        this.pkLoading = null;
        throw e;
      });
    }
    return this.pkLoading;
  }

  close(): void {
    this.endRequest();
  }
}

// Singleton par URL : conserve le cache pkMap d'une requete a l'autre. La
// connexion, elle, est ouverte par requete puis rendue (endRequest).
const adapters = new Map<string, SupabaseAdapter>();

export function getSupabaseAdapter(dbUrl: string, tf?: TransportFactory): SupabaseAdapter {
  let a = adapters.get(dbUrl);
  if (!a) {
    a = new SupabaseAdapter(() => new PgClient(dbUrl, tf || cloudflareTransport));
    adapters.set(dbUrl, a);
  }
  return a;
}
