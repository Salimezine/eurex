// Classification du SQL : savoir si une instruction modifie les donnees.
//
// Sert a la double ecriture (dual-write.ts) : une lecture ne doit etre
// executee que sur la primaire, une ecriture sur les deux. Le test porte sur
// le TEXTE de la requete et non sur la methode appelee, car le code de
// l'application appelle run() pour les ecritures et all()/first() pour les
// lectures — mais rien n'empeche un run() sur un SELECT (resultat ecarte), et
// doubler une telle lecture serait du cout pour rien.

// Commentaires de tete admis avant le mot cle : SQLite en autorise en debut de
// requete, et le traducteur en injecte parfois.
const HEAD =
  '^(?:\\s+|\\-\\-[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/)*' +
  '(insert|update|delete|replace|create|alter|drop|truncate)\\b';

const WRITE_RE = new RegExp(HEAD, 'i');

export function isWriteSql(sql: string): boolean {
  return WRITE_RE.test(sql);
}

// Les commandes de schema ne transitent jamais par env.DB en production (elles
// passent par `wrangler d1 migrations`), mais les migrations executes a la
// volee en test le feraient : on les exclut volontairement de la double
// ecriture, DDL et Supabase n'ayant pas le meme sens (une sequence, un index
// partiel SQLite sans equivalent PG…).
const DDL_RE = /^(create|alter|drop|truncate)\b/i;

export function isDdlSql(sql: string): boolean {
  const m = WRITE_RE.exec(sql);
  return !!m && DDL_RE.test(m[1]);
}

// Version a employer par la double ecriture : ecriture de donnees, schema exclu.
export function isDataWriteSql(sql: string): boolean {
  return isWriteSql(sql) && !isDdlSql(sql);
}
