// Double ecriture : chaque ecriture part vers les DEUX bases (D1 et
// Supabase), les lectures restant sur la primaire.
//
// Pourquoi : sans double ecriture, une modification n'atteint qu'une base. La
// bascule automatique et la resync nocturne existent precisement pour recon-
// verger, et la fenetre de divergence impose d'interdire tout retour sans copie
// prealable (`d1_state`). Avec les deux bases ecrites a chaque modification,
// elles restent identiques PAR CONSTRUCTION : la resync nocturne devient un
// simple filet de secours (elle ne sert qu'a reparer un ecart rare), et la
// lecture peut etre repartie entre les deux moteurs sans risquer de rendre une
// donnee invisible a l'utilisateur.
//
// Ordre volontairement SEQUENTIEL (primaire, puis secondaire) et non
// parallele : si le primaire echoue, le secondaire n'a pas ete touche, donc
// la requete echoue proprement sans avoir laisse une ecriture orpheline d'un
// cote. Un parallelisme aurait produit ce cas impossible a reparer proprement.
//
// L'ecriture secondaire est en BEST-EFFORT : la primaire a deja reussi et
// l'utilisateur a son resultat. Faire echouer la requete pour un retard de
// l'autre base serait pire qu'un ecart transitoire. L'echec est donc signale
// via `onSecondaryFailure`, qui ne doit jamais lever.
//
// NOTE de style : pas de proprietes de parametre (`private x:` dans le
// constructeur). Le stripping de types de Node ne sait pas les effacer, et le
// Worker comme les tests passent par ce chemin.
import { isDataWriteSql } from './sql-kind.ts';

// Sous-ensemble de l'API D1 que l'application utilise (constate par inventaire
// sur index.ts) : prepare/bind/run/all/first, plus batch. Pas de raw().
export interface DbLike {
  prepare(sql: string): any;
  batch(stmts: any[]): Promise<any[]>;
}

export interface DualHooks {
  // La base secondaire est en retard d'UNE ecriture. Le rappel doit signaler
  // l'ecart (KV) pour que la resync le repare, et ne doit jamais lever.
  onSecondaryFailure?: (e: unknown, sql: string) => void;
}

class DualStatement {
  prim: DbLike;
  sec: DbLike | null;
  sql: string;
  params: unknown[];
  hooks: DualHooks;

  constructor(prim: DbLike, sec: DbLike | null, sql: string, params: unknown[], hooks: DualHooks) {
    this.prim = prim;
    this.sec = sec;
    this.sql = sql;
    this.params = params;
    this.hooks = hooks;
  }

  bind(...params: unknown[]): DualStatement {
    return new DualStatement(this.prim, this.sec, this.sql, params, this.hooks);
  }

  // Delegue a la base primaire seule : une lecture ne doit pas toucher la
  // secondaire (double cout, et surtout aucune raison de le faire).
  all<T = any>(): Promise<{ results: T[]; success: boolean; meta: any }> {
    return this.prim.prepare(this.sql).bind(...this.params).all();
  }

  first<T = any>(): Promise<T | null> {
    return this.prim.prepare(this.sql).bind(...this.params).first();
  }

  async run(): Promise<any> {
    const out = await this.prim.prepare(this.sql).bind(...this.params).run();
    if (this.sec && isDataWriteSql(this.sql)) await this.writeSecondary();
    return out;
  }

  // Best-effort : aucun effet de bord visible si ca echoue.
  private async writeSecondary(): Promise<void> {
    if (!this.sec) return;
    try {
      await this.sec.prepare(this.sql).bind(...this.params).run();
    } catch (e) {
      // Le message porte le SQL : sans lui, un refus de D1 (quota, limite de
      // parametres) ou de PostgreSQL (cle etrangere) est indiagnostiquable
      // dans les logs du Worker.
      console.error('double ecriture : echec secondaire', this.sql.slice(0, 120), String((e as any)?.message || e));
      try { this.hooks.onSecondaryFailure?.(e, this.sql); } catch { /* jamais fatal */ }
    }
  }

  // Pour batch() : la base primaire a besoin de SES propres objets statement.
  toPrimary(): any { return this.prim.prepare(this.sql).bind(...this.params); }
  toSecondary(): any | null { return this.sec ? this.sec.prepare(this.sql).bind(...this.params) : null; }
}

export class DualDb implements DbLike {
  prim: DbLike;
  sec: DbLike | null;
  hooks: DualHooks;

  constructor(prim: DbLike, sec: DbLike | null, hooks: DualHooks = {}) {
    this.prim = prim;
    this.sec = sec;
    this.hooks = hooks;
  }

  prepare(sql: string): DualStatement {
    return new DualStatement(this.prim, this.sec, sql, [], this.hooks);
  }

  // D1 batch est atomique. On le restitue tel quel sur chaque base : chaque
  // cote reste coherent en interne. On n'essaie PAS de faire un deuxieme
  // "atomique transverse", ce qui n'existe pas sans transaction distribuee.
  async batch(stmts: DualStatement[]): Promise<any[]> {
    const primary = stmts.map((s) => s.toPrimary());
    const out = await this.prim.batch(primary);
    // Seules les ecritures de donnees sont rejouees sur la seconde base.
    const writes = stmts.filter((s) => isDataWriteSql(s.sql));
    if (!this.sec || writes.length === 0) return out;
    try {
      await this.sec.batch(writes.map((s) => s.toSecondary()));
    } catch (e) {
      console.error('double ecriture : echec secondaire (batch)', String((e as any)?.message || e));
      try { this.hooks.onSecondaryFailure?.(e, `batch(${writes.length})`); } catch { /* jamais fatal */ }
    }
    return out;
  }

  // Fermeture des connexions ouvertes par la requete (adaptateur PG).
  endRequest(): void {
    for (const db of [this.prim, this.sec]) {
      const a = db as unknown as { endRequest?: () => void } | null;
      if (a && typeof a.endRequest === 'function') a.endRequest();
    }
  }

  // Test et debogage : quelle base sert les lectures, laquelle recoit les
  // ecritures en plus.
  describe(): { primary: string; secondary: string | null } {
    return { primary: name(this.prim), secondary: this.sec ? name(this.sec) : null };
  }
}

function name(db: DbLike): string {
  const a = db as unknown as { servedBy?: string };
  return a && a.servedBy === 'supabase' ? 'supabase' : 'd1';
}
