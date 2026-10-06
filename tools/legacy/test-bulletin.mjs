// Full salary calculation test matching bulletin June 2026
// Expected from bulletin: Brut=592.928, CNSS=57.395, IRPP=9.797, CSS=2.410, Net=523.326

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

function calculateSalary(salaire_brut, situation_fam = 'C', nombre_enfants = 0) {
  const PLAFOND_CNSS = 5000;
  const TAUX_CNSS_SALARIAL = 0.0968;
  const TAUX_CNSS_PATRONAL = 0.1657;
  const TAUX_AT_MP = 0.005;
  const TAUX_TFP = 0.01;
  const TAUX_FOPROLOS = 0.01;
  const TAUX_CSS = 0.005;

  // 1. Salaire brut
  const brut = Math.max(0, salaire_brut);

  // 2. Assiette CNSS (plafonnée)
  const assiette_cnss = Math.min(brut, PLAFOND_CNSS);

  // 3. CNSS salarié
  const cnss_salariale = Math.round(assiette_cnss * TAUX_CNSS_SALARIAL * 1000) / 1000;

  // 4. Revenu imposable (Brut - CNSS)
  const revenu_imposable = Math.max(0, brut - cnss_salariale);

  // 5. Frais professionnels (10% plafonné à 2000 DT/an = 166.67 DT/mois)
  const frais_pro_annuel = Math.min(revenu_imposable * 12 * 0.10, 2000);
  const frais_pro = Math.round((frais_pro_annuel / 12) * 1000) / 1000;

  // 6. Revenu net imposable
  const revenu_net_imposable = Math.max(0, revenu_imposable - frais_pro);

  // 7. Calcul IRPP (barème progressif ANNUEL)
  const revenu_annuel_imposable = revenu_net_imposable * 12;
  let irpp_annuel = 0;
  let remaining_annuel = revenu_annuel_imposable;

  for (const bracket of IRPP_BRACKET_ANNUAL) {
    if (remaining_annuel <= 0) break;
    const tranche_size = bracket.max === Infinity ? remaining_annuel : bracket.max - bracket.min;
    const taxable = Math.min(remaining_annuel, tranche_size);
    const impot = taxable * bracket.taux;
    irpp_annuel += impot;
    remaining_annuel -= taxable;
  }

  const irpp = Math.round((irpp_annuel / 12) * 1000) / 1000;

  // 8. CSS (0.5% du revenu net imposable)
  const css_salariale = Math.round(revenu_net_imposable * TAUX_CSS * 1000) / 1000;

  // 9. Charges patronales
  const cnss_patronale = Math.round(brut * TAUX_CNSS_PATRONAL * 1000) / 1000;
  const at_mp = Math.round(brut * TAUX_AT_MP * 1000) / 1000;
  const tfp = Math.round(brut * TAUX_TFP * 1000) / 1000;
  const foprolos = Math.round(brut * TAUX_FOPROLOS * 1000) / 1000;

  // 10. Total retenues
  const total_retenues = Math.round((cnss_salariale + irpp + css_salariale) * 1000) / 1000;

  // 11. Salaire net
  const salaire_net = Math.round((brut - total_retenues) * 1000) / 1000;

  return {
    salaire_brut: brut,
    assiette_cnss,
    cnss_salariale,
    revenu_imposable,
    frais_pro,
    revenu_net_imposable,
    irpp,
    css_salariale,
    cnss_patronale,
    at_mp,
    tfp,
    foprolos,
    total_retenues,
    salaire_net,
  };
}

// Test with bulletin data
console.log('=== TEST: Bulletin June 2026 (DALY SONDES) ===');
console.log('Expected: Brut=592.928, CNSS=57.395, IRPP=9.797, CSS=2.410, Net=523.326\n');

const result = calculateSalary(592.928);

console.log('Calculated:');
console.log(`  Salaire brut: ${result.salaire_brut}`);
console.log(`  CNSS salarié: ${result.cnss_salariale} (expected: 57.395)`);
console.log(`  Revenu imposable: ${result.revenu_imposable}`);
console.log(`  Frais pro: ${result.frais_pro}`);
console.log(`  Revenu net imposable: ${result.revenu_net_imposable}`);
console.log(`  IRPP: ${result.irpp} (expected: 9.797)`);
console.log(`  CSS: ${result.css_salariale} (expected: 2.410)`);
console.log(`  Net: ${result.salaire_net} (expected: 523.326)`);

console.log('\nDifferences:');
console.log(`  CNSS: ${(result.cnss_salariale - 57.395).toFixed(3)}`);
console.log(`  IRPP: ${(result.irpp - 9.797).toFixed(3)}`);
console.log(`  CSS: ${(result.css_salariale - 2.410).toFixed(3)}`);
console.log(`  Net: ${(result.salaire_net - 523.326).toFixed(3)}`);

// Verify all within tolerance
const tolerance = 0.01;
const cnssOk = Math.abs(result.cnss_salariale - 57.395) < tolerance;
const irppOk = Math.abs(result.irpp - 9.797) < tolerance;
const cssOk = Math.abs(result.css_salariale - 2.410) < tolerance;
const netOk = Math.abs(result.salaire_net - 523.326) < tolerance;

console.log(`\n=== VALIDATION ===`);
console.log(`CNSS: ${cnssOk ? '✓' : '✗'}`);
console.log(`IRPP: ${irppOk ? '✓' : '✗'}`);
console.log(`CSS: ${cssOk ? '✓' : '✗'}`);
console.log(`Net: ${netOk ? '✓' : '✗'}`);
console.log(`\nAll correct: ${cnssOk && irppOk && cssOk && netOk ? '✓ YES' : '✗ NO'}`);