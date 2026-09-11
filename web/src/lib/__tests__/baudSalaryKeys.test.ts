import { describe, it, expect } from 'vitest';
import { calculateSalary, buildSalaryKeys, generateSagePaieExport } from '../baudCalculator';
import { verifySalaryCalculations } from '../baudAI';

const RAW: [string, string, number, string, number][] = [
  ['41359', 'BOUCHAHDA', 3102.622, 'M', 1],
  ['41191', 'ROUHI', 2695.170, 'M', 2],
  ['41091', 'BACCOUCHE', 2084.200, 'M', 5],
  ['41670', 'RGUEZ', 2349.618, 'M', 3],
  ['41302', 'BAOUAB', 2916.290, 'M', 2],
  ['41519', 'ROUHI', 2255.727, 'M', 2],
  ['41338', 'CHAABANE', 1729.980, 'M', 2],
  ['41339', 'FRIX', 2209.403, 'M', 2],
  ['41421', 'HECHI', 1881.069, 'M', 1],
  ['41319', 'BEN SLIMENE', 1643.497, 'C', 0],
  ['41331', 'KAABI', 1382.535, 'C', 2],
  ['41331', 'RAYSI', 1553.614, 'M', 1],
  ['209129', 'ZAYANI', 3601.240, 'C', 0],
  ['209130', 'EL MANNAI', 1370.965, 'C', 0],
  ['209130', 'AAMRI', 6008.771, 'M', 0],
  ['209132', 'SASSI', 1490.647, 'C', 0],
  ['209133', 'EL WAER', 1225.030, 'C', 0],
  ['209134', 'SLIMEN', 950.000, 'C', 0],
  ['209137', 'SIRAT', 1182.603, 'M', 1],
  ['209136', 'RHILI', 826.657, 'M', 2],
  ['209138', 'BEN ISSMAIL', 826.657, 'M', 2],
];

function buildEmployees() {
  return RAW.map(([matricule, nom, brut, sf, ne]) => ({
    matricule, nom, prenom: 'X', cin: '0000', date_naissance: '', date_sortie: '',
    date_recrutement: '', adresse: '', numero_cnss: '0000000000000',
    situation_fam: sf as any, nombre_enfants: ne, sexe: 'H' as any, salaire_brut: brut,
    nouveau_salaire_brut: brut, ticketRestaurant: 0, contexte_categorie: '',
    salaire_manually_edited: false, matricule_valid: true,
  }));
}

function buildResults(employees: any[]) {
  const keys = buildSalaryKeys(employees);
  const results = new Map<string, any>();
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    results.set(keys[i], calculateSalary({
      salaire_brut: emp.salaire_brut, situation_fam: emp.situation_fam,
      nombre_enfants: emp.nombre_enfants, sexe: emp.sexe, date_recrutement: '', mois: 6, annee: 2026,
    }));
  }
  return results;
}

describe('buildSalaryKeys (matricules en double/vides)', () => {
  it('génère des clés uniques pour 21 salariés dont 2 matricules dupliqués', () => {
    const keys = buildSalaryKeys(buildEmployees());
    expect(keys.length).toBe(21);
    expect(new Set(keys).size).toBe(21);
  });

  it('clé vide → fallback nom+prénom (pas d\'écrasement)', () => {
    const emps = [
      { matricule: '', nom: 'A', prenom: 'X' },
      { matricule: '', nom: 'B', prenom: 'Y' },
      { matricule: '', nom: 'A', prenom: 'X' },
    ];
    const keys = buildSalaryKeys(emps);
    expect(keys.length).toBe(3);
    expect(new Set(keys).size).toBe(3);
  });

  it('21 résultats stockés pour 21 salariés (avant : 19 écrasés)', () => {
    const results = buildResults(buildEmployees());
    expect(results.size).toBe(21);
  });
});

describe('Vérification IA sans faux positifs (régression bug IRPP 157.923)', () => {
  it('aucune erreur IRPP/CNSS fantôme malgré les matricules dupliqués', () => {
    const employees = buildEmployees();
    const results = buildResults(employees);
    const v = verifySalaryCalculations(employees as any, [], results as any);
    expect(v.summary.verified).toBe(21);
    const irppErrors = v.checks.filter(c => c.name.includes('IRPP') && c.status === 'error');
    const cnssErrors = v.checks.filter(c => c.name.includes('CNSS incorrect') && c.status === 'error');
    expect(irppErrors).toHaveLength(0);
    expect(cnssErrors).toHaveLength(0);
  });

  it('IRPP distincts pour 2 salariés au matricule identique (41331)', () => {
    const employees = buildEmployees();
    const results = buildResults(employees);
    const keys = buildSalaryKeys(employees);
    const kaabi = employees.find(e => e.nom === 'KAABI')!;
    const raysi = employees.find(e => e.nom === 'RAYSI')!;
    const rK = results.get(keys[employees.indexOf(kaabi)]);
    const rR = results.get(keys[employees.indexOf(raysi)]);
    expect(rK.irpp).not.toBe(rR.irpp);
  });

  it('applyCorrections trouve le bon résultat via salaryKey', async () => {
    // Simule une correction IRPP produite par la vérification
    const employees = buildEmployees();
    const results = buildResults(employees);
    const keys = buildSalaryKeys(employees);
    const kaabi = employees.find(e => e.nom === 'KAABI')!;
    const key = keys[employees.indexOf(kaabi)];
    const before = results.get(key).irpp;
    const corrections = [{ matricule: '41331', nom: 'KAABI X', field: 'irpp', oldValue: before, newValue: 123.456, reason: 'test', salaryKey: key }];
    const { applyCorrections } = await import('../baudAI');
    const corrected = applyCorrections(employees as any, [], results as any, corrections as any);
    expect(corrected.get(key)!.irpp).toBe(123.456);
    // L'autre salarié au même matricule reste intact
    const raysiIdx = employees.findIndex(e => e.nom === 'RAYSI');
    const raysiKey = keys[raysiIdx];
    expect(corrected.get(raysiKey)!.irpp).toBe(results.get(raysiKey)!.irpp);
  });

  it('rekeySalaryResults suit le changement de matricule (fix_duplicate)', async () => {
    const { rekeySalaryResults } = await import('../baudAI');
    const employees = buildEmployees();
    const results = buildResults(employees);
    const keys = buildSalaryKeys(employees);

    // Renumérote le 2e salarié partageant le matricule 41331 (RAYSI → 99999)
    const newEmps = employees.map((e, i) => i === employees.findIndex(x => x.nom === 'RAYSI') ? { ...e, matricule: '99999' } : e);

    const rekeyed = rekeySalaryResults(employees, newEmps, results);
    const newKeys = buildSalaryKeys(newEmps);
    const raysiIdx = newEmps.findIndex(e => e.nom === 'RAYSI')!;
    expect(rekeyed.has(newKeys[raysiIdx])).toBe(true);
    // Le 1er salarié au matricule 41331 garde son résultat sous sa clé
    expect(rekeyed.get(newKeys[newEmps.findIndex(x => x.nom === 'KAABI')])!.irpp).toBe(results.get(keys[employees.findIndex(x => x.nom === 'KAABI')])?.irpp);
  });

  it('fix_duplicate multi-occurrences renumérote chaque excédent', async () => {
    const { applyAutoFixes } = await import('../baudAI');
    const emps = [
      { matricule: '', nom: 'A', prenom: 'B' },
      { matricule: '', nom: 'C', prenom: 'D' },
      { matricule: '', nom: 'E', prenom: 'F' },
    ];
    const autoFixes = [
      { type: 'fix_duplicate', description: 'fix all extras', matricule: '', data: { newMatricules: ['99901', '99902'] }, applied: false },
    ];
    const fixed = applyAutoFixes(emps as any, [], autoFixes as any);
    expect(fixed.employees[0].matricule).toBe('');    // 1er reste vide
    expect(fixed.employees[1].matricule).toBe('99901'); // 2e renuméroté
    expect(fixed.employees[2].matricule).toBe('99902'); // 3e renuméroté
  });
});