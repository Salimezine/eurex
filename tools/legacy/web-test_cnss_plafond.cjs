/**
 * CNSS PLAFOND TEST — Test on high-salary employees from June bulletin
 * Also tests if savon/douche are excluded from CNSS assiette
 */
const XLSX = require('xlsx');

const CNSS_TAUX = 0.0968;

// All 21 employees from June bulletin with full data
const bulletin = {
  'BACCOUCHE Tahar':    { brut: 1990.392, cnss: 189.926, lait: 28.350, savon: 5.157, douche: 23.875 },
  'ROUHI NABIL':        { brut: 3363.040, cnss: 322.667, lait: 29.700, savon: 5.400, douche: 25.000 },
  'BAOUAB NADA':        { brut: 3538.867, cnss: 339.687, lait: 29.700, savon: 5.400, douche: 25.000 },
  'BEN SLIMENE KARIM':  { brut: 1645.637, cnss: 156.815, lait: 25.650, savon: 4.666, douche: 21.600 },
  'KAABI OLFA':         { brut: 1549.475, cnss: 147.245, lait: 28.350, savon: 5.157, douche: 23.875 },
  'RAYSI SALWA':        { brut: 2470.174, cnss: 236.238, lait: 29.700, savon: 5.400, douche: 25.000 },
  'CHABANE MOHAMED':    { brut: 1735.925, cnss: 165.685, lait: 24.300, savon: 4.417, douche: 20.450 },
  'FRIX FOUAD':         { brut: 2647.203, cnss: 253.374, lait: 29.700, savon: 5.400, douche: 25.000 },
  'BOUCHAHDA WALID':    { brut: 4241.606, cnss: 407.713, lait: 29.700, savon: 5.400, douche: 25.000 },
  'HECHI MOHAMED':      { brut: 2335.619, cnss: 223.213, lait: 29.700, savon: 5.400, douche: 25.000 },
  'ROUHI IMED':         { brut: 2927.787, cnss: 280.535, lait: 29.700, savon: 5.400, douche: 25.000 },
  'RAGUEZ ALI':         { brut: 3192.607, cnss: 306.169, lait: 29.700, savon: 5.400, douche: 25.000 },
  'ZAYNI MAJED':        { brut: 5521.902, cnss: 531.645, lait: 29.700, savon: 5.400, douche: 25.000 },
  'AAMRI MOETEZ':       { brut: 6261.380, cnss: 603.227, lait: 29.700, savon: 5.400, douche: 25.000 },
  'EL MANNAI AMINA':    { brut: 2162.965, cnss: 206.500, lait: 29.700, savon: 5.400, douche: 25.000 },
  'HASSINE FAOUZI':     { brut: 2046.567, cnss: 195.233, lait: 29.700, savon: 5.400, douche: 25.000 },
  'ELWAER MORTADHA':    { brut: 1747.838, cnss: 166.316, lait: 29.700, savon: 5.400, douche: 25.000 },
  'LAZAAR NADER':       { brut: 5481.841, cnss: 0,       lait: 29.700, savon: 5.400, douche: 25.000 },  // CNSS missing in bulletin?
  'RHILI FATMA':        { brut: 1398.103, cnss: 123.836, lait: 29.700, savon: 5.400, douche: 25.000 },
  'SLIMEN SLIM':        { brut: 1308.996, cnss: 0,       lait: 29.700, savon: 5.400, douche: 25.000 },  // CNSS missing in bulletin?
  'SIRAT HAMDI':        { brut: 1730.530, cnss: 164.640, lait: 29.700, savon: 5.400, douche: 25.000 },
};

console.log('=== CNSS PLAFOND TEST — HIGH-SALARY EMPLOYEES ===\n');
console.log('Testing multiple plafond hypotheses:');
console.log('  H1: assiette = brut - lait, plafond = 5000');
console.log('  H2: assiette = brut - lait, plafond = 6000');
console.log('  H3: assiette = brut - lait - savon, plafond = 5000');
console.log('  H4: assiette = brut - lait - savon, plafond = 6000');
console.log('  H5: assiette = brut - lait - douche, plafond = 5000');
console.log('');

// Score each hypothesis
const hypotheses = [
  { name: 'H1: -lait, plafond=5000', calc: (b) => Math.min(Math.max(0, b.brut - b.lait), 5000) * CNSS_TAUX },
  { name: 'H2: -lait, plafond=6000', calc: (b) => Math.min(Math.max(0, b.brut - b.lait), 6000) * CNSS_TAUX },
  { name: 'H3: -lait-savon, plafond=5000', calc: (b) => Math.min(Math.max(0, b.brut - b.lait - b.savon), 5000) * CNSS_TAUX },
  { name: 'H4: -lait-savon, plafond=6000', calc: (b) => Math.min(Math.max(0, b.brut - b.lait - b.savon), 6000) * CNSS_TAUX },
  { name: 'H5: -lait-douche, plafond=5000', calc: (b) => Math.min(Math.max(0, b.brut - b.lait - b.douche), 5000) * CNSS_TAUX },
  { name: 'H6: -lait-douche, plafond=6000', calc: (b) => Math.min(Math.max(0, b.brut - b.lait - b.douche), 6000) * CNSS_TAUX },
];

const scores = {};
for (const h of hypotheses) scores[h.name] = { exact: 0, total: 0, totalDelta: 0 };

for (const [name, b] of Object.entries(bulletin)) {
  if (b.cnss === 0) continue; // Skip employees with missing CNSS in bulletin
  for (const h of hypotheses) {
    const calc = Math.round(h.calc(b) * 1000) / 1000;
    const delta = Math.abs(calc - b.cnss);
    scores[h.name].total++;
    scores[h.name].totalDelta += delta;
    if (delta < 0.01) scores[h.name].exact++;
  }
}

console.log('RESULTS:');
for (const [hname, score] of Object.entries(scores)) {
  const avgDelta = score.totalDelta / score.total;
  const flag = score.exact === score.total ? ' ★★★ PERFECT' : (score.exact >= 18 ? ' ★★ EXCELLENT' : '');
  console.log(`  ${hname.padEnd(35)} ${score.exact}/${score.exact === score.total ? score.total : '??'} exact  avg_delta=${avgDelta.toFixed(4)}${flag}`);
}

// Detailed view for high-salary employees
console.log('\n\nDETAILED — HIGH-SALARY EMPLOYEES (brut > 4000):');
console.log('Name'.padEnd(25), 'Brut'.padEnd(10), 'Assiette(lait)'.padEnd(15), 'H1(5k)'.padEnd(10), 'H2(6k)'.padEnd(10), 'Bulletin CNSS'.padEnd(15), 'Best');
console.log('-'.repeat(100));

for (const [name, b] of Object.entries(bulletin)) {
  if (b.brut < 4000) continue;
  const assiette5k = Math.min(b.brut - b.lait, 5000);
  const assiette6k = Math.min(b.brut - b.lait, 6000);
  const cnss5k = Math.round(assiette5k * CNSS_TAUX * 1000) / 1000;
  const cnss6k = Math.round(assiette6k * CNSS_TAUX * 1000) / 1000;

  const delta5k = Math.abs(cnss5k - b.cnss);
  const delta6k = Math.abs(cnss6k - b.cnss);
  const best = delta5k < delta6k ? '5000 ✓' : (delta6k < delta5k ? '6000' : 'equal');

  console.log(
    `${name.padEnd(25)} ${b.brut.toFixed(3).padEnd(10)} ${assiette5k.toFixed(3).padEnd(15)} ` +
    `${cnss5k.toFixed(3).padEnd(10)} ${cnss6k.toFixed(3).padEnd(10)} ${b.cnss.toFixed(3).padEnd(15)} ${best}`
  );
}
