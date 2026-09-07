// Test different IRPP computation methods
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

function calcIRPP(rni_annuel) {
  let irpp = 0, remaining = rni_annuel;
  for (const b of IRPP_BRACKETS) {
    if (remaining <= 0) break;
    const size = b.max === Infinity ? remaining : b.max - b.min;
    const taxable = Math.min(remaining, size);
    irpp += taxable * b.taux;
    remaining -= taxable;
  }
  return irpp;
}

const CNSS_TAUX = 0.0968;
const employees = [
  { nom: 'ROUHI', brut: 3363.040, irpp_bulletin: 602.045, sf: 'M', ne: 2, lait: 29.7 },
  { nom: 'AAMRI', brut: 6261.380, irpp_bulletin: 1571.661, sf: 'M', ne: 0, lait: 29.7 },
  { nom: 'ZAYNI', brut: 5521.902, irpp_bulletin: 1306.962, sf: 'C', ne: 0, lait: 29.7 },
  { nom: 'BOUCHAHDA', brut: 4241.606, irpp_bulletin: 858.842, sf: 'M', ne: 1, lait: 29.7 },
  { nom: 'CHAABANE', brut: 1735.925, irpp_bulletin: 174.656, sf: 'M', ne: 2, lait: 24.3 },
  { nom: 'BEN SLIMANE', brut: 1645.637, irpp_bulletin: 167.634, sf: 'C', ne: 0, lait: 25.65 },
  { nom: 'HASSINE', brut: 2046.567, irpp_bulletin: 236.936, sf: 'C', ne: 0, lait: 29.7 },
  { nom: 'BACCOUCHE', brut: 1990.392, irpp_bulletin: 236.601, sf: 'M', ne: 5, lait: 28.35 },
  { nom: 'EL MANNAI', brut: 2162.965, irpp_bulletin: 283.768, sf: 'C', ne: 0, lait: 29.7 },
];

function getRNI(brut, lait) {
  const assiette_cnss = Math.max(0, brut - lait);
  const cnss = assiette_cnss * CNSS_TAUX;
  const ri = Math.max(0, brut - cnss);
  const fp_annuel = Math.min(ri * 12 * 0.10, 2000);
  const fp_mensuel = fp_annuel / 12;
  return ri - fp_mensuel;
}

const results = {};

for (const emp of employees) {
  const rni_mensuel = getRNI(emp.brut, emp.lait);
  const rni_annuel = rni_mensuel * 12;
  const abattement = (emp.sf === 'M' ? 300 : 0) + Math.min(emp.ne, 4) * 100;
  
  results[emp.nom] = {};
  
  // Method A (current): deduct from RNI_annuel
  const rni_A = Math.max(0, rni_annuel - abattement);
  const irpp_A = calcIRPP(rni_A) / 12;
  results[emp.nom]['A_deduct_RNI_annuel'] = Math.abs(irpp_A - emp.irpp_bulletin);
  
  // Method B: deduct from IRPP_annuel (after barème)
  const irpp_B = Math.max(0, calcIRPP(rni_annuel) - abattement) / 12;
  results[emp.nom]['B_deduct_IRPP_annuel'] = Math.abs(irpp_B - emp.irpp_bulletin);
  
  // Method C: deduct monthly from RNI then apply barème on annual
  const rni_C_mensuel = Math.max(0, rni_mensuel - abattement / 12);
  const irpp_C = calcIRPP(rni_C_mensuel * 12) / 12;
  results[emp.nom]['C_deduct_RNI_mensuel'] = Math.abs(irpp_C - emp.irpp_bulletin);
  
  // Method D: barème on monthly RNI, subtract abattement/12 from monthly IRPP
  const irpp_D_monthly = calcIRPP(rni_mensuel) - abattement / 12;
  const irpp_D = Math.max(0, irpp_D_monthly);
  results[emp.nom]['D_monthly_barème'] = Math.abs(irpp_D - emp.irpp_bulletin);
  
  // Method E: barème on RNI_annuel, then divide by 12, NO family deduction
  const irpp_E = calcIRPP(rni_annuel) / 12;
  results[emp.nom]['E_no_family'] = Math.abs(irpp_E - emp.irpp_bulletin);
}

// Print results
console.log('=== IRPP Method Comparison ===\n');
const methods = ['A_deduct_RNI_annuel', 'B_deduct_IRPP_annuel', 'C_deduct_RNI_mensuel', 'D_monthly_barème', 'E_no_family'];

// Summary table
const totals = {};
for (const m of methods) totals[m] = 0;

for (const emp of employees) {
  let line = emp.nom.padEnd(12);
  for (const m of methods) {
    const d = results[emp.nom][m];
    totals[m] += d;
    line += ('  ' + d.toFixed(3)).padStart(8);
  }
  console.log(line);
}

console.log('─'.repeat(80));
let sumLine = 'TOTAL'.padEnd(12);
for (const m of methods) {
  sumLine += ('  ' + totals[m].toFixed(3)).padStart(8);
}
console.log(sumLine);
console.log('');

// Now try: what if frais_pro is calculated differently?
// Maybe Sage calculates frais_pro on brut (not RI)?
console.log('\n=== Alternative: frais_pro sur BRUT ===\n');

for (const emp of employees) {
  const assiette_cnss = Math.max(0, emp.brut - emp.lait);
  const cnss = assiette_cnss * CNSS_TAUX;
  const ri = Math.max(0, emp.brut - cnss);
  
  // FP on brut
  const fp_annuel_brut = Math.min(emp.brut * 12 * 0.10, 2000);
  const fp_mensuel_brut = fp_annuel_brut / 12;
  const rni_brut = ri - fp_mensuel_brut;
  
  const abattement = (emp.sf === 'M' ? 300 : 0) + Math.min(emp.ne, 4) * 100;
  
  // Method A with fp on brut
  const rni_A = Math.max(0, rni_brut * 12 - abattement);
  const irpp_A = calcIRPP(rni_A) / 12;
  
  // Method B with fp on brut
  const irpp_B = Math.max(0, calcIRPP(rni_brut * 12) - abattement) / 12;
  
  const delta_A = Math.abs(irpp_A - emp.irpp_bulletin);
  const delta_B = Math.abs(irpp_B - emp.irpp_bulletin);
  
  console.log(emp.nom + ': fp_brut A=' + delta_A.toFixed(3) + ' B=' + delta_B.toFixed(3) + (delta_B < 5 ? ' ***' : ''));
}

// Now try: what if CNSS base = brut (no lait exclusion) for IRPP?
console.log('\n=== Alternative: CNSS sur brut (sans lait) pour IRPP ===\n');

for (const emp of employees) {
  // CNSS on brut without lait
  const cnss_irpp = emp.brut * CNSS_TAUX;
  const ri_irpp = emp.brut - cnss_irpp;
  const fp = Math.min(ri_irpp * 12 * 0.10, 2000) / 12;
  const rni = ri_irpp - fp;
  
  const abattement = (emp.sf === 'M' ? 300 : 0) + Math.min(emp.ne, 4) * 100;
  const rni_A = Math.max(0, rni * 12 - abattement);
  const irpp_A = calcIRPP(rni_A) / 12;
  const irpp_B = Math.max(0, calcIRPP(rni * 12) - abattement) / 12;
  
  const delta_A = Math.abs(irpp_A - emp.irpp_bulletin);
  const delta_B = Math.abs(irpp_B - emp.irpp_bulletin);
  
  console.log(emp.nom + ': cnss_no_lait A=' + delta_A.toFixed(3) + ' B=' + delta_B.toFixed(3) + (delta_B < 5 ? ' ***' : ''));
}
