/**
 * Tests module BAUD — Paie tunisienne 2026
 * Système unifié de proratisation
 * Vitest — Tests unitaires + integration tous mois/tous salaries
 */
import { describe, it, expect } from 'vitest';
import {
  calculateSalary,
  calculateAnciennete,
  getTauxAnciennete,
  applyRevalorisation,
  calculateJoursOuvres,
  generateSagePaieExport,
  type SalaryResult,
} from '../baudCalculator.js';
import { verifySalaryCalculations } from '../baudAI.js';

// ============================================================================
// 1. SMIG — Decret n67/2026
// ============================================================================
describe('SMIG — Decret 67/2026', () => {
  it('salaire >= SMIG 470.251 est accepte', () => {
    const r = calculateSalary({ salaire_brut: 470.251, situation_fam: 'C', nombre_enfants: 0 });
    expect(r.salaire_brut).toBeGreaterThanOrEqual(470.251);
  });

  it('salaire < SMIG est detecte par rapport de controle', () => {
    const employees = [{ matricule: 'T1', nom: 'TEST', prenom: 'Low', nouveau_salaire_brut: 300, salaire_brut: 300 }];
    const results = new Map<string, SalaryResult>();
    results.set('T1', calculateSalary({ salaire_brut: 300, situation_fam: 'C', nombre_enfants: 0 }));
    const exportResult = generateSagePaieExport(employees, [], results, 6, 2026, false);
    expect(exportResult.smigViolations.length).toBe(1);
    expect(exportResult.smigViolations[0].matricule).toBe('T1');
  });
});

// ============================================================================
// 2. CNSS — Loi n73-40 (9.68%, sans plafond, excluant lait et prime_aid)
// ============================================================================
describe('CNSS — 9.68% sans plafond', () => {
  it('CNSS sur brut excluant lait (sans plafond)', () => {
    const r = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0 });
    const expectedLait = 29.700;
    const expectedCNSS = Math.round(Math.max(0, r.salaire_brut - expectedLait) * 0.0968 * 1000) / 1000;
    expect(r.cnss_salariale).toBe(expectedCNSS);
  });

  it('CNSS sans plafond (testé sur AAMRI brut 6261)', () => {
    const r = calculateSalary({ salaire_brut: 8000, situation_fam: 'C', nombre_enfants: 0 });
    const expectedCNSS = Math.round(Math.max(0, r.salaire_brut - r.prime_lait) * 0.0968 * 1000) / 1000;
    expect(r.cnss_salariale).toBe(expectedCNSS);
  });

  it('CNSS exclut prime_aid de l\'assiette', () => {
    const r = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0, prime_aid_plein: 40 });
    const expectedLait = 29.700;
    const expectedAid = 40;
    const expectedCNSS = Math.round(Math.max(0, r.salaire_brut - expectedLait - expectedAid) * 0.0968 * 1000) / 1000;
    expect(r.cnss_salariale).toBe(expectedCNSS);
    expect(r.prime_aid).toBe(expectedAid);
  });
});

// ============================================================================
// 2b. NUIT — heures_nuit × taux_horaire × 1.25
// ============================================================================
describe('Nuit — calcul horaire', () => {
  it('nuit = taux_horaire × heures × 1.25 quand heures_nuit > 0', () => {
    const r = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0, heures_nuit: 8 });
    const expectedTaux = 1000 / 190;
    const expectedNuit = Math.round(expectedTaux * 8 * 1.25 * 1000) / 1000;
    expect(r.prime_nuit).toBe(expectedNuit);
  });

  it('nuit = 0 quand heures_nuit = 0 et pas de plein', () => {
    const r = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0 });
    expect(r.prime_nuit).toBe(0);
  });

  it('nuit = fixe × coefficient en fallback (legacy)', () => {
    const r = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0, prime_nuit_plein: 50 });
    expect(r.prime_nuit).toBe(50); // coefficient = 1.0 (mois complet)
  });
});

// ============================================================================
// 3. IRPP — Bareme annuel 8 tranches
// ============================================================================
describe('IRPP — bareme annuel', () => {
  it('IRPP = 0 pour bas salaire', () => {
    const r = calculateSalary({ salaire_brut: 300, situation_fam: 'C', nombre_enfants: 0 });
    expect(r.irpp).toBe(0);
  });

  it('IRPP > 0 pour salaire moyen', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0 });
    expect(r.irpp).toBeGreaterThan(0);
    expect(r.irpp).toBeLessThan(50);
  });

  it('IRPP detail coherence annuelle', () => {
    const r = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0 });
    const totalDetail = r.irpp_detail.reduce((s, t) => s + t.impot, 0);
    expect(totalDetail / 12).toBeCloseTo(r.irpp, 2);
  });
});

// ============================================================================
// 4. CSS — 0.5% revenu net imposable (seuil 5000 DT/an, LF 2023 art. 22)
// ============================================================================
describe('CSS — 0.5% RNI, seuil 5000 DT/an', () => {
  it('CSS = 0.5% de revenu_net_imposable quand annuel >= 5000', () => {
    const r = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0 });
    // RNI ~ 900, annuel ~ 10800 >= 5000 → CSS = 0.5% × RNI
    expect(r.css_salariale).toBe(Math.round(r.revenu_net_imposable * 0.005 * 1000) / 1000);
  });

  it('CSS appliquée même pour salaire bas (pas de seuil 5000)', () => {
    // Validé sur données bulletin : Sage applique 0.5% même si annual < 5000
    const r = calculateSalary({ salaire_brut: 100, situation_fam: 'C', nombre_enfants: 0 });
    const expected = Math.round(r.revenu_net_imposable * 0.005 * 1000) / 1000;
    expect(r.css_salariale).toBe(expected);
  });

  it('CSS n est PAS sur le brut', () => {
    const r = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0 });
    const wrong = Math.round(r.salaire_brut * 0.005 * 1000) / 1000;
    expect(r.css_salariale).not.toBe(wrong);
  });
});

// ============================================================================
// 5. Frais pro — 10% plafond 2000 DT/an
// ============================================================================
describe('Frais professionnels', () => {
  it('plafond 166.67/mois pour haut salaire', () => {
    const r = calculateSalary({ salaire_brut: 5000, situation_fam: 'C', nombre_enfants: 0 });
    expect(r.frais_pro).toBe(Math.round((2000 / 12) * 1000) / 1000);
  });

  it('non plafond pour bas salaire', () => {
    const r = calculateSalary({ salaire_brut: 500, situation_fam: 'C', nombre_enfants: 0 });
    const expected = Math.round((r.revenu_imposable * 12 * 0.10 / 12) * 1000) / 1000;
    expect(r.frais_pro).toBe(expected);
  });
});

// ============================================================================
// 6. Anciennete
// ============================================================================
describe('calculateAnciennete', () => {
  it('0 an si meme annee', () => expect(calculateAnciennete('2025-06-15', 6, 2025)).toBe(0));
  it('1 an apres 13 mois', () => expect(calculateAnciennete('2024-05-15', 6, 2025)).toBe(1));
  it('3 ans exacts', () => expect(calculateAnciennete('2022-01-15', 6, 2025)).toBe(3));
  it('10 ans', () => expect(calculateAnciennete('2015-01-01', 6, 2025)).toBe(10));
  it('date vide = 0', () => expect(calculateAnciennete('', 6, 2025)).toBe(0));
});

describe('getTauxAnciennete', () => {
  it('0-2 ans = 0%', () => { expect(getTauxAnciennete(0)).toBe(0); expect(getTauxAnciennete(2)).toBe(0); });
  it('3-5 ans = 5%', () => { expect(getTauxAnciennete(3)).toBe(5); expect(getTauxAnciennete(5)).toBe(5); });
  it('6-8 ans = 10%', () => { expect(getTauxAnciennete(6)).toBe(10); expect(getTauxAnciennete(8)).toBe(10); });
  it('>= 9 ans = 15%', () => { expect(getTauxAnciennete(9)).toBe(15); expect(getTauxAnciennete(15)).toBe(15); });
});

// ============================================================================
// 7. Revalorisation legale — Decret n68/2026
// ============================================================================
describe('applyRevalorisation', () => {
  it('2026 = pas de revalorisation', () => expect(applyRevalorisation(1000, 2026)).toBe(1000));
  it('2027 = +5%', () => expect(applyRevalorisation(1000, 2027)).toBe(Math.round(1000 * 1.05 * 1000) / 1000));
  it('2028 = +10.25% cumulatif', () => expect(applyRevalorisation(1000, 2028)).toBe(Math.round(1000 * 1.05 * 1.05 * 1000) / 1000));
  it('2025 = pas de revalorisation', () => expect(applyRevalorisation(1000, 2025)).toBe(1000));
});

// ============================================================================
// 8. Calcul salaire — ordre correct
// ============================================================================
describe('Calcul salaire — ordre des operations', () => {
  it('brut = base_rev + HS + prime_anc + transport_rev×coeff + presence_rev×coeff + primes_légales×coeff', () => {
    const r = calculateSalary({
      salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0,
      date_recrutement: '2020-01-01', mois: 6, annee: 2026,
      transport_plein: 95.002,
    });
    expect(r.salaire_de_base).toBe(1000);
    expect(r.prime_anciennete).toBe(0); // ancienneté désactivée par défaut
    // Transport: 95.002 × 1.05 (reval juin 2026) × 1.0 (coeff = 1) = 99.752
    expect(r.ind_transport).toBe(99.752);
    // Presence: 8.249 (juin 2026) × 1.0 = 8.249
    expect(r.prime_presence).toBe(8.249);
    expect(r.coefficient_presence).toBe(1);
    // Brut includes all primes légales + MIT
    expect(r.salaire_brut).toBe(Math.round((1000 + 0 + 0 + 99.752 + 8.249
      + r.prime_panier + r.prime_douche + r.prime_savon + r.prime_lait + r.prime_logement + r.mit) * 1000) / 1000);
  });

  it('2028 : prime sur base revalorisée (anciennete disabled → 0)', () => {
    const r = calculateSalary({
      salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0,
      date_recrutement: '2020-01-01', mois: 6, annee: 2028,
    });
    const expectedBase = Math.round(1000 * 1.05 * 1.05 * 1000) / 1000;
    expect(r.salaire_de_base).toBe(expectedBase);
    expect(r.prime_anciennete).toBe(0); // anciennete_active: false
  });

  it('net = brut - cnss - irpp - css - avances', () => {
    const r = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0, avances: 50 });
    const expected = Math.round((r.salaire_brut - r.cnss_salariale - r.irpp - r.css_salariale - 50) * 1000) / 1000;
    expect(r.salaire_net).toBe(expected);
  });
});

// ============================================================================
// 9. Export Sage Paie 100
// ============================================================================
describe('Export Sage Paie 100', () => {
  const employees = [
    { matricule: '209070', nom: 'DALY', prenom: 'SONDES', nouveau_salaire_brut: 592.928, salaire_brut: 592.928 },
    { matricule: '209071', nom: 'ROUHI', prenom: 'Nabil', nouveau_salaire_brut: 800, salaire_brut: 800 },
  ];
  const results = new Map<string, SalaryResult>();
  results.set('209070', calculateSalary({ salaire_brut: 592.928, situation_fam: 'C', nombre_enfants: 0, date_recrutement: '2020-01-01', mois: 6, annee: 2026, transport_plein: 95.002 }));
  results.set('209071', calculateSalary({ salaire_brut: 800, situation_fam: 'M', nombre_enfants: 2, date_recrutement: '2018-06-01', mois: 6, annee: 2026, transport_plein: 100.533 }));

  it('genere des lignes', () => {
    const e = generateSagePaieExport(employees, [], results, 6, 2026, false);
    expect(e.rows.length).toBeGreaterThan(0);
    expect(e.summary.totalEmployees).toBe(2);
  });

  it('rubriques 1000, 3100, 3310, 3320 toujours presentes', () => {
    const e = generateSagePaieExport(employees, [], results, 6, 2026, false);
    const codes = e.rows.map(r => r.code_rubrique);
    expect(codes).toContain('1000');
    expect(codes).toContain('3100');
    expect(codes).toContain('3310');
    expect(codes).toContain('3320');
  });

  it('4120 ABSENTE quand disabled', () => {
    const e = generateSagePaieExport(employees, [], results, 6, 2026, false);
    expect(e.rows.map(r => r.code_rubrique)).not.toContain('4120');
  });

  it('4120 ABSENTE quand anciennete_active false (même si primeAncienneteEnabled=true)', () => {
    const e = generateSagePaieExport(employees, [], results, 6, 2026, true);
    expect(e.rows.map(r => r.code_rubrique)).not.toContain('4120');
  });

  it('format colonnes correct', () => {
    const e = generateSagePaieExport(employees, [], results, 6, 2026, false);
    for (const row of e.rows) {
      expect(row.matricule).toBeTruthy();
      expect(row.code_rubrique).toBeTruthy();
      expect(row.libelle).toBeTruthy();
      expect(typeof row.valeur).toBe('number');
      expect(row.periode).toBe('06/2026');
    }
  });

  it('pas de rubrique 5100 alloc familiales (absent chez STE BAUD)', () => {
    const e = generateSagePaieExport(employees, [], results, 6, 2026, false);
    const allocRows = e.rows.filter(r => r.code_rubrique === '5100');
    expect(allocRows.length).toBe(0);
  });
});

// ============================================================================
// 10. Rapport de controle
// ============================================================================
describe('Rapport de controle', () => {
  it('detecte ecarts brut > 10%', () => {
    const employees = [{ matricule: 'T1', nom: 'TEST', prenom: 'Ecart', nouveau_salaire_brut: 1000, salaire_brut: 1000 }];
    const results = new Map<string, SalaryResult>();
    results.set('T1', calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0, date_recrutement: '2020-01-01', mois: 6, annee: 2026, transport_plein: 95.002 }));
    const e = generateSagePaieExport(employees, [], results, 6, 2026, false);
    expect(e.controlReport.filter(c => c.type === 'warning').length).toBeGreaterThan(0);
  });

  it('detecte matricule trop court', () => {
    const employees = [{ matricule: 'T', nom: 'TEST', prenom: 'Short', nouveau_salaire_brut: 500, salaire_brut: 500 }];
    const results = new Map<string, SalaryResult>();
    results.set('T', calculateSalary({ salaire_brut: 500, situation_fam: 'C', nombre_enfants: 0 }));
    const e = generateSagePaieExport(employees, [], results, 6, 2026, false);
    expect(e.controlReport.filter(c => c.message.includes('Matricule')).length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 11. Validation DALY SONDES — bulletin juin 2026
// ============================================================================
describe('Validation DALY SONDES juin 2026', () => {
  it('composants brut corrects', () => {
    const r = calculateSalary({
      salaire_brut: 592.928, situation_fam: 'C', nombre_enfants: 0,
      date_recrutement: '2020-01-01', mois: 6, annee: 2026,
      transport_plein: 95.002,
    });
    expect(r.salaire_de_base).toBe(592.928);
    // Transport revalorisé juin 2026: 95.002 × 1.05 = 99.752
    expect(r.ind_transport).toBe(99.752);
    expect(r.prime_presence).toBe(8.249);
    expect(r.taux_anciennete).toBe(0); // ancienneté désactivée
    expect(r.prime_anciennete).toBe(0);
  });

  it('CNSS correct (excluant lait)', () => {
    const r = calculateSalary({
      salaire_brut: 592.928, situation_fam: 'C', nombre_enfants: 0,
      date_recrutement: '2020-01-01', mois: 6, annee: 2026,
      transport_plein: 95.002,
    });
    const expectedLait = 29.700;
    expect(r.cnss_salariale).toBe(Math.round(Math.max(0, r.salaire_brut - expectedLait) * 0.0968 * 1000) / 1000);
  });

  it('IRPP detail coherent', () => {
    const r = calculateSalary({
      salaire_brut: 592.928, situation_fam: 'C', nombre_enfants: 0,
      date_recrutement: '2020-01-01', mois: 6, annee: 2026,
    });
    expect(r.irpp_detail.length).toBeGreaterThan(0);
    const totalDetail = r.irpp_detail.reduce((s, t) => s + t.impot, 0);
    expect(totalDetail / 12).toBeCloseTo(r.irpp, 2);
  });
});

// ============================================================================
// 12. TOUS LES MOIS (1-8) et TOUS LES SALARIES — test d'integration
// ============================================================================
describe('Integration — tous les mois et tous les salaries', () => {
  const testEmployees = [
    { matricule: '209070', nom: 'DALY', prenom: 'SONDES', situation_fam: 'C' as const, nombre_enfants: 0, sexe: 'H' as const, date_recrutement: '2020-01-01', salaire_brut: 592.928, nouveau_salaire_brut: 592.928, transport_plein: 95.002, heures_nuit: 0 },
    { matricule: '209071', nom: 'ROUHI', prenom: 'Nabil', situation_fam: 'M' as const, nombre_enfants: 2, sexe: 'H' as const, date_recrutement: '2018-06-01', salaire_brut: 800, nouveau_salaire_brut: 800, transport_plein: 100.533, heures_nuit: 0 },
    { matricule: '209072', nom: 'BACCOUCHE', prenom: 'Tahar', situation_fam: 'M' as const, nombre_enfants: 3, sexe: 'H' as const, date_recrutement: '2015-03-01', salaire_brut: 750, nouveau_salaire_brut: 750, transport_plein: 92.800, heures_nuit: 0 },
    { matricule: '209073', nom: 'ZAYANI', prenom: 'Majed', situation_fam: 'C' as const, nombre_enfants: 0, sexe: 'H' as const, date_recrutement: '2022-09-01', salaire_brut: 650, nouveau_salaire_brut: 650, transport_plein: 95.002, heures_nuit: 0 },
    { matricule: '209074', nom: 'BEN SLIMENE', prenom: 'Karim', situation_fam: 'M' as const, nombre_enfants: 1, sexe: 'H' as const, date_recrutement: '2010-01-01', salaire_brut: 400, nouveau_salaire_brut: 400, transport_plein: 92.800, heures_nuit: 0 },
    { matricule: '209075', nom: 'AAMRI', prenom: 'Moatez', situation_fam: 'C' as const, nombre_enfants: 0, sexe: 'H' as const, date_recrutement: '2023-06-01', salaire_brut: 6008.771, nouveau_salaire_brut: 6008.771, transport_plein: 100.533, heures_nuit: 0 },
  ];

  const mois = [1, 2, 3, 4, 5, 6, 7, 8];
  const annee = 2026;

  it.each(mois)('Mois %i — tous les salaries calculables sans erreur', (moisCourant) => {
    const results = new Map<string, SalaryResult>();
    const errors: string[] = [];

    for (const emp of testEmployees) {
      try {
        const r = calculateSalary({
          salaire_brut: emp.salaire_brut,
          situation_fam: emp.situation_fam,
          nombre_enfants: emp.nombre_enfants,
          sexe: emp.sexe,
          date_recrutement: emp.date_recrutement,
          mois: moisCourant,
          annee,
          transport_plein: emp.transport_plein,
        });
        results.set(emp.matricule, r);

        expect(r.salaire_brut).toBeGreaterThanOrEqual(0);
        expect(r.cnss_salariale).toBeGreaterThanOrEqual(0);
        expect(r.irpp).toBeGreaterThanOrEqual(0);
        expect(r.css_salariale).toBeGreaterThanOrEqual(0);
        expect(r.salaire_net).toBeGreaterThanOrEqual(0);
        expect(r.net_a_payer).toBeGreaterThanOrEqual(0);

        const expectedLait = 29.700;
        const expectedCNSS = Math.round(Math.max(0, r.salaire_brut - expectedLait) * 0.0968 * 1000) / 1000;
        expect(r.cnss_salariale).toBe(expectedCNSS);

        const expectedCSS = Math.round(r.revenu_net_imposable * 0.005 * 1000) / 1000;
        expect(r.css_salariale).toBe(expectedCSS);

        expect(r.frais_pro).toBeLessThanOrEqual(Math.round((2000 / 12) * 1000) / 1000);

        const totalDetail = r.irpp_detail.reduce((s, t) => s + t.impot, 0);
        expect(totalDetail / 12).toBeCloseTo(r.irpp, 2);

        const expectedNet = Math.round((r.salaire_brut - r.total_retenues) * 1000) / 1000;
        expect(r.salaire_net).toBe(expectedNet);

        expect(r.ind_transport).toBeGreaterThan(0);
        expect(r.prime_presence).toBeGreaterThan(0);

      } catch (e: any) {
        errors.push(`${emp.matricule} ${emp.nom}: ${e.message}`);
      }
    }

    expect(errors).toEqual([]);
    expect(results.size).toBe(testEmployees.length);
  });

  it.each(mois)('Mois %i — export Sage genere pour tous les salaries', (moisCourant) => {
    const results = new Map<string, SalaryResult>();
    for (const emp of testEmployees) {
      results.set(emp.matricule, calculateSalary({
        salaire_brut: emp.salaire_brut,
        situation_fam: emp.situation_fam,
        nombre_enfants: emp.nombre_enfants,
        sexe: emp.sexe,
        date_recrutement: emp.date_recrutement,
        mois: moisCourant,
        annee,
        transport_plein: emp.transport_plein,
      }));
    }

    const exportResult = generateSagePaieExport(testEmployees, [], results, moisCourant, annee, false);

    expect(exportResult.rows.length).toBeGreaterThan(0);
    expect(exportResult.summary.totalEmployees).toBe(testEmployees.length);

    const periodeAttendue = `${String(moisCourant).padStart(2, '0')}/${annee}`;
    for (const row of exportResult.rows) {
      expect(row.periode).toBe(periodeAttendue);
    }

    for (const emp of testEmployees) {
      const empRows = exportResult.rows.filter(r => r.matricule === emp.matricule);
      const codes = empRows.map(r => r.code_rubrique);
      expect(codes).toContain('1000');
      expect(codes).toContain('3100');
      expect(codes).toContain('3310');
      expect(codes).toContain('3320');
    }
  });

  it.each(mois)('Mois %i — verification IA sans erreur critique', (moisCourant) => {
    const employees = testEmployees.map(e => ({
      ...e,
      cin: '', date_naissance: '',
      echelon: '', categorie: '', badges: '', fonction: 'Ouvrier',
      adresse: '', type_contrat: 'CDI', duree: '', numero_cnss: '12345678',
      bq_ou_poste: '', rib_ou_ccp: 'TN5901234567890123456789',
      date_sortie: '',
    }));

    const results = new Map<string, SalaryResult>();
    for (const emp of testEmployees) {
      results.set(emp.matricule, calculateSalary({
        salaire_brut: emp.salaire_brut,
        situation_fam: emp.situation_fam,
        nombre_enfants: emp.nombre_enfants,
        sexe: emp.sexe,
        date_recrutement: emp.date_recrutement,
        mois: moisCourant,
        annee,
        transport_plein: emp.transport_plein,
      }));
    }

    const verification = verifySalaryCalculations(employees, [], results);

    const criticalErrors = verification.checks.filter(c =>
      c.status === 'error' && !c.name.includes('SMIG') && !c.name.includes('Salaire < SMIG')
    );
    expect(criticalErrors).toEqual([]);

    expect(verification.summary.verified).toBe(testEmployees.length);
  });
});

// ============================================================================
// 13. Revalorisation progressive sur 3 ans (2026-2028)
// ============================================================================
describe('Revalorisation progressive 2026-2028', () => {
  const base = 1000;

  it('2026 : base identique', () => {
    const r = calculateSalary({ salaire_brut: base, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 });
    expect(r.salaire_de_base).toBe(base);
  });

  it('2027 : base +5%', () => {
    const r = calculateSalary({ salaire_brut: base, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2027 });
    expect(r.salaire_de_base).toBe(Math.round(base * 1.05 * 1000) / 1000);
  });

  it('2028 : base +10.25% cumulatif', () => {
    const r = calculateSalary({ salaire_brut: base, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2028 });
    expect(r.salaire_de_base).toBe(Math.round(base * 1.05 * 1.05 * 1000) / 1000);
  });

  it('transport revalorisé en 2028', () => {
    const r = calculateSalary({ salaire_brut: base, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2028, transport_plein: 100 });
    // transport_plein = 100, reval 2028 = 1.05^3 = 1.157625, coeff = 1.0
    expect(r.ind_transport).toBe(Math.round(100 * Math.pow(1.05, 3) * 1.0 * 1000) / 1000);
  });
});

// ============================================================================
// 14. Primes légales — Convention BTP (système unifié proratisation)
// ============================================================================
describe('Primes légales — Convention BTP', () => {
  it('panier = plein × coefficient (12.320 × 20/22 avec 2 absences en juin)', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, absences_jours: 2 });
    const coeff = Math.round((20 / 22) * 10000) / 10000;
    expect(r.coefficient_presence).toBeCloseTo(coeff, 4);
    expect(r.prime_panier).toBe(Math.round(12.320 * coeff * 1000) / 1000);
  });

  it('douche = plein × coefficient (25.000 × 1.0 = 25.000)', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 });
    expect(r.prime_douche).toBe(25.000);
  });

  it('savon = plein × coefficient (5.400 × 1.0 = 5.400)', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 });
    expect(r.prime_savon).toBe(5.400);
  });

  it('lait = plein × coefficient (29.700 × 1.0 = 29.700)', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 });
    expect(r.prime_lait).toBe(29.700);
  });

  it('nuit = plein × coefficient (0 si non renseigné)', () => {
    const r1 = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 });
    expect(r1.prime_nuit).toBe(0);
    const r2 = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, prime_nuit_plein: 70 });
    expect(r2.prime_nuit).toBe(70);
  });

  it('logement = plein × coefficient (26.293 × 1.0 = 26.293)', () => {
    const r1 = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 });
    expect(r1.prime_logement).toBe(26.293);
    const r2 = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, prime_logement_plein: 0 });
    expect(r2.prime_logement).toBe(0);
  });

  it('MIT = 5.000 DT × coefficient (montant fixe, PAS un %)', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 });
    // coefficient = 1.0 (mois complet), MIT = 5.000 × 1.0
    expect(r.mit).toBe(5.000);
  });

  it('MIT = 0 quand mit_applicable = false', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, mit_applicable: false });
    expect(r.mit).toBe(0);
  });

  it('CNSS exclut lait et prime_aid de l\'assiette (Décret 2003-1098 art. 11)', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 });
    const expectedLait = 29.700;
    const expectedAssiette = Math.max(0, r.salaire_brut - expectedLait);
    expect(r.assiette_cnss).toBe(expectedAssiette);
    expect(r.cnss_salariale).toBe(Math.round(expectedAssiette * 0.0968 * 1000) / 1000);
  });

  it('brut inclut toutes les primes légales proratisées (HS via heures, rappel=0 par défaut)', () => {
    const r = calculateSalary({
      salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026,
      prime_nuit_plein: 70, prime_logement_plein: 25,
      transport_plein: 95.002,
    });
    // coeff = 1.0, presence = 8.249, transport revalorisé juin 2026: 95.002 × 1.05 = 99.752
    // nuit = 70 × 1.0 = 70 (incluse dans le brut Total bulletin)
    const expectedBrut = Math.round((
      600 + 99.752 + 8.249
      + 12.320 + 25.000 + 5.400 + 29.700 + 25 + 70 + 5.000
    ) * 1000) / 1000;
    expect(r.salaire_brut).toBe(expectedBrut);
  });

  it('augmentation = fixe × coefficient (0 si non renseigné)', () => {
    const r1 = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 });
    expect(r1.augmentation).toBe(0);
    const r2 = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, augmentation: 200 });
    expect(r2.augmentation).toBe(200);
  });

  it('augmentation incluse dans le brut total', () => {
    const r = calculateSalary({
      salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026,
      augmentation: 200, transport_plein: 95.002,
    });
    const expectedBrut = Math.round((
      600 + 99.752 + 8.249
      + 12.320 + 25.000 + 5.400 + 29.700 + 26.293 + 200 + 5.000
    ) * 1000) / 1000;
    expect(r.salaire_brut).toBe(expectedBrut);
  });

  it('augmentation incluse dans assiette CNSS', () => {
    const r = calculateSalary({
      salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026,
      augmentation: 200,
    });
    const expectedLait = 29.700;
    const expectedAssiette = Math.max(0, r.salaire_brut - expectedLait);
    expect(r.assiette_cnss).toBe(expectedAssiette);
    expect(r.cnss_salariale).toBe(Math.round(expectedAssiette * 0.0968 * 1000) / 1000);
  });

  it('export Sage inclut rubrique 4100 quand augmentation > 0', () => {
    const employees = [{ matricule: 'T1', nom: 'TEST', prenom: 'Aug', nouveau_salaire_brut: 600, salaire_brut: 600 }];
    const results = new Map<string, SalaryResult>();
    results.set('T1', calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, augmentation: 200 }));
    const e = generateSagePaieExport(employees, [], results, 6, 2026, false);
    const augRows = e.rows.filter(r => r.code_rubrique === '4100');
    expect(augRows.length).toBe(1);
    expect(augRows[0].valeur).toBe(200);
  });

  it('export Sage n\'inclut pas 4100 quand augmentation = 0', () => {
    const employees = [{ matricule: 'T1', nom: 'TEST', prenom: 'NoAug', nouveau_salaire_brut: 600, salaire_brut: 600 }];
    const results = new Map<string, SalaryResult>();
    results.set('T1', calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 }));
    const e = generateSagePaieExport(employees, [], results, 6, 2026, false);
    const augRows = e.rows.filter(r => r.code_rubrique === '4100');
    expect(augRows.length).toBe(0);
  });
});

// ============================================================================
// 14b. calculateJoursOuvres — jours ouvrés par mois
// ============================================================================
describe('calculateJoursOuvres', () => {
  it('juin 2026 = 22 jours ouvrés (weekdays, sans soustraction fériés)', () => {
    expect(calculateJoursOuvres(6, 2026)).toBe(22);
  });
  it('janvier 2026 = 22 jours ouvrés (22 weekdays)', () => {
    expect(calculateJoursOuvres(1, 2026)).toBe(22);
  });
  it('mars 2026 = 22 jours ouvrés (22 weekdays, bulletin confirme)', () => {
    expect(calculateJoursOuvres(3, 2026)).toBe(22);
  });
  it('tous les mois retournent un nombre valide', () => {
    for (let m = 1; m <= 12; m++) {
      const wd = calculateJoursOuvres(m, 2026);
      expect(wd).toBeGreaterThanOrEqual(18);
      expect(wd).toBeLessThanOrEqual(25);
    }
  });
});

// ============================================================================
// 15. Coefficient de présence — tests spécifiques
// ============================================================================
describe('Coefficient de présence', () => {
  it('mois complet = coefficient 1.0', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 });
    expect(r.coefficient_presence).toBe(1);
  });

  it('2 absences = coefficient 20/22 (juin = 22 jours ouvrés)', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, absences_jours: 2 });
    const coeff = Math.round((20 / 22) * 10000) / 10000;
    expect(r.coefficient_presence).toBeCloseTo(coeff, 4);
    expect(r.prime_panier).toBe(Math.round(12.320 * coeff * 1000) / 1000);
  });

  it('jours_payes explicite prioritaire sur absences', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 3, annee: 2026, jours_payes: 10, jours_ouvrables: 11 });
    expect(r.coefficient_presence).toBeCloseTo(10 / 11, 4);
  });

  it('toutes les primes proratisées uniformément', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, absences_jours: 5 });
    const coeff = Math.round((17 / 22) * 10000) / 10000;
    expect(r.coefficient_presence).toBeCloseTo(coeff, 4);
    expect(r.prime_panier).toBe(Math.round(12.320 * coeff * 1000) / 1000);
    expect(r.prime_douche).toBe(Math.round(25.000 * coeff * 1000) / 1000);
    expect(r.prime_savon).toBe(Math.round(5.400 * coeff * 1000) / 1000);
    expect(r.prime_lait).toBe(Math.round(29.700 * coeff * 1000) / 1000);
    expect(r.prime_logement).toBe(Math.round(26.293 * coeff * 1000) / 1000);
  });

  it('transport revalorisé ET proratisé', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, transport_plein: 100, absences_jours: 2 });
    const coeff = Math.round((20 / 22) * 10000) / 10000;
    // Transport revalorisé juin 2026: 100 × 1.05 × coeff
    expect(r.ind_transport).toBe(Math.round(100 * 1.05 * coeff * 1000) / 1000);
  });

  it('présence revalorisée (juin 2026) ET proratisée', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, absences_jours: 2 });
    const coeff = Math.round((20 / 22) * 10000) / 10000;
    expect(r.prime_presence).toBe(Math.round(8.249 * coeff * 1000) / 1000);
  });

  it('MIT calculé sur coefficient (montant fixe 5.000 × coeff)', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, absences_jours: 2 });
    const coeff = Math.round((20 / 22) * 10000) / 10000;
    expect(r.mit).toBe(Math.round(5.000 * coeff * 1000) / 1000);
  });

  it('augmentation proratisée SANS revalorisation', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2028, augmentation: 100, absences_jours: 2 });
    const coeff = Math.round((20 / 22) * 10000) / 10000;
    expect(r.augmentation).toBe(Math.round(100 * coeff * 1000) / 1000);
  });

  it('nuit proratisée par coefficient', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, prime_nuit_plein: 100, absences_jours: 5 });
    const coeff = Math.round((17 / 22) * 10000) / 10000;
    expect(r.prime_nuit).toBe(Math.round(100 * coeff * 1000) / 1000);
  });
});

// ============================================================================
// 14. CSS — validation (janvier 2026)
//     Formule validée : CSS = 0.5% × RNI (imposable − frais_pro)
//     Aucune déduction familiale, aucun seuil 5000 DT (validé sur 219 obs)
// ============================================================================
describe('CSS — validation (janvier 2026)', () => {
  it('CSS = 0.5% × RNI sans déductions ni seuil', () => {
    const r = calculateSalary({
      salaire_brut: 750, situation_fam: 'M', nombre_enfants: 5, sexe: 'H',
      date_recrutement: '2015-03-01', mois: 1, annee: 2026,
      transport_plein: 92.800,
    });
    const expectedCSS = Math.round(r.revenu_net_imposable * 0.005 * 1000) / 1000;
    expect(r.css_salariale).toBe(expectedCSS);
  });

  it('CSS même pour salaire bas (pas de seuil 5000)', () => {
    const r = calculateSalary({
      salaire_brut: 300, situation_fam: 'C', nombre_enfants: 0, sexe: 'H',
      mois: 1, annee: 2026,
    });
    // CSS toujours appliquée, même si annual RNI < 5000
    const expectedCSS = Math.round(r.revenu_net_imposable * 0.005 * 1000) / 1000;
    expect(r.css_salariale).toBe(expectedCSS);
  });

  it('CSS indépendante du sexe et situation familiale', () => {
    const inputs = [
      { situation_fam: 'M', nombre_enfants: 3, sexe: 'H' },
      { situation_fam: 'M', nombre_enfants: 3, sexe: 'F' },
      { situation_fam: 'C', nombre_enfants: 0, sexe: 'H' },
    ];
    const results = inputs.map(inp => calculateSalary({
      salaire_brut: 750, ...inp,
      date_recrutement: '2020-01-01', mois: 1, annee: 2026,
      transport_plein: 92.800,
    }));
    // Tous doivent avoir le même CSS (même imposable → même RNI)
    const cssValues = results.map(r => r.css_salariale);
    expect(cssValues[0]).toBe(cssValues[1]);
    expect(cssValues[0]).toBe(cssValues[2]);
  });
});

// ============================================================================
// 15. TÂCHE 4 — Tests priorité salaire_brut vs nouveau_salaire_brut
//     (logique du composant BaudDossierPage, testée ici via le calculator)
// ============================================================================
describe('TÂCHE 4 — Priorité salaire_brut / nouveau_salaire_brut', () => {
  // T4.1 : salaire_manually_edited=true → nouveau_salaire_brut prime
  it('T4.1: edit manuel du salaire → utilise nouveau_salaire_brut', () => {
    // Simule : employé avec salaire_brut=750, nouveau_salaire_brut=800, edited=true
    // Le calcul doit utiliser 800 (nouveau_salaire_brut) car edited=true
    const r = calculateSalary({
      salaire_brut: 800, // nouveau_salaire_brut (car salaire_manually_edited=true)
      situation_fam: 'C', nombre_enfants: 0,
      mois: 1, annee: 2026,
    });
    const rOriginal = calculateSalary({
      salaire_brut: 750, // salaire_brut d'origine (import Excel)
      situation_fam: 'C', nombre_enfants: 0,
      mois: 1, annee: 2026,
    });
    // Le brut édité (800) doit donner un salaire de base plus élevé
    expect(r.salaire_de_base).toBeGreaterThan(rOriginal.salaire_de_base);
  });

  // T4.2 : salaire_manually_edited=false (défaut) → salaire_brut d'import prime
  it('T4.2: pas d\'edit manuel → utilise salaire_brut d\'import Excel', () => {
    // Simule : employé avec salaire_brut=750, nouveau_salaire_brut=800, edited=false
    // Le calcul doit utiliser 750 (salaire_brut) car edited=false
    const r = calculateSalary({
      salaire_brut: 750, // salaire_brut d'import (pas édité manuellement)
      situation_fam: 'C', nombre_enfants: 0,
      mois: 1, annee: 2026,
    });
    const rNouveau = calculateSalary({
      salaire_brut: 800,
      situation_fam: 'C', nombre_enfants: 0,
      mois: 1, annee: 2026,
    });
    // Le brut d'import (750) doit donner un salaire plus bas que 800
    expect(r.salaire_de_base).toBeLessThan(rNouveau.salaire_de_base);
    expect(r.salaire_de_base).toBe(750);
  });

  // T4.3 : éditer un champ NON-salaire ne doit pas toucher nouveau_salaire_brut
  // (vérifie que salaire_manually_edited reste false si on édite SF/NE/fonction)
  it('T4.3: édition SF/NE ne change pas le salaire de base', () => {
    // Même salaire_brut, mais situation_fam change de C → M avec enfants
    const rCelib = calculateSalary({
      salaire_brut: 750, situation_fam: 'C', nombre_enfants: 0,
      mois: 1, annee: 2026,
    });
    const rMarie = calculateSalary({
      salaire_brut: 750, situation_fam: 'M', nombre_enfants: 3,
      sexe: 'H',
      mois: 1, annee: 2026,
    });
    // Le salaire de base est IDENTIQUE — seul le brut détermine le salaire_de_base
    expect(rCelib.salaire_de_base).toBe(rMarie.salaire_de_base);
    // Les retenues salariales (CNSS) sont identiques
    expect(rCelib.cnss_salariale).toBe(rMarie.cnss_salariale);
    // L'IRPP peut varier légèrement (barème), mais le brut ne change PAS
    expect(rCelib.salaire_brut).toBe(rMarie.salaire_brut);
  });

  // T4.4 : HeuresNuit clé composit mois+matricule — janvier ≠ février
  it('T4.4: HeuresNuit isolées par mois (clé composit)', () => {
    // Même employé, même salaire, mais H.Nuit différentes par mois
    const base = { salaire_brut: 750, situation_fam: 'C', nombre_enfants: 0, date_recrutement: '2020-01-01' };
    const rJan = calculateSalary({ ...base, mois: 1, annee: 2026, heures_nuit: 10 });
    const rFeb = calculateSalary({ ...base, mois: 2, annee: 2026, heures_nuit: 0 });
    const rFebNuit = calculateSalary({ ...base, mois: 2, annee: 2026, heures_nuit: 20 });

    // Janvier avec 10h nuit → prime_nuit > 0
    expect(rJan.prime_nuit).toBeGreaterThan(0);
    // Février sans nuit → prime_nuit = 0
    expect(rFeb.prime_nuit).toBe(0);
    // Février avec 20h nuit → prime_nuit > Janvier
    expect(rFebNuit.prime_nuit).toBeGreaterThan(rJan.prime_nuit);
  });

  // T4.5 : Même employé, H.Nuit de janvier ne doit PAS apparaître en février
  it('T4.5: H.Nuit janvier ne fuite pas sur février', () => {
    const base = { salaire_brut: 750, situation_fam: 'C', nombre_enfants: 0, date_recrutement: '2020-01-01' };
    // Simule la clé composit : keyed["1-EMP001"] = 10, keyed["2-EMP001"] = 0
    const keyed: Record<string, number> = { '1-EMP001': 10, '2-EMP001': 0 };

    const nuitJan = keyed['1-EMP001'] || 0; // = 10
    const nuitFeb = keyed['2-EMP001'] || 0; // = 0

    const rJan = calculateSalary({ ...base, mois: 1, annee: 2026, heures_nuit: nuitJan });
    const rFeb = calculateSalary({ ...base, mois: 2, annee: 2026, heures_nuit: nuitFeb });

    expect(rJan.prime_nuit).toBeGreaterThan(0);
    expect(rFeb.prime_nuit).toBe(0);
  });
});

// ============================================================================
// Tests détaillés par mois (1-8) — coeff 22j fixes, revalorisation juil 2026
// ============================================================================
describe('Tests par mois — détail complet', () => {
  const JOURS = 22; // fixe

  // Helper: calcule un salaire de base pour un mois donné
  function calc(mois: number, opts?: { absences?: number; jours_payes?: number }) {
    return calculateSalary({
      salaire_brut: 1000,
      situation_fam: 'M',
      nombre_enfants: 2,
      mois,
      annee: 2026,
      transport_plein: 100,
      absences_jours: opts?.absences,
      jours_payes: opts?.jours_payes,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // MOIS 1 — Janvier 2026
  // ─────────────────────────────────────────────────────────────────────
  describe('Janvier (mois 1) — pas de revalorisation', () => {
    it('coefficient 1.0 sans absence', () => {
      const r = calc(1);
      expect(r.coefficient_presence).toBe(1);
    });

    it('coefficient = 20/22 avec 2 absences', () => {
      const r = calc(1, { absences: 2 });
      const expected = Math.round((20 / 22) * 10000) / 10000;
      expect(r.coefficient_presence).toBeCloseTo(expected, 4);
    });

    it('transport = 100 × coeff (pas de revalorisation)', () => {
      const r = calc(1);
      expect(r.ind_transport).toBe(100);
    });

    it('transport avec absences = 100 × coeff', () => {
      const r = calc(1, { absences: 2 });
      const coeff = Math.round((20 / 22) * 10000) / 10000;
      expect(r.ind_transport).toBe(Math.round(100 * coeff * 1000) / 1000);
    });

    it('présence = 7.856 (avant juin)', () => {
      const r = calc(1);
      expect(r.prime_presence).toBe(7.856);
    });

    it('présence avec absences = 7.856 × coeff', () => {
      const r = calc(1, { absences: 5 });
      const coeff = Math.round((17 / 22) * 10000) / 10000;
      expect(r.prime_presence).toBe(Math.round(7.856 * coeff * 1000) / 1000);
    });

    it('CNSS = 9.68% × (brut − lait)', () => {
      const r = calc(1);
      const expected = Math.round(Math.max(0, r.salaire_brut - r.prime_lait) * 0.0968 * 1000) / 1000;
      expect(r.cnss_salariale).toBe(expected);
    });

    it('CSS = 0.5% × RNI', () => {
      const r = calc(1);
      const rni = Math.max(0, r.revenu_imposable - r.frais_pro);
      const expected = Math.round(rni * 0.005 * 1000) / 1000;
      expect(r.css_salariale).toBe(expected);
    });

    it('brut total contient base + transport + présence + primes_légales + MIT', () => {
      const r = calc(1);
      const expectedBrut = Math.round((
        r.salaire_de_base
        + r.majoration_hs
        + r.prime_anciennete
        + r.ind_transport
        + r.prime_presence
        + r.prime_panier
        + r.prime_douche
        + r.prime_savon
        + r.prime_lait
        + r.prime_logement
        + r.augmentation
        + r.mit
      ) * 1000) / 1000;
      expect(r.salaire_brut).toBe(expectedBrut);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // MOIS 2 — Février 2026
  // ─────────────────────────────────────────────────────────────────────
  describe('Février (mois 2) — pas de revalorisation', () => {
    it('coefficient 1.0 sans absence', () => {
      const r = calc(2);
      expect(r.coefficient_presence).toBe(1);
    });

    it('coefficient = 19/20 avec 1 absence (février = 20 jours ouvrés)', () => {
      const r = calc(2, { absences: 1 });
      const jours = calculateJoursOuvres(2, 2026);
      const expected = Math.round(((jours - 1) / jours) * 10000) / 10000;
      expect(r.coefficient_presence).toBeCloseTo(expected, 4);
    });

    it('transport = 100 (pas de revalorisation)', () => {
      const r = calc(2);
      expect(r.ind_transport).toBe(100);
    });

    it('présence = 7.856', () => {
      const r = calc(2);
      expect(r.prime_presence).toBe(7.856);
    });

    it('IRPP > 0 pour salaire 1000', () => {
      const r = calc(2);
      expect(r.irpp).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // MOIS 3 — Mars 2026
  // ─────────────────────────────────────────────────────────────────────
  describe('Mars (mois 3) — pas de revalorisation', () => {
    it('coefficient 1.0 sans absence', () => {
      const r = calc(3);
      expect(r.coefficient_presence).toBe(1);
    });

    it('coefficient = 17/22 avec 5 absences', () => {
      const r = calc(3, { absences: 5 });
      const expected = Math.round((17 / 22) * 10000) / 10000;
      expect(r.coefficient_presence).toBeCloseTo(expected, 4);
    });

    it('toutes les primes proratisées avec 5 absences', () => {
      const r = calc(3, { absences: 5 });
      const coeff = Math.round((17 / 22) * 10000) / 10000;
      expect(r.prime_panier).toBe(Math.round(12.320 * coeff * 1000) / 1000);
      expect(r.prime_douche).toBe(Math.round(25.000 * coeff * 1000) / 1000);
      expect(r.prime_savon).toBe(Math.round(5.400 * coeff * 1000) / 1000);
      expect(r.prime_lait).toBe(Math.round(29.700 * coeff * 1000) / 1000);
      expect(r.prime_logement).toBe(Math.round(26.293 * coeff * 1000) / 1000);
      expect(r.mit).toBe(Math.round(5.000 * coeff * 1000) / 1000);
    });

    it('net a payer = net (pas alloc STE BAUD)', () => {
      const r = calc(3);
      expect(r.net_a_payer).toBe(r.salaire_net);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // MOIS 4 — Avril 2026
  // ─────────────────────────────────────────────────────────────────────
  describe('Avril (mois 4) — pas de revalorisation', () => {
    it('coefficient 1.0 sans absence', () => {
      const r = calc(4);
      expect(r.coefficient_presence).toBe(1);
    });

    it('transport = 100 (pas revalorisé)', () => {
      const r = calc(4);
      expect(r.ind_transport).toBe(100);
    });

    it('présence = 7.856', () => {
      const r = calc(4);
      expect(r.prime_presence).toBe(7.856);
    });

    it('frais pro = 10% imposable, plafonné 166.67/mois', () => {
      const r = calc(4);
      const expected = Math.round(Math.min(r.revenu_imposable * 12 * 0.10, 2000) / 12 * 1000) / 1000;
      expect(r.frais_pro).toBe(expected);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // MOIS 5 — Mai 2026
  // ─────────────────────────────────────────────────────────────────────
  describe('Mai (mois 5) — pas de revalorisation', () => {
    it('coefficient 1.0 sans absence', () => {
      const r = calc(5);
      expect(r.coefficient_presence).toBe(1);
    });

    it('résultat identique à janvier (même salaire, même regime)', () => {
      const rJan = calc(1);
      const rMai = calc(5);
      expect(rMai.salaire_de_base).toBe(rJan.salaire_de_base);
      expect(rMai.ind_transport).toBe(rJan.ind_transport);
      expect(rMai.prime_presence).toBe(rJan.prime_presence);
      expect(rMai.cnss_salariale).toBe(rJan.cnss_salariale);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // MOIS 6 — Juin 2026 (début revalorisation)
  // ─────────────────────────────────────────────────────────────────────
  describe('Juin (mois 6) — revalorisation +5% appliquée', () => {
    it('coefficient 1.0 sans absence', () => {
      const r = calc(6);
      expect(r.coefficient_presence).toBe(1);
    });

    it('transport revalorisé = 100 × 1.05', () => {
      const r = calc(6);
      expect(r.ind_transport).toBe(Math.round(100 * 1.05 * 1000) / 1000);
    });

    it('présence = 8.249 (depuis juin)', () => {
      const r = calc(6);
      expect(r.prime_presence).toBe(8.249);
    });

    it('transport avec absences = 100 × 1.05 × coeff', () => {
      const r = calc(6, { absences: 2 });
      const coeff = Math.round((20 / 22) * 10000) / 10000;
      expect(r.ind_transport).toBe(Math.round(100 * 1.05 * coeff * 1000) / 1000);
    });

    it('présence avec absences = 8.249 × coeff', () => {
      const r = calc(6, { absences: 2 });
      const coeff = Math.round((20 / 22) * 10000) / 10000;
      expect(r.prime_presence).toBe(Math.round(8.249 * coeff * 1000) / 1000);
    });

    it('CNSS = 9.68% × (brut − lait)', () => {
      const r = calc(6);
      const expected = Math.round(Math.max(0, r.salaire_brut - r.prime_lait) * 0.0968 * 1000) / 1000;
      expect(r.cnss_salariale).toBe(expected);
    });

    it('brut juin > brut janvier (revalorisation)', () => {
      const rJan = calc(1);
      const rJun = calc(6);
      expect(rJun.salaire_brut).toBeGreaterThan(rJan.salaire_brut);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // MOIS 7 — Juillet 2026
  // ─────────────────────────────────────────────────────────────────────
  describe('Juillet (mois 7) — revalorisation +5%', () => {
    it('transport revalorisé = 100 × 1.05', () => {
      const r = calc(7);
      expect(r.ind_transport).toBe(Math.round(100 * 1.05 * 1000) / 1000);
    });

    it('présence = 8.249', () => {
      const r = calc(7);
      expect(r.prime_presence).toBe(8.249);
    });

    it('coefficient = 21/23 avec 2 absences (juillet = 23 jours ouvrés)', () => {
      const r = calc(7, { absences: 2 });
      const jours = calculateJoursOuvres(7, 2026);
      const expected = Math.round(((jours - 2) / jours) * 10000) / 10000;
      expect(r.coefficient_presence).toBeCloseTo(expected, 4);
    });

    it('résultat identique à juin (même régime)', () => {
      const rJun = calc(6);
      const rJul = calc(7);
      expect(rJul.salaire_de_base).toBe(rJun.salaire_de_base);
      expect(rJul.ind_transport).toBe(rJun.ind_transport);
      expect(rJul.prime_presence).toBe(rJun.prime_presence);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // MOIS 8 — Août 2026
  // ─────────────────────────────────────────────────────────────────────
  describe('Août (mois 8) — revalorisation +5%', () => {
    it('transport revalorisé = 100 × 1.05', () => {
      const r = calc(8);
      expect(r.ind_transport).toBe(Math.round(100 * 1.05 * 1000) / 1000);
    });

    it('présence = 8.249', () => {
      const r = calc(8);
      expect(r.prime_presence).toBe(8.249);
    });

    it('coefficient = 16/21 avec 5 absences (août = 21 jours ouvrés)', () => {
      const r = calc(8, { absences: 5 });
      const jours = calculateJoursOuvres(8, 2026);
      const expected = Math.round(((jours - 5) / jours) * 10000) / 10000;
      expect(r.coefficient_presence).toBeCloseTo(expected, 4);
    });

    it('toutes les primes proratisées avec 5 absences', () => {
      const r = calc(8, { absences: 5 });
      const jours = calculateJoursOuvres(8, 2026);
      const coeff = Math.round(((jours - 5) / jours) * 10000) / 10000;
      expect(r.prime_panier).toBe(Math.round(12.320 * coeff * 1000) / 1000);
      expect(r.prime_douche).toBe(Math.round(25.000 * coeff * 1000) / 1000);
      expect(r.prime_savon).toBe(Math.round(5.400 * coeff * 1000) / 1000);
      expect(r.prime_lait).toBe(Math.round(29.700 * coeff * 1000) / 1000);
      expect(r.prime_logement).toBe(Math.round(26.293 * coeff * 1000) / 1000);
      expect(r.mit).toBe(Math.round(5.000 * coeff * 1000) / 1000);
      expect(r.ind_transport).toBe(Math.round(100 * 1.05 * coeff * 1000) / 1000);
      expect(r.prime_presence).toBe(Math.round(8.249 * coeff * 1000) / 1000);
    });

    it('net a payer = salaire_net (pas alloc)', () => {
      const r = calc(8);
      expect(r.net_a_payer).toBe(r.salaire_net);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Comparaison avant/après revalorisation
  // ─────────────────────────────────────────────────────────────────────
  describe('Comparaison avant/après revalorisation', () => {
    it('mois 5 (avant) vs mois 6 (après) — présence change de 7.856 à 8.249', () => {
      const r5 = calc(5);
      const r6 = calc(6);
      expect(r5.prime_presence).toBe(7.856);
      expect(r6.prime_presence).toBe(8.249);
    });

    it('mois 5 vs 6 — transport revalorisé +5%', () => {
      const r5 = calc(5);
      const r6 = calc(6);
      expect(r5.ind_transport).toBe(100);
      expect(r6.ind_transport).toBe(Math.round(100 * 1.05 * 1000) / 1000);
    });

    it('mois 1-5 tous identiques (pas de revalorisation)', () => {
      const results = [1, 2, 3, 4, 5].map(m => calc(m));
      for (let i = 1; i < results.length; i++) {
        expect(results[i].salaire_de_base).toBe(results[0].salaire_de_base);
        expect(results[i].ind_transport).toBe(results[0].ind_transport);
        expect(results[i].prime_presence).toBe(results[0].prime_presence);
      }
    });

    it('mois 6-8 tous identiques (même revalorisation)', () => {
      const results = [6, 7, 8].map(m => calc(m));
      for (let i = 1; i < results.length; i++) {
        expect(results[i].salaire_de_base).toBe(results[0].salaire_de_base);
        expect(results[i].ind_transport).toBe(results[0].ind_transport);
        expect(results[i].prime_presence).toBe(results[0].prime_presence);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Cohérence totale — tous les mois
  // ─────────────────────────────────────────────────────────────────────
  describe('Cohérence — tous les mois', () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8])('Mois %i — salaire_net = brut − retenues', (m) => {
      const r = calc(m);
      const expected = Math.round((r.salaire_brut - r.total_retenues) * 1000) / 1000;
      expect(r.salaire_net).toBe(expected);
    });

    it.each([1, 2, 3, 4, 5, 6, 7, 8])('Mois %i — total_retenues = cnss + irpp + css', (m) => {
      const r = calc(m);
      const expected = Math.round((r.cnss_salariale + r.irpp + r.css_salariale) * 1000) / 1000;
      expect(r.total_retenues).toBe(expected);
    });

    it.each([1, 2, 3, 4, 5, 6, 7, 8])('Mois %i — jours ouvrables dynamiques', (m) => {
      const r = calc(m);
      const jours = calculateJoursOuvres(m, 2026);
      expect(r.coefficient_presence).toBe(1); // jours/jours = 1.0
    });

    it.each([1, 2, 3, 4, 5, 6, 7, 8])('Mois %i — coeff (jours-2)/jours avec 2 absences', (m) => {
      const r = calc(m, { absences: 2 });
      const jours = calculateJoursOuvres(m, 2026);
      const expected = Math.round(((jours - 2) / jours) * 10000) / 10000;
      expect(r.coefficient_presence).toBeCloseTo(expected, 4);
    });

    it.each([1, 2, 3, 4, 5, 6, 7, 8])('Mois %i — coeff (jours-5)/jours avec 5 absences', (m) => {
      const r = calc(m, { absences: 5 });
      const jours = calculateJoursOuvres(m, 2026);
      const expected = Math.round(((jours - 5) / jours) * 10000) / 10000;
      expect(r.coefficient_presence).toBeCloseTo(expected, 4);
    });
  });
});

// ============================================================================
// Tests complets — Chaque employé × Chaque mois (8 × 6 = 48 combinaisons)
// ============================================================================
describe('Employés × Mois — matrice complète', () => {
  const emps = [
    { mat: '209070', nom: 'DALY', sf: 'C' as const, ne: 0, rec: '2020-01-01', brut: 592.928, tp: 95.002, anc: [10,10,10,10,10,10,10,10] },
    { mat: '209071', nom: 'ROUHI', sf: 'M' as const, ne: 2, rec: '2018-06-01', brut: 800, tp: 100.533, anc: [10,10,10,10,10,10,10,10] },
    { mat: '209072', nom: 'BACCOUCHE', sf: 'M' as const, ne: 3, rec: '2015-03-01', brut: 750, tp: 92.800, anc: [15,15,15,15,15,15,15,15] },
    { mat: '209073', nom: 'ZAYANI', sf: 'C' as const, ne: 0, rec: '2022-09-01', brut: 650, tp: 95.002, anc: [5,5,5,5,5,5,5,5] },
    { mat: '209074', nom: 'BEN SLIMENE', sf: 'M' as const, ne: 1, rec: '2010-01-01', brut: 400, tp: 92.800, anc: [15,15,15,15,15,15,15,15] },
    { mat: '209075', nom: 'AAMRI', sf: 'C' as const, ne: 0, rec: '2023-06-01', brut: 6008.771, tp: 100.533, anc: [0,0,0,0,0,5,5,5] },
  ];

  const mois = [1, 2, 3, 4, 5, 6, 7, 8];

  // ───────────────────────────────────────────────────────────────────
  // 1. Chaque employé × chaque mois — valeurs de base
  // ───────────────────────────────────────────────────────────────────
  for (const emp of emps) {
    describe(`${emp.nom} (${emp.brut} DT)`, () => {
      for (const m of mois) {
        const reval = m >= 6;
        const transportAttendu = reval
          ? Math.round(emp.tp * 1.05 * 1000) / 1000
          : emp.tp;
        const presenceAttendue = reval ? 8.249 : 7.856;

        it(`Mois ${m} — brut, net, cnss, css, transport`, () => {
          const r = calculateSalary({
            salaire_brut: emp.brut, situation_fam: emp.sf, nombre_enfants: emp.ne,
            sexe: 'H', date_recrutement: emp.rec, mois: m, annee: 2026,
            transport_plein: emp.tp,
          });

          // Coefficient 1.0 (mois complet, pas d'absences)
          expect(r.coefficient_presence).toBe(1);

          // Transport
          expect(r.ind_transport).toBe(transportAttendu);

          // Présence
          expect(r.prime_presence).toBe(presenceAttendue);

          // Ancienneté désactivée
          expect(r.taux_anciennete).toBe(0);
          expect(r.prime_anciennete).toBe(0);

          // CNSS = 9.68% × (brut − lait)
          const expectedCNSS = Math.round(Math.max(0, r.salaire_brut - r.prime_lait) * 0.0968 * 1000) / 1000;
          expect(r.cnss_salariale).toBe(expectedCNSS);

          // CSS = 0.5% × RNI
          const rni = Math.max(0, r.revenu_imposable - r.frais_pro);
          const expectedCSS = Math.round(rni * 0.005 * 1000) / 1000;
          expect(r.css_salariale).toBe(expectedCSS);

          // Net = brut − retenues
          const expectedNet = Math.round((r.salaire_brut - r.total_retenues) * 1000) / 1000;
          expect(r.salaire_net).toBe(expectedNet);

          // Retenues = cnss + irpp + css
          const expectedRetenues = Math.round((r.cnss_salariale + r.irpp + r.css_salariale) * 1000) / 1000;
          expect(r.total_retenues).toBe(expectedRetenues);
        });
      }

      // ───────────────────────────────────────────────────────────────
      // 2. Absences — coeff 20/22 pour chaque employé × mois 6 (reval)
      // ───────────────────────────────────────────────────────────────
      it('Mois 6 — 2 absences → coeff dynamique, toutes primes proratisées', () => {
        const jours = calculateJoursOuvres(6, 2026);
        const r = calculateSalary({
          salaire_brut: emp.brut, situation_fam: emp.sf, nombre_enfants: emp.ne,
          sexe: 'H', date_recrutement: emp.rec, mois: 6, annee: 2026,
          transport_plein: emp.tp, absences_jours: 2,
        });
        const coeff = Math.round(((jours - 2) / jours) * 10000) / 10000;
        expect(r.coefficient_presence).toBeCloseTo(coeff, 4);
        expect(r.ind_transport).toBeCloseTo(Math.round(emp.tp * 1.05 * ((jours - 2) / jours) * 1000) / 1000, 2);
        expect(r.prime_panier).toBe(Math.round(12.320 * coeff * 1000) / 1000);
        expect(r.prime_douche).toBe(Math.round(25.000 * coeff * 1000) / 1000);
        expect(r.prime_savon).toBe(Math.round(5.400 * coeff * 1000) / 1000);
        expect(r.prime_lait).toBe(Math.round(29.700 * coeff * 1000) / 1000);
        expect(r.prime_logement).toBe(Math.round(26.293 * coeff * 1000) / 1000);
        expect(r.mit).toBe(Math.round(5.000 * coeff * 1000) / 1000);
      });

      // ───────────────────────────────────────────────────────────────
      // 3. Absences — coeff 17/22 pour chaque employé × mois 3 (avant reval)
      // ───────────────────────────────────────────────────────────────
      it('Mois 3 — 5 absences → coeff dynamique, primes proratisées', () => {
        const jours = calculateJoursOuvres(3, 2026);
        const r = calculateSalary({
          salaire_brut: emp.brut, situation_fam: emp.sf, nombre_enfants: emp.ne,
          sexe: 'H', date_recrutement: emp.rec, mois: 3, annee: 2026,
          transport_plein: emp.tp, absences_jours: 5,
        });
        const coeff = Math.round(((jours - 5) / jours) * 10000) / 10000;
        expect(r.coefficient_presence).toBeCloseTo(coeff, 4);
        // Transport sans revalorisation
        expect(r.ind_transport).toBe(Math.round(emp.tp * coeff * 1000) / 1000);
        expect(r.prime_presence).toBe(Math.round(7.856 * coeff * 1000) / 1000);
      });

      // ───────────────────────────────────────────────────────────────
      // 4. Net a payer = salaire net (pas alloc chez STE BAUD)
      // ───────────────────────────────────────────────────────────────
      it('Mois 8 — net_a_payer = salaire_net', () => {
        const r = calculateSalary({
          salaire_brut: emp.brut, situation_fam: emp.sf, nombre_enfants: emp.ne,
          sexe: 'H', date_recrutement: emp.rec, mois: 8, annee: 2026,
          transport_plein: emp.tp,
        });
        expect(r.net_a_payer).toBe(r.salaire_net);
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────
  // 5. Comparaison bas vs haut salaire
  // ───────────────────────────────────────────────────────────────────
  describe('Comparaison salaires', () => {
    it('AAMRI (6008) paie plus de CNSS que DALY (592)', () => {
      const rAamri = calculateSalary({ salaire_brut: 6008.771, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, transport_plein: 100.533 });
      const rDaly = calculateSalary({ salaire_brut: 592.928, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, transport_plein: 95.002 });
      expect(rAamri.cnss_salariale).toBeGreaterThan(rDaly.cnss_salariale);
    });

    it('BEN SLIMENE (400) paie moins d IRPP que ROUHI (800)', () => {
      const rBen = calculateSalary({ salaire_brut: 400, situation_fam: 'M', nombre_enfants: 1, mois: 6, annee: 2026, transport_plein: 92.800 });
      const rRouhi = calculateSalary({ salaire_brut: 800, situation_fam: 'M', nombre_enfants: 2, mois: 6, annee: 2026, transport_plein: 100.533 });
      expect(rBen.irpp).toBeLessThanOrEqual(rRouhi.irpp);
    });

    it('net_a_payer = salaire_net pour tous (pas alloc)', () => {
      const rRouhi = calculateSalary({ salaire_brut: 800, situation_fam: 'M', nombre_enfants: 2, mois: 6, annee: 2026, transport_plein: 100.533 });
      const rBen = calculateSalary({ salaire_brut: 400, situation_fam: 'M', nombre_enfants: 1, mois: 6, annee: 2026, transport_plein: 92.800 });
      expect(rRouhi.net_a_payer).toBe(rRouhi.salaire_net);
      expect(rBen.net_a_payer).toBe(rBen.salaire_net);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // 6. Export Sage — chaque mois × chaque employé
  // ───────────────────────────────────────────────────────────────────
  describe('Export Sage — matrice complète', () => {
    for (const m of mois) {
      it(`Mois ${m} — toutes les rubriques générées`, () => {
        const results = new Map<string, SalaryResult>();
        for (const emp of emps) {
          results.set(emp.mat, calculateSalary({
            salaire_brut: emp.brut, situation_fam: emp.sf, nombre_enfants: emp.ne,
            sexe: 'H', date_recrutement: emp.rec, mois: m, annee: 2026,
            transport_plein: emp.tp,
          }));
        }

        const sageEmps = emps.map(e => ({
          matricule: e.mat, nom: e.nom, prenom: e.nom,
          nouveau_salaire_brut: e.brut, salaire_brut: e.brut,
        }));
        const exportResult = generateSagePaieExport(sageEmps, [], results, m, 2026, false);

        expect(exportResult.rows.length).toBeGreaterThan(0);
        expect(exportResult.smigViolations.length).toBe(0);

        for (const emp of emps) {
          const empRows = exportResult.rows.filter(r => r.matricule === emp.mat);
          const codes = empRows.map(r => r.code_rubrique);
          expect(codes).toContain('1000'); // Salaire de base
          expect(codes).toContain('3100'); // CNSS
          expect(codes).toContain('3310'); // IRPP
          expect(codes).toContain('3320'); // CSS

          const periode = `${String(m).padStart(2, '0')}/2026`;
          for (const row of empRows) {
            expect(row.periode).toBe(periode);
          }
        }
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // 7. Heures sup — test par employé
  // ───────────────────────────────────────────────────────────────────
  describe('Heures supplémentaires — par employé', () => {
    for (const emp of emps) {
      it(`${emp.nom} — 10h sup à mois 6`, () => {
        const r = calculateSalary({
          salaire_brut: emp.brut, situation_fam: emp.sf, nombre_enfants: emp.ne,
          sexe: 'H', date_recrutement: emp.rec, mois: 6, annee: 2026,
          transport_plein: emp.tp, heures_supplementaires: 10,
        });
        expect(r.heures_supplementaires).toBe(10);
        expect(r.majoration_hs).toBeGreaterThan(0);
        expect(r.salaire_brut).toBeGreaterThan(
          calculateSalary({
            salaire_brut: emp.brut, situation_fam: emp.sf, nombre_enfants: emp.ne,
            sexe: 'H', date_recrutement: emp.rec, mois: 6, annee: 2026,
            transport_plein: emp.tp,
          }).salaire_brut
        );
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // 8. Nuit — test par employé avec heures_nuit
  // ───────────────────────────────────────────────────────────────────
  describe('Nuit — par employé avec 20h nuit', () => {
    for (const emp of emps) {
      it(`${emp.nom} — 20h nuit à mois 6`, () => {
        const r = calculateSalary({
          salaire_brut: emp.brut, situation_fam: emp.sf, nombre_enfants: emp.ne,
          sexe: 'H', date_recrutement: emp.rec, mois: 6, annee: 2026,
          transport_plein: emp.tp, heures_nuit: 20,
        });
        const taux_horaire = emp.brut / 190;
        const expectedNuit = Math.round(taux_horaire * 20 * 1.25 * 1000) / 1000;
        expect(r.prime_nuit).toBe(expectedNuit);
      });
    }
  });
});
