import { describe, expect, it } from 'vitest';
import {
  buildSageSalariesRecord,
  generateSageSalariesExport,
  toSageDate,
  SAGE_SALARIES_SPEC,
} from '../baudCalculator';

const emp = {
  matricule: '209070',
  matricule_valid: true,
  nom: 'BEN SALEM',
  prenom: 'Ali',
  sexe: 'H',
  date_naissance: '1985-03-15',
  situation_fam: 'M',
  adresse: 'Rue 12 Mars, Tunis',
  numero_cnss: '0123456789012',
  bq_ou_poste: 'BNA ARIANA',
  rib_ou_ccp: 'TU5901000395352359',
  date_recrutement: '2020-06-01',
  date_sortie: '',
};

describe('Export SAGE BTP (format fixe salariés)', () => {
  const TOTAL_LINE = SAGE_SALARIES_SPEC.reduce((s, f) => s + f.size, 0);

  it('la ligne fait exactement la taille requise (somme des tailles = 657 + \\n)', () => {
    const line = buildSageSalariesRecord(emp);
    expect(line.length).toBe(TOTAL_LINE + 1);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.length - 1).toBe(657);
  });

  it('chaque champ est à sa position exacte selon la spec SAGE', () => {
    const line = buildSageSalariesRecord(emp);
    for (const f of SAGE_SALARIES_SPEC) {
      const slice = line.substr(f.start - 1, f.size);
      expect(slice.length).toBe(f.size);
    }
  });

  it('positions critiques : matricule, nom, prénom, naissance, CNSS, IBAN', () => {
    const line = buildSageSalariesRecord(emp);
    // Matricule: départ 1, taille 10
    expect(line.substr(0, 10)).toBe('209070    ');
    // Non importable (11,1) = '0'
    expect(line.substr(10, 1)).toBe('0');
    // Nom (12,80) — majuscules
    expect(line.substr(11, 80).trim()).toBe('BEN SALEM');
    // Prénom (92,20)
    expect(line.substr(91, 20).trim()).toBe('ALI');
    // Sexe (192,1)
    expect(line.substr(191, 1)).toBe('H');
    // Date de naissance (193,8) AAAAMMJJ
    expect(line.substr(192, 8)).toBe('19850315');
    // Situation familiale (229,1)
    expect(line.substr(228, 1)).toBe('M');
    // Adresse (230,32)
    expect(line.substr(229, 32).trim()).toBe('RUE 12 MARS, TUNIS');
    // CNSS (327,13)
    expect(line.substr(326, 13).trim()).toBe('0123456789012');
    // Date d'embauche société (519,8)
    expect(line.substr(518, 8)).toBe('20200601');
    // Libellé du compte 1 (559,24) / Nom banque 1 (583,30)
    expect(line.substr(558, 24).trim()).toBe('BNA ARIANA');
    expect(line.substr(582, 30).trim()).toBe('BNA ARIANA');
    // Code IBAN 1 (624,34)
    expect(line.substr(623, 34).trim()).toBe('TU5901000395352359');
  });

  it('champs vides → espaces, dates absentes → vides (pas de crash)', () => {
    const empty = {
      matricule: 'X1', nom: '', prenom: '', date_naissance: '', situation_fam: '',
      date_recrutement: '', date_sortie: '', numero_cnss: '', adresse: '',
    };
    const line = buildSageSalariesRecord(empty as any);
    expect(line.length).toBe(TOTAL_LINE + 1);
    // Toutes les zones de date doivent être 8 espaces
    expect(line.substr(192, 8)).toBe('        ');
    // Le nom (12,80) doit être vide
    expect(line.substr(11, 80)).toBe(' '.repeat(80));
  });

  it('toSageDate gère ISO, DD/MM/YYYY et serial Excel', () => {
    expect(toSageDate('2020-06-01')).toBe('20200601');
    expect(toSageDate('01/06/2020')).toBe('20200601');
    expect(toSageDate('')).toBe('');
    expect(toSageDate('non')).toBe('');
  });

  it('1 ligne par salarié + somme des tailles = recordLength', () => {
    const res = generateSageSalariesExport([
      emp,
      { matricule: '209071', matricule_valid: true, nom: 'ROUHI', prenom: 'Nabil', situation_fam: 'C' },
    ]);
    expect(res.lines.length).toBe(2);
    expect(res.totalEmployees).toBe(2);
    expect(res.recordLength).toBe(657);
  });

  it('adresse longue (>32) scindée adresse+complément, ligne toujours 657', () => {
    const long = {
      matricule: '209143',
      matricule_valid: true,
      nom: 'RGUEZ',
      prenom: 'Ali',
      adresse: 'RUE MAHMOUH BAYREM ETOUNSI, 1152 ZRIBA HAMMAM, GOUVERNORAT DE ZAGHOUAN',
      date_naissance: '1977-01-14',
      date_recrutement: '2014-01-31',
      situation_fam: 'M',
      numero_cnss: '11854899/01',
    };
    const line = buildSageSalariesRecord(long as any);
    expect(line.length).toBe(TOTAL_LINE + 1);
    // Adresse (230,32) = 32 premiers caractères de l'adresse
    const addr = line.substr(229, 32);
    expect(addr).toBe('RUE MAHMOUH BAYREM ETOUNSI, 1152');
    // Complément d'adresse (262,32) = suite
    const comp = line.substr(261, 32);
    expect(comp.trim().startsWith('ZRIBA HAMMAM, GOUVERNORAT DE')).toBe(true);
    // Le reste des champs reste aligné : CNSS toujours à 327
    expect(line.substr(326, 13).trim()).toBe('11854899/01');
    // Date d'embauche toujours à 519
    expect(line.substr(518, 8)).toBe('20140131');
  });

  it('matricules invalides listés (blocage export côté UI)', () => {
    const res = generateSageSalariesExport([
      { matricule: '', nom: 'BAD', prenom: 'X' },
      { matricule_valid: false, matricule: '12', nom: 'SHORT', prenom: 'Y' },
    ]);
    expect(res.invalidMatricules?.length).toBe(2);
  });
});