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
  calculateIRPPAnnuel,
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
// 4. CSS — Mécanisme différentiel IRPP
// ============================================================================
describe('CSS — mécanisme différentiel IRPP (Loi 92-73)', () => {
  it('CSS = IRPP(barème+1pt) − IRPP(barème normal) / 12', () => {
    const r = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0 });
    const annualImposable = r.revenu_net_imposable * 12;
    const irppNormal = calculateIRPPAnnuel(annualImposable, 0);
    const irppAvecPoint = calculateIRPPAnnuel(annualImposable, 1);
    const expectedCSS = Math.round(((irppAvecPoint.irpp_annuel - irppNormal.irpp_annuel) / 12) * 1000) / 1000;
    expect(r.css_salariale).toBe(expectedCSS);
  });

  it('CSS n est PAS sur le brut', () => {
    const r = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0 });
    const wrong = Math.round(r.salaire_brut * 0.005 * 1000) / 1000;
    expect(r.css_salariale).not.toBe(wrong);
  });

  it('CSS augmente avec le revenu (taux effectif progressif)', () => {
    const r1 = calculateSalary({ salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0 });
    const r2 = calculateSalary({ salaire_brut: 5000, situation_fam: 'C', nombre_enfants: 0 });
    const rate1 = r1.css_salariale / r1.revenu_net_imposable;
    const rate2 = r2.css_salariale / r2.revenu_net_imposable;
    expect(rate2).toBeGreaterThan(rate1);
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
    expect(r.prime_anciennete).toBe(100);
    // Transport: 95.002 × 1.05 (reval juin 2026) × 1.0 (coeff = 1) = 99.752
    expect(r.ind_transport).toBe(99.752);
    // Presence: 8.249 (juin 2026) × 1.0 = 8.249
    expect(r.prime_presence).toBe(8.249);
    expect(r.coefficient_presence).toBe(1);
    // Brut includes all primes légales (logement defaults to 26.293)
    expect(r.salaire_brut).toBe(Math.round((1000 + 0 + 100 + 99.752 + 8.249
      + r.prime_panier + r.prime_douche + r.prime_savon + r.prime_lait + r.prime_logement) * 1000) / 1000);
  });

  it('2028 : prime sur base revalORISEE', () => {
    const r = calculateSalary({
      salaire_brut: 1000, situation_fam: 'C', nombre_enfants: 0,
      date_recrutement: '2020-01-01', mois: 6, annee: 2028,
    });
    const expectedBase = Math.round(1000 * 1.05 * 1.05 * 1000) / 1000;
    expect(r.salaire_de_base).toBe(expectedBase);
    expect(r.prime_anciennete).toBe(Math.round(expectedBase * 10 / 100 * 1000) / 1000);
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

  it('4120 PRESENTE quand enabled', () => {
    const e = generateSagePaieExport(employees, [], results, 6, 2026, true);
    expect(e.rows.map(r => r.code_rubrique)).toContain('4120');
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

  it('alloc 5100 pour marie + enfants', () => {
    const e = generateSagePaieExport(employees, [], results, 6, 2026, false);
    const allocRows = e.rows.filter(r => r.code_rubrique === '5100');
    expect(allocRows.length).toBeGreaterThan(0);
    expect(allocRows.find(r => r.matricule === '209070')).toBeUndefined();
    expect(allocRows.find(r => r.matricule === '209071')!.valeur).toBeGreaterThan(0);
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
    expect(r.taux_anciennete).toBe(10);
    expect(r.prime_anciennete).toBe(Math.round(592.928 * 10 / 100 * 1000) / 1000);
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
    { matricule: '209070', nom: 'DALY', prenom: 'SONDES', situation_fam: 'C' as const, nombre_enfants: 0, date_recrutement: '2020-01-01', salaire_brut: 592.928, nouveau_salaire_brut: 592.928, transport_plein: 95.002, heures_nuit: 0 },
    { matricule: '209071', nom: 'ROUHI', prenom: 'Nabil', situation_fam: 'M' as const, nombre_enfants: 2, date_recrutement: '2018-06-01', salaire_brut: 800, nouveau_salaire_brut: 800, transport_plein: 100.533, heures_nuit: 0 },
    { matricule: '209072', nom: 'BACCOUCHE', prenom: 'Tahar', situation_fam: 'M' as const, nombre_enfants: 3, date_recrutement: '2015-03-01', salaire_brut: 750, nouveau_salaire_brut: 750, transport_plein: 92.800, heures_nuit: 0 },
    { matricule: '209073', nom: 'ZAYANI', prenom: 'Majed', situation_fam: 'C' as const, nombre_enfants: 0, date_recrutement: '2022-09-01', salaire_brut: 650, nouveau_salaire_brut: 650, transport_plein: 95.002, heures_nuit: 0 },
    { matricule: '209074', nom: 'BEN SLIMENE', prenom: 'Karim', situation_fam: 'M' as const, nombre_enfants: 1, date_recrutement: '2010-01-01', salaire_brut: 400, nouveau_salaire_brut: 400, transport_plein: 92.800, heures_nuit: 0 },
    { matricule: '209075', nom: 'AAMRI', prenom: 'Moatez', situation_fam: 'C' as const, nombre_enfants: 0, date_recrutement: '2023-06-01', salaire_brut: 6008.771, nouveau_salaire_brut: 6008.771, transport_plein: 100.533, heures_nuit: 0 },
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

        const annualImposable = r.revenu_net_imposable * 12;
        const irppNormal = calculateIRPPAnnuel(annualImposable, 0);
        const irppAvecPoint = calculateIRPPAnnuel(annualImposable, 1);
        const expectedCSS = Math.round(((irppAvecPoint.irpp_annuel - irppNormal.irpp_annuel) / 12) * 1000) / 1000;
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

  it('MIT = 5000 DT × coefficient (montant fixe, PAS un %)', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026 });
    // coefficient = 1.0 (mois complet), MIT = 5000 × 1.0
    expect(r.mit).toBe(5000);
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

  it('brut inclut toutes les primes légales proratisées (sauf nuit, HS, rappel)', () => {
    const r = calculateSalary({
      salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026,
      prime_nuit_plein: 70, prime_logement_plein: 25,
      transport_plein: 95.002,
    });
    // coeff = 1.0, presence = 8.249, transport revalorisé juin 2026: 95.002 × 1.05 = 99.752
    const expectedBrut = Math.round((
      600 + 99.752 + 8.249
      + 12.320 + 25.000 + 5.400 + 29.700 + 25
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
      + 12.320 + 25.000 + 5.400 + 29.700 + 26.293 + 200
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

  it('MIT calculé sur coefficient (montant fixe 5000 × coeff)', () => {
    const r = calculateSalary({ salaire_brut: 600, situation_fam: 'C', nombre_enfants: 0, mois: 6, annee: 2026, absences_jours: 2 });
    const coeff = Math.round((20 / 22) * 10000) / 10000;
    expect(r.mit).toBe(Math.round(5000 * coeff * 1000) / 1000);
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
