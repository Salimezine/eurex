// Check exported Sage files
import XLSX from 'xlsx';

const files = [
  'C:\\Users\\ezzin\\Downloads\\ImportVariables_09-26 (1).xlsx',
  'C:\\Users\\ezzin\\Downloads\\ImportSalaries_09-26 (1).xlsx',
];

for (const file of files) {
  console.log('\n' + '='.repeat(60));
  console.log('File:', file.split('\\').pop());
  console.log('='.repeat(60));

  try {
    const wb = XLSX.readFile(file);
    for (const sheetName of wb.SheetNames) {
      console.log(`\nSheet: ${sheetName}`);
      const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
      console.log(`Rows: ${data.length}`);
      
      // Print first 30 rows
      for (let i = 0; i < Math.min(30, data.length); i++) {
        console.log(`Row ${i + 1}: ${JSON.stringify(data[i])}`);
      }
      
      if (data.length > 30) {
        console.log(`... and ${data.length - 30} more rows`);
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}