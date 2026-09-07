const XLSX = require('xlsx');
const path = require('path');

const PAIE_DIR = 'D:/base de paie';

const files = [
  { file: 'Liste du personnel du mois de Janvier 2026.xls', month: 'JANVIER' },
  { file: 'Liste du personnel du mois de Février 2026.xls', month: 'FEVRIER' },
  { file: 'Liste du personnel du mois de Mars 2026 VF.xls', month: 'MARS' },
  { file: "Liste du personnel du mois d'Avril 2026.xls", month: 'AVRIL' },
  { file: 'Liste du personnel du mois de mai 2026.xls', month: 'MAI' },
  { file: 'Liste du personnel du mois de juin 2026.xls', month: 'JUIN' },
  { file: 'Liste du personnel du mois de juillet 2026.xls', month: 'JUILLET' },
  { file: 'Liste du personnel du mois de aout 2026.xls', month: 'AOUT' },
];

// Step 1: Read DP sheet from first file to build matricule -> name mapping
const wb0 = XLSX.readFile(path.join(PAIE_DIR, files[0].file));
const dpData = XLSX.utils.sheet_to_json(wb0.Sheets['DP'], { header: 1, defval: null });

// DP header row 3: [null,"Mat","Date Recrutement","Nom","Prénom",...]
// DP data starts at row 4
const matToName = new Map();
const nameToMat = new Map();

for (let r = 4; r < dpData.length; r++) {
  const row = dpData[r];
  const mat = row[1]; // Actual matricule (e.g. 209059)
  const nom = (row[3] || '').toString().trim();
  const prenom = (row[4] || '').toString().trim();
  if (!mat || !nom) continue;
  const key = `${nom}|${prenom}`;
  matToName.set(String(mat), { nom, prenom });
  if (!nameToMat.has(key)) {
    nameToMat.set(key, String(mat));
  }
}

console.log(`Found ${matToName.size} employees in DP sheet`);
console.log(`Unique name keys: ${nameToMat.size}`);

// Step 2: Read each month's Pointage sheet and extract transport values
// Map: nameKey -> { mat, nom, prenom, values: Map<month, transportValue> }
const employees = new Map();

for (const { file, month } of files) {
  const filePath = path.join(PAIE_DIR, file);
  let wb;
  try {
    wb = XLSX.readFile(filePath);
  } catch (e) {
    console.log(`ERROR reading ${file}: ${e.message}`);
    continue;
  }
  const ws = wb.Sheets['Pointage'];
  if (!ws) {
    console.log(`No Pointage sheet in ${file}`);
    continue;
  }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Detect transport column: look for column where most numeric values are paliers (0/100/200/300)
  const palierSet = new Set([0, 100, 200, 300]);
  let transportCol = -1;
  let bestScore = 0;

  for (let c = 5; c < 20; c++) {
    let palierCount = 0;
    let numericCount = 0;
    for (let r = 5; r < Math.min(data.length, 50); r++) {
      const val = data[r][c];
      if (typeof val === 'number') {
        numericCount++;
        if (palierSet.has(val)) palierCount++;
      }
    }
    if (numericCount >= 5 && palierCount / numericCount >= 0.8 && palierCount > bestScore) {
      bestScore = palierCount;
      transportCol = c;
    }
  }

  if (transportCol < 0) {
    console.log(`Could not find transport column in ${file}`);
    continue;
  }

  console.log(`${month}: transport column = ${transportCol}`);

  // Extract transport values from Pointage
  // Pointage col0 = category number, col1 = Mat (always null), col2 = Nom, col3 = Prénom
  for (let r = 5; r < data.length; r++) {
    const row = data[r];
    const nom = (row[2] || '').toString().trim();
    const prenom = (row[3] || '').toString().trim();
    const transportVal = row[transportCol];

    if (!nom) continue;

    const nameKey = `${nom}|${prenom}`;
    const mat = nameToMat.get(nameKey) || '';

    if (!employees.has(nameKey)) {
      employees.set(nameKey, { mat, nom, prenom, values: new Map() });
    }
    const emp = employees.get(nameKey);
    if (mat && !emp.mat) emp.mat = mat;

    if (transportVal !== null && transportVal !== undefined) {
      emp.values.set(month, transportVal);
    }
  }
}

// Step 3: Collect all distinct palier values
const allPaliers = new Set();

console.log('\n' + '='.repeat(110));
console.log('TRANSPORT PLEIN - Distinct values per employee across 8 months (Jan-Aug 2026)');
console.log('='.repeat(110));

const monthOrder = ['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT'];

const sortedEmployees = [...employees.values()].sort((a, b) => {
  const ma = parseInt(a.mat) || 0;
  const mb = parseInt(b.mat) || 0;
  return ma - mb || a.nom.localeCompare(b.nom);
});

for (const emp of sortedEmployees) {
  if (emp.values.size === 0) continue;

  const monthly = monthOrder.map(m => {
    const v = emp.values.get(m);
    return v !== undefined ? v : '-';
  });
  const distinctVals = [...new Set(emp.values.values())];

  console.log(`\nMat: ${emp.mat || 'N/A'} | ${emp.nom} ${emp.prenom}`);
  console.log(`  ${monthOrder.map((m, i) => m.substring(0, 3) + '=' + monthly[i]).join(' | ')}`);
  console.log(`  Distinct paliers: [${distinctVals.join(', ')}]`);

  distinctVals.forEach(v => allPaliers.add(v));
}

console.log('\n' + '='.repeat(110));
console.log('ALL DISTINCT PALIERS found across all employees:');
console.log('='.repeat(110));

const sortedPaliers = [...allPaliers].sort((a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
});

sortedPaliers.forEach(p => console.log(`  - ${p}`));

console.log(`\nTotal distinct paliers: ${allPaliers.size}`);
console.log(`Total employees with transport data: ${[...employees.values()].filter(e => e.values.size > 0).length}`);
