const fs = require('fs');
const path = require('path');

const prhPath = path.join('C:', 'Users', 'ezzin', 'Downloads', 'base de paie', 'BASE PAIE 06-2026.PRH');
const buf = fs.readFileSync(prhPath);
const text = buf.toString('latin1');

console.log('=== SEARCHING NUIT PARAMETERS IN PRH ===\n');

// Search for NUIT strings
const keywords = ['NUIT', 'nuit', '150%', '125%', 'MAJORATION', 'HEURES BASE', 'BASE HORAIRE', 'HEURE', 'COEFF'];
for (const kw of keywords) {
  let idx = 0;
  let found = 0;
  while ((idx = text.indexOf(kw, idx)) !== -1) {
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + 60);
    const context = text.substring(start, end).replace(/[^\x20-\x7E]/g, '.');
    console.log(`[${kw}] offset=${idx}: ...${context}...`);
    found++;
    idx++;
    if (found > 5) break;
  }
  if (found === 0) console.log(`[${kw}] NOT FOUND`);
  console.log('');
}

// Also search for numeric patterns near NUIT
console.log('\n=== SEARCHING NUMERIC VALUES NEAR NUIT ===');
let nuitIdx = 0;
while ((nuitIdx = text.indexOf('NUIT', nuitIdx)) !== -1) {
  // Look at bytes around this location for numeric data
  const region = buf.slice(Math.max(0, nuitIdx - 100), nuitIdx + 200);
  // Print hex and ASCII
  let hexLine = '';
  let asciiLine = '';
  for (let i = 0; i < region.length; i++) {
    hexLine += region[i].toString(16).padStart(2, '0') + ' ';
    asciiLine += (region[i] >= 0x20 && region[i] <= 0x7E) ? String.fromCharCode(region[i]) : '.';
    if ((i + 1) % 32 === 0) {
      console.log(hexLine.trim());
      console.log(asciiLine);
      console.log('');
      hexLine = '';
      asciiLine = '';
    }
  }
  if (hexLine) {
    console.log(hexLine.trim());
    console.log(asciiLine);
  }
  console.log('---');
  nuitIdx++;
}
