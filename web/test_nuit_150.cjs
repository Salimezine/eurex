/**
 * TEST NUIT 150% — Hypothèse: majoration 150% (pas 125%)
 * Formule: nuit = (salaire_base / 190) × heures_nuit × 1.5
 * 
 * Compare 125% vs 150% sur tous les salariés ayant nuit > 0 (juin 2026)
 */

const TAUX_CNSS = 0.0968;
const HEURES_BASE = 190;

// Données Juin 2026 — salaire_de_base = base avant primes
// salaire_de_base est la composante "salaire de base" du brut
const EMPLOYEES = [
  { nom: 'ROUHI Nabil', salaire_base: 800, nuit_bulletin: 54.620, sf: 'M', ne: 2 },
  { nom: 'BOUCHAHDA Walid', salaire_base: 1044.082, nuit_bulletin: 88.598, sf: 'M', ne: 1 },
  { nom: 'HASSINE Faouzi', salaire_base: 650, nuit_bulletin: 78.693, sf: 'C', ne: 0 },
  { nom: 'BACCOUCHE Taher', salaire_base: 750, nuit_bulletin: 78.693, sf: 'M', ne: 5 },
  { nom: 'EL MANNAI Amina', salaire_base: 650, nuit_bulletin: 63.218, sf: 'C', ne: 0 },
];

console.log('='.repeat(100));
console.log('TEST NUIT — 125% vs 150%');
console.log('='.repeat(100));
console.log('');

let score125 = 0, score150 = 0;

for (const emp of EMPLOYEES) {
  const taux_horaire = emp.salaire_base / HEURES_BASE;
  
  // 125%
  const nuit_125 = Math.round(taux_horaire * (emp.nuit_bulletin / (taux_horaire * 1.25)) * 1.25 * 1000) / 1000;
  const heures_125 = emp.nuit_bulletin / (taux_horaire * 1.25);
  
  // 150%
  const heures_150 = emp.nuit_bulletin / (taux_horaire * 1.5);
  const nuit_150 = Math.round(taux_horaire * heures_150 * 1.5 * 1000) / 1000;
  
  const isRound125 = Math.abs(heures_125 - Math.round(heures_125)) < 0.1;
  const isRound150 = Math.abs(heures_150 - Math.round(heures_150)) < 0.1;
  
  if (isRound125) score125++;
  if (isRound150) score150++;
  
  console.log(`--- ${emp.nom} (base=${emp.salaire_base}, bulletin=${emp.nuit_bulletin}) ---`);
  console.log(`  Taux horaire: ${taux_horaire.toFixed(4)} DT/h`);
  console.log(`  125%: heures=${heures_125.toFixed(2)}h ${isRound125 ? '✓ ROND' : '✗ PAS ROND'}  nuit_calc=${nuit_125.toFixed(3)}`);
  console.log(`  150%: heures=${heures_150.toFixed(2)}h ${isRound150 ? '✓ ROND' : '✗ PAS ROND'}  nuit_calc=${nuit_150.toFixed(3)}`);
  console.log(`  Delta 125%: ${Math.abs(nuit_125 - emp.nuit_bulletin).toFixed(3)}  Delta 150%: ${Math.abs(nuit_150 - emp.nuit_bulletin).toFixed(3)}`);
  console.log('');
}

console.log('='.repeat(100));
console.log(`SCORE: 125% = ${score125}/${EMPLOYEES.length} ronds | 150% = ${score150}/${EMPLOYEES.length} ronds`);
console.log('='.repeat(100));

// Aussi tester avec base 200h
console.log('\n' + '='.repeat(100));
console.log('TEST NUIT — 150% avec base 200h');
console.log('='.repeat(100));

let score200 = 0;
for (const emp of EMPLOYEES) {
  const taux_horaire_200 = emp.salaire_base / 200;
  const heures_200 = emp.nuit_bulletin / (taux_horaire_200 * 1.5);
  const isRound200 = Math.abs(heures_200 - Math.round(heures_200)) < 0.1;
  if (isRound200) score200++;
  
  console.log(`  ${emp.nom}: base200h=${taux_horaire_200.toFixed(4)} → ${heures_200.toFixed(2)}h ${isRound200 ? '✓' : '✗'}`);
}
console.log(`\nSCORE 200h+150%: ${score200}/${EMPLOYEES.length}`);
