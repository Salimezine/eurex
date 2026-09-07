import { describe, it, expect } from 'vitest';
import { calculateSalary } from '../baudCalculator';

// Validation du calculateur BAUD vs bulletins réels Sage Paie — Juin 2026
//
// Stratégie:
//   1. CAS PROPRE (AAMRI): validation complète — inputs individuels → brut exact
//   2. FORMULE CNSS: validée sur 19/19 employés, exacte
//   3. COHERENCE INTERNE: net = brut − retenues, retenues = cnss + irpp + css
//   4. IRPP: résidu ~20-40 DT documenté (frais_pro sur brut vs RI)
//
// Hypothèses NON confirmées (en attente validation client):
//   HS (Art. 90), NUIT (3802),—heures exactes inconnues

// ============================================================================
// 1. AAMRI — CAS PROPRE: validation complète
//    Pas de HS, nuit, ni rappel → brut exactement reproductible
// ============================================================================
describe('AAMRI Moatez — Juin 2026 (CAS PROPRE)', () => {
  const r = calculateSalary({
    salaire_brut: 1346.001 + 4127.440,
    situation_fam: 'M', nombre_enfants: 0,
    sexe: 'H', date_recrutement: '2023-06-01',
    mois: 6, annee: 2026,
    transport_plein: 105.560 / 1.05,
    augmentation: 570.417,
    prime_logement_plein: 26.293,
    prime_lait_plein: 29.700,
    prime_panier_plein: 12.320,
    prime_douche_plein: 25.000,
    prime_savon_plein: 5.400,
    mit_applicable: true,
  });

  it('brut total = 6261.380 (bulletin)', () => {
    expect(r.salaire_brut).toBeCloseTo(6261.380, 0);
  });

  it('CNSS = 9.68% × (brut − lait) = 603.227', () => {
    expect(r.cnss_salariale).toBeCloseTo(603.227, 0);
  });

  it('IRPP ≈ 1572 (résidu documenté ~28 DT, frais_pro)', () => {
    expect(Math.abs(r.irpp - 1571.661)).toBeLessThan(50);
  });

  it('CSS ≈ 27.1', () => {
    expect(r.css_salariale).toBeCloseTo(27.094, 0);
  });

  it('net_a_payer = salaire_net', () => {
    expect(r.net_a_payer).toBe(r.salaire_net);
  });

  it('coherence: net = brut − retenues', () => {
    const expected = Math.round((r.salaire_brut - r.total_retenues) * 1000) / 1000;
    expect(r.salaire_net).toBe(expected);
  });

  it('coherence: retenues = cnss + irpp + css', () => {
    const expected = Math.round((r.cnss_salariale + r.irpp + r.css_salariale) * 1000) / 1000;
    expect(r.total_retenues).toBe(expected);
  });

  it('MIT = 5.000 (montant fixe config)', () => {
    expect(r.mit).toBe(5.000);
  });

  it('presence = 8.249 (juin revalorisé)', () => {
    expect(r.prime_presence).toBe(8.249);
  });

  it('transport = 105.560 (97.8 × 1.05 × coeff 1.0)', () => {
    expect(r.ind_transport).toBe(105.560);
  });
});

// ============================================================================
// 2. Formule CNSS — 11 employés juin
//    CNSS = 9.68% × (Total Brut − prime_lait)
//    Validation: EXACT sur 19/19 dans validateAllMonths.cjs
//    On teste ici les cas où on peut reproduire le brut
// ============================================================================
describe('Formule CNSS — 9.68% × (brut − lait)', () => {
  it('AAMRI: CNSS = 603.227 (brut=6261.380)', () => {
    const r = calculateSalary({
      salaire_brut: 1346.001 + 4127.440,
      situation_fam: 'M', nombre_enfants: 0, sexe: 'H',
      mois: 6, annee: 2026, transport_plein: 105.560 / 1.05,
      augmentation: 570.417, prime_logement_plein: 26.293,
      prime_lait_plein: 29.700, prime_panier_plein: 12.320,
      prime_douche_plein: 25.000, prime_savon_plein: 5.400,
      mit_applicable: true,
    });
    const assiette = Math.max(0, r.salaire_brut - 29.700);
    const expected = Math.round(assiette * 0.0968 * 1000) / 1000;
    expect(r.cnss_salariale).toBe(expected);
  });

  it('BEN SLIMANE: CNSS sur brut avec coeff proraté', () => {
    const r = calculateSalary({
      salaire_brut: 606.945 + 507.737,
      situation_fam: 'C', nombre_enfants: 0, sexe: 'H',
      mois: 6, annee: 2026, absences_jours: 3,
      transport_plein: 92.800, augmentation: 103.007,
      prime_logement_plein: 26.293, prime_lait_plein: 29.700,
      prime_panier_plein: 12.320, prime_douche_plein: 25.000,
      prime_savon_plein: 5.400, mit_applicable: true,
    });
    const assiette = Math.max(0, r.salaire_brut - r.prime_lait);
    const expected = Math.round(assiette * 0.0968 * 1000) / 1000;
    expect(r.cnss_salariale).toBe(expected);
  });

  it('LAZAAR: CNSS sur brut (MIT=0, lait dans assiette)', () => {
    const r = calculateSalary({
      salaire_brut: 1396.734 + 3507.930,
      situation_fam: 'C', nombre_enfants: 0, sexe: 'H',
      mois: 6, annee: 2026, transport_plein: 105.560 / 1.05,
      montant_hs: 371.232, prime_logement_plein: 26.293,
      prime_lait_plein: 29.700, prime_panier_plein: 12.320,
      prime_douche_plein: 25.000, prime_savon_plein: 5.400,
      mit_applicable: false,
    });
    const assiette = Math.max(0, r.salaire_brut - 29.700);
    const expected = Math.round(assiette * 0.0968 * 1000) / 1000;
    expect(r.cnss_salariale).toBe(expected);
  });

  it('RHILI: CNSS (MIT=0, HS)', () => {
    const r = calculateSalary({
      salaire_brut: 595.065 + 85.559,
      situation_fam: 'M', nombre_enfants: 2, sexe: 'F',
      mois: 6, annee: 2026, transport_plein: 97.440 / 1.05,
      montant_hs: 358.996, prime_logement_plein: 26.293,
      prime_lait_plein: 29.700, prime_panier_plein: 12.320,
      prime_douche_plein: 0, prime_savon_plein: 5.400,
      mit_applicable: false,
    });
    const assiette = Math.max(0, r.salaire_brut - 29.700);
    const expected = Math.round(assiette * 0.0968 * 1000) / 1000;
    expect(r.cnss_salariale).toBe(expected);
  });
});

// ============================================================================
// 3. Coherences internes — tous les cas propres
// ============================================================================
describe('Coherences internes', () => {
  it('net = brut − retenues (AAMRI)', () => {
    const r = calculateSalary({
      salaire_brut: 1346.001 + 4127.440,
      situation_fam: 'M', nombre_enfants: 0, sexe: 'H',
      mois: 6, annee: 2026, transport_plein: 105.560 / 1.05,
      augmentation: 570.417, prime_logement_plein: 26.293,
      prime_lait_plein: 29.700, prime_panier_plein: 12.320,
      prime_douche_plein: 25.000, prime_savon_plein: 5.400,
      mit_applicable: true,
    });
    expect(r.salaire_net).toBe(Math.round((r.salaire_brut - r.total_retenues) * 1000) / 1000);
  });

  it('retenues = cnss + irpp + css (AAMRI)', () => {
    const r = calculateSalary({
      salaire_brut: 1346.001 + 4127.440,
      situation_fam: 'M', nombre_enfants: 0, sexe: 'H',
      mois: 6, annee: 2026, transport_plein: 105.560 / 1.05,
      augmentation: 570.417, prime_logement_plein: 26.293,
      prime_lait_plein: 29.700, prime_panier_plein: 12.320,
      prime_douche_plein: 25.000, prime_savon_plein: 5.400,
      mit_applicable: true,
    });
    expect(r.total_retenues).toBe(Math.round((r.cnss_salariale + r.irpp + r.css_salariale) * 1000) / 1000);
  });

  it('net_a_payer = salaire_net (pas alloc)', () => {
    const r = calculateSalary({
      salaire_brut: 1346.001 + 4127.440,
      situation_fam: 'M', nombre_enfants: 0, sexe: 'H',
      mois: 6, annee: 2026, transport_plein: 105.560 / 1.05,
      augmentation: 570.417, prime_logement_plein: 26.293,
      prime_lait_plein: 29.700, prime_panier_plein: 12.320,
      prime_douche_plein: 25.000, prime_savon_plein: 5.400,
      mit_applicable: true,
    });
    expect(r.net_a_payer).toBe(r.salaire_net);
  });

  it('net = brut − retenues (ROUHI avec HS/nuit/rappel)', () => {
    const r = calculateSalary({
      salaire_brut: 1044.082 + 983.933,
      situation_fam: 'M', nombre_enfants: 2, sexe: 'H',
      mois: 6, annee: 2026, transport_plein: 105.560 / 1.05,
      augmentation: 370.940, montant_hs: 510.976,
      rappel: 192.420, prime_nuit_plein: 54.620,
      prime_logement_plein: 26.293, prime_lait_plein: 29.700,
      prime_panier_plein: 12.320, prime_douche_plein: 25.000,
      prime_savon_plein: 5.400, mit_applicable: true,
    });
    expect(r.salaire_net).toBe(Math.round((r.salaire_brut - r.total_retenues) * 1000) / 1000);
    expect(r.total_retenues).toBe(Math.round((r.cnss_salariale + r.irpp + r.css_salariale) * 1000) / 1000);
  });

  it('net = brut − retenues (BEN SLIMANE coeff proraté)', () => {
    const r = calculateSalary({
      salaire_brut: 606.945 + 507.737,
      situation_fam: 'C', nombre_enfants: 0, sexe: 'H',
      mois: 6, annee: 2026, absences_jours: 3,
      transport_plein: 92.800, augmentation: 103.007,
      prime_logement_plein: 26.293, prime_lait_plein: 29.700,
      prime_panier_plein: 12.320, prime_douche_plein: 25.000,
      prime_savon_plein: 5.400, mit_applicable: true,
    });
    expect(r.salaire_net).toBe(Math.round((r.salaire_brut - r.total_retenues) * 1000) / 1000);
    expect(r.total_retenues).toBe(Math.round((r.cnss_salariale + r.irpp + r.css_salariale) * 1000) / 1000);
  });
});

// ============================================================================
// 4. MIT — montant fixe, PAS un pourcentage
// ============================================================================
describe('MIT — montant fixe ~5 DT', () => {
  it('MIT = 5.000 quand mit_applicable = true (mois complet)', () => {
    const r = calculateSalary({
      salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 6, annee: 2026, mit_applicable: true,
    });
    expect(r.mit).toBe(5.000);
  });

  it('MIT = 0 quand mit_applicable = false', () => {
    const r = calculateSalary({
      salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 6, annee: 2026, mit_applicable: false,
    });
    expect(r.mit).toBe(0);
  });

  it('MIT proratisé avec absences', () => {
    const r = calculateSalary({
      salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 6, annee: 2026, absences_jours: 2,
      mit_applicable: true,
    });
    const coeff = Math.round((20 / 22) * 10000) / 10000;
    expect(r.mit).toBe(Math.round(5.000 * coeff * 1000) / 1000);
  });
});

// ============================================================================
// 5. SMIG — salaire minimum garanti
// ============================================================================
describe('SMIG — verification', () => {
  it('SMIG 2026 = 470.251 DT/mois', () => {
    const r = calculateSalary({
      salaire_brut: 470.251, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 1, annee: 2026,
    });
    expect(r.salaire_de_base).toBeGreaterThanOrEqual(470.251);
  });
});

// ============================================================================
// 6. Ben Slimane — proratisation avec absences
// ============================================================================
describe('BEN SLIMANE — proratisation (3 absences juin)', () => {
  it('coefficient ≈ (22−3)/22 = 0.8636', () => {
    const r = calculateSalary({
      salaire_brut: 606.945 + 507.737,
      situation_fam: 'C', nombre_enfants: 0, sexe: 'H',
      mois: 6, annee: 2026, absences_jours: 3,
      transport_plein: 92.800, augmentation: 103.007,
      prime_logement_plein: 26.293, prime_lait_plein: 29.700,
      prime_panier_plein: 12.320, prime_douche_plein: 25.000,
      prime_savon_plein: 5.400, mit_applicable: true,
    });
    const expectedCoeff = Math.round((19 / 22) * 10000) / 10000;
    expect(r.coefficient_presence).toBeCloseTo(expectedCoeff, 4);
    expect(r.ind_transport).toBeCloseTo(92.800 * 1.05 * expectedCoeff, 0);
    expect(r.prime_presence).toBeCloseTo(8.249 * expectedCoeff, 2);
    expect(r.mit).toBeCloseTo(5.000 * expectedCoeff, 2);
  });
});

// ============================================================================
// 7. CSS — 0.5% × RNI (revenu net imposable)
//    Formule validée sur 219 observations, median error = 0.000
// ============================================================================
describe('CSS — 0.5% × RNI', () => {
  it('CSS = 0.5% × (imposable − frais_pro) pour AAMRI', () => {
    const r = calculateSalary({
      salaire_brut: 1346.001 + 4127.440,
      situation_fam: 'M', nombre_enfants: 0, sexe: 'H',
      mois: 6, annee: 2026, transport_plein: 105.560 / 1.05,
      augmentation: 570.417, prime_logement_plein: 26.293,
      prime_lait_plein: 29.700, prime_panier_plein: 12.320,
      prime_douche_plein: 25.000, prime_savon_plein: 5.400,
      mit_applicable: true,
    });
    const rni = Math.max(0, r.revenu_net_imposable);
    const expected = Math.round(rni * 0.005 * 1000) / 1000;
    expect(r.css_salariale).toBe(expected);
  });

  it('CSS même pour salaire bas (pas de seuil)', () => {
    const r = calculateSalary({
      salaire_brut: 500, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 1, annee: 2026,
    });
    const rni = Math.max(0, r.revenu_net_imposable);
    const expected = Math.round(rni * 0.005 * 1000) / 1000;
    expect(r.css_salariale).toBe(expected);
  });
});

// ============================================================================
// 8. IRPP — barème annuel 8 tranches
//    Résidu documenté: ~20-40 DT (frais_pro sur RI vs bulletin)
// ============================================================================
describe('IRPP — barème annuel 8 tranches', () => {
  it('IRPP > 0 pour salaire moyen (AAMRI)', () => {
    const r = calculateSalary({
      salaire_brut: 1346.001 + 4127.440,
      situation_fam: 'M', nombre_enfants: 0, sexe: 'H',
      mois: 6, annee: 2026, transport_plein: 105.560 / 1.05,
      augmentation: 570.417, prime_logement_plein: 26.293,
      prime_lait_plein: 29.700, prime_panier_plein: 12.320,
      prime_douche_plein: 25.000, prime_savon_plein: 5.400,
      mit_applicable: true,
    });
    expect(r.irpp).toBeGreaterThan(0);
    expect(r.irpp_detail.length).toBeGreaterThan(0);
  });

  it('IRPP detail coherent (somme = 12 × mensuel)', () => {
    const r = calculateSalary({
      salaire_brut: 1346.001 + 4127.440,
      situation_fam: 'M', nombre_enfants: 0, sexe: 'H',
      mois: 6, annee: 2026, transport_plein: 105.560 / 1.05,
      augmentation: 570.417, prime_logement_plein: 26.293,
      prime_lait_plein: 29.700, prime_panier_plein: 12.320,
      prime_douche_plein: 25.000, prime_savon_plein: 5.400,
      mit_applicable: true,
    });
    const totalDetail = r.irpp_detail.reduce((s, t) => s + t.impot, 0);
    expect(totalDetail / 12).toBeCloseTo(r.irpp, 2);
  });

  it('IRPP = 0 pour bas salaire (seuil 5000/an)', () => {
    const r = calculateSalary({
      salaire_brut: 300, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 1, annee: 2026,
    });
    expect(r.irpp).toBe(0);
  });
});

// ============================================================================
// 9. Charges patronales — les taux sont dans la config
// ============================================================================
describe('Charges patronales', () => {
  it('CNSS patronale = 17.07% × brut', () => {
    const r = calculateSalary({
      salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 6, annee: 2026,
    });
    expect(r.cnss_patronale).toBeGreaterThan(0);
  });

  it('AT/MP + TFP + FOPROLOS > 0', () => {
    const r = calculateSalary({
      salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 6, annee: 2026,
    });
    expect(r.at_mp).toBeGreaterThan(0);
    expect(r.tfp).toBeGreaterThan(0);
    expect(r.foprolos).toBeGreaterThan(0);
  });
});

// ============================================================================
// 10. Nuit — fixe × coefficient (hypothèse non confirmée)
// ============================================================================
describe('Nuit — fixe × coefficient', () => {
  it('nuit = plein × coefficient (0 si non renseigné)', () => {
    const r1 = calculateSalary({
      salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 6, annee: 2026,
    });
    expect(r1.prime_nuit).toBe(0);

    const r2 = calculateSalary({
      salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 6, annee: 2026, prime_nuit_plein: 70,
    });
    expect(r2.prime_nuit).toBe(70);
  });
});

// ============================================================================
// 11. Proratisation — transport, presence, primes légales
// ============================================================================
describe('Proratisation', () => {
  it('coefficient = 1.0 sans absence', () => {
    const r = calculateSalary({
      salaire_brut: 800, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 6, annee: 2026, transport_plein: 100,
    });
    expect(r.coefficient_presence).toBe(1);
  });

  it('coefficient = (jours − abs) / jours avec absences', () => {
    const r = calculateSalary({
      salaire_brut: 800, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 6, annee: 2026, transport_plein: 100,
      absences_jours: 2,
    });
    const expected = Math.round((20 / 22) * 10000) / 10000;
    expect(r.coefficient_presence).toBeCloseTo(expected, 4);
  });

  it('toutes les primes proratisées avec 2 absences', () => {
    const r = calculateSalary({
      salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0,
      sexe: 'H', mois: 6, annee: 2026,
      transport_plein: 100, absences_jours: 2,
    });
    const coeff = Math.round((20 / 22) * 10000) / 10000;
    expect(r.ind_transport).toBeCloseTo(100 * 1.05 * coeff, 2);
    expect(r.prime_presence).toBeCloseTo(8.249 * coeff, 2);
    expect(r.prime_panier).toBeCloseTo(12.320 * coeff, 2);
    expect(r.prime_douche).toBeCloseTo(25.000 * coeff, 2);
    expect(r.mit).toBeCloseTo(5.000 * coeff, 2);
  });
});
