const { parseDMIItems, generateFISCecritures } = require('./server-fisc.js');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(label, actual, expected, tolerance = 0.001) {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Math.abs(actual - expected) <= tolerance) {
      passed++;
    } else {
      failed++;
      console.log(`  FAIL: ${label} — got ${actual}, expected ${expected}`);
    }
  } else {
    if (actual === expected) {
      passed++;
    } else {
      failed++;
      console.log(`  FAIL: ${label} — got "${actual}", expected "${expected}"`);
    }
  }
}

function assertEntry(entries, numeroDoc, compte, sens, montant, tresorerie) {
  const e = entries.find(e => e.numero_doc === numeroDoc && e.compte === compte && e.sens === sens);
  if (!e) {
    failed++;
    console.log(`  FAIL: entry ${numeroDoc} ${compte} ${sens} not found`);
    return;
  }
  assert(`${numeroDoc} ${compte} ${sens} montant`, e.montant, montant);
  if (tresorerie) assert(`${numeroDoc} ${compte} ${sens} tresorerie`, e.tresorerie, tresorerie);
}

// ============================================================
// TEST 1: Parse DMI 01-2026 from actual PDF
// ============================================================
console.log('\n=== TEST 1: Parse DMI 01-2026 from PDF ===');

async function testDMI01() {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfPath = path.join(__dirname, 'uploads', '9120a2095bd020f0_DMI 01-2026.pdf');
  if (!fs.existsSync(pdfPath)) {
    console.log('  SKIP: DMI 01-2026 PDF not found');
    return;
  }

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  let items = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    for (const it of content.items) {
      if (it.str.trim()) {
        items.push({ str: it.str.trim(), x: it.transform[4], y: it.transform[5], page: i });
      }
    }
  }

  const dmi = parseDMIItems(items);

  assert('mois', dmi.mois, '01');
  assert('annee', dmi.annee, '2026');
  assert('retenue_salaires', dmi.retenue_salaires, 1281.564);
  assert('css', dmi.css, 32.727);
  assert('tfp_du', dmi.tfp_du, 104.413);
  assert('foprolos_du', dmi.foprolos_du, 52.206);
  assert('tcl_du', dmi.tcl_du, 366.568);
  assert('timbre_fiscal', dmi.timbre_fiscal, 67);
  assert('total_general', dmi.total_general, 5771.764);
  assert('tva_collectee', dmi.tva_collectee, 9107.356);
  assert('tva_report_precedent', dmi.tva_report_precedent, 3386.57);
  assert('tva_resultat', dmi.tva_resultat, 3867.286);
  assert('tva_signe', dmi.tva_signe, 'ب');

  // Generate ecritures
  const result = generateFISCecritures(dmi, 'test1', 'soc1');
  assert('no error', result.error, undefined);
  assert('entries count', result.entries.length, 18);

  // Piece A: constatation
  assertEntry(result.entries, 'DMI 01-26 P1', '457100', 'D', 5771.764, 'CTS DMI 01-26');
  assertEntry(result.entries, 'DMI 01-26 P1', '432100', 'C', 1281.564);
  assertEntry(result.entries, 'DMI 01-26 P1', '432101', 'C', 32.727);
  assertEntry(result.entries, 'DMI 01-26 P1', '437300', 'C', 104.413);
  assertEntry(result.entries, 'DMI 01-26 P1', '437200', 'C', 52.206);
  assertEntry(result.entries, 'DMI 01-26 P1', '437500', 'C', 67);
  assertEntry(result.entries, 'DMI 01-26 P1', '437400', 'C', 366.568);
  assertEntry(result.entries, 'DMI 01-26 P1', '436510', 'C', 3867.286);

  // Piece B: TFP
  assertEntry(result.entries, 'DMI 01-26 P2', '661100', 'D', 104.413, 'CTS TFP 01-26');
  assertEntry(result.entries, 'DMI 01-26 P2', '437300', 'C', 104.413, 'CTS TFP 01-26');

  // Piece C: FOPROLOS
  assertEntry(result.entries, 'DMI 01-26 P3', '661200', 'D', 52.206, 'CTS FOPROLOSS 01-26');
  assertEntry(result.entries, 'DMI 01-26 P3', '437200', 'C', 52.206, 'CTS FOPROLOSS 01-26');

  // Piece D: TCL
  assertEntry(result.entries, 'DMI 01-26 P4', '661300', 'D', 366.568, 'CTS TCL 01-26');
  assertEntry(result.entries, 'DMI 01-26 P4', '437400', 'C', 366.568, 'CTS TCL 01-26');

  // Piece E: RECLASS TVA (ب = due)
  assertEntry(result.entries, 'RECLASS TVA P5', '436710', 'D', 9107.356, 'RECLASS TVA');
  assertEntry(result.entries, 'RECLASS TVA P5', '436660', 'C', 1853.5, 'RECLASS TVA');
  assertEntry(result.entries, 'RECLASS TVA P5', '436670', 'C', 3386.57, 'RECLASS TVA');
  assertEntry(result.entries, 'RECLASS TVA P5', '436510', 'C', 3867.286, 'RECLASS TVA');

  // Verify all pieces balance
  const pieces = {};
  for (const e of result.entries) {
    if (!pieces[e.numero_doc]) pieces[e.numero_doc] = { D: 0, C: 0 };
    pieces[e.numero_doc][e.sens] += e.montant;
  }
  for (const [name, bal] of Object.entries(pieces)) {
    const diff = Math.abs(bal.D - bal.C);
    assert(`${name} balanced (D=${bal.D.toFixed(3)} C=${bal.C.toFixed(3)})`, diff < 0.01, true);
  }
}

// ============================================================
// TEST 2: DMI 02-26 reference data (mocked parsed values)
// ============================================================
function testDMI02() {
  console.log('\n=== TEST 2: DMI 02-26 reference data ===');

  // Values extracted from the reference XLSX the user provided
  const dmi = {
    mois: '02', annee: '2026',
    retenue_salaires: 1281.564, css: 32.727,
    retenue_loyers: 300, retenue_marches: 0,
    tfp_du: 104.413, foprolos_du: 52.206,
    tva_collectee: 4339.679, tva_deductible: 0,
    tva_report_precedent: 9142.440, tva_resultat: 5467.932,
    tva_signe: 'ف',
    timbre_fiscal: 46, tcl_du: 202.713, total_general: 2519.623,
  };

  const result = generateFISCecritures(dmi, 'test2', 'soc2');
  assert('no error', result.error, undefined);
  assert('entries count', result.entries.length, 19);

  // Piece A: constatation
  assertEntry(result.entries, 'DMI 02-26 P1', '457100', 'D', 2519.623, 'CTS DMI 02-26');
  assertEntry(result.entries, 'DMI 02-26 P1', '432100', 'C', 1281.564);
  assertEntry(result.entries, 'DMI 02-26 P1', '432101', 'C', 32.727);
  assertEntry(result.entries, 'DMI 02-26 P1', '432300', 'C', 300);
  assertEntry(result.entries, 'DMI 02-26 P1', '437300', 'C', 104.413);
  assertEntry(result.entries, 'DMI 02-26 P1', '437200', 'C', 52.206);
  assertEntry(result.entries, 'DMI 02-26 P1', '437500', 'C', 46);
  assertEntry(result.entries, 'DMI 02-26 P1', '437400', 'C', 202.713);
  assertEntry(result.entries, 'DMI 02-26 P1', '436510', 'C', 500);

  // Piece B: TFP
  assertEntry(result.entries, 'DMI 02-26 P2', '661100', 'D', 104.413, 'CTS TFP 02-26');
  assertEntry(result.entries, 'DMI 02-26 P2', '437300', 'C', 104.413, 'CTS TFP 02-26');

  // Piece C: FOPROLOS
  assertEntry(result.entries, 'DMI 02-26 P3', '661200', 'D', 52.206, 'CTS FOPROLOSS 02-26');
  assertEntry(result.entries, 'DMI 02-26 P3', '437200', 'C', 52.206, 'CTS FOPROLOSS 02-26');

  // Piece D: TCL
  assertEntry(result.entries, 'DMI 02-26 P4', '661300', 'D', 202.713, 'CTS TCL 02-26');
  assertEntry(result.entries, 'DMI 02-26 P4', '437400', 'C', 202.713, 'CTS TCL 02-26');

  // Piece E: RECLASS TVA (ف = credit)
  assertEntry(result.entries, 'RECLASS TVA P5', '436710', 'D', 4339.679, 'RECLASS TVA');
  assertEntry(result.entries, 'RECLASS TVA P5', '436660', 'C', 665.171, 'RECLASS TVA');
  assertEntry(result.entries, 'RECLASS TVA P5', '436670', 'C', 9142.440, 'RECLASS TVA');
  assertEntry(result.entries, 'RECLASS TVA P5', '436670', 'D', 5467.932, 'RECLASS TVA');

  // Verify all pieces balance
  const pieces = {};
  for (const e of result.entries) {
    if (!pieces[e.numero_doc]) pieces[e.numero_doc] = { D: 0, C: 0 };
    pieces[e.numero_doc][e.sens] += e.montant;
  }
  for (const [name, bal] of Object.entries(pieces)) {
    const diff = Math.abs(bal.D - bal.C);
    assert(`${name} balanced (D=${bal.D.toFixed(3)} C=${bal.C.toFixed(3)})`, diff < 0.01, true);
  }
}

// ============================================================
// TEST 3: DMI 03-26 reference data
// ============================================================
function testDMI03() {
  console.log('\n=== TEST 3: DMI 03-26 reference data ===');

  const dmi = {
    mois: '03', annee: '2026',
    retenue_salaires: 1311.290, css: 33.718,
    retenue_loyers: 1150, retenue_marches: 0,
    tfp_du: 109.289, foprolos_du: 54.644,
    tva_collectee: 7117.174, tva_deductible: 0,
    tva_report_precedent: 5467.932, tva_resultat: 50.758,
    tva_signe: 'ف',
    timbre_fiscal: 66, tcl_du: 356.079, total_general: 3081.020,
  };

  const result = generateFISCecritures(dmi, 'test3', 'soc3');
  assert('no error', result.error, undefined);
  // P1 has no 436510 because sumC = total_general → 18 entries total
  assert('entries count', result.entries.length, 18);

  // Piece A: constatation — sum C = 1311.290+33.718+1150+109.289+54.644+66+356.079 = 3081.020 = total
  assertEntry(result.entries, 'DMI 03-26 P1', '457100', 'D', 3081.020, 'CTS DMI 03-26');
  assertEntry(result.entries, 'DMI 03-26 P1', '432100', 'C', 1311.290);
  assertEntry(result.entries, 'DMI 03-26 P1', '432101', 'C', 33.718);
  assertEntry(result.entries, 'DMI 03-26 P1', '432300', 'C', 1150);
  assertEntry(result.entries, 'DMI 03-26 P1', '437300', 'C', 109.289);
  assertEntry(result.entries, 'DMI 03-26 P1', '437200', 'C', 54.644);
  assertEntry(result.entries, 'DMI 03-26 P1', '437500', 'C', 66);
  assertEntry(result.entries, 'DMI 03-26 P1', '437400', 'C', 356.079);

  // Piece D: TCL
  assertEntry(result.entries, 'DMI 03-26 P4', '661300', 'D', 356.079, 'CTS TCL 03-26');
  assertEntry(result.entries, 'DMI 03-26 P4', '437400', 'C', 356.079, 'CTS TCL 03-26');

  // Piece E: RECLASS TVA — tvaDed = 7117.174+50.758-5467.932 = 1700.000
  assertEntry(result.entries, 'RECLASS TVA P5', '436710', 'D', 7117.174, 'RECLASS TVA');
  assertEntry(result.entries, 'RECLASS TVA P5', '436660', 'C', 1700, 'RECLASS TVA');
  assertEntry(result.entries, 'RECLASS TVA P5', '436670', 'C', 5467.932, 'RECLASS TVA');
  assertEntry(result.entries, 'RECLASS TVA P5', '436670', 'D', 50.758, 'RECLASS TVA');

  // Verify all pieces balance
  const pieces = {};
  for (const e of result.entries) {
    if (!pieces[e.numero_doc]) pieces[e.numero_doc] = { D: 0, C: 0 };
    pieces[e.numero_doc][e.sens] += e.montant;
  }
  for (const [name, bal] of Object.entries(pieces)) {
    const diff = Math.abs(bal.D - bal.C);
    assert(`${name} balanced (D=${bal.D.toFixed(3)} C=${bal.C.toFixed(3)})`, diff < 0.01, true);
  }
}

// ============================================================
// TEST 4: Edge case — no TVA in constatation (sumC == total_general)
// ============================================================
function testNoTVA() {
  console.log('\n=== TEST 4: No TVA in constatation (sumC = total) ===');

  const dmi = {
    mois: '01', annee: '2026',
    retenue_salaires: 1000, css: 50,
    retenue_loyers: 0, retenue_marches: 0,
    tfp_du: 100, foprolos_du: 50,
    tva_collectee: 500, tva_deductible: 0,
    tva_report_precedent: 200, tva_resultat: 50,
    tva_signe: 'ب',
    timbre_fiscal: 20, tcl_du: 80, total_general: 1300,
  };

  // sumC = 1000+50+100+50+20+80 = 1300 = total_general → no 436510 line
  const result = generateFISCecritures(dmi, 'test4', 'soc4');
  assert('no error', result.error, undefined);
  const p1Entries = result.entries.filter(e => e.numero_doc === 'DMI 01-26 P1');
  const tvaEntry = p1Entries.find(e => e.compte === '436510');
  assert('no 436510 entry', tvaEntry, undefined);
  assert('P1 has 7 entries (no TVA line)', p1Entries.length, 7);

  // Verify P1 balance
  const totalD = p1Entries.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
  const totalC = p1Entries.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
  assert('P1 balanced', Math.abs(totalD - totalC) < 0.01, true);
}

// ============================================================
// TEST 5: Edge case — missing total_general
// ============================================================
function testMissingTotal() {
  console.log('\n=== TEST 5: Missing total_general ===');

  const dmi = {
    mois: '01', annee: '2026',
    retenue_salaires: 0, css: 0,
    retenue_loyers: 0, retenue_marches: 0,
    tfp_du: 0, foprolos_du: 0,
    tva_collectee: 0, tva_deductible: 0,
    tva_report_precedent: 0, tva_resultat: 0,
    tva_signe: null,
    timbre_fiscal: 0, tcl_du: 0, total_general: 0,
  };

  const result = generateFISCecritures(dmi, 'test5', 'soc5');
  assert('has error', result.error !== undefined, true);
  assert('entries empty', result.entries.length, 0);
}

// ============================================================
// TEST 6: 411006 is FORBIDDEN — should never appear
// ============================================================
function testForbidden411006() {
  console.log('\n=== TEST 6: 411006 should never appear ===');

  const dmi = {
    mois: '01', annee: '2026',
    retenue_salaires: 1000, css: 50,
    retenue_loyers: 100, retenue_marches: 0,
    tfp_du: 80, foprolos_du: 40,
    tva_collectee: 500, tva_deductible: 0,
    tva_report_precedent: 200, tva_resultat: 50,
    tva_signe: 'ب',
    timbre_fiscal: 15, tcl_du: 60, total_general: 1345,
  };

  const result = generateFISCecritures(dmi, 'test6', 'soc6');
  const has411006 = result.entries.some(e => e.compte === '411006');
  assert('no 411006 in entries', has411006, false);
}

// ============================================================
// Run all tests
// ============================================================
async function runAll() {
  await testDMI01();
  testDMI02();
  testDMI03();
  testNoTVA();
  testMissingTotal();
  testForbidden411006();

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(e => { console.error(e); process.exit(1); });
