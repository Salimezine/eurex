/**
 * Tests export variables Sage Paie — le système prépare les données, Sage calcule
 * Vitest — Tests unitaires pour generateSageVariablesExport()
 *
 * Seules 4 variables mensuelles sont exportées (données qui changent chaque mois).
 * Les données fixes de fiche employé (salaire, situation, enfants, catégorie,
 * fonction, date embauche) ne sont PAS exportées — elles vivent dans Sage.
 */
import { describe, it, expect } from 'vitest';
import { generateSageVariablesExport } from '../baudCalculator.js';

const defaultEmployees = [
  { matricule: '209071', nom: 'ROUHI', prenom: 'Nabil' },
  { matricule: '209074', nom: 'BEN SLIMANE', prenom: 'Karim' },
  { matricule: '209070', nom: 'DALY', prenom: 'Sondes' },
];

describe('Export Variables Sage — generateSageVariablesExport', () => {
  it('génère 4 variables par salarié (mensuelles uniquement)', () => {
    const result = generateSageVariablesExport(defaultEmployees, [], {}, 6, 2026);
    expect(result.rows.length).toBe(12); // 3 employés × 4 variables
    expect(result.summary.totalEmployees).toBe(3);
  });

  it('ne contient que les 4 variables mensuelles', () => {
    const result = generateSageVariablesExport(defaultEmployees, [], {}, 6, 2026);
    expect(result.summary.variablesExported).toEqual([
      'ABSENCES_JOURS', 'HEURES_SUP', 'HEURES_NUIT', 'AVANCES',
    ]);
  });

  it('pas de données fixes fiche employé dans l\'export', () => {
    const result = generateSageVariablesExport(defaultEmployees, [], {}, 6, 2026);
    const allVars = result.summary.variablesExported;
    expect(allVars).not.toContain('SALAIRE_DE_BASE');
    expect(allVars).not.toContain('SALAIRE_BRUT');
    expect(allVars).not.toContain('SITUATION_FAMILLE');
    expect(allVars).not.toContain('NOMBRE_ENFANTS');
    expect(allVars).not.toContain('CATEGORIE');
    expect(allVars).not.toContain('FONCTION');
    expect(allVars).not.toContain('DATE_RECRUTEMENT');
    expect(allVars).not.toContain('CNSS');
    expect(allVars).not.toContain('IRPP');
    expect(allVars).not.toContain('CSS');
  });

  it('variables sans pointage = 0', () => {
    const result = generateSageVariablesExport(defaultEmployees, [], {}, 6, 2026);
    const abs = result.rows.filter(r => r.matricule === '209071').map(r => ({ variable: r.variable, valeur: r.valeur }));
    expect(abs.find(r => r.variable === 'ABSENCES_JOURS')?.valeur).toBe('0');
    expect(abs.find(r => r.variable === 'HEURES_SUP')?.valeur).toBe('0.0');
    expect(abs.find(r => r.variable === 'HEURES_NUIT')?.valeur).toBe('0.0');
    expect(abs.find(r => r.variable === 'AVANCES')?.valeur).toBe('0.000');
  });

  it('absences depuis le pointage', () => {
    const pointage = [{ matricule: '209071', absences: '3', avances: 50, heures_supplementaires: '10.5' }];
    const result = generateSageVariablesExport(defaultEmployees, pointage, {}, 6, 2026);
    const abs = result.rows.find(r => r.matricule === '209071' && r.variable === 'ABSENCES_JOURS');
    const hs = result.rows.find(r => r.matricule === '209071' && r.variable === 'HEURES_SUP');
    const av = result.rows.find(r => r.matricule === '209071' && r.variable === 'AVANCES');
    expect(abs?.valeur).toBe('3');
    expect(hs?.valeur).toBe('10.5');
    expect(av?.valeur).toBe('50.000');
  });

  it('heures de nuit depuis heuresNuit record', () => {
    const heuresNuit = { '6-209071': 20 };
    const result = generateSageVariablesExport(defaultEmployees, [], heuresNuit, 6, 2026);
    const nuit = result.rows.find(r => r.matricule === '209071' && r.variable === 'HEURES_NUIT');
    expect(nuit?.valeur).toBe('20.0');
  });

  it('periode format MM/YYYY', () => {
    const result = generateSageVariablesExport(defaultEmployees, [], {}, 6, 2026);
    expect(result.rows[0].periode).toBe('06/2026');
  });

  it('matricule = vrai matricule Sage', () => {
    const result = generateSageVariablesExport(defaultEmployees, [], {}, 6, 2026);
    const matricules = [...new Set(result.rows.map(r => r.matricule))];
    expect(matricules).toEqual(['209071', '209074', '209070']);
  });

  it('employé avec pointage partiel (certains sans)', () => {
    const pointage = [{ matricule: '209071', absences: '2', avances: 0, heures_supplementaires: '' }];
    const result = generateSageVariablesExport(defaultEmployees, pointage, {}, 6, 2026);
    const abs209071 = result.rows.find(r => r.matricule === '209071' && r.variable === 'ABSENCES_JOURS');
    expect(abs209071?.valeur).toBe('2');
    const abs209074 = result.rows.find(r => r.matricule === '209074' && r.variable === 'ABSENCES_JOURS');
    expect(abs209074?.valeur).toBe('0');
  });

  it('détecte les matricules invalides (pas de 209xxx)', () => {
    const mixedEmployees = [
      { matricule: '209071', nom: 'ROUHI', prenom: 'Nabil', matricule_valid: true },
      { matricule: '5', nom: 'BEN ALI', prenom: 'Ahmed', matricule_valid: false },
      { matricule: '', nom: 'DUPONT', prenom: 'Jean', matricule_valid: false },
    ];
    const result = generateSageVariablesExport(mixedEmployees, [], {}, 6, 2026);
    expect(result.invalidMatricules).toBeDefined();
    expect(result.invalidMatricules!.length).toBe(2);
    expect(result.invalidMatricules!.map(e => e.nom)).toContain('BEN ALI');
    expect(result.invalidMatricules!.map(e => e.nom)).toContain('DUPONT');
  });

  it('jointure par nom+prénom quand matricule vide dans pointage', () => {
    const employees = [
      { matricule: '209071', nom: 'ROUHI', prenom: 'Nabil', matricule_valid: true },
    ];
    // Pointage avec matricule vide mais nom/prénom correct
    const pointage = [{ matricule: '', absences: '5', avances: 100, heures_supplementaires: '15', nom: 'ROUHI', prenom: 'Nabil' }];
    const result = generateSageVariablesExport(employees, pointage, {}, 6, 2026);
    const abs = result.rows.find(r => r.variable === 'ABSENCES_JOURS');
    const av = result.rows.find(r => r.variable === 'AVANCES');
    const hs = result.rows.find(r => r.variable === 'HEURES_SUP');
    expect(abs?.valeur).toBe('5');
    expect(av?.valeur).toBe('100.000');
    expect(hs?.valeur).toBe('15.0');
  });

  it('tous les matricules valides → invalidMatricules vide', () => {
    const result = generateSageVariablesExport(defaultEmployees, [], {}, 6, 2026);
    expect(result.invalidMatricules).toBeDefined();
    expect(result.invalidMatricules!.length).toBe(0);
  });

  describe('Export pour chaque mois (1-12)', () => {
    const moisNoms = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

    for (let mois = 1; mois <= 12; mois++) {
      it(`mois ${mois} (${moisNoms[mois - 1]}) — même structure, bonne période`, () => {
        const pointage = [{ matricule: '209071', absences: String(mois), avances: mois * 10, heures_supplementaires: String(mois) }];
        const heuresNuit = { [`${mois}-209071`]: mois * 2 };
        const result = generateSageVariablesExport(defaultEmployees, pointage, heuresNuit, mois, 2026);

        // 3 employés × 4 variables = 12 rows
        expect(result.rows.length).toBe(12);
        expect(result.summary.totalEmployees).toBe(3);

        // Toutes les rows ont la bonne période
        const periode = `${String(mois).padStart(2, '0')}/2026`;
        expect(result.rows.every(r => r.periode === periode)).toBe(true);

        // Les 4 variables toujours présentes
        expect(result.summary.variablesExported).toEqual([
          'ABSENCES_JOURS', 'HEURES_SUP', 'HEURES_NUIT', 'AVANCES',
        ]);

        // 209071 a les bonnes valeurs du pointage
        const emp1 = result.rows.filter(r => r.matricule === '209071');
        expect(emp1.find(r => r.variable === 'ABSENCES_JOURS')?.valeur).toBe(String(mois));
        expect(emp1.find(r => r.variable === 'HEURES_SUP')?.valeur).toBe(String(mois) + '.0');
        expect(emp1.find(r => r.variable === 'HEURES_NUIT')?.valeur).toBe(String(mois * 2) + '.0');
        expect(emp1.find(r => r.variable === 'AVANCES')?.valeur).toBe((mois * 10).toFixed(3));

        // 209074 et 209070 ont 0 (pas de pointage)
        const emp2 = result.rows.filter(r => r.matricule === '209074');
        expect(emp2.find(r => r.variable === 'ABSENCES_JOURS')?.valeur).toBe('0');
        expect(emp2.find(r => r.variable === 'HEURES_SUP')?.valeur).toBe('0.0');
        expect(emp2.find(r => r.variable === 'HEURES_NUIT')?.valeur).toBe('0.0');
        expect(emp2.find(r => r.variable === 'AVANCES')?.valeur).toBe('0.000');
      });
    }
  });

  it('12 mois consécutifs — chaque mois a une période distincte', () => {
    for (let mois = 1; mois <= 12; mois++) {
      const result = generateSageVariablesExport(defaultEmployees, [], {}, mois, 2026);
      const periode = `${String(mois).padStart(2, '0')}/2026`;
      expect(result.rows[0].periode).toBe(periode);
    }
  });

  it('décembre 2026 vs janvier 2027 — changement d\'année', () => {
    const r1 = generateSageVariablesExport(defaultEmployees, [], {}, 12, 2026);
    const r2 = generateSageVariablesExport(defaultEmployees, [], {}, 1, 2027);
    expect(r1.rows[0].periode).toBe('12/2026');
    expect(r2.rows[0].periode).toBe('01/2027');
  });
});
