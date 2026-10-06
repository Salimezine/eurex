// Save Sage export to CSV file
import XLSX from 'xlsx';
import fs from 'fs';
import { calculateSalary } from './web/src/lib/baudCalculator.ts';

// Column indices for "Liste du personnel" DP sheet (0-based, header row at index 3)
const DP_COLUMNS = {
  matricule: 0,
  date_recrutement: 2,
  nom: 3,
  prenom: 4,
  cin: 5,
  date_naissance: 6,
  sf: 7,
  ne: 8,
  echelon: 9,
  categorie: 10,
  badges: 11,
  fonction: 12,
  adresse: 13,
  contrat: 14,
  duree: 15,
  cnss: 16,
  bq_poste: 17,
  rib_ccp: 18,
  salaire_brut: 19,
  nouveau_brut: 20,
  date_sortie: 21,
};

const POINTAGE_COLUMNS = {
  matricule: 0,
  nom: 2,
  prenom: 3,
  absences: 4,
  avances: 5,
  conges_payes: 6,
  heures_sup: 7,
};

function cleanStr(v) {
  return String(v ?? '').trim();
}

function parseNum(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function detectDateMonthYear(filename) {
  const months = {
    'janvier': 1, 'fevrier': 2, 'février': 2, 'mars': 3, 'avril': 4,
    'mai': 5, 'juin': 6, 'juillet': 7, 'aout': 8, 'août': 8,
    'septembre': 9, 'octobre': 10, 'novembre': 11, 'decembre': 12, 'décembre': 12
  };
  const lower = filename.toLowerCase();
  for (const [name, num] of Object.entries(months)) {
    if (lower.includes(name)) {
      const yearMatch = lower.match(/20\d{2}/);
      const annee = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();
      return { mois: num, annee };
    }
  }
  return null;
}

function parseFichePersonnel(workbook, filename) {
  const employees = [];
  const pointage = [];

  const dpSheet = workbook.Sheets['DP'];
  if (dpSheet) {
    const data = XLSX.utils.sheet_to_json(dpSheet, { header: 1, defval: '' });
    let headerRow = 3;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (row && (String(row[1] || '').trim() === 'Mat' || String(row[3] || '').trim() === 'Nom')) {
        headerRow = i;
        break;
      }
    }
    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;
      const nom = cleanStr(row[DP_COLUMNS.nom]);
      const prenom = cleanStr(row[DP_COLUMNS.prenom]);
      if (!nom && !prenom) continue;
      let matricule = cleanStr(row[1]);
      if (!matricule) matricule = String(row[0] || i - headerRow);
      const sf = cleanStr(row[DP_COLUMNS.sf]);
      let situationFam = 'C';
      if (sf === 'M' || sf.toLowerCase().includes('mar')) situationFam = 'M';
      else if (sf === 'D' || sf.toLowerCase().includes('div')) situationFam = 'D';
      else if (sf === 'V' || sf.toLowerCase().includes('veuf')) situationFam = 'V';
      employees.push({
        matricule,
        nom: nom.toUpperCase(),
        prenom,
        cin: cleanStr(row[DP_COLUMNS.cin]),
        date_naissance: cleanStr(row[DP_COLUMNS.date_naissance]),
        situation_fam: situationFam,
        nombre_enfants: Math.max(0, Math.floor(parseNum(row[DP_COLUMNS.ne]))),
        echelon: cleanStr(row[DP_COLUMNS.echelon]),
        categorie: cleanStr(row[DP_COLUMNS.categorie]),
        badges: cleanStr(row[DP_COLUMNS.badges]),
        fonction: cleanStr(row[DP_COLUMNS.fonction]),
        adresse: cleanStr(row[DP_COLUMNS.adresse]),
        type_contrat: cleanStr(row[DP_COLUMNS.contrat]),
        duree: cleanStr(row[DP_COLUMNS.duree]),
        numero_cnss: cleanStr(row[DP_COLUMNS.cnss]),
        bq_ou_poste: cleanStr(row[DP_COLUMNS.bq_poste]),
        rib_ou_ccp: cleanStr(row[DP_COLUMNS.rib_ccp]),
        salaire_brut: parseNum(row[DP_COLUMNS.salaire_brut]),
        nouveau_salaire_brut: parseNum(row[DP_COLUMNS.nouveau_brut]),
        date_sortie: cleanStr(row[DP_COLUMNS.date_sortie]),
        date_recrutement: cleanStr(row[DP_COLUMNS.date_recrutement]),
      });
    }
  }

  const ptgSheet = workbook.Sheets['Pointage'];
  if (ptgSheet) {
    const data = XLSX.utils.sheet_to_json(ptgSheet, { header: 1, defval: '' });
    let headerRow = 3;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (row && String(row[1] || '').trim() === 'Mat') {
        headerRow = i;
        break;
      }
    }
    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;
      const nom = cleanStr(row[POINTAGE_COLUMNS.nom]);
      const prenom = cleanStr(row[POINTAGE_COLUMNS.prenom]);
      if (!nom && !prenom) continue;
      let matricule = cleanStr(row[1]);
      if (!matricule) matricule = String(row[0] || '');
      const absences = cleanStr(row[POINTAGE_COLUMNS.absences]);
      const avances = parseNum(row[POINTAGE_COLUMNS.avances]);
      const cp = cleanStr(row[POINTAGE_COLUMNS.conges_payes]);
      const hs = cleanStr(row[POINTAGE_COLUMNS.heures_sup]);
      if (absences || avances || cp || hs) {
        pointage.push({
          matricule,
          nom: nom.toUpperCase(),
          prenom,
          absences,
          avances,
          conges_payes: cp,
          heures_supplementaires: hs,
        });
      }
    }
  }

  const dateInfo = detectDateMonthYear(filename);
  return {
    employees,
    pointage,
    mois: dateInfo?.mois || new Date().getMonth() + 1,
    annee: dateInfo?.annee || new Date().getFullYear(),
    source_file: filename,
  };
}

function processExcelFile(filePath) {
  const filename = filePath.split('\\').pop();
  try {
    const workbook = XLSX.readFile(filePath);
    const parsed = parseFichePersonnel(workbook, filename);
    const pointageMap = new Map();
    for (const ptg of parsed.pointage) {
      pointageMap.set(ptg.matricule, ptg);
    }
    const sageExport = [];
    const bulletinData = [];
    
    for (const emp of parsed.employees) {
      const ptg = pointageMap.get(emp.matricule);
      const absencesJours = ptg?.absences ? parseNum(ptg.absences) : 0;
      const hs = ptg?.heures_supplementaires ? parseNum(ptg.heures_supplementaires) : 0;
      const avances = ptg?.avances || 0;
      
      const input = {
        salaire_brut: emp.salaire_brut,
        situation_fam: emp.situation_fam,
        nombre_enfants: emp.nombre_enfants,
        absences_jours: absencesJours,
        heures_supplementaires: hs,
        avances: avances,
      };
      
      const calculated = calculateSalary(input);
      
      // Sage export format: MATRICULE;MOIS;ANNEE;RUBRIQUE;MONTANT
      const mois = String(parsed.mois).padStart(2, '0');
      sageExport.push(`${emp.matricule};${mois};${parsed.annee};SBASE;${calculated.salaire_brut}`);
      sageExport.push(`${emp.matricule};${mois};${parsed.annee};CSSAL;${calculated.cnss_salariale}`);
      sageExport.push(`${emp.matricule};${mois};${parsed.annee};IRPP;${calculated.irpp}`);
      sageExport.push(`${emp.matricule};${mois};${parsed.annee};CSS;${calculated.css_salariale}`);
      
      if (calculated.majoration_hs > 0) {
        sageExport.push(`${emp.matricule};${mois};${parsed.annee};HSUP;${calculated.majoration_hs}`);
      }
      
      if (avances > 0) {
        sageExport.push(`${emp.matricule};${mois};${parsed.annee};AVANCE;${avances}`);
      }
      
      bulletinData.push({
        mois: parsed.mois,
        annee: parsed.annee,
        matricule: emp.matricule,
        nom: emp.nom,
        prenom: emp.prenom,
        fonction: emp.fonction,
        categorie: emp.categorie,
        echelon: emp.echelon,
        situation_fam: emp.situation_fam,
        nombre_enfants: emp.nombre_enfants,
        date_naissance: emp.date_naissance,
        cin: emp.cin,
        numero_cnss: emp.numero_cnss,
        salaire_brut: emp.salaire_brut,
        absences: absencesJours,
        heures_supplementaires: hs,
        avances: avances,
        ...calculated,
      });
    }
    
    return {
      filename,
      mois: parsed.mois,
      annee: parsed.annee,
      employeesCount: parsed.employees.length,
      sageExport,
      bulletinData,
    };
  } catch (error) {
    console.error(`Error processing ${filename}:`, error.message);
    return null;
  }
}

// Main
const files = [
  'D:\\base de paie\\Liste du personnel du mois de Janvier 2026.xls',
  'D:\\base de paie\\Liste du personnel du mois de Février 2026.xls',
  'D:\\base de paie\\Liste du personnel du mois de Mars 2026 VF.xls',
  "D:\\base de paie\\Liste du personnel du mois d'Avril 2026.xls",
  'D:\\base de paie\\Liste du personnel du mois de mai 2026.xls',
  'D:\\base de paie\\Liste du personnel du mois de juin 2026.xls',
  'D:\\base de paie\\Liste du personnel du mois de juillet 2026.xls',
  'D:\\base de paie\\Liste du personnel du mois de aout 2026.xls',
];

console.log('Processing all Excel files and saving Sage export...\n');

const allSageExports = [];
const allBulletinData = [];

for (const file of files) {
  const result = processExcelFile(file);
  if (result) {
    allSageExports.push(...result.sageExport);
    allBulletinData.push(...result.bulletinData);
    console.log(`✓ ${result.filename}: ${result.employeesCount} employees`);
  }
}

// Save Sage export to CSV
const sageContent = allSageExports.join('\n');
fs.writeFileSync('D:\\base de paie\\sage_export_paie_2026.csv', sageContent);
console.log(`\n✓ Sage export saved to: D:\\base de paie\\sage_export_paie_2026.csv`);
console.log(`  Total lines: ${allSageExports.length}`);

// Save bulletin data as JSON for reference
fs.writeFileSync('D:\\base de paie\\bulletin_data_2026.json', JSON.stringify(allBulletinData, null, 2));
console.log(`✓ Bulletin data saved to: D:\\base de paie\\bulletin_data_2026.json`);
console.log(`  Total bulletins: ${allBulletinData.length}`);

// Summary by month
console.log('\n--- Summary by Month ---');
const byMonth = {};
for (const b of allBulletinData) {
  const key = `${b.mois}/${b.annee}`;
  if (!byMonth[key]) byMonth[key] = { count: 0, totalBrut: 0, totalNet: 0 };
  byMonth[key].count++;
  byMonth[key].totalBrut += b.salaire_brut;
  byMonth[key].totalNet += b.salaire_net;
}

for (const [month, data] of Object.entries(byMonth).sort((a, b) => {
  const [ma] = a[0].split('/');
  const [mb] = b[0].split('/');
  return parseInt(ma) - parseInt(mb);
})) {
  console.log(`${month}: ${data.count} employees, Brut=${data.totalBrut.toFixed(2)}, Net=${data.totalNet.toFixed(2)}`);
}