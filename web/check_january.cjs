const XLSX = require('xlsx');

const filePath = 'D:\\base de paie\\Liste du personnel du mois de Janvier 2026.xls';

function excelDateToJS(val) {
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return d.toISOString().split('T')[0];
  }
  return String(val).trim();
}

const wb = XLSX.readFile(filePath);
const ws = wb.Sheets['DP'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Header is at row 3 (0-indexed)
const headers = data[3].map(h => String(h).trim());
console.log('Headers:', headers.filter(h => h !== '').join(' | '));

const matriculeIdx = 1;  // "Mat"
const nomIdx = 3;         // "Nom"
const prenomIdx = 4;      // "Prénom"
const dateSortieIdx = 21; // "Date de sortie"
const dateEntreeIdx = 2;  // "Date Recrutement"

const employees = [];
for (let i = 4; i < data.length; i++) {
  const row = data[i];
  if (!row || row.length === 0) continue;

  const matricule = String(row[matriculeIdx] || '').trim();
  const nom = String(row[nomIdx] || '').trim();
  const prenom = String(row[prenomIdx] || '').trim();
  const dateSortieRaw = row[dateSortieIdx];
  const dateEntreeRaw = row[dateEntreeIdx];

  if (!nom) continue;

  const dateSortie = excelDateToJS(dateSortieRaw);
  const dateEntree = excelDateToJS(dateEntreeRaw);
  const hasDateSortie = dateSortie !== '' && dateSortie !== 'undefined' && dateSortie !== 'null';

  employees.push({
    matricule: matricule || '(vide)',
    nom,
    prenom,
    dateSortie: hasDateSortie ? dateSortie : '',
    dateEntree,
    hasDateSortie
  });
}

const total = employees.length;
const withSortie = employees.filter(e => e.hasDateSortie);
const withoutSortie = employees.filter(e => !e.hasDateSortie);

console.log('\n========== RESULTS ==========');
console.log(`Total employees in January 2026 DP sheet: ${total}`);
console.log(`With Date de sortie (former/left): ${withSortie.length}`);
console.log(`Without Date de sortie (current/active): ${withoutSortie.length}`);

console.log('\n--- CURRENT EMPLOYEES (no date_sortie) ---');
console.log('Matricule | Nom | Prénom | Date Recrutement');
console.log('-'.repeat(70));
withoutSortie.forEach(e => {
  console.log(`${e.matricule} | ${e.nom} | ${e.prenom} | ${e.dateEntree}`);
});

console.log('\n--- SAMPLE FORMER EMPLOYEES (with date_sortie) ---');
console.log('Matricule | Nom | Prénom | Date de sortie');
console.log('-'.repeat(70));
withSortie.forEach(e => {
  console.log(`${e.matricule} | ${e.nom} | ${e.prenom} | ${e.dateSortie}`);
});
