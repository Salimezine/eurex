// Traduction du dialecte SQLite du code applicatif (index.ts) vers PostgreSQL.
// Le code applicatif reste en dialecte SQLite (la base locale fonctionne telle
// quelle) : cette traduction est appliquee a la volee par l'adaptateur Supabase
// au moment du prepare(), donc le SQL source ne change jamais.
//
// Couvre l'inventaire reel de index.ts :
//   - datetime(...)            57 occurrences (litteraux, binds, concat, imbriques)
//   - date(...)                (lignes 33, 34, 298)
//   - strftime('%Y'/'%m',...)  (lignes 2837-2838)
//   - INSERT OR REPLACE/IGNORE (4 + 3 tables)
//   - LIKE -> ILIKE            (recherche insensible a la casse, comportement
//                               LIKE SQLite sur l'ASCII)
//   - sqlite_master ... GLOB   (syncToCopy, 1 occurrence)
//   - placeholders ? -> $n     (hors litteraux/commentaires)
// Tout motif non couvert leve une erreur plutot que de partir en silence.

export type PkMap = Record<string, string[]>;

export interface TranslateOpts {
  // Tables connues : table -> colonnes de la PK, pour ON CONFLICT cible
  pk?: PkMap;
  // Parametre ? deja utilise avant cette traduction (rare : fragments concatenes)
  paramOffset?: number;
}

const DEFAULT_PK: PkMap = {
  org_fiscal_alerts: ['id'],
  rapport_modes: ['id'],
  rubriques_paie: ['id'],
  org_alert_dones: ['alert_id', 'due_date'],
};

const STRFTIME_FMT: Record<string, string> = {
  '%Y': 'YYYY',
  '%m': 'MM',
  '%d': 'DD',
  '%H': 'HH24',
  '%M': 'MI',
  '%S': 'SS',
  '%Y-%m-%d': 'YYYY-MM-DD',
  '%Y-%m': 'YYYY-MM',
  '%Y%m%d': 'YYYYMMDD',
};

const DATETIME_OUT = 'YYYY-MM-DD HH24:MI:SS';
const DATE_OUT = 'YYYY-MM-DD';

class TranslateError extends Error {
  constructor(msg: string) {
    super('traducteur SQLite->PG: ' + msg);
    this.name = 'TranslateError';
  }
}

// --- helpers ---------------------------------------------------------------

function isWordChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

// Lit la fin d'un appel de fonction : args bruts entre parentheses equilibrees.
// debut = position du '(' ouvrant. Respecte strings et commentaires.
function readCallArgs(sql: string, open: number): { args: string[]; end: number } {
  let i = open + 1;
  let depth = 1;
  const args: string[] = [];
  let cur = '';
  let inStr = false;
  let inLine = false;
  let inBlock = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (inLine) {
      if (c === '\n') inLine = false;
      cur += c;
      i++;
      continue;
    }
    if (inBlock > 0) {
      if (c === '*' && sql[i + 1] === '/') { inBlock--; cur += '*/'; i += 2; continue; }
      if (c === '/' && sql[i + 1] === '*') { inBlock++; cur += '/*'; i += 2; continue; }
      cur += c;
      i++;
      continue;
    }
    if (inStr) {
      if (c === "'") {
        if (sql[i + 1] === "'") { cur += "''"; i += 2; continue; }
        inStr = false;
        cur += c;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === "'") { inStr = true; cur += c; i++; continue; }
    if (c === '-' && sql[i + 1] === '-') { inLine = true; cur += '--'; i += 2; continue; }
    if (c === '/' && sql[i + 1] === '*') { inBlock = 1; cur += '/*'; i += 2; continue; }
    if (c === '(') { depth++; cur += c; i++; continue; }
    if (c === ')') {
      depth--;
      if (depth === 0) {
        args.push(cur);
        i++;
        return { args, end: i };
      }
      cur += c;
      i++;
      continue;
    }
    if (c === ',' && depth === 1) {
      args.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  throw new TranslateError('parenthese fermante manquante apres position ' + open);
}

function asLiteral(s: string): string | null {
  const m = s.trim().match(/^'((?:[^']|'')*)'$/);
  return m ? m[1].replace(/''/g, "'") : null;
}

// --- transformations de fonctions ------------------------------------------

function translateDateTime(argsRaw: string[], fn: 'datetime' | 'date', tf: (s: string) => string): string {
  if (argsRaw.length === 0) throw new TranslateError(fn + '() sans argument');
  // Recursion sur chaque argument (appels imbriques, ? deja numerotes dedans)
  const args = argsRaw.map(a => tf(a.trim()));

  // base
  let expr: string;
  const lit0 = asLiteral(args[0]);
  if (lit0 !== null && lit0.toLowerCase() === 'now') {
    expr = "now() AT TIME ZONE 'UTC'";
  } else {
    expr = 'NULLIF(' + args[0] + ", '')::timestamp";
  }

  // modificateurs
  for (const modRaw of args.slice(1)) {
    const lit = asLiteral(modRaw);
    if (lit !== null) {
      const startOf = lit.match(/^start of (day|week|month|year)$/);
      if (startOf) {
        expr = "date_trunc('" + startOf[1] + "', " + expr + ')';
        continue;
      }
      const iv = lit.trim().match(/^([+-])?\s*(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)$/i);
      if (iv) {
        const sign = iv[1] === '-' ? '-' : '';
        const unit = iv[3].toLowerCase();
        const n = sign ? '-' + iv[2] : iv[2];
        expr = expr + " + interval '" + n + ' ' + unit + "'";
        continue;
      }
      throw new TranslateError("modificateur datetime SQLite non traduit: '" + lit + "'");
    }
    // expression non litterale (bind ou concat) : on la cast en interval
    expr = expr + ' + (' + modRaw + ')::interval';
  }

  return fn === 'datetime'
    ? "to_char(" + expr + ", '" + DATETIME_OUT + "')"
    : "to_char((" + expr + ")::date, '" + DATE_OUT + "')";
}

function translateStrftime(argsRaw: string[], tf: (s: string) => string): string {
  if (argsRaw.length !== 2) throw new TranslateError('strftime() : 2 arguments attendus, ' + argsRaw.length + ' fournis');
  const fmt = asLiteral(argsRaw[0].trim());
  if (fmt === null) throw new TranslateError('strftime() : format non litteral: ' + argsRaw[0].trim());
  const pgFmt = STRFTIME_FMT[fmt];
  if (!pgFmt) throw new TranslateError("strftime() : format non traduit: '" + fmt + "'");
  const inner = tf(argsRaw[1].trim());
  return "to_char((" + inner + ")::timestamp, '" + pgFmt + "')";
}

// --- corps principal --------------------------------------------------------

export function toPg(sql: string, opts: TranslateOpts = {}): string {
  const pk = { ...DEFAULT_PK, ...(opts.pk || {}) };
  let param = opts.paramOffset || 0;
  let orSuffix = '';

  function tf(src: string): string {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];

      // --- strings ---
      if (c === "'") {
        let j = i + 1;
        while (j < n) {
          if (src[j] === "'") {
            if (src[j + 1] === "'") { j += 2; continue; }
            j++;
            break;
          }
          j++;
        }
        out += src.slice(i, j);
        i = j;
        continue;
      }
      // --- commentaires ---
      if (c === '-' && src[i + 1] === '-') {
        const j = src.indexOf('\n', i);
        const end = j === -1 ? n : j;
        out += src.slice(i, end);
        i = end;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const j = src.indexOf('*/', i + 2);
        const end = j === -1 ? n : j + 2;
        out += src.slice(i, end);
        i = end;
        continue;
      }

      // --- INSERT OR REPLACE / INSERT OR IGNORE ---
      if ((c === 'i' || c === 'I') && !isWordChar(src[i - 1] || '')) {
        const rest = src.slice(i);
        const m = rest.match(/^INSERT\s+OR\s+(REPLACE|IGNORE)\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)/i);
        if (m) {
          const kind = m[1].toUpperCase();
          const table = m[2];
          let after = i + m[0].length;
          if (kind === 'REPLACE') {
            const pkCols = pk[table];
            if (!pkCols) throw new TranslateError('INSERT OR REPLACE sur ' + table + ' : PK inconnue (ajouter au PkMap)');
            const lm = src.slice(after).match(/^\s*\(\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\)/);
            if (!lm) throw new TranslateError('INSERT OR REPLACE INTO ' + table + ' : liste de colonnes illisible');
            const cols = lm[1].split(',').map(s => s.trim());
            const pkSet = new Set(pkCols.map(c2 => c2.toLowerCase()));
            const updatable = cols.filter(cl => !pkSet.has(cl.toLowerCase()));
            if (updatable.length === 0) throw new TranslateError('INSERT OR REPLACE INTO ' + table + ' : aucune colonne a mettre a jour');
            after += lm[0].length;
            orSuffix = ' ON CONFLICT (' + pkCols.join(', ') + ') DO UPDATE SET '
              + updatable.map(cl => cl + ' = EXCLUDED.' + cl).join(', ');
            out += 'INSERT INTO ' + table + src.slice(i + m[0].length, after);
            i = after;
            continue;
          }
          // IGNORE
          orSuffix = ' ON CONFLICT DO NOTHING';
          out += 'INSERT INTO ' + table;
          i += m[0].length;
          continue;
        }
      }

      // --- LIKE -> ILIKE ---
      if ((c === 'l' || c === 'L') && !isWordChar(src[i - 1] || '')) {
        const rest = src.slice(i);
        const lm = rest.match(/^LIKE\b/i);
        if (lm) {
          out += 'ILIKE';
          i += lm[0].length;
          continue;
        }
      }

      // --- datetime( / date( / strftime( ---
      if ((c === 'd' || c === 'D' || c === 's' || c === 'S') && !isWordChar(src[i - 1] || '')) {
        const rest = src.slice(i);
        const fm = rest.match(/^(datetime|date|strftime)\s*\(/i);
        if (fm) {
          const fn = fm[1].toLowerCase() as 'datetime' | 'date' | 'strftime';
          const open = i + fm[0].length - 1;
          const { args, end } = readCallArgs(src, open);
          const replaced = fn === 'strftime'
            ? translateStrftime(args, tf)
            : translateDateTime(args, fn, tf);
          out += replaced;
          i = end;
          continue;
        }
      }

      // --- placeholder ? -> $n ---
      if (c === '?') {
        param++;
        out += '$' + param;
        i++;
        continue;
      }

      out += c;
      i++;
    }
    return out;
  }

  let result = tf(sql);

  // syncToCopy : listing des tables via sqlite_master -> information_schema
  result = result.replace(
    /SELECT\s+name\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s+NOT\s+GLOB\s+'sqlite_\*'\s+AND\s+name\s+NOT\s+GLOB\s+'d1_\*'\s+AND\s+name\s+NOT\s+GLOB\s+'_cf_\*'\s+ORDER\s+BY\s+name/i,
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE 'pg\\_%' ORDER BY table_name",
  );

  if (orSuffix) result += orSuffix;

  // filets de securite : aucun motif SQLite ne doit subsister hors litteraux
  const stripped = stripLiterals(result);
  const leftovers: Array<[RegExp, string]> = [
    [/\bdatetime\s*\(/i, 'datetime() non traduit'],
    [/\bstrftime\s*\(/i, 'strftime() non traduit'],
    [/\bINSERT\s+OR\b/i, 'INSERT OR non traduit'],
    [/FROM\s+sqlite_master/i, 'sqlite_master non traduit'],
    [/\bGLOB\b/i, 'GLOB non traduit'],
  ];
  for (const [re, msg] of leftovers) {
    if (!msg) continue;
    if (re.test(stripped)) throw new TranslateError(msg + ' dans: ' + trimForErr(result));
  }

  return result;
}

function stripLiterals(s: string): string {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (s[j] === "'") {
          if (s[j + 1] === "'") { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      out += ' ';
      i = j;
      continue;
    }
    if (c === '-' && s[i + 1] === '-') {
      const j = s.indexOf('\n', i);
      const end = j === -1 ? n : j;
      out += ' ';
      i = end;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const j = s.indexOf('*/', i + 2);
      const end = j === -1 ? n : j + 2;
      out += ' ';
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function trimForErr(s: string): string {
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}
