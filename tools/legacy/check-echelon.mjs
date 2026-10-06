// Check échelon/ancienneté in Excel files
import XLSX from 'xlsx';

const file = 'D:\\base de paie\\Liste du personnel du mois de aout 2026.xls';
const wb = XLSX.readFile(file);
const dpSheet = wb.Sheets['DP'];

if (dpSheet) {
  const data = XLSX.utils.sheet_to_json(dpSheet, { header: 1, defval: '' });
  console.log('DP Sheet - First 30 rows:\n');
  
  for (let i = 0; i < Math.min(35, data.length); i++) {
    const row = data[i];
    console.log(`Row ${i + 1}: ${JSON.stringify(row.slice(0, 15))}`);
  }
  
  // Find header row
  let headerRow = 3;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (row && (String(row[1] || '').trim() === 'Mat' || String(row[3] || '').trim() === 'Nom')) {
      headerRow = i;
      break;
    }
  }
  
  console.log(`\nHeader row: ${headerRow + 1}`);
  console.log(`Headers: ${JSON.stringify(data[headerRow])}`);
  
  // Print sample employee data with all columns
  console.log('\nSample employee data (first 5 employees):\n');
  for (let i = headerRow + 1; i < Math.min(headerRow + 6, data.length); i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    console.log(`Employee ${i - headerRow}:`);
    console.log(`  Mat: ${row[1]}`);
    console.log(`  Date Recrutement: ${row[2]}`);
    console.log(`  Nom: ${row[3]} ${row[4]}`);
    console.log(`  Echelon: ${row[9]}`);
    console.log(`  Catégorie: ${row[10]}`);
    console.log(`  Salaire Brut: ${row[19]}`);
    console.log('');
  }
}