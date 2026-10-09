import { DatabaseSync } from 'node:sqlite';

type SqlParam = null | number | bigint | string | Uint8Array;

function norm(v: unknown): SqlParam {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  return String(v);
}

interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export class D1Statement {
  db: DatabaseSync;
  sql: string;
  params: unknown[];

  constructor(db: DatabaseSync, sql: string, params: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params: unknown[]): D1Statement {
    return new D1Statement(this.db, this.sql, params);
  }

  private st() {
    return this.db.prepare(this.sql);
  }

  async first<T = any>(): Promise<T | null> {
    const row = this.st().get(...(this.params.map(norm) as SqlParam[]));
    return (row ?? null) as T | null;
  }

  async all<T = any>(): Promise<{ results: T[]; success: boolean; meta: any }> {
    const results = this.st().all(...(this.params.map(norm) as SqlParam[])) as T[];
    return { results, success: true, meta: { changes: results.length, served_by: 'local-sqlite' } };
  }

  async run(): Promise<{ success: boolean; results: any[]; meta: { changes: number; last_row_id: number } }> {
    const r = this.st().run(...(this.params.map(norm) as SqlParam[])) as RunResult;
    return {
      success: true,
      results: [],
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
    };
  }
}

export class D1Adapter {
  db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  prepare(sql: string): D1Statement {
    return new D1Statement(this.db, sql);
  }

  // D1 batch est atomique : on reproduit avec une transaction SQLite
  async batch(stmts: D1Statement[]): Promise<any[]> {
    if (stmts.length === 0) return [];
    const out: any[] = [];
    this.db.exec('BEGIN');
    try {
      for (const s of stmts) out.push(await s.run());
      this.db.exec('COMMIT');
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* deja roule en arriere */ }
      throw e;
    }
    return out;
  }
}

export function openDatabase(path: string): D1Adapter {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  return new D1Adapter(db);
}
