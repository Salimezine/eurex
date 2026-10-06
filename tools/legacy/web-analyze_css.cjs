const fs = require('fs');
const text = fs.readFileSync('D:/base de paie/bulletin_parsed.txt', 'utf8');
const lines = text.split('\n');

const employees = [];
let currentEmps = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  if (line.startsWith('Rubriques')) {
    const parts = line.split(/\s{2,}/).map(s => s.trim()).filter(s => s.length > 0);
    currentEmps = parts.slice(1);
  }
  
  if (line.includes('8350') && line.includes('CSS')) {
    const vals = line.split(/\s{2,}/).map(s => s.trim()).filter(s => s.length > 0);
    const cssValues = vals.slice(2).map(v => parseFloat(v.replace(',', '.')) || 0);
    for (let j = 0; j < cssValues.length; j++) {
      if (!employees[j]) employees[j] = { name: currentEmps[j] || '?' };
      employees[j].css = cssValues[j];
    }
  }
  
  if (line.includes('8300') && line.includes('Salaire imposable')) {
    const vals = line.split(/\s{2,}/).map(s => s.trim()).filter(s => s.length > 0);
    const impValues = vals.slice(2).map(v => Math.abs(parseFloat(v.replace(',', '.')) || 0));
    for (let j = 0; j < impValues.length; j++) {
      if (!employees[j]) employees[j] = { name: currentEmps[j] || '?' };
      employees[j].imposable = impValues[j];
    }
  }

  if (line.startsWith('Net imposable')) {
    const vals = line.split(/\s{2,}/).map(s => s.trim()).filter(s => s.length > 0);
    const netValues = vals.slice(1).map(v => parseFloat(v.replace(',', '.')) || 0);
    for (let j = 0; j < netValues.length; j++) {
      if (!employees[j]) employees[j] = { name: currentEmps[j] || '?' };
      employees[j].net_imposable = netValues[j];
    }
  }
}

console.log('Emp | Name | Imposable | CSS | Rate (%)');
console.log('--- | ---- | --------- | --- | ---------');
const sorted = employees.filter(e => e && e.css && e.imposable).sort((a, b) => a.imposable - b.imposable);
for (const e of sorted) {
  const rate = (e.css / e.imposable * 100).toFixed(3);
  console.log(`${e.name.padEnd(12)} | ${e.imposable.toFixed(3)} | ${e.css.toFixed(3)} | ${rate}%`);
}

// Try to fit CSS = taux * (imposable - threshold)
// Using least squares on two extreme points
const min = sorted[0];
const max = sorted[sorted.length - 1];
const taux = (max.css - min.css) / (max.imposable - min.imposable);
const threshold = min.imposable - min.css / taux;
console.log('\n--- Modele lineaire: CSS = taux * (imposable - threshold) ---');
console.log(`Taux: ${(taux * 100).toFixed(4)}%`);
console.log(`Threshold: ${threshold.toFixed(2)} DT`);

// Verify with all employees
console.log('\nEmp | Imposable | CSS reel | CSS calc | Ecart');
for (const e of sorted) {
  const calc = Math.round(taux * (e.imposable - threshold) * 1000) / 1000;
  const ecart = (calc - e.css).toFixed(3);
  console.log(`${e.name.padEnd(12)} | ${e.imposable.toFixed(3)} | ${e.css.toFixed(3)} | ${calc.toFixed(3)} | ${ecart}`);
}
