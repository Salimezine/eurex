const IRPP_BRACKETS = [
  { min: 0, max: 5000, taux: 0.00 },
  { min: 5000, max: 10000, taux: 0.15 },
  { min: 10000, max: 20000, taux: 0.25 },
  { min: 20000, max: 30000, taux: 0.30 },
  { min: 30000, max: 40000, taux: 0.33 },
  { min: 40000, max: 50000, taux: 0.36 },
  { min: 50000, max: 70000, taux: 0.38 },
  { min: 70000, max: Infinity, taux: 0.40 },
];

function calculerIRPP(rni_annuel) {
  let irpp = 0;
  let remaining = rni_annuel;
  for (const b of IRPP_BRACKETS) {
    if (remaining <= 0) break;
    const size = b.max === Infinity ? remaining : b.max - b.min;
    const taxable = Math.min(remaining, size);
    irpp += taxable * b.taux;
    remaining -= taxable;
  }
  return irpp;
}

function reverseIRPP(irpp_annuel) {
  let lo = 0, hi = 200000;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (calculerIRPP(mid) < irpp_annuel) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const CNSS_TAUX = 0.0968;
const FRAIS_PRO_PLAFOND = 2000;

// All employees from bulletin
const employees = [
  { nom: 'ROUHI', brut: 3363.040, irpp_bulletin: 602.045, css_bulletin: 13.526, sf: 'M', ne: 2, lait: 29.7 },
  { nom: 'AAMRI', brut: 6261.380, irpp_bulletin: 1571.661, css_bulletin: 27.094, sf: 'M', ne: 0, lait: 29.7 },
  { nom: 'ZAYNI', brut: 5521.902, irpp_bulletin: 1306.962, css_bulletin: 23.713, sf: 'C', ne: 0, lait: 29.7 },
  { nom: 'BOUCHAHDA', brut: 4241.606, irpp_bulletin: 858.842, css_bulletin: 17.450, sf: 'M', ne: 1, lait: 29.7 },
  { nom: 'CHAABANE', brut: 1735.925, irpp_bulletin: 174.656, css_bulletin: 6.410, sf: 'M', ne: 2, lait: 24.3 },
  { nom: 'BEN SLIMANE', brut: 1645.637, irpp_bulletin: 167.634, css_bulletin: 6.269, sf: 'C', ne: 0, lait: 25.65 },
  { nom: 'HASSINE', brut: 2046.567, irpp_bulletin: 236.936, css_bulletin: null, sf: 'C', ne: 0, lait: 29.7 },
  { nom: 'BACCOUCHE', brut: 1990.392, irpp_bulletin: 236.601, css_bulletin: 9.053, sf: 'M', ne: 5, lait: 28.35 },
  { nom: 'EL MANNAI', brut: 2162.965, irpp_bulletin: 283.768, css_bulletin: null, sf: 'C', ne: 0, lait: 29.7 },
];

console.log('=== REVERSE-ENGINEERING: Quel RNI annuel donne l\'IRPP bulletin ? ===\n');

for (const emp of employees) {
  const irpp_annuel_bulletin = emp.irpp_bulletin * 12;
  const rni_annuel_sage = reverseIRPP(irpp_annuel_bulletin);
  const rni_mensuel_sage = rni_annuel_sage / 12;
  
  const assiette_cnss = Math.max(0, emp.brut - emp.lait);
  const cnss = assiette_cnss * CNSS_TAUX;
  const ri = Math.max(0, emp.brut - cnss);
  const frais_pro_annuel = Math.min(ri * 12 * 0.10, FRAIS_PRO_PLAFOND);
  const frais_pro_mensuel = frais_pro_annuel / 12;
  const rni_notre = Math.max(0, ri - frais_pro_mensuel);
  
  const abattement = (emp.sf === 'M' ? 300 : 0) + Math.min(emp.ne, 4) * 100;
  const rni_annuel_notre = Math.max(0, rni_notre * 12 - abattement);
  
  const rni_manquant_annuel = rni_annuel_notre - rni_annuel_sage;
  const deduction_manquante = rni_manquant_annuel / 12;
  const pct_brut = (deduction_manquante / emp.brut * 100).toFixed(1);
  
  console.log(emp.nom + ':');
  console.log('  IRPP bulletin: ' + emp.irpp_bulletin + ' x12 = ' + irpp_annuel_bulletin.toFixed(3));
  console.log('  RNI annuel Sage (reverse): ' + rni_annuel_sage.toFixed(3) + '  mensuel: ' + rni_mensuel_sage.toFixed(3));
  console.log('  RNI annuel notre calc:     ' + rni_annuel_notre.toFixed(3) + '  mensuel: ' + rni_notre.toFixed(3));
  console.log('  Diff manquante/mois:       ' + deduction_manquante.toFixed(3) + ' (' + pct_brut + '% du brut)');
  
  // Check if CSS matches 1% of IRPP
  if (emp.css_bulletin !== null) {
    const css_calc = emp.irpp_bulletin * 0.01;
    console.log('  CSS bulletin: ' + emp.css_bulletin + '  1% IRPP: ' + css_calc.toFixed(3) + '  delta: ' + Math.abs(emp.css_bulletin - css_calc).toFixed(3));
  }
  console.log('');
}

// Summary: what deduction pattern explains all employees?
console.log('=== HYPOTHESIS TESTING ===\n');

// Test: what if frais_pro is on brut (not ri)?
console.log('--- Hypothese A: frais_pro sur brut (pas RI) ---');
for (const emp of employees) {
  const assiette_cnss = Math.max(0, emp.brut - emp.lait);
  const cnss = assiette_cnss * CNSS_TAUX;
  const ri = Math.max(0, emp.brut - cnss);
  const fp_sur_brut = Math.min(emp.brut * 0.10, 2000/12);
  const rni_A = ri - fp_sur_brut;
  const abattement = (emp.sf === 'M' ? 300 : 0) + Math.min(emp.ne, 4) * 100;
  const rni_annuel_A = Math.max(0, rni_A * 12 - abattement);
  const irpp_A = calculerIRPP(rni_annuel_A) / 12;
  const delta_A = Math.abs(irpp_A - emp.irpp_bulletin);
  console.log('  ' + emp.nom + ': RNI=' + rni_A.toFixed(3) + ' IRPP=' + irpp_A.toFixed(3) + ' delta=' + delta_A.toFixed(3) + (delta_A < 5 ? ' OK' : ''));
}

// Test: what if family deduction is bigger (500+200 per child)?
console.log('\n--- Hypothese B: Abattement 500 + 200/enfant ---');
for (const emp of employees) {
  const assiette_cnss = Math.max(0, emp.brut - emp.lait);
  const cnss = assiette_cnss * CNSS_TAUX;
  const ri = Math.max(0, emp.brut - cnss);
  const fp = Math.min(ri * 0.10, 2000/12);
  const rni = ri - fp;
  const abattement = (emp.sf === 'M' ? 500 : 0) + Math.min(emp.ne, 4) * 200;
  const rni_annuel = Math.max(0, rni * 12 - abattement);
  const irpp = calculerIRPP(rni_annuel) / 12;
  const delta = Math.abs(irpp - emp.irpp_bulletin);
  console.log('  ' + emp.nom + ': abat=' + abattement + ' IRPP=' + irpp.toFixed(3) + ' delta=' + delta.toFixed(3) + (delta < 5 ? ' OK' : ''));
}

// Test: what if family deduction is proportional to RNI?
console.log('\n--- Hypothese C: Abattement proportionnel ---');
for (const emp of employees) {
  const assiette_cnss = Math.max(0, emp.brut - emp.lait);
  const cnss = assiette_cnss * CNSS_TAUX;
  const ri = Math.max(0, emp.brut - cnss);
  const fp = Math.min(ri * 0.10, 2000/12);
  const rni = ri - fp;
  // Try: RNI annuel = (rni * 12) * 0.85 (15% abattement)
  const rni_annuel = rni * 12 * 0.85;
  const irpp = calculerIRPP(rni_annuel) / 12;
  const delta = Math.abs(irpp - emp.irpp_bulletin);
  console.log('  ' + emp.nom + ': RNI_ann=' + rni_annuel.toFixed(3) + ' IRPP=' + irpp.toFixed(3) + ' delta=' + delta.toFixed(3) + (delta < 5 ? ' OK' : ''));
}

// Test: what if RI is computed without CNSS (i.e., CNSS on base = IRPP on base - CNSS)?
// Perhaps Sage deducts CNSS from base for IRPP differently?
console.log('\n--- Hypothese D: IRPP sur (brut - CNSS - lait) x 10% fp ---');
for (const emp of employees) {
  const base_irpp = emp.brut - emp.lait;
  const cnss = base_irpp * CNSS_TAUX;
  const ri_irpp = base_irpp - cnss;
  const fp = Math.min(ri_irpp * 0.10, 2000/12);
  const rni = ri_irpp - fp;
  const abattement = (emp.sf === 'M' ? 300 : 0) + Math.min(emp.ne, 4) * 100;
  const rni_annuel = Math.max(0, rni * 12 - abattement);
  const irpp = calculerIRPP(rni_annuel) / 12;
  const delta = Math.abs(irpp - emp.irpp_bulletin);
  console.log('  ' + emp.nom + ': CNSS_lait exclu fp IRPP=' + irpp.toFixed(3) + ' delta=' + delta.toFixed(3) + (delta < 5 ? ' OK' : ''));
}

// Test: what if CNSS includes lait (wrong but test)?
console.log('\n--- Hypothese E: CSS correctif (manque ~1DT sur CSS) ---');
// CSS is 1% of IRPP. Delta CSS is 0.3-0.9. 
// This means IRPP bulletin is slightly different than 1%*IRPP.
// Wait - CSS=1% IRPP is rounded. Let's check
for (const emp of employees) {
  if (emp.css_bulletin === null) continue;
  const css_from_irpp = emp.irpp_bulletin * 0.01;
  const diff = emp.css_bulletin - css_from_irpp;
  console.log('  ' + emp.nom + ': CSS_bulletin=' + emp.css_bulletin + ' 1%IRPP=' + css_from_irpp.toFixed(3) + ' diff=' + diff.toFixed(3));
}
