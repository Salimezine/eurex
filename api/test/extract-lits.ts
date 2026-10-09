// Extracteur de literals JS (strings + templates) avec saut des commentaires
// et des expressions ${...} (strings + regex litterales). Partage entre le
// test d'inventaire et les scripts de diagnostic.
export interface Lit {
  text: string;
  pos: number;
  template: boolean;
}

export function extractLiterals(src: string): Lit[] {
  const out: Lit[] = [];
  const decode = (raw: string): string =>
    raw.replace(/\\([nrt0'"`\\$]|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_m, e: string) => {
      if (e === 'n') return '\n';
      if (e === 'r') return '\r';
      if (e === 't') return '\t';
      if (e === '0') return '\0';
      if (e[0] === 'u' || e[0] === 'x') return '';
      return e; // \' \" ` \\ \$ -> caractere literal
    });
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      i = j === -1 ? n : j + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      i = j === -1 ? n : j + 2;
      continue;
    }
    // regex litterale : /["']/ en mode code ouvrirait une fausse string.
    // Detectee apres operateur ( (, = : ! & | ? { [ ; > ) ou return/=>.
    if (c === '/') {
      let p = i - 1;
      while (p >= 0 && (src[p] === ' ' || src[p] === '\t')) p--;
      const prev = p >= 0 ? src[p] : '';
      const ctx = src.slice(Math.max(0, i - 8), i);
      const isRegex = /[(,=:!&|?[{;>]$/.test(prev) || /\breturn\s*$/.test(ctx) || /=>$/.test(ctx);
      if (isRegex) {
        let k = i + 1;
        let inClass = false;
        let closed = false;
        while (k < n && src[k] !== '\n') {
          if (src[k] === '\\') { k += 2; continue; }
          if (src[k] === '[') inClass = true;
          else if (src[k] === ']') inClass = false;
          else if (src[k] === '/' && !inClass) { closed = true; k++; break; }
          k++;
        }
        if (closed) {
          while (k < n && /[a-z]/i.test(src[k])) k++; // flags gimsuy
          i = k;
          continue;
        }
        // pas de fermeture sur la ligne : simple division, on avance d'un char
      }
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      out.push({ text: decode(src.slice(i + 1, j)), pos: i, template: false });
      i = j + 1;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let raw = '';
      while (j < n) {
        if (src[j] === '\\') { raw += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') {
          // saut de l'expression ${...} : strings, regex litterales et
          // comptage d'accolades. Sans detection regex, un /"/ dans une
          // expression desynchronise le saut et le template avale le code.
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            const d = src[k];
            if (d === "'" || d === '"') {
              k++;
              while (k < n && src[k] !== d) { if (src[k] === '\\') k++; k++; }
              k++;
              continue;
            }
            if (d === '/' && /[(,=!:&|?[{;]/.test(src[k - 1] || '')) {
              // regex litterale : saut jusqu'au / final (hors classes [...])
              k++;
              let inClass = false;
              while (k < n && src[k] !== '\n') {
                if (src[k] === '\\') { k += 2; continue; }
                if (src[k] === '[') inClass = true;
                else if (src[k] === ']') inClass = false;
                else if (src[k] === '/' && !inClass) { k++; break; }
                k++;
              }
              while (k < n && /[a-z]/i.test(src[k])) k++; // flags gimsuy
              continue;
            }
            if (d === '{') depth++;
            else if (d === '}') depth--;
            k++;
          }
          // valeur simulee : entier plausible (interval '+7 days', colonnes...)
          raw += '7';
          j = k;
          continue;
        }
        raw += src[j];
        j++;
      }
      out.push({ text: decode(raw), pos: i, template: true });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}
