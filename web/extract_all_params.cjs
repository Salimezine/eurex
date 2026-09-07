const fs = require('fs');
const path = require('path');

const prhPath = path.join('C:', 'Users', 'ezzin', 'Downloads', 'base de paie', 'BASE PAIE 06-2026.PRH');
const buf = fs.readFileSync(prhPath);
const text = buf.toString('latin1');

console.log('=== ALL PARAMETERS IN SAGE PRH FILE ===\n');

// Known variable names from earlier analysis
const knownVars = [
  'CHEFFAMENF', 'DEDUCTEN', 'FRAISPROF', 'DEDFP', 'ZSBRUTFX',
  'ZIRPP', 'ZIMPOTAN', 'Z1IMPOTA', 'ZIRPPH1', 'ZIRPPEXP', 'ZIRPPREGU',
  'PLAFCNSS', 'CNSS', 'TX_JR', 'NUIT', 'HS', 'SMIG', 'SMIC',
  'PRIMBASE', 'PRIMCOMP', 'PRIMTRANSP', 'PRIMABSEN', 'PRIMNUIT',
  'SALTR', 'SALBASE', 'SALBRUT', 'SALNET', 'SALIMPOS',
  'BAR', 'BAREME', 'TAUX', 'TXCHARG', 'TXCSS', 'TXATMP',
  'PLAF', 'PLAFOND', 'HEURE', 'BASE', 'COEFF',
  'CONG', 'ABS', 'AVANCE', 'MIT', 'MITIGE',
  'FOPROLOS', 'TFP', 'ATMP', 'PATRONAL', 'SALARIAL',
  'ABATTFAMILIAL', 'ABATTFAM', 'ENFANT', 'FAMILLE',
  'TEST PLAF', 'PLAF FRAIS PROF', 'PLAFFPAN',
  'NBSAL', 'NBENF', 'NBCON',
];

console.log('--- SEARCHING KNOWN VARIABLES ---');
for (const v of knownVars) {
  let idx = 0;
  let found = false;
  while ((idx = text.indexOf(v, idx)) !== -1) {
    const context = text.substring(Math.max(0, idx - 5), Math.min(text.length, idx + v.length + 30)).replace(/[^\x20-\x7E]/g, '.');
    console.log(`  ${v} @ ${idx}: ${context}`);
    found = true;
    idx += v.length;
  }
  if (!found) {
    // try lowercase
    const lv = v.toLowerCase();
    idx = text.indexOf(lv);
    if (idx !== -1) {
      const context = text.substring(Math.max(0, idx - 5), Math.min(text.length, idx + v.length + 30)).replace(/[^\x20-\x7E]/g, '.');
      console.log(`  ${v} (lower) @ ${idx}: ${context}`);
    }
  }
}

console.log('\n--- ALL UNIQUE IDENTIFIERS (TX_, Z, PLAFCNSS, etc.) ---');
const identifiers = new Set();
const regex = /(?:TX_|Z[A-Z]|PLAF[A-Z]|PRIM[A-Z]|SAL[A-Z]|NB[A-Z])/g;
let match;
while ((match = regex.exec(text)) !== null) {
  const start = match.index;
  let end = start;
  while (end < text.length && text[end] >= 'A' && text[end] <= 'Z') end++;
  const id = text.substring(start, end);
  if (id.length > 2 && id.length < 30) identifiers.add(id);
}
const sorted = [...identifiers].sort();
for (const id of sorted) {
  console.log(`  ${id}`);
}

console.log('\n--- ALL %/RATE INDICATORS ---');
const rateRegex = /(?:0\.\d{2,4})/g;
const rates = new Set();
while ((match = rateRegex.exec(text)) !== null) {
  const val = parseFloat(match[0]);
  if (val > 0 && val < 1) {
    const context = text.substring(Math.max(0, match.index - 20), Math.min(text.length, match.index + match[0].length + 20)).replace(/[^\x20-\x7E]/g, '.');
    rates.add(`${match[0]} → ${context}`);
  }
}
for (const r of rates) console.log(`  ${r}`);

console.log('\n--- KEY NAMES CONTAINING KEYWORDS ---');
const keywords = ['FAMILLE', 'ENFANT', 'ABATT', 'CREDIT', 'CHARGE', 'DEDUCT', 'MUTUEL', 'FNE', 'ARE', 'REPO'];
for (const kw of keywords) {
  let idx = 0;
  let count = 0;
  while ((idx = text.indexOf(kw, idx)) !== -1 && count < 3) {
    const context = text.substring(Math.max(0, idx - 20), Math.min(text.length, idx + kw.length + 30)).replace(/[^\x20-\x7E]/g, '.');
    console.log(`  [${kw}] @ ${idx}: ${context}`);
    count++;
    idx++;
  }
}
