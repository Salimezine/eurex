// Test AI verification system (simplified version without TS imports)
import XLSX from 'xlsx';

// IRPP brackets (annual, LF 2025)
const IRPP_BRACKETS = [
  { min: 0, max: 5000, rate: 0 },
  { min: 5000, max: 10000, rate: 0.15 },
  { min: 10000, max: 20000, rate: 0.25 },
  { min: 20000, max: 30000, rate: 0.30 },
  { min: 30000, max: 40000, rate: 0.33 },
  { min: 40000, max: 50000, rate: 0.36 },
  { min: 50000, max: 70000, rate: 0.38 },
  { min: 70000, max: Infinity, rate: 0.40 },
];

const CONSTANTS = {
  CNSS_SALARIAL: 0.0968,
  CNSS_PATRONAL: 0.1657,
  AT_MP: 0.005,
  TFP: 0.01,
  FOPROLOS: 0.01,
  CSS: 0.005,
  PLAFOND_CNSS: 5000,
  SMIG: 480,
  FRAIS_PRO_MAX: 2000,
  FRAIS_PRO_RATE: 0.10,
};

// Column indices
const DP_COLUMNS = {
  matricule: 0, date_recrutement: 2, nom: 3, prenom: 4, cin: 5,
  date_naissance: 6, sf: 7, ne: 8, echelon: 9, categorie: 10,
  badges: 11, fonction: 12, adresse: 13, contrat: 14, duree: 15,
  cnss: 16, bq_poste: 17, rib_ccp: 18, salaire_brut: 19,
  nouveau_brut: 20, date_sortie: 21,
};

const POINTAGE_COLUMNS = {
  matricule: 0, nom: 2, prenom: 3, absences: 4, avances: 5,
  conges_payes: 6, heures_sup: 7,
};

function cleanStr(v) { return String(v ?? '').trim(); }
function parseNum(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function calculateSalary(input) {
  const { salaire_brut, situation_fam, nombre_enfants, absences_jours = 0, heures_supplementaires = 0, avances = 0 } = input;
  const brut = Math.max(0, salaire_brut);
  const heures_par_mois = (40 * 52) / 12;
  const taux_horaire = brut / heures_par_mois;
  const hs_25 = Math.min(heures_supplementaires, 8 * 4.33);
  const hs_50 = Math.max(0, heures_supplementaires - hs_25);
  const majoration_hs = Math.round((taux_horaire * hs_25 * 0.25 + taux_horaire * hs_50 * 0.50) * 1000) / 1000;
  const brut_total = Math.round((brut + majoration_hs) * 1000) / 1000;
  const assiette_cnss = Math.min(brut_total, CONSTANTS.PLAFOND_CNSS);
  const cnss_salariale = Math.round(assiette_cnss * CONSTANTS.CNSS_SALARIAL * 1000) / 1000;
  const revenu_imposable = Math.max(0, brut_total - cnss_salariale);
  const frais_pro_annuel = Math.min(revenu_imposable * 12 * CONSTANTS.FRAIS_PRO_RATE, CONSTANTS.FRAIS_PRO_MAX);
  const frais_pro = Math.round((frais_pro_annuel / 12) * 1000) / 1000;
  const revenu_net_imposable = Math.max(0, revenu_imposable - frais_pro);
  const revenu_annuel_imposable = revenu_net_imposable * 12;
  let irpp_annuel = 0;
  let remaining_annuel = revenu_annuel_imposable;
  for (const bracket of IRPP_BRACKETS) {
    if (remaining_annuel <= 0) break;
    const tranche_size = bracket.max === Infinity ? remaining_annuel : bracket.max - bracket.min;
    const taxable = Math.min(remaining_annuel, tranche_size);
    irpp_annuel += taxable * bracket.rate;
    remaining_annuel -= taxable;
  }
  const irpp = Math.round((irpp_annuel / 12) * 1000) / 1000;
  const css_salariale = Math.round(revenu_net_imposable * CONSTANTS.CSS * 1000) / 1000;
  const total_retenues = Math.round((cnss_salariale + irpp + css_salariale + avances) * 1000) / 1000;
  const salaire_net = Math.round((brut_total - total_retenues) * 1000) / 1000;
  return { salaire_brut: brut, cnss_salariale, irpp, css_salariale, revenu_net_imposable, total_retenues, salaire_net, net_a_payer: salaire_net, majoration_hs, heures_supplementaires };
}

function parseExcelFile(filePath) {
  const filename = filePath.split('\\').pop();
  const workbook = XLSX.readFile(filePath);
  const employees = [];
  const pointage = [];
  const dpSheet = workbook.Sheets['DP'];
  if (dpSheet) {
    const data = XLSX.utils.sheet_to_json(dpSheet, { header: 1, defval: '' });
    let headerRow = 3;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (row && (String(row[1] || '').trim() === 'Mat' || String(row[3] || '').trim() === 'Nom')) { headerRow = i; break; }
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
        matricule, nom: nom.toUpperCase(), prenom,
        cin: cleanStr(row[DP_COLUMNS.cin]),
        date_naissance: cleanStr(row[DP_COLUMNS.date_naissance]),
        situation_fam: situationFam,
        nombre_enfants: Math.max(0, Math.floor(parseNum(row[DP_COLUMNS.ne]))),
        echelon: cleanStr(row[DP_COLUMNS.echelon]),
        categorie: cleanStr(row[DP_COLUMNS.categorie]),
        fonction: cleanStr(row[DP_COLUMNS.fonction]),
        type_contrat: cleanStr(row[DP_COLUMNS.contrat]),
        numero_cnss: cleanStr(row[DP_COLUMNS.cnss]),
        rib_ou_ccp: cleanStr(row[DP_COLUMNS.rib_ccp]),
        salaire_brut: parseNum(row[DP_COLUMNS.salaire_brut]),
        nouveau_salaire_brut: parseNum(row[DP_COLUMNS.nouveau_brut]),
      });
    }
  }
  const ptgSheet = workbook.Sheets['Pointage'];
  if (ptgSheet) {
    const data = XLSX.utils.sheet_to_json(ptgSheet, { header: 1, defval: '' });
    let headerRow = 3;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (row && String(row[1] || '').trim() === 'Mat') { headerRow = i; break; }
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
        pointage.push({ matricule, nom: nom.toUpperCase(), prenom, absences, avances, conges_payes: cp, heures_supplementaires: hs });
      }
    }
  }
  return { employees, pointage, filename };
}

function verifyEmployee(emp, ptg, result) {
  const checks = [];
  const empLabel = `${emp.nom} ${emp.prenom}`;
  
  // Check SMIG
  if (result.salaire_brut < CONSTANTS.SMIG) {
    checks.push({ name: 'Salaire < SMIG', status: 'warning', detail: `${empLabel}: Brut ${result.salaire_brut} < SMIG ${CONSTANTS.SMIG}` });
  }
  
  // Verify CNSS
  const expectedCNSS = Math.round(Math.min(result.salaire_brut, CONSTANTS.PLAFOND_CNSS) * CONSTANTS.CNSS_SALARIAL * 1000) / 1000;
  if (Math.abs(result.cnss_salariale - expectedCNSS) > 0.01) {
    checks.push({ name: 'CNSS incorrect', status: 'error', detail: `${empLabel}: CNSS ${result.cnss_salariale} ≠ attendu ${expectedCNSS}` });
  }
  
  // Verify IRPP
  const annual = result.revenu_net_imposable * 12;
  let expectedIRPPAnnual = 0;
  let remaining = annual;
  for (const bracket of IRPP_BRACKETS) {
    if (remaining <= 0) break;
    const size = bracket.max === Infinity ? remaining : bracket.max - bracket.min;
    const taxable = Math.min(remaining, size);
    expectedIRPPAnnual += taxable * bracket.rate;
    remaining -= taxable;
  }
  const expectedIRPP = Math.round((expectedIRPPAnnual / 12) * 1000) / 1000;
  if (Math.abs(result.irpp - expectedIRPP) > 0.01) {
    checks.push({ name: 'IRPP incorrect', status: 'error', detail: `${empLabel}: IRPP ${result.irpp} ≠ attendu ${expectedIRPP}` });
  }
  
  // Verify CSS
  const expectedCSS = Math.round(result.revenu_net_imposable * CONSTANTS.CSS * 1000) / 1000;
  if (Math.abs(result.css_salariale - expectedCSS) > 0.01) {
    checks.push({ name: 'CSS incorrect', status: 'error', detail: `${empLabel}: CSS ${result.css_salariale} ≠ attendu ${expectedCSS}` });
  }
  
  // Check pointage
  if (!ptg) {
    checks.push({ name: 'Pointage manquant', status: 'warning', detail: `${empLabel}: Aucune donnée de pointage` });
  } else {
    const absences = parseInt(ptg.absences) || 0;
    if (absences > 22) {
      checks.push({ name: 'Absences excessives', status: 'warning', detail: `${empLabel}: ${absences} absences (> 22 jours/mois)` });
    }
    if (ptg.avances > result.salaire_brut * 0.5) {
      checks.push({ name: 'Avances élevées', status: 'warning', detail: `${empLabel}: Avances ${ptg.avances} > 50% du brut` });
    }
  }
  
  // Check negative
  if (result.salaire_net < 0) {
    checks.push({ name: 'Salaire net négatif', status: 'error', detail: `${empLabel}: Net ${result.salaire_net} < 0` });
  }
  
  if (checks.length === 0) {
    checks.push({ name: 'Vérification OK', status: 'ok', detail: `${empLabel}: Tous les calculs sont corrects` });
  }
  
  return checks;
}

// Test with all files
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

console.log('AI Verification System Test\n');
console.log('='.repeat(60));

let totalOk = 0;
let totalWarnings = 0;
let totalErrors = 0;

for (const file of files) {
  const { employees, pointage, filename } = parseExcelFile(file);
  console.log(`\n--- ${filename} ---`);
  console.log(`Employees: ${employees.length}, Pointage: ${pointage.length}`);
  
  const pointageMap = new Map();
  for (const ptg of pointage) pointageMap.set(ptg.matricule, ptg);
  
  let ok = 0, warnings = 0, errors = 0;
  
  for (const emp of employees) {
    const ptg = pointageMap.get(emp.matricule);
    const absences = ptg?.absences ? parseInt(ptg.absences) || 0 : 0;
    const hs = ptg?.heures_supplementaires ? parseFloat(ptg.heures_supplementaires) || 0 : 0;
    const avances = ptg?.avances || 0;
    
    let brut = emp.nouveau_salaire_brut > 0 ? emp.nouveau_salaire_brut : emp.salaire_brut;
    if (absences > 0) brut = Math.round(brut * (22 - absences) / 22 * 1000) / 1000;
    
    const result = calculateSalary({
      salaire_brut: brut,
      situation_fam: emp.situation_fam,
      nombre_enfants: emp.nombre_enfants,
      absences_jours: absences,
      heures_supplementaires: hs,
      avances,
    });
    
    const checks = verifyEmployee(emp, ptg, result);
    for (const check of checks) {
      if (check.status === 'ok') ok++;
      else if (check.status === 'warning') warnings++;
      else if (check.status === 'error') errors++;
    }
  }
  
  console.log(`Results: ${ok} OK, ${warnings} warnings, ${errors} errors`);
  totalOk += ok;
  totalWarnings += warnings;
  totalErrors += errors;
}

console.log('\n' + '='.repeat(60));
console.log(`TOTAL: ${totalOk} OK, ${totalWarnings} warnings, ${totalErrors} errors`);
console.log('AI Verification Test Complete');