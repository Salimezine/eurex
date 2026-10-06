/**
 * TEST EMPIRIQUE IRPP — Barème annuel 8 tranches (LF 2025 art. 36)
 * Compare le calcul IRPP du code contre les bulletins réels Juin 2026
 *
 * Même chose pour HS et NUIT: on teste la formule contre les valeurs bulletin.
 *
 * STATUT: CE SCRIPT EST UN TEST — pas de production code modifié ici.
 */

const TAUX_CNSS_SALARIAL = 0.0968;
const FRAIS_PRO_TAUX = 0.10;
const FRAIS_PRO_PLAFOND_ANNUEL = 2000;

// Barème IRPP annuel 2026 (LF 2025 art. 36)
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

// HS params (hypothèses à tester)
const HS_HEURES_SEMAINE = 40;
const HS_SEMAINES_ANNEE = 52;
const HS_SEUIL_25H_SEM = 8;
const HS_TAUX_25 = 0.25;
const HS_TAUX_50 = 0.50;

// Nuit params
const NUIT_HEURES_BASE = 190;
const NUIT_MAJORATION = 0.25;

// =====================================================================
// Données extraites des bulletins JUIN 2026 (Sage Paie)
// brut = Total Brut bulletin (exclut nuit, HS, rappel)
// cnss = CNSS salarié bulletin
// irpp = IRPP bulletin
// css = CSS bulletin
// hs_euros = montant HS bulletin (4113)
// nuit_euros = montant nuit bulletin (3802)
// heures_hs = heures supplémentaires en heures (si disponible)
// =====================================================================
const JUNE_EMPLOYEES = [
  {
    mat: '002', nom: 'ROUHI Nabil', fonction: 'Chef d\'equipe',
    brut: 3363.040, cnss: 322.667, irpp: 602.045, css: 13.526,
    hs_euros: 510.976, nuit_euros: 54.620, heures_hs: null,
    sf: 'M', ne: 2, lait: 29.700,
  },
  {
    mat: '014', nom: 'AAMRI Moatez', fonction: 'Resp. Qualite',
    brut: 6261.380, cnss: 603.227, irpp: 1571.661, css: 27.094,
    hs_euros: 0, nuit_euros: 0, heures_hs: 0,
    sf: 'M', ne: 0, lait: 29.700,
  },
  {
    mat: '013', nom: 'ZAYNI Majed', fonction: 'Chef d\'equipe',
    brut: 5521.902, cnss: 531.645, irpp: 1306.962, css: 23.713,
    hs_euros: 1348.560, nuit_euros: 0, heures_hs: null,
    sf: 'C', ne: 0, lait: 29.700,
  },
  {
    mat: '009', nom: 'BOUCHAHDA Walid', fonction: 'Tech. axes+tubes',
    brut: 4241.606, cnss: 407.713, irpp: 858.842, css: 17.450,
    hs_euros: 1000.500, nuit_euros: 88.598, heures_hs: null,
    sf: 'M', ne: 1, lait: 29.700,
  },
  {
    mat: '007', nom: 'CHAABANE Mohamed', fonction: 'Tech. axes',
    brut: 1735.925, cnss: 165.685, irpp: 174.656, css: 6.410,
    hs_euros: 0, nuit_euros: 0, heures_hs: 0,
    sf: 'M', ne: 2, lait: 24.300,
  },
  {
    mat: '004', nom: 'BEN SLIMANE Karim', fonction: 'Cond. Machine',
    brut: 1645.637, cnss: 156.815, irpp: 167.634, css: 6.269,
    hs_euros: 0, nuit_euros: 0, heures_hs: 0,
    sf: 'C', ne: 0, lait: 25.650,
  },
  {
    mat: '016', nom: 'HASSINE Faouzi', fonction: 'Magasinier',
    brut: 2046.567, cnss: 195.233, irpp: 236.936, css: 7.655,
    hs_euros: 555.920, nuit_euros: 78.693, heures_hs: null,
    sf: 'C', ne: 0, lait: 29.700,
  },
  {
    mat: '001', nom: 'BACCOUCHE Taher', fonction: 'Chef d\'equipe',
    brut: 1990.392, cnss: 189.926, irpp: 236.601, css: 7.649,
    hs_euros: 667.870, nuit_euros: 78.693, heures_hs: null,
    sf: 'M', ne: 5, lait: 28.350,
  },
  {
    mat: '015', nom: 'EL MANNAI Amina', fonction: 'Operatrice',
    brut: 2162.965, cnss: 206.500, irpp: 283.768, css: 8.592,
    hs_euros: 792.000, nuit_euros: 63.218, heures_hs: null,
    sf: 'C', ne: 0, lait: 29.700,
  },
];

// =====================================================================
// Fonctions de calcul (identiques au code de production)
// =====================================================================
function calculerIRPP(revenuAnnuelImposable) {
  let irpp = 0;
  let remaining = revenuAnnuelImposable;
  const detail = [];
  for (const b of IRPP_BRACKETS) {
    if (remaining <= 0) break;
    const size = b.max === Infinity ? remaining : b.max - b.min;
    const taxable = Math.min(remaining, size);
    const impot = Math.round(taxable * b.taux * 1000) / 1000;
    irpp += impot;
    detail.push({ tranche: `${b.min}-${b.max === Infinity ? '∞' : b.max}`, taux: b.taux, taxable, impot });
    remaining -= taxable;
  }
  return { irpp, detail };
}

function calculerEmployee(emp) {
  // 1. CNSS salarié — assiette = brut - lait (exclu par Décret 2003-1098 art. 11)
  const assiette_cnss = Math.max(0, emp.brut - (emp.lait || 0));
  const cnss_calc = Math.round(assiette_cnss * TAUX_CNSS_SALARIAL * 1000) / 1000;

  // 2. Revenu imposable
  const revenu_imposable = Math.max(0, emp.brut - cnss_calc);

  // 3. Frais professionnels — 10% plafonné à 2000 DT/an
  const frais_pro_annuel = Math.min(revenu_imposable * 12 * FRAIS_PRO_TAUX, FRAIS_PRO_PLAFOND_ANNUEL);
  const frais_pro = Math.round((frais_pro_annuel / 12) * 1000) / 1000;

  // 4. Revenu net imposable
  const rni = Math.max(0, revenu_imposable - frais_pro);

  // 5. Abattements familiaux (Note Commune N°3/2025, DGI)
  //   - 300 DT si chef de famille (SF = 'M' pour Marié)
  //   - + 100 DT × nombre_enfants (NE, plafonné à 4)
  const abattement_familial = Math.round(
    ((emp.sf === 'M' ? 300 : 0) + Math.min(emp.ne, 4) * 100) * 1000
  ) / 1000;

  // 6. IRPP annuel → mensuel (avec abattement familial)
  const rni_annuel = rni * 12;
  const rni_apres_abattement = Math.max(0, rni_annuel - abattement_familial);
  const irpp_annuel = calculerIRPP(rni_apres_abattement);
  const irpp_mensuel = Math.round((irpp_annuel.irpp / 12) * 1000) / 1000;

  // 7. CSS (sans abattement familial — validé à 100%)
  const css_calc = Math.round(rni * 0.005 * 1000) / 1000;

  return {
    assiette_cnss,
    cnss_calc,
    frais_pro,
    revenu_imposable,
    rni,
    rni_annuel,
    abattement_familial,
    rni_apres_abattement,
    irpp_mensuel,
    irpp_annuel_total: irpp_annuel.irpp,
    irpp_detail: irpp_annuel.detail,
    css_calc,
  };
}

// =====================================================================
// TEST 1: Hypothèse Sage — frais_pro = 10% de brut (pas de RI)
// =====================================================================
function calculerEmployee_v2(emp) {
  const assiette_cnss = Math.max(0, emp.brut - (emp.lait || 0));
  const cnss_calc = Math.round(assiette_cnss * TAUX_CNSS_SALARIAL * 1000) / 1000;
  const revenu_imposable = Math.max(0, emp.brut - cnss_calc);
  
  // Hypothèse: frais_pro sur BRUT (pas sur RI)
  const frais_pro_annuel = Math.min(emp.brut * 12 * FRAIS_PRO_TAUX, FRAIS_PRO_PLAFOND_ANNUEL);
  const frais_pro = Math.round((frais_pro_annuel / 12) * 1000) / 1000;
  
  const rni = Math.max(0, revenu_imposable - frais_pro);
  const abattement_familial = Math.round(
    ((emp.sf === 'M' ? 300 : 0) + Math.min(emp.ne, 4) * 100) * 1000
  ) / 1000;
  const rni_annuel = rni * 12;
  const rni_apres_abattement = Math.max(0, rni_annuel - abattement_familial);
  const irpp_annuel = calculerIRPP(rni_apres_abattement);
  const irpp_mensuel = Math.round((irpp_annuel.irpp / 12) * 1000) / 1000;
  
  return { frais_pro, rni, rni_apres_abattement, irpp_mensuel };
}

// =====================================================================
// TEST 2: Hypothèse Sage — IRPP sur RI mensuel (pas annuel)
// =====================================================================
function calculerEmployee_v3(emp) {
  const assiette_cnss = Math.max(0, emp.brut - (emp.lait || 0));
  const cnss_calc = Math.round(assiette_cnss * TAUX_CNSS_SALARIAL * 1000) / 1000;
  const revenu_imposable = Math.max(0, emp.brut - cnss_calc);
  const frais_pro_annuel = Math.min(revenu_imposable * 12 * FRAIS_PRO_TAUX, FRAIS_PRO_PLAFOND_ANNUEL);
  const frais_pro = Math.round((frais_pro_annuel / 12) * 1000) / 1000;
  const rni = Math.max(0, revenu_imposable - frais_pro);
  
  // Hypothèse: barème sur RNI MENSUEL (pas ×12)
  const abattement_mensuel = Math.round(
    (((emp.sf === 'M' ? 300 : 0) + Math.min(emp.ne, 4) * 100) / 12) * 1000
  ) / 1000;
  const rni_apres_abattement = Math.max(0, rni - abattement_mensuel);
  const irpp_annuel = calculerIRPP(rni_apres_abattement * 12);
  const irpp_mensuel = Math.round((irpp_annuel.irpp / 12) * 1000) / 1000;
  
  return { rni, rni_apres_abattement, irpp_mensuel };
}

// =====================================================================
// TEST 3: Hypothèse Sage — frais_pro = 10% brut, IRPP sur mensuel
// =====================================================================
function calculerEmployee_v4(emp) {
  const assiette_cnss = Math.max(0, emp.brut - (emp.lait || 0));
  const cnss_calc = Math.round(assiette_cnss * TAUX_CNSS_SALARIAL * 1000) / 1000;
  const revenu_imposable = Math.max(0, emp.brut - cnss_calc);
  
  // Frais pro sur brut
  const frais_pro_annuel = Math.min(emp.brut * 12 * FRAIS_PRO_TAUX, FRAIS_PRO_PLAFOND_ANNUEL);
  const frais_pro = Math.round((frais_pro_annuel / 12) * 1000) / 1000;
  
  const rni = Math.max(0, revenu_imposable - frais_pro);
  const abattement_mensuel = Math.round(
    (((emp.sf === 'M' ? 300 : 0) + Math.min(emp.ne, 4) * 100) / 12) * 1000
  ) / 1000;
  const rni_apres_abattement = Math.max(0, rni - abattement_mensuel);
  const irpp_annuel = calculerIRPP(rni_apres_abattement * 12);
  const irpp_mensuel = Math.round((irpp_annuel.irpp / 12) * 1000) / 1000;
  
  return { frais_pro, rni, rni_apres_abattement, irpp_mensuel };
}

// =====================================================================
// TEST COMPARATIF — 4 hypothèses
// =====================================================================
console.log('\n\n' + '='.repeat(130));
console.log('TEST COMPARATIF — 4 hypothèses vs bulletin Sage');
console.log('='.repeat(130));

let bestPass = { v1: 0, v2: 0, v3: 0, v4: 0 };

for (const emp of JUNE_EMPLOYEES) {
  const v1 = calculerEmployee(emp);
  const v2 = calculerEmployee_v2(emp);
  const v3 = calculerEmployee_v3(emp);
  const v4 = calculerEmployee_v4(emp);
  
  const d1 = Math.abs(v1.irpp_mensuel - emp.irpp);
  const d2 = Math.abs(v2.irpp_mensuel - emp.irpp);
  const d3 = Math.abs(v3.irpp_mensuel - emp.irpp);
  const d4 = Math.abs(v4.irpp_mensuel - emp.irpp);
  
  if (d1 < 5) bestPass.v1++;
  if (d2 < 5) bestPass.v2++;
  if (d3 < 5) bestPass.v3++;
  if (d4 < 5) bestPass.v4++;
  
  console.log(`\n--- ${emp.nom} (SF=${emp.sf}, NE=${emp.ne}) bulletin=${emp.irpp.toFixed(3)} ---`);
  console.log(`  V1 (code actuel):     IRPP=${v1.irpp_mensuel.toFixed(3)}  delta=${d1.toFixed(3)}  frais_pro=${v1.frais_pro.toFixed(3)}`);
  console.log(`  V2 (frais_pro sur brut): IRPP=${v2.irpp_mensuel.toFixed(3)}  delta=${d2.toFixed(3)}  frais_pro=${v2.frais_pro.toFixed(3)}`);
  console.log(`  V3 (barème mensuel):  IRPP=${v3.irpp_mensuel.toFixed(3)}  delta=${d3.toFixed(3)}`);
  console.log(`  V4 (brut+mensuel):    IRPP=${v4.irpp_mensuel.toFixed(3)}  delta=${d4.toFixed(3)}  frais_pro=${v4.frais_pro.toFixed(3)}`);
}

console.log('\n' + '='.repeat(130));
console.log(`RÉSULTATS (< 5 DT tolerance): V1=${bestPass.v1}/9  V2=${bestPass.v2}/9  V3=${bestPass.v3}/9  V4=${bestPass.v4}/9`);
console.log('='.repeat(130));

// =====================================================================
// TEST IRPP
// =====================================================================
console.log('='.repeat(130));
console.log('TEST EMPIRIQUE IRPP — Comparaison calcul BAUD vs bulletin Sage Juin 2026');
console.log('='.repeat(130));
console.log('');

const irppResults = [];
let irppPass = 0;
let irppFail = 0;

for (const emp of JUNE_EMPLOYEES) {
  const r = calculerEmployee(emp);

  const delta_cnss = Math.abs(r.cnss_calc - emp.cnss);
  const delta_irpp = Math.abs(r.irpp_mensuel - emp.irpp);
  const delta_css = Math.abs(r.css_calc - emp.css);
  const pct_irpp = emp.irpp > 0 ? (delta_irpp / emp.irpp * 100) : 0;

  const irppOk = delta_irpp < 1.0; // tolerance 1 DT
  const cnssOk = delta_cnss < 1.0;
  const cssOk = delta_css < 0.5;

  if (irppOk) irppPass++; else irppFail++;

  irppResults.push({
    nom: emp.nom,
    brut: emp.brut,
    cnss_bulletin: emp.cnss,
    cnss_calc: r.cnss_calc,
    cnss_delta: delta_cnss,
    cnss_ok: cnssOk,
    irpp_bulletin: emp.irpp,
    irpp_calc: r.irpp_mensuel,
    irpp_delta: delta_irpp,
    irpp_pct: pct_irpp,
    irpp_ok: irppOk,
    css_bulletin: emp.css,
    css_calc: r.css_calc,
    css_delta: delta_css,
    css_ok: cssOk,
    rni_annuel: r.rni_annuel,
    irpp_detail: r.irpp_detail,
    frais_pro: r.frais_pro,
    rni: r.rni,
  });

  console.log(`--- ${emp.nom} (Brut: ${emp.brut} DT) ---`);
  console.log(`  Assiette CNSS: ${r.assiette_cnss.toFixed(3)} DT (brut - lait=${emp.lait})`);
  console.log(`  CNSS:  bulletin=${emp.cnss.toFixed(3)}  calc=${r.cnss_calc.toFixed(3)}  delta=${delta_cnss.toFixed(3)}  ${cnssOk ? 'OK' : 'FAIL'}`);
  console.log(`  IRPP:  bulletin=${emp.irpp.toFixed(3)}  calc=${r.irpp_mensuel.toFixed(3)}  delta=${delta_irpp.toFixed(3)} (${pct_irpp.toFixed(1)}%)  ${irppOk ? 'OK' : 'FAIL'}`);
  console.log(`  CSS:   bulletin=${emp.css.toFixed(3)}  calc=${r.css_calc.toFixed(3)}  delta=${delta_css.toFixed(3)}  ${cssOk ? 'OK' : 'FAIL'}`);
  console.log(`  RNI annuel: ${r.rni_annuel.toFixed(3)} DT`);
  console.log(`  Abattement familial: ${r.abattement_familial.toFixed(3)} DT (SF=${emp.sf}, NE=${emp.ne})`);
  console.log(`  RNI après abattement: ${r.rni_apres_abattement.toFixed(3)} DT`);
  console.log(`  Détail IRPP annuel:`);
  for (const d of r.irpp_detail) {
    if (d.impot > 0) {
      console.log(`    Tranche ${d.tranche} @ ${(d.taux*100).toFixed(0)}%: ${d.taxable.toFixed(3)} × ${(d.taux*100).toFixed(0)}% = ${d.impot.toFixed(3)}`);
    }
  }
  console.log('');
}

console.log('='.repeat(130));
console.log(`RESULTATS IRPP: ${irppPass}/${irppResults.length} OK, ${irppFail} FAIL`);
console.log('='.repeat(130));

// =====================================================================
// REVERSE ENGINEERING — What RNI annual does Sage use?
// =====================================================================
console.log('\n\n' + '='.repeat(130));
console.log('REVERSE ENGINEERING — RNI annuel Sage (depuis IRPP bulletin)');
console.log('='.repeat(130));

for (const emp of JUNE_EMPLOYEES) {
  const r = calculerEmployee(emp);
  
  // Work backwards from bulletin IRPP to find what annual RNI Sage uses
  const irpp_annuel_bulletin = emp.irpp * 12;
  
  // Find which bracket the bulletin IRPP falls in
  let rni_annuel_sage = 0;
  let remaining_irpp = irpp_annuel_bulletin;
  const bracket_desc = [];
  
  for (const b of IRPP_BRACKETS) {
    if (remaining_irpp <= 0) break;
    const tranche_size = b.max === Infinity ? Infinity : b.max - b.min;
    const max_impot_tranche = tranche_size * b.taux;
    
    if (remaining_irpp >= max_impot_tranche && b.max !== Infinity) {
      // This bracket is fully consumed
      remaining_irpp -= max_impot_tranche;
      rni_annuel_sage += tranche_size;
      bracket_desc.push(`${b.min}-${b.max}: ${tranche_size.toFixed(0)} × ${(b.taux*100).toFixed(0)}% = ${max_impot_tranche.toFixed(3)}`);
    } else {
      // This bracket is partially consumed
      const taxable = remaining_irpp / b.taux;
      rni_annuel_sage += taxable;
      bracket_desc.push(`${b.min}+: ${taxable.toFixed(3)} × ${(b.taux*100).toFixed(0)}% = ${remaining_irpp.toFixed(3)}`);
      remaining_irpp = 0;
    }
  }
  
  const rni_mensuel_sage = rni_annuel_sage / 12;
  const delta_rni = r.rni_apres_abattement - rni_mensuel_sage;
  
  console.log(`\n--- ${emp.nom} (SF=${emp.sf}, NE=${emp.ne}) ---`);
  console.log(`  IRPP bulletin annuel: ${irpp_annuel_bulletin.toFixed(3)} DT`);
  console.log(`  RNI annuel Sage (reverse): ${rni_annuel_sage.toFixed(3)} DT`);
  console.log(`  RNI mensuel Sage (reverse): ${rni_mensuel_sage.toFixed(3)} DT`);
  console.log(`  RNI mensuel code (après abattement): ${r.rni_apres_abattement.toFixed(3)} DT`);
  console.log(`  Delta RNI: ${delta_rni.toFixed(3)} DT`);
  console.log(`  Delta RNI annuel: ${(delta_rni * 12).toFixed(3)} DT`);
  
  // Try to explain delta: what frais_pro would produce this RNI?
  const revenu_imposable_annuel = r.revenu_imposable * 12;
  const frais_pro_requis_annuel = revenu_imposable_annuel - rni_annuel_sage;
  const frais_pro_requis_mensuel = frais_pro_requis_annuel / 12;
  const frais_pro_pct = r.revenu_imposable > 0 ? (frais_pro_requis_mensuel / r.revenu_imposable * 100) : 0;
  
  console.log(`  Frais pro bulletin (reverse): ${frais_pro_requis_mensuel.toFixed(3)} DT/mois = ${frais_pro_requis_annuel.toFixed(3)} DT/an`);
  console.log(`  Frais pro % du RI: ${frais_pro_pct.toFixed(2)}%`);
  console.log(`  Frais pro code: ${r.frais_pro.toFixed(3)} DT/mois = ${(r.frais_pro * 12).toFixed(3)} DT/an`);
}

// =====================================================================
// TEST HS — BOUCHAHDA (le cas le plus complexe: HS + NUIT)
// =====================================================================
console.log('\n\n' + '='.repeat(130));
console.log('TEST HS — Formule heures supplémentaires vs bulletin réel');
console.log('='.repeat(130));

// BOUCHAHDA: brut bulletin 4241.606, HS=1000.500
// On ne connaît pas les heures exactes en heures, donc on teste la COHÉRENCE
// du montant HS par rapport aux paramètres known.
// Hypothèse: taux horaire = base_complement_mensuel / heures_base_mois
// BOUCHAHDA: base=1044.082, complement=1509.387, total_base=2553.469
// Si 40h/sem → 173.33h/mois → taux_horaire = 2553.469 / 173.33 = 14.732 DT/h

const BOUCHAHDA = JUNE_EMPLOYEES.find(e => e.nom === 'BOUCHAHDA Walid');
const heures_mois = HS_HEURES_SEMAINE * (HS_SEMAINES_ANNEE / 12); // ≈ 173.33h
const taux_horaire = (1044.082 + 1509.387) / heures_mois; // base+complement / heures_base
const seuil_25 = HS_SEUIL_25H_SEM * (HS_SEMAINES_ANNEE / 12); // ≈ 34.67h/mois

console.log(`BOUCHAHDA: Base+Complement = ${(1044.082 + 1509.387).toFixed(3)} DT`);
console.log(`  Heures base/mois: ${heures_mois.toFixed(2)}h`);
console.log(`  Taux horaire: ${taux_horaire.toFixed(3)} DT/h`);
console.log(`  Seuil 25%: ${seuil_25.toFixed(2)}h/mois`);
console.log(`  HS bulletin: ${BOUCHAHDA.hs_euros.toFixed(3)} DT`);
console.log('');

// On ne sait pas combien d'heures exactes → on calcule le nombre d'heures
// qui donnerait exactement le montant bulletin
// Cas 1: toutes les heures au-delà du seuil → 50%
// Cas 2: mélange 25% et 50%

// Test avec différentes hypothèses d'heures
for (const hsupposees of [60, 70, 80, 90, 100]) {
  const h25 = Math.min(hsupposees, seuil_25);
  const h50 = Math.max(0, hsupposees - seuil_25);
  const calc_hs = Math.round((h25 * taux_horaire * 0.25 + h50 * taux_horaire * 0.50) * 1000) / 1000;
  const delta = Math.abs(calc_hs - BOUCHAHDA.hs_euros);
  console.log(`  Hypothèse ${hsupposees}h HS: h25=${h25.toFixed(1)} h50=${h50.toFixed(1)} → HS_calc=${calc_hs.toFixed(3)} delta=${delta.toFixed(3)} ${delta < 5 ? '≈ OK' : ''}`);
}

// =====================================================================
// TEST NUIT — ROUHI Nabil
// =====================================================================
console.log('\n\n' + '='.repeat(130));
console.log('TEST NUIT — Formule heures nuit vs bulletin réel');
console.log('='.repeat(130));

const ROUHI = JUNE_EMPLOYEES.find(e => e.nom === 'ROUHI Nabil');

// Hypothèse: Base heures = 190h/mois, majoration 25%
// Nuit bulletin: 54.620 DT
// Taux horaire nuit = taux_horaire_jour * (1 + 0.25) = taux * 1.25
// Montant nuit = heures_nuit * taux_horaire * 1.25

const taux_horaire_rouhi = (1044.082 + 983.933) / heures_mois; // base+complement / heures_base
console.log(`ROUHI: Base+Complement = ${(1044.082 + 983.933).toFixed(3)} DT`);
console.log(`  Taux horaire jour: ${taux_horaire_rouhi.toFixed(3)} DT/h`);
console.log(`  Taux horaire nuit (×1.25): ${(taux_horaire_rouhi * 1.25).toFixed(3)} DT/h`);
console.log(`  Nuit bulletin: ${ROUHI.nuit_euros.toFixed(3)} DT`);
console.log('');

// Calculer les heures de nuit à partir du montant bulletin
const heures_nuit_reelles = ROUHI.nuit_euros / (taux_horaire_rouhi * 1.25);
console.log(`  Heures de nuit déduites du bulletin: ${heures_nuit_reelles.toFixed(2)}h`);
console.log(`  (Ce n'est PAS un nombre rond — ${heures_nuit_reelles.toFixed(4)}h)`);
console.log('');

// Test: si on avait 48h de nuit → quel montant?
const test_nuit = Math.round(48 * taux_horaire_rouhi * 1.25 * 1000) / 1000;
console.log(`  Test 48h nuit: ${test_nuit.toFixed(3)} DT (delta bulletin: ${Math.abs(test_nuit - ROUHI.nuit_euros).toFixed(3)})`);
const test_nuit2 = Math.round(47 * taux_horaire_rouhi * 1.25 * 1000) / 1000;
console.log(`  Test 47h nuit: ${test_nuit2.toFixed(3)} DT (delta bulletin: ${Math.abs(test_nuit2 - ROUHI.nuit_euros).toFixed(3)})`);

// =====================================================================
// TEST NUIT — BOUCHAHDA (aussi pour valider)
// =====================================================================
console.log('\n--- BOUCHAHDA nuit ---');
const taux_horaire_bouch = (1044.082 + 1509.387) / heures_mois;
console.log(`  Taux horaire jour: ${taux_horaire_bouch.toFixed(3)} DT/h`);
console.log(`  Nuit bulletin: ${BOUCHAHDA.nuit_euros.toFixed(3)} DT`);
const heures_nuit_bouch = BOUCHAHDA.nuit_euros / (taux_horaire_bouch * 1.25);
console.log(`  Heures nuit déduites: ${heures_nuit_bouch.toFixed(2)}h`);

console.log('\n\n' + '='.repeat(130));
console.log('CONCLUSIONS');
console.log('='.repeat(130));
console.log(`
IRPP:  Voir résultats ci-dessus. Si tous les bulletins montrent delta < 1 DT,
       le barème 8 tranches est CONFIRMÉ pour la production.
       Si des écarts > 5 DT apparaissent, chercher si une déduction
       familiale ou un crédit d'impôt manque dans la formule.

HS:    Le nombre d'heures exact n'est pas connu (pas dans le bulletin).
       Tester la cohérence du montant HS vs la fourchette d'heures attendue.
       Si le montant bulletin correspond à une fourchette réaliste (40-80h),
       la formule 25%/50% est plausible mais PAS encore confirmée.

NUIT:  Les heures déduites du bulletin ne sont PAS des heures rondes.
       Cela confirme que la formule "190h base, taux horaire × 1.25"
       ne produit pas de résultats ronds → la nuit est probablement
       un montant fixe individuel par salarié (saisi manuellement dans Sage),
       PAS un calcul horaire automatique.
`);
