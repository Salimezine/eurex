// Test IRPP calculation against bulletin PDF data
// Bulletin June 2026 (DALY SONDES): Brut=592.928, IRPP=9.797, CSS=2.410

// Correct IRPP brackets (ANNUAL, LF 2025)
const IRPP_BRACKET_ANNUAL = [
  { min: 0,     max: 5000,   taux: 0.00 },
  { min: 5000,  max: 10000,  taux: 0.15 },
  { min: 10000, max: 20000,  taux: 0.25 },
  { min: 20000, max: 30000,  taux: 0.30 },
  { min: 30000, max: 40000,  taux: 0.33 },
  { min: 40000, max: 50000,  taux: 0.36 },
  { min: 50000, max: 70000,  taux: 0.38 },
  { min: 70000, max: Infinity, taux: 0.40 },
];

function calculateIRPP(revenu_net_imposable_mensuel) {
  // Annualize
  const revenu_annuel = revenu_net_imposable_mensuel * 12;
  
  let irpp_annuel = 0;
  let remaining = revenu_annuel;
  
  console.log(`\nRevenu net imposable mensuel: ${revenu_net_imposable_mensuel} DT`);
  console.log(`Revenu net imposable annuel: ${revenu_annuel} DT`);
  
  for (const bracket of IRPP_BRACKET_ANNUAL) {
    if (remaining <= 0) break;
    const tranche_size = bracket.max === Infinity ? remaining : bracket.max - bracket.min;
    const taxable = Math.min(remaining, tranche_size);
    const impot = taxable * bracket.taux;
    irpp_annuel += impot;
    console.log(`  Tranche ${bracket.min}-${bracket.max}: ${taxable.toFixed(3)} × ${bracket.taux * 100}% = ${impot.toFixed(3)}`);
    remaining -= taxable;
  }
  
  const irpp_mensuel = irpp_annuel / 12;
  console.log(`\nIRPP annuel: ${irpp_annuel.toFixed(3)} DT`);
  console.log(`IRPP mensuel: ${irpp_mensuel.toFixed(3)} DT`);
  
  return irpp_mensuel;
}

// Test with bulletin data
console.log('=== TEST 1: DALY SONDES (Bulletin June 2026) ===');
console.log('Expected: IRPP = 9.797, CSS = 2.410');
console.log('Bulletin: Salaire imposable = 535.533');

// Step 1: Calculate CNSS
const salaire_imposable = 535.533;
const cnss = salaire_imposable * 0.0968;
console.log(`\nCNSS: ${salaire_imposable} × 9.68% = ${cnss.toFixed(3)}`);

// Step 2: Calculate frais pro (10% of salaire imposable, capped at 2000 DT/year)
const frais_pro_annuel = Math.min(salaire_imposable * 12 * 0.10, 2000);
const frais_pro_mensuel = frais_pro_annuel / 12;
console.log(`Frais pro: min(${salaire_imposable * 12} × 10%, 2000) / 12 = ${frais_pro_mensuel.toFixed(3)}`);

// Step 3: Calculate revenu net imposable
const revenu_net_imposable = salaire_imposable - frais_pro_mensuel;
console.log(`Revenu net imposable: ${salaire_imposable} - ${frais_pro_mensuel.toFixed(3)} = ${revenu_net_imposable.toFixed(3)}`);

// Step 4: Calculate IRPP
const irpp = calculateIRPP(revenu_net_imposable);

// Step 5: Calculate CSS
const css = revenu_net_imposable * 0.005;
console.log(`\nCSS: ${revenu_net_imposable.toFixed(3)} × 0.5% = ${css.toFixed(3)}`);

console.log('\n=== RESULTS ===');
console.log(`IRPP calculated: ${irpp.toFixed(3)} DT (expected: 9.797)`);
console.log(`CSS calculated: ${css.toFixed(3)} DT (expected: 2.410)`);
console.log(`Difference IRPP: ${(irpp - 9.797).toFixed(3)} DT`);
console.log(`Difference CSS: ${(css - 2.410).toFixed(3)} DT`);

// Test with a higher salary
console.log('\n\n=== TEST 2: Higher salary (2000 DT brut) ===');
const brut = 2000;
const cnss2 = brut * 0.0968;
const revenu_imp2 = brut - cnss2;
const frais_pro2 = Math.min(revenu_imp2 * 12 * 0.10, 2000) / 12;
const revenu_net2 = revenu_imp2 - frais_pro2;
const irpp2 = calculateIRPP(revenu_net2);
const css2 = revenu_net2 * 0.005;

console.log(`\nBrut: ${brut} DT`);
console.log(`CNSS: ${cnss2.toFixed(3)} DT`);
console.log(`Revenu imposable: ${revenu_imp2.toFixed(3)} DT`);
console.log(`Frais pro: ${frais_pro2.toFixed(3)} DT`);
console.log(`Revenu net imposable: ${revenu_net2.toFixed(3)} DT`);
console.log(`IRPP: ${irpp2.toFixed(3)} DT`);
console.log(`CSS: ${css2.toFixed(3)} DT`);
console.log(`Net: ${(brut - cnss2 - irpp2 - css2).toFixed(3)} DT`);