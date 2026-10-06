import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const ACC = config.accounts;
const LIB = config.libelles;

async function extractTextFromPDF(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(i => 'str' in i && i.str.trim()).map(i => ({ str: i.str, x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));
    const rows = [];
    const sorted = items.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const item of sorted) {
      const existing = rows.find(r => Math.abs(r.y - item.y) < 4);
      if (existing) existing.items.push(item);
      else rows.push({ y: item.y, items: [item] });
    }
    for (const row of rows) row.items.sort((a, b) => a.x - b.x);
    pageTexts.push(rows.map(r => r.items.map(i => i.str).join(' ')).join('\n'));
  }
  return pageTexts.join('\n');
}

function parseInvoice(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  let numero = '', date = '', client = '';
  let ht0 = 0, ht19 = 0, tva19 = 0, ttc = 0, timbre = 1.0;
  const p = s => { try { return parseFloat(s.replace(/ /g, '').replace(',', '.')); } catch { return 0; } };

  for (const line of lines) {
    if (!numero) { 
      let m = line.match(/FACTURE\s*N[°o∞]?\s*:\s*(\d{4})\s*\/\s*(\d+)/); 
      if (m) numero = m[2] + '/' + m[1].slice(-2); // year/invoice → invoice/2-digit-year
      else {
        m = line.match(/FAC\s*N[°o∞]?\s*(\d{3,4})\s*[\/-]\s*(\d{2})/);
        if (m) numero = m[1] + '/' + m[2];
      }
    }
    if (!date) { const m = line.match(/LE\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/); if (m) date = m[3] + '-' + m[2] + '-' + m[1]; }
    if (!client) {
      const m = line.match(/(?<!Code\s)Client\s*:\s*(.+)/);
      if (m) { const c = m[1].trim(); client = c.toUpperCase().includes('PASSAGERS') ? 'CLIENTS PASSAGERS' : c; }
    }
    if (!ht0) { const m = line.match(/([\d][\d ]*,\d+)\s+0%/); if (m) ht0 = p(m[1]); }
    if (!ht19) { const m = line.match(/([\d][\d ]*,\d+)\s+19%\s+([\d ]*,\d+)/); if (m) { ht19 = p(m[1]); tva19 = p(m[2]); } }
    if (timbre === 1.0) { const m = line.match(/TIMBRE\s+FIS\.?\s*:\s*([\d ]*,\d+)/); if (m) timbre = p(m[1]); }
    if (!ttc) { const m = line.match(/NET\s+T\.T\.C\.?\s+([\d ]*,\d+)/); if (m) ttc = p(m[1]); }
  }
  return { date, numero, client, ht0, ht19, tva19, timbre, ttc };
}

function parseRapportPage(text) {
  const p = s => parseFloat(s.replace(/ /g, '').replace(',', '.')) || 0;
  // Allow optional negative sign for numbers like -112,40
  const num = '-?\\d[\\d ]*\\d,\\d+|-?\\d,\\d+';
  const sep = '\\s*[|]?\\s*';
  // Match date + 6 payment columns: Espèce, Chèque, Carte de cr, Bons D'ach, Avoir, Crédit
  const re = new RegExp('(\\d{2})/(\\d{2})/(\\d{4})' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')');
  const modes = {};
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const date = m[3] + '-' + m[2] + '-' + m[1];
    modes[date] = { 
      especes: p(m[4]),         // Espèces → 411004
      cheques: p(m[5]),         // Chèque → 411003
      tpe: p(m[6]),             // Carte de cr → 411005
      avoirFinancier: p(m[7]),  // Bons D'ach → 709500
      avoir: p(m[8]),           // Avoir (not used in accounting)
      credit: p(m[9])           // Crédit (not used in accounting)
    };
  }
  return modes;
}

function generateEcrituresDay(invoices, journal, rapportDay) {
  const ecritures = [];
  if (invoices.length === 0) return ecritures;

  const date = invoices[0].date;
  const rapport = rapportDay || { especes: 0, cheques: 0, tpe: 0, avoirFinancier: 0, avoir: 0, credit: 0 };

  // Build piece number
  const nums = invoices.map(i => i.numero.split('/')[0]);
  const annees = invoices.map(i => i.numero.split('/')[1]);
  const annee = annees[0];
  let pieceNum;
  if (invoices.length === 1) {
    pieceNum = nums[0];
  } else {
    pieceNum = nums.join('/');
  }

  // Piece number for CSV column3
  const pieceFormatted = journal === 'VT J.C'
    ? `FAC N\u00b0${pieceNum}-${annee}`
    : `FAC ${pieceNum}-${annee}`;

  // Build description - use actual client name from invoice
  const clientName = invoices[0].client.toUpperCase().replace(/\s+/g, '_');
  const descCombined = journal === 'VT J.C'
    ? `FAC N\u00b0${pieceNum}-${annee} ${clientName.replace(/_/g, ' ')}`
    : `FAC ${pieceNum}-${annee}/${clientName}`;

  // DEBIT: Combined 411xxx entries with FULL rapport amounts
  if (rapport.especes > 0) {
    ecritures.push({
      date, journal, numero_piece: pieceFormatted, compte: ACC.especes, libelle: LIB.especes,
      description: descCombined, debit: rapport.especes, credit: 0
    });
  }
  if (rapport.tpe > 0) {
    ecritures.push({
      date, journal, numero_piece: pieceFormatted, compte: ACC.tpe, libelle: LIB.tpe,
      description: descCombined, debit: rapport.tpe, credit: 0
    });
  }
  if (rapport.cheques > 0) {
    ecritures.push({
      date, journal, numero_piece: pieceFormatted, compte: ACC.cheques, libelle: LIB.cheques,
      description: descCombined, debit: rapport.cheques, credit: 0
    });
  }

  // DEBIT: Combined avoirs financiers with FULL rapport amount
  if (rapport.avoirFinancier > 0) {
    ecritures.push({
      date, journal, numero_piece: pieceFormatted, compte: ACC.avoirFinancier, libelle: LIB.avoirFinancier,
      description: descCombined, debit: rapport.avoirFinancier, credit: 0
    });
  }

  // Per invoice: CREDIT entries
  for (const inv of invoices) {
    const invClientName = inv.client.toUpperCase().replace(/\s+/g, '_');
    const invDesc = journal === 'VT J.C'
      ? `FAC N\u00b0${inv.numero.split('/')[0]}-${annee}-${invClientName}`
      : `FAC ${inv.numero.split('/')[0]}-${annee}/${invClientName}`;

    // VENTES 0%
    const compteVente0 = journal === 'VT J.C' ? ACC.ventesJc0 : ACC.ventesC0;
    const libelleVente0 = journal === 'VT J.C' ? LIB.ventesJc0 : LIB.ventesC0;
    if (inv.ht0 > 0) {
      ecritures.push({
        date, journal, numero_piece: pieceFormatted, compte: compteVente0, libelle: libelleVente0,
        description: invDesc, debit: 0, credit: inv.ht0
      });
    }

    // VENTES 19%
    const compteVente19 = journal === 'VT J.C' ? ACC.ventesJc19 : ACC.ventesC19;
    const libelleVente19 = journal === 'VT J.C' ? LIB.ventesJc19 : LIB.ventesC19;
    if (inv.ht19 > 0) {
      ecritures.push({
        date, journal, numero_piece: pieceFormatted, compte: compteVente19, libelle: libelleVente19,
        description: invDesc, debit: 0, credit: inv.ht19
      });
    }

    // TVA COLLECTEE 19%
    const compteTVA = journal === 'VT J.C' ? ACC.tvaJc : ACC.tvaC;
    const libelleTVA = journal === 'VT J.C' ? LIB.tvaJc : LIB.tvaC;
    if (inv.tva19 > 0) {
      ecritures.push({
        date, journal, numero_piece: pieceFormatted, compte: compteTVA, libelle: libelleTVA,
        description: invDesc, debit: 0, credit: inv.tva19
      });
    }

    // TIMBRE FISCAL
    ecritures.push({
      date, journal, numero_piece: pieceFormatted, compte: ACC.timbre, libelle: LIB.timbre,
      description: invDesc, debit: 0, credit: inv.timbre
    });
  }

  // ECARTS = totalTTC - totalPayments
  const totalTTC = invoices.reduce((sum, inv) => sum + inv.ttc, 0);
  const totalPayments = rapport.especes + rapport.tpe + rapport.cheques + rapport.avoirFinancier;
  const ecart = Math.round((totalTTC - totalPayments) * 1000) / 1000;
  if (Math.abs(ecart) > 0.001) {
    const ecartDesc = Math.abs(ecart) > config.ecartsThreshold ? descCombined + ' a verifier' : descCombined;
    if (ecart > 0) {
      ecritures.push({
        date, journal, numero_piece: pieceFormatted, compte: ACC.ecarts, libelle: LIB.ecarts,
        description: ecartDesc, debit: ecart, credit: 0
      });
    } else {
      ecritures.push({
        date, journal, numero_piece: pieceFormatted, compte: ACC.ecarts, libelle: LIB.ecarts,
        description: ecartDesc, debit: 0, credit: Math.abs(ecart)
      });
    }
  }

  return ecritures;
}

async function main() {
  const month = process.argv[2] || '06-2026';
  const monthName = config.months[month] || month;

  const basePath = `${config.basePath}\\${month}`;
  
  let jcDir, cDir;
  if (fs.existsSync(`${basePath}\\VTE J.C`)) {
    jcDir = `${basePath}\\VTE J.C`;
    cDir = `${basePath}\\VTE C`;
  } else if (fs.existsSync(`${basePath}\\JC`)) {
    jcDir = `${basePath}\\JC`;
    cDir = `${basePath}\\C`;
  } else {
    console.error(`Cannot find JC/C directories in ${basePath}`);
    return;
  }

  const outputFile = `${config.outputDir}\\ecritures_vt_${month.replace('-', '_')}.csv`;
  console.log(`=== VT ANIMAL TEST - ${monthName} 2026 ===\n`);

  // Parse rapports
  console.log('=== PARSING RAPPORTS ===');
  const rapportJCFile = fs.readdirSync(jcDir).find(f => f.startsWith('Rapport'));
  const rapportCFile = fs.readdirSync(cDir).find(f => f.startsWith('Rapport'));
  
  let rapportJC = {};
  let rapportC = {};
  
  if (rapportJCFile) {
    const text = await extractTextFromPDF(path.join(jcDir, rapportJCFile));
    rapportJC = parseRapportPage(text);
    console.log(`JC Rapport: ${Object.keys(rapportJC).length} days`);
  }
  
  if (rapportCFile) {
    const text = await extractTextFromPDF(path.join(cDir, rapportCFile));
    rapportC = parseRapportPage(text);
    console.log(`C Rapport: ${Object.keys(rapportC).length} days`);
  }

  // Parse JC invoices
  const jcFiles = fs.readdirSync(jcDir).filter(f => f.endsWith('.pdf') && !f.toLowerCase().includes('rapport'));
  console.log('\n=== JC INVOICES ===');
  const jcInvoices = [];
  let jcTotal = { ht0: 0, ht19: 0, tva19: 0, timbre: 0, ttc: 0 };

  for (const f of jcFiles) {
    try {
      const text = await extractTextFromPDF(path.join(jcDir, f));
      const inv = parseInvoice(text);
      if (inv.ht0 === 0 && inv.ht19 === 0 && inv.ttc === 0) continue;
      jcTotal.ht0 += inv.ht0; jcTotal.ht19 += inv.ht19; jcTotal.tva19 += inv.tva19;
      jcTotal.timbre += inv.timbre; jcTotal.ttc += inv.ttc;
      jcInvoices.push(inv);
      console.log(`OK: ${f} date=${inv.date} num=${inv.numero} HT0=${inv.ht0.toFixed(3)} HT19=${inv.ht19.toFixed(3)} TTC=${inv.ttc.toFixed(3)}`);
    } catch (e) { console.log('ERR:', f, e.message); }
  }
  console.log(`JC Total: ${jcTotal.ht0.toFixed(3)} + ${jcTotal.tva19.toFixed(3)} + ${jcTotal.timbre.toFixed(3)} = ${jcTotal.ttc.toFixed(3)}`);

  // Group JC by date, generate combined entries
  const jcByDate = {};
  for (const inv of jcInvoices) {
    if (!jcByDate[inv.date]) jcByDate[inv.date] = [];
    jcByDate[inv.date].push(inv);
  }
  const allJCEcritures = [];
  for (const [date, invoices] of Object.entries(jcByDate)) {
    const ecritures = generateEcrituresDay(invoices, 'VT J.C', rapportJC[date]);
    allJCEcritures.push(...ecritures);
  }

  // Parse C invoices
  const cFiles = fs.readdirSync(cDir).filter(f => f.endsWith('.pdf') && !f.toLowerCase().includes('rapport'));
  console.log('\n=== C INVOICES ===');
  const cInvoices = [];
  let cTotal = { ht0: 0, ht19: 0, tva19: 0, timbre: 0, ttc: 0 };

  for (const f of cFiles) {
    try {
      const text = await extractTextFromPDF(path.join(cDir, f));
      const inv = parseInvoice(text);
      if (inv.ht0 === 0 && inv.ht19 === 0 && inv.ttc === 0) continue;
      cTotal.ht0 += inv.ht0; cTotal.ht19 += inv.ht19; cTotal.tva19 += inv.tva19;
      cTotal.timbre += inv.timbre; cTotal.ttc += inv.ttc;
      cInvoices.push(inv);
      console.log(`OK: ${f} date=${inv.date} num=${inv.numero} HT0=${inv.ht0.toFixed(3)} HT19=${inv.ht19.toFixed(3)} TTC=${inv.ttc.toFixed(3)}`);
    } catch (e) { console.log('ERR:', f, e.message); }
  }
  console.log(`C Total: ${cTotal.ht0.toFixed(3)} + ${cTotal.tva19.toFixed(3)} + ${cTotal.timbre.toFixed(3)} = ${cTotal.ttc.toFixed(3)}`);

  // Group C by date, generate combined entries
  const cByDate = {};
  for (const inv of cInvoices) {
    if (!cByDate[inv.date]) cByDate[inv.date] = [];
    cByDate[inv.date].push(inv);
  }
  const allCEcritures = [];
  for (const [date, invoices] of Object.entries(cByDate)) {
    const ecritures = generateEcrituresDay(invoices, 'VT C', rapportC[date]);
    allCEcritures.push(...ecritures);
  }

  // Export CSV
  const csvLines = ['Jour;Journal;N° Pièce;Compte;Libellé;Description;Débit;Crédit'];
  for (const e of [...allJCEcritures, ...allCEcritures]) {
    csvLines.push(`${e.date};${e.journal};${e.numero_piece};${e.compte};${e.libelle};${e.description};${e.debit};${e.credit}`);
  }
  fs.writeFileSync(outputFile, csvLines.join('\n'), 'utf8');
  console.log(`\nExported ${allJCEcritures.length + allCEcritures.length} entries to ${outputFile}`);

  // Verify per-day balance
  console.log('\n=== BALANCE CHECK (per day+journal) ===');
  const balMap = {};
  for (const e of [...allJCEcritures, ...allCEcritures]) {
    const key = `${e.date}_${e.journal}`;
    if (!balMap[key]) balMap[key] = { debit: 0, credit: 0 };
    balMap[key].debit += e.debit;
    balMap[key].credit += e.credit;
  }
  let imbalanceDays = 0;
  for (const [key, bal] of Object.entries(balMap)) {
    const diff = Math.round((bal.debit - bal.credit) * 1000) / 1000;
    if (Math.abs(diff) > 0.01) {
      console.log(`IMBALANCE: ${key} debit=${bal.debit.toFixed(3)} credit=${bal.credit.toFixed(3)} diff=${diff}`);
      imbalanceDays++;
    }
  }
  if (imbalanceDays === 0) console.log('All days balanced!');

  console.log('\n=== SUMMARY ===');
  console.log(`JC: ${jcFiles.length} invoices, ${allJCEcritures.length} entries`);
  console.log(`C: ${cFiles.length} invoices, ${allCEcritures.length} entries`);
  console.log(`Grand Total TTC: ${(jcTotal.ttc + cTotal.ttc).toFixed(3)}`);
}

main().catch(console.error);
