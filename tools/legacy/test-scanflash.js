const fs = require('fs');
const path = require('path');
const pdfjsLib = require('./web/node_modules/pdfjs-dist/legacy/build/pdf.js');

let passed = 0;
let failed = 0;
const errors = [];

function parseAmount(s) {
  return parseFloat(s.replace(/\s/g, '').replace(',', '.')) || 0;
}

function parseScanInvoice(text) {
  const lines = text.split('\n');
  let numero = '';
  let isAvoir = false;
  let date = '';
  let codeClient = '';
  let clientName = '';
  let totalHT = 0;
  let tva19 = 0;
  let fodec = 0;
  let timbre = 0;
  let totalTTC = 0;
  let afterAdressA = false;
  let hasTimbreLine = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const facMatch = line.match(/^Facture\s+(avoir\s+)?(FAC|AVR)\S+/i);
    if (facMatch) {
      isAvoir = !!facMatch[1];
      numero = line.replace(/^Facture\s+(avoir\s+)?/i, '').trim();
    }
    const dateMatch = line.match(/Date\s+facturation\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (dateMatch) date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    const codeMatch = line.match(/Code\s+client\s*:\s*(\S+)/i);
    if (codeMatch) codeClient = codeMatch[1];
    if (line.match(/Adress[ée]\s+[àa]/i)) { afterAdressA = true; continue; }
    if (afterAdressA && line && !line.match(/^(Numéro|Tél|Email|Web|Scan)/i)) {
      clientName = line;
      afterAdressA = false;
    }
    if (line.match(/^Total\s+HT$/i)) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const v = parseAmount(lines[j].trim());
        if (v !== 0) { totalHT = v; break; }
      }
    }
    if (line.match(/^Total\s+TVA\s+19\s*%$/i)) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const v = parseAmount(lines[j].trim());
        if (v !== 0) { tva19 = v; break; }
      }
    }
    if (line.match(/^FODEC\s+1\s*%$/i)) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const v = parseAmount(lines[j].trim());
        if (v !== 0) { fodec = v; break; }
      }
    }
    if (line.match(/^Timbre\s+fiscal$/i)) {
      hasTimbreLine = true;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const v = parseAmount(lines[j].trim());
        if (v !== 0) { timbre = v; break; }
      }
    }
    if (line.match(/^Total\s+TTC$/i)) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const v = parseAmount(lines[j].trim());
        if (v !== 0) { totalTTC = v; break; }
      }
    }
  }

  if (!numero || !date) return null;
  const hasTVA = tva19 > 0;
  const compteClient = '411000';

  return {
    numero, date_facture: date, client: clientName || codeClient, code_client: codeClient,
    compte_client: compteClient, is_avoir: isAvoir,
    total_ht_0: hasTVA ? 0 : Math.abs(totalHT),
    total_ht_19: hasTVA ? Math.abs(totalHT) : 0,
    tva_19: Math.abs(tva19), fodec: Math.abs(fodec),
    timbre: isAvoir ? 0 : Math.abs(timbre),
    total_ttc: Math.abs(totalTTC),
    hasTimbreLine,
  };
}

function generateEcritures(facture) {
  const f = facture;
  const ecritures = [];
  const date = f.date_facture;
  const facNum = f.numero || '';
  const clientName = f.client || '';
  const compteClient = f.compte_client || '411000';
  const ht19 = f.total_ht_19 || 0;
  const ht0 = f.total_ht_0 || 0;
  const tva = f.tva_19 || 0;
  const fodec = f.fodec || 0;
  const timbre = f.timbre || 0;
  const isAvoir = !!f.is_avoir;
  const prefix = isAvoir ? 'AVR' : 'FAC';
  const lib = `${prefix} ${facNum}/${clientName}`;
  const totalCredit = ht19 + ht0 + tva + fodec + timbre;
  const r = (v) => Math.round(v * 1000) / 1000;

  if (isAvoir) {
    if (totalCredit > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: compteClient, libelle: lib, sens: 'C', montant: r(totalCredit) });
    if (ht19 > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '707000', libelle: lib, sens: 'D', montant: r(ht19) });
    if (ht0 > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '707003', libelle: lib, sens: 'D', montant: r(ht0) });
    if (tva > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '436719', libelle: lib, sens: 'D', montant: r(tva) });
    if (fodec > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '436780', libelle: lib, sens: 'D', montant: r(fodec) });
  } else {
    if (totalCredit > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: compteClient, libelle: lib, sens: 'D', montant: r(totalCredit) });
    if (ht19 > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '707000', libelle: lib, sens: 'C', montant: r(ht19) });
    if (ht0 > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '707003', libelle: lib, sens: 'C', montant: r(ht0) });
    if (tva > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '436719', libelle: lib, sens: 'C', montant: r(tva) });
    if (fodec > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '436780', libelle: lib, sens: 'C', montant: r(fodec) });
    if (timbre > 0) ecritures.push({ numero_doc: facNum, date_operation: date, journal_code: 'VT', compte: '437600', libelle: lib, sens: 'C', montant: r(timbre) });
  }
  return ecritures;
}

async function extractTextFromPDF(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.filter(item => 'str' in item).map(item => item.str).join('\n') + '\n';
  }
  return fullText;
}

async function testDir(dirPath, label) {
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.pdf'));
  console.log(`\n=== ${label}: ${files.length} PDFs ===`);
  let totalD = 0, totalC = 0;
  let facCount = 0, avrCount = 0, rejectedCount = 0;
  const details = [];

  for (const file of files) {
    const fp = path.join(dirPath, file);
    try {
      const text = await extractTextFromPDF(fp);
      const parsed = parseScanInvoice(text);
      if (!parsed) {
        rejectedCount++;
        continue;
      }
      if (parsed.is_avoir) avrCount++; else facCount++;

      const ecritures = generateEcritures(parsed);
      const sumD = ecritures.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
      const sumC = ecritures.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
      const diff = Math.abs(sumD - sumC);

      totalD += sumD;
      totalC += sumC;

      if (diff > 0.001) {
        failed++;
        const msg = `  BALANCE FAIL: ${parsed.numero} D=${sumD.toFixed(3)} C=${sumC.toFixed(3)} diff=${diff.toFixed(3)}`;
        console.log(msg);
        errors.push(msg);
      } else {
        passed++;
      }

      details.push({
        numero: parsed.numero,
        type: parsed.is_avoir ? 'AVR' : 'FAC',
        ht: parsed.total_ht_19 || parsed.total_ht_0,
        tva: parsed.tva_19,
        fodec: parsed.fodec,
        timbre: parsed.timbre,
        ttc: parsed.total_ttc,
        hasTimbreLine: parsed.hasTimbreLine,
        d: sumD,
        c: sumC,
      });
    } catch (e) {
      failed++;
      const msg = `  ERROR: ${file} — ${e.message}`;
      console.log(msg);
      errors.push(msg);
    }
  }

  console.log(`\n  Parsed: ${facCount} FAC + ${avrCount} AVR = ${facCount + avrCount} | Rejected: ${rejectedCount}`);
  console.log(`  Total D=${totalD.toFixed(3)} C=${totalC.toFixed(3)} diff=${Math.abs(totalD - totalC).toFixed(3)}`);

  return { details, totalD, totalC, facCount, avrCount, rejectedCount };
}

async function main() {
  console.log('SCANFLASH Parser Test (Node.js + pdf.js)\n');

  const dir6 = 'D:\\vt scan';
  const dir1 = 'D:\\vt scan\\01-2026\\VENTE';

  if (fs.existsSync(dir6)) {
    await testDir(dir6, 'JUIN 2026 (162 PDFs)');
  }
  if (fs.existsSync(dir1)) {
    await testDir(dir1, 'JANVIER 2026 (106 PDFs)');
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (errors.length > 0) {
    console.log(`\nErrors:`);
    errors.forEach(e => console.log(e));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
