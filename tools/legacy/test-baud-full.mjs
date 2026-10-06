// Test BAUD module: Parse Excel files, calculate salaries, export to Sage
import XLSX from 'xlsx';
import { calculateSalary } from './web/src/lib/baudCalculator.ts';

// Column indices for "Liste du personnel" DP sheet (0-based, header row at index 3)
const DP_COLUMNS = {
  matricule: 0,       // Col A: row number (used as matricule fallback)
  date_recrutement: 2, // Col C
  nom: 3,             // Col D
  prenom: 4,          // Col E
  cin: 5,             // Col F
  date_naissance: 6,  // Col G
  sf: 7,              // Col H: Situation familiale
  ne: 8,              // Col I: Nombre d'enfants
  echelon: 9,         // Col J
  categorie: 10,      // Col K
  badges: 11,         // Col L
  fonction: 12,       // Col M
  adresse: 13,        // Col N
  contrat: 14,        // Col O
  duree: 15,          // Col P
  cnss: 16,           // Col Q
  bq_poste: 17,       // Col R
  rib_ccp: 18,        // Col S
  salaire_brut: 19,   // Col T
  nouveau_brut: 20,   // Col U
  date_sortie: 21,    // Col V
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

  // Parse DP sheet
  const dpSheet = workbook.Sheets['DP'];
  if (dpSheet) {
    const data = XLSX.utils.sheet_to_json(dpSheet, { header: 1, defval: '' });

    // Find header row (look for "Mat" or "Nom" in first 10 rows)
    let headerRow = 3;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (row && (String(row[1] || '').trim() === 'Mat' || String(row[3] || '').trim() === 'Nom')) {
        headerRow = i;
        break;
      }
    }

    // Parse employees from rows after header
    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const nom = cleanStr(row[DP_COLUMNS.nom]);
      const prenom = cleanStr(row[DP_COLUMNS.prenom]);
      if (!nom && !prenom) continue; // Skip empty rows

      // Matricule: use the "Mat" column (index 1) if present, otherwise use row number
      let matricule = cleanStr(row[1]);
      if (!matricule) {
        matricule = String(row[0] || i - headerRow);
      }

      const sf = cleanStr(row[DP_COLUMNS.sf]);
      let situationFam = 'C'; // Default: célibataire
      if (sf === 'M' || sf.toLowerCase().includes('mar')) situationFam = 'M';
      else if (sf === 'C' || sf.toLowerCase().includes('célib') || sf.toLowerCase().includes('celib')) situationFam = 'C';
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

  // Parse Pointage sheet
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

    // Pointage has alternating rows: data row + detail row
    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;

      const nom = cleanStr(row[POINTAGE_COLUMNS.nom]);
      const prenom = cleanStr(row[POINTAGE_COLUMNS.prenom]);
      if (!nom && !prenom) continue;

      let matricule = cleanStr(row[1]);
      if (!matricule) matricule = String(row[0] || '');

      // Skip detail rows (row after each employee, with phone loans etc.)
      const absences = cleanStr(row[POINTAGE_COLUMNS.absences]);
      const avances = parseNum(row[POINTAGE_COLUMNS.avances]);
      const cp = cleanStr(row[POINTAGE_COLUMNS.conges_payes]);
      const hs = cleanStr(row[POINTAGE_COLUMNS.heures_sup]);

      // Only add if has meaningful data
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

// Generate Sage Paie 100 export
function generateSageExport(matricule, result, calculated) {
  const lines = [];
  const mois = String(result.mois).padStart(2, '0');
  const annee = result.annee;
  
  // Format: MATRICULE;MOIS;ANNEE;RUBRIQUE;MONTANT
  lines.push(`${matricule};${mois};${annee};SBASE;${calculated.salaire_brut}`);
  lines.push(`${matricule};${mois};${annee};CSSAL;${calculated.cnss_salariale}`);
  lines.push(`${matricule};${mois};${annee};IRPP;${calculated.irpp}`);
  lines.push(`${matricule};${mois};${annee};CSS;${calculated.css_salariale}`);
  
  if (calculated.majoration_hs > 0) {
    lines.push(`${matricule};${mois};${annee};HSUP;${calculated.majoration_hs}`);
  }
  
  if (result.avances > 0) {
    lines.push(`${matricule};${mois};${annee};AVANCE;${result.avances}`);
  }
  
  return lines;
}

// Process a single Excel file
function processExcelFile(filePath) {
  const filename = filePath.split('\\').pop();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${filename}`);
  console.log('='.repeat(60));

  try {
    const workbook = XLSX.readFile(filePath);
    const parsed = parseFichePersonnel(workbook, filename);
    
    console.log(`Month: ${parsed.mois}/${parsed.annee}`);
    console.log(`Employees found: ${parsed.employees.length}`);
    console.log(`Pointage records: ${parsed.pointage.length}`);
    
    // Create pointage lookup by matricule
    const pointageMap = new Map();
    for (const ptg of parsed.pointage) {
      pointageMap.set(ptg.matricule, ptg);
    }
    
    // Calculate salaries for each employee
    const results = [];
    const sageExport = [];
    
    for (const emp of parsed.employees) {
      const ptg = pointageMap.get(emp.matricule);
      
      // Get absences and HS from pointage
      const absencesJours = ptg?.absences ? parseNum(ptg.absences) : 0;
      const hs = ptg?.heures_supplementaires ? parseNum(ptg.heures_supplementaires) : 0;
      const avances = ptg?.avances || 0;
      
      // Calculate salary
      const input = {
        salaire_brut: emp.salaire_brut,
        situation_fam: emp.situation_fam,
        nombre_enfants: emp.nombre_enfants,
        absences_jours: absencesJours,
        heures_supplementaires: hs,
        avances: avances,
      };
      
      const calculated = calculateSalary(input);
      
      results.push({
        matricule: emp.matricule,
        nom: emp.nom,
        prenom: emp.prenom,
        salaire_brut: emp.salaire_brut,
        ...calculated,
      });
      
      // Generate Sage export
      sageExport.push(...generateSageExport(emp.matricule, {
        mois: parsed.mois,
        annee: parsed.annee,
        avances: avances,
      }, calculated));
    }
    
    // Print summary
    console.log('\n--- Summary ---');
    console.log(`Total employees: ${results.length}`);
    
    if (results.length > 0) {
      const totalBrut = results.reduce((sum, r) => sum + r.salaire_brut, 0);
      const totalNet = results.reduce((sum, r) => sum + r.salaire_net, 0);
      const totalCNSS = results.reduce((sum, r) => sum + r.cnss_salariale, 0);
      const totalIRPP = results.reduce((sum, r) => sum + r.irpp, 0);
      const totalCSS = results.reduce((sum, r) => sum + r.css_salariale, 0);
      
      console.log(`Total Brut: ${totalBrut.toFixed(3)} DT`);
      console.log(`Total CNSS: ${totalCNSS.toFixed(3)} DT`);
      console.log(`Total IRPP: ${totalIRPP.toFixed(3)} DT`);
      console.log(`Total CSS: ${totalCSS.toFixed(3)} DT`);
      console.log(`Total Net: ${totalNet.toFixed(3)} DT`);
    }
    
    // Print first 5 employees
    console.log('\n--- First 5 employees ---');
    for (const r of results.slice(0, 5)) {
      console.log(`${r.matricule} ${r.nom} ${r.prenom}: Brut=${r.salaire_brut}, CNSS=${r.cnss_salariale.toFixed(3)}, IRPP=${r.irpp.toFixed(3)}, CSS=${r.css_salariale.toFixed(3)}, Net=${r.salaire_net.toFixed(3)}`);
    }
    
    // Print Sage export (first 10 lines)
    console.log('\n--- Sage Export (first 10 lines) ---');
    for (const line of sageExport.slice(0, 10)) {
      console.log(line);
    }
    
    return {
      filename,
      mois: parsed.mois,
      annee: parsed.annee,
      employeesCount: results.length,
      results,
      sageExport,
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
  'D:\\base de paie\\Liste du personnel du mois d\'Avril 2026.xls',
  'D:\\base de paie\\Liste du personnel du mois de mai 2026.xls',
  'D:\\base de paie\\Liste du personnel du mois de juin 2026.xls',
  'D:\\base de paie\\Liste du personnel du mois de juillet 2026.xls',
  'D:\\base de paie\\Liste du personnel du mois de aout 2026.xls',
];

console.log('BAUD Module - Full Test');
console.log('Processing all Excel files...\n');

const allResults = [];
for (const file of files) {
  const result = processExcelFile(file);
  if (result) {
    allResults.push(result);
  }
}

// Final summary
console.log('\n\n' + '='.repeat(60));
console.log('FINAL SUMMARY');
console.log('='.repeat(60));
console.log(`Total files processed: ${allResults.length}`);
console.log(`Total employees across all months: ${allResults.reduce((sum, r) => sum + r.employeesCount, 0)}`);

// Save all Sage exports to a single file
const allSageExports = allResults.flatMap(r => r.sageExport);
console.log(`\nTotal Sage export lines: ${allSageExports.length}`);
console.log('\nFirst 20 lines of combined Sage export:');
for (const line of allSageExports.slice(0, 20)) {
  console.log(line);
}