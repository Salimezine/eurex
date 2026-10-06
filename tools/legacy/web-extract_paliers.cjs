/**
 * Extract transport_plein and nuit_plein per employee from bulletins + Excel
 */
const XLSX = require('xlsx');

const FILES = [
  { month: 6, file: 'D:/base de paie/Liste du personnel du mois de juin 2026.xls' },
];

// June bulletin — transport and nuit values per employee
// transport in bulletin = transport_plein × revalorisation(1.05 for June) × coefficient
// For coeff=1.0 employees: transport_bulletin / 1.05 = transport_plein
const bulletin_june = {
  'BACCOUCHE':  { transport: 93.055, nuit: 78.693, coeff: 21/22, fonction: 'Ouvrier' },
  'ROUHI':      { transport: 105.560, nuit: 0, coeff: 1.0, fonction: 'Chef d\'équipe' },
  'BAOUAB':     { transport: 105.560, nuit: 0, coeff: 1.0, fonction: 'Chef d\'équipe' },
  'BEN SLIMENE':{ transport: 84.188, nuit: 0, coeff: 19/22, fonction: 'Ouvrier' },
  'KAABI':      { transport: 93.055, nuit: 0, coeff: 21/22, fonction: 'Ouvrier' },
  'RAYSI':      { transport: 97.440, nuit: 0, coeff: 1.0, fonction: 'Ouvrier' },
  'CHABANE':    { transport: 86.348, nuit: 0, coeff: 18/22, fonction: 'Ouvrier' },
  'FRIX':       { transport: 105.560, nuit: 65.616, coeff: 1.0, fonction: 'Chef d\'équipe' },
  'BOUCHAHDA':  { transport: 105.560, nuit: 88.598, coeff: 1.0, fonction: 'Chef d\'équipe' },
  'HECHI':      { transport: 105.560, nuit: 63.501, coeff: 1.0, fonction: 'Chef d\'équipe' },
  'ROUHI I':    { transport: 105.560, nuit: 66.876, coeff: 1.0, fonction: 'Chef d\'équipe' },
  'RAGUEZ':     { transport: 105.560, nuit: 67.720, coeff: 1.0, fonction: 'Chef d\'équipe' },
  'ZAYNI':      { transport: 105.560, nuit: 0, coeff: 1.0, fonction: 'Chef d\'équipe' },
  'AAMRI':      { transport: 105.560, nuit: 0, coeff: 1.0, fonction: 'Conducteur d\'engins' },
  'EL MANNAI':  { transport: 97.440, nuit: 63.218, coeff: 1.0, fonction: 'Ouvrier' },
  'HASSINE':    { transport: 97.440, nuit: 0, coeff: 1.0, fonction: 'Ouvrier' },
  'ELWAER':     { transport: 97.440, nuit: 0, coeff: 1.0, fonction: 'Ouvrier' },
  'LAZAAR':     { transport: 105.560, nuit: 0, coeff: 1.0, fonction: 'Chef d\'équipe' },
  'RHILI':      { transport: 97.440, nuit: 0, coeff: 1.0, fonction: 'Ouvrier' },
  'SLIMEN':     { transport: 97.440, nuit: 0, coeff: 1.0, fonction: 'Ouvrier' },
  'SIRAT':      { transport: 105.560, nuit: 78.693, coeff: 1.0, fonction: 'Chef d\'équipe' },
};

console.log('=== TRANSPORT_PLEIN EXTRACTION ===\n');
console.log('Formula: transport_plein = bulletin_transport / (revalorisation × coefficient)');
console.log('For June 2026: revalorisation = 1.05\n');

// Group by transport_plein
const transportGroups = {};
for (const [name, data] of Object.entries(bulletin_june)) {
  const reval = 1.05; // June 2026
  const plein = Math.round((data.transport / (reval * data.coeff)) * 1000) / 1000;
  if (!transportGroups[plein]) transportGroups[plein] = [];
  transportGroups[plein].push({ name, bulletin_transport: data.transport, coeff: data.coeff, fonction: data.fonction });
}

console.log('TRANSPORT PALIERS:');
for (const [plein, employees] of Object.entries(transportGroups).sort((a,b) => parseFloat(a[0]) - parseFloat(b[0]))) {
  console.log(`\n  Palier ${plein} DT:`);
  for (const emp of employees) {
    console.log(`    ${emp.name.padEnd(15)} bulletin=${emp.bulletin_transport} coeff=${emp.coeff.toFixed(4)} fonction=${emp.fonction}`);
  }
}

console.log('\n\n=== NUIT_PLEIN EXTRACTION ===\n');
console.log('Formula: nuit_plein = bulletin_nuit / coefficient (for coeff=1.0, bulletin = plein)\n');

// Group by nuit value
const nuitValues = {};
for (const [name, data] of Object.entries(bulletin_june)) {
  if (data.nuit === 0) continue;
  // For coeff=1.0, nuit_bulletin = nuit_plein
  // For coeff<1.0, nuit_plein = nuit_bulletin / coeff
  const plein = data.coeff === 1.0 ? data.nuit : Math.round((data.nuit / data.coeff) * 1000) / 1000;
  if (!nuitValues[plein]) nuitValues[plein] = [];
  nuitValues[plein].push({ name, bulletin_nuit: data.nuit, coeff: data.coeff, fonction: data.fonction });
}

console.log('NUIT PALIERS:');
for (const [plein, employees] of Object.entries(nuitValues).sort((a,b) => parseFloat(a[0]) - parseFloat(b[0]))) {
  console.log(`\n  Palier ${plein} DT:`);
  for (const emp of employees) {
    console.log(`    ${emp.name.padEnd(15)} bulletin=${emp.bulletin_nuit} coeff=${emp.coeff.toFixed(4)} fonction=${emp.fonction}`);
  }
}

// Summary: who has nuit and who doesn't
console.log('\n\n=== NIGHT WORK DISTRIBUTION ===\n');
const withNuit = Object.entries(bulletin_june).filter(([_,d]) => d.nuit > 0).map(([n,d]) => n);
const withoutNuit = Object.entries(bulletin_june).filter(([_,d]) => d.nuit === 0).map(([n,d]) => `${n} (${d.fonction})`);
console.log('WITH nuit:', withNuit.join(', '));
console.log('WITHOUT nuit:', withoutNuit.join(', '));
