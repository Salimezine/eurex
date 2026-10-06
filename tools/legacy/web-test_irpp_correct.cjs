// Test: IRPP = (barème(RNI_annuel) - abattement) / 12
// This is what the Note Commune says: "déductions de l'impôt, pas du revenu"
// Plus: CSS = 0.5% of RNI_annuel (confirmed 2026)

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
  return Math.round(irpp * 1000) / 1000;
}

const CNSS_TAUX = 0.0968;

const employees = [
  { nom: 'ROUHI', brut: 3363.040, irpp_bull: 602.045, css_bull: 13.526, sf: 'M', ne: 2, lait: 29.7 },
  { nom: 'AAMRI', brut: 6261.380, irpp_bull: 1571.661, css_bull: 27.094, sf: 'M', ne: 0, lait: 29.7 },
  { nom: 'ZAYNI', brut: 5521.902, irpp_bull: 1306.962, css_bull: 23.713, sf: 'C', ne: 0, lait: 29.7 },
  { nom: 'BOUCHAHDA', brut: 4241.606, irpp_bull: 858.842, css_bull: 17.450, sf: 'M', ne: 1, lait: 29.7 },
  { nom: 'CHAABANE', brut: 1735.925, irpp_bull: 174.656, css_bull: 6.410, sf: 'M', ne: 2, lait: 24.3 },
  { nom: 'BEN SLIMANE', brut: 1645.637, irpp_bull: 167.634, css_bull: 6.269, sf: 'C', ne: 0, lait: 25.65 },
  { nom: 'HASSINE', brut: 2046.567, irpp_bull: 236.936, css_bull: null, sf: 'C', ne: 0, lait: 29.7 },
  { nom: 'BACCOUCHE', brut: 1990.392, irpp_bull: 236.601, css_bull: 9.053, sf: 'M', ne: 5, lait: 28.35 },
  { nom: 'EL MANNAI', brut: 2162.965, irpp_bull: 283.768, css_bull: null, sf: 'C', ne: 0, lait: 29.7 },
];

console.log('=== FORMULA: IRPP = (barème(RNI_annuel) - abattement) / 12 ===');
console.log('=== CSS = 0.5% x RNI_mensuel ===\n');

let total_irpp_delta = 0;
let total_css_delta = 0;
let count = 0;

for (const emp of employees) {
  // Step 1: CNSS (same as current, validated 100%)
  const assiette_cnss = Math.max(0, emp.brut - emp.lait);
  const cnss = Math.round(assiette_cnss * CNSS_TAUX * 1000) / 1000;
  
  // Step 2: Revenu imposable = Brut - CNSS
  const ri = Math.max(0, emp.brut - cnss);
  
  // Step 3: Frais pro (10% plafond 2000/an)
  const fp_annuel = Math.min(ri * 12 * 0.10, 2000);
  const fp_mensuel = Math.round((fp_annuel / 12) * 1000) / 1000;
  
  // Step 4: RNI = RI - frais_pro
  const rni_mensuel = Math.max(0, ri - fp_mensuel);
  const rni_annuel = rni_mensuel * 12;
  
  // Step 5: Abattement familial
  const abattement = (emp.sf === 'M' ? 300 : 0) + Math.min(emp.ne, 4) * 100;
  
  // Step 6: IRPP = (barème(RNI_annuel) - abattement) / 12
  const irpp_annuel = calcIRPP(rni_annuel);
  const irpp_mensuel = Math.max(0, Math.round((irpp_annuel - abattement) * 1000) / 1000) / 12;
  const irpp_final = Math.round(irpp_mensuel * 1000) / 1000;
  
  // Step 7: CSS = 0.5% x RNI_mensuel
  const css_calc = Math.round(rni_mensuel * 0.005 * 1000) / 1000;
  
  const irpp_delta = Math.abs(irpp_final - emp.irpp_bull);
  const css_delta = emp.css_bull !== null ? Math.abs(css_calc - emp.css_bull) : null;
  
  total_irpp_delta += irpp_delta;
  if (css_delta !== null) {
    total_css_delta += css_delta;
    count++;
  }
  
  const irpp_pct = (irpp_delta / emp.irpp_bull * 100).toFixed(1);
  
  console.log(emp.nom + ' (SF=' + emp.sf + ', NE=' + emp.ne + ', abat=' + abattement + '):');
  console.log('  RNI mensuel: ' + rni_mensuel.toFixed(3) + '  annuel: ' + rni_annuel.toFixed(3));
  console.log('  IRPP annuel (barème): ' + irpp_annuel.toFixed(3));
  console.log('  IRPP annuel - abattement: ' + (irpp_annuel - abattement).toFixed(3));
  console.log('  IRPP mensuel: ' + irpp_final.toFixed(3) + '  bulletin: ' + emp.irpp_bull.toFixed(3));
  console.log('  IRPP delta: ' + irpp_delta.toFixed(3) + ' (' + irpp_pct + '%)' + (irpp_delta < 2 ? ' *** PERFECT' : irpp_delta < 10 ? ' ✓ OK' : ''));
  if (css_delta !== null) {
    console.log('  CSS calc: ' + css_calc.toFixed(3) + '  bulletin: ' + emp.css_bull.toFixed(3) + '  delta: ' + css_delta.toFixed(3));
  }
  console.log('');
}

console.log('=== SUMMARY ===');
console.log('IRPP total delta: ' + total_irpp_delta.toFixed(3));
console.log('CSS total delta: ' + total_css_delta.toFixed(3) + ' (over ' + count + ' employees)');
console.log('Mean IRPP delta: ' + (total_irpp_delta / employees.length).toFixed(3));
console.log('Mean CSS delta: ' + (total_css_delta / count).toFixed(3));
