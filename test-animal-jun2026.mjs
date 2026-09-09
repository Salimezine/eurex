import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';

const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const DID = 'dossier_animal';
const SOC_ID = 'soc_animal';

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
    if (!numero) { const m = line.match(/FACTURE\s*N[°o∞.]\s*:\s*(\d{4})\s*\/\s*(\d+)/); if (m) numero = m[1] + '/' + m[2]; }
    if (!date) { const m = line.match(/LE\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/); if (m) date = m[3] + '-' + m[2] + '-' + m[1]; }
    if (!client) {
      const m = line.match(/(?<!Code\s)Client\s*:\s*(.+?)(?:\s+Adresse|\s+FACTURE|\s+Mat\.)/);
      if (m) { const c = m[1].trim(); client = c.toUpperCase().includes('PASSAGERS') ? 'CLIENTS PASSAGERS' : c; }
    }
    if (!ht0) { const m = line.match(/([\d][\d ]*,\d+)\s+0%\s+NET\s+H\.TVA\s*:\s*([\d ][\d ]*,\d+)/); if (m) ht0 = p(m[1]); }
    if (!ht19) { const m = line.match(/([\d][\d ]*,\d+)\s+19%\s+([\d ]*,\d+)/); if (m) { ht19 = p(m[1]); tva19 = p(m[2]); } }
    if (timbre === 1.0) { const m = line.match(/TIMBRE\s+FIS\.?\s*:\s*([\d ]*,\d+)/); if (m) timbre = p(m[1]); }
    if (!ttc) { const m = line.match(/NET\s+T\.T\.C\.?\s+([\d ]*,\d+)/); if (m) ttc = p(m[1]); }
  }
  return { date, numero, client, ht0, ht19, tva19, timbre, ttc };
}

function parseRapportPage(text) {
  const p = s => parseFloat(s.replace(/ /g, '').replace(',', '.')) || 0;
  const num = '\\d[\\d ]*\\d,\\d+|\\d,\\d+';
  const sep = '\\s*[|]?\\s*';
  const re = new RegExp('(\\d{2})/(\\d{2})/(\\d{4})' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')');
  const modes = {};
  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const date = m[3] + '-' + m[2] + '-' + m[1];
    modes[date] = { especes: p(m[4]), cheques: p(m[5]), tpe: p(m[6]), bonsAchat: p(m[7]), avoir: p(m[8]), credit: p(m[9]) };
  }
  return modes;
}

function generateEcritures(invoice, journal, invoiceNum) {
  const ecritures = [];
  const date = invoice.date;
  const numFac = invoice.numero || invoiceNum;
  const desc = `FAC N°${numFac} ${invoice.client === 'CLIENTS PASSAGERS' ? 'CLTS PASSAGERS' : invoice.client}`;

  // Especes (411004)
  if (invoice.ht0 + invoice.tva19 > 0) {
    ecritures.push({
      date, journal, numero_piece: numFac, compte: '411004', libelle: 'CLIENTS PASSAGERS ESPECES',
      description: desc, debit: 0, credit: invoice.ht0 + invoice.tva19
    });
  }

  // TPE (411005) - estimated 40% of total
  const tpeAmount = Math.round((invoice.ht0 + invoice.tva19) * 0.4 * 1000) / 1000;
  if (tpeAmount > 0) {
    ecritures.push({
      date, journal, numero_piece: numFac, compte: '411005', libelle: 'CLIENTS PASSAGERS TPE',
      description: desc, debit: 0, credit: tpeAmount
    });
  }

  // Avoirs financiers (709500)
  if (invoice.timbre > 1) {
    ecritures.push({
      date, journal, numero_piece: numFac, compte: '709500', libelle: 'AVOIRS FINACIERS',
      description: desc, debit: invoice.timbre, credit: 0
    });
  }

  // Ventes marchandises 0% (707200 for JC, 707100 for C)
  const compteVente0 = journal === 'VT J.C' ? '707200' : '707100';
  const libelleVente0 = journal === 'VT J.C' ? 'VENTES MARCHANDISES J.C 0%' : 'VENTES MARCHANDISES C 0%';
  if (invoice.ht0 > 0) {
    ecritures.push({
      date, journal, numero_piece: numFac, compte: compteVente0, libelle: libelleVente0,
      description: desc, debit: invoice.ht0, credit: 0
    });
  }

  // Ventes marchandises 19% (707219 for JC, 707119 for C)
  const compteVente19 = journal === 'VT J.C' ? '707219' : '707119';
  const libelleVente19 = journal === 'VT J.C' ? 'VENTES MARCHANDISES J.C 19%' : 'VENTES MARCHANDISES C 19%';
  if (invoice.ht19 > 0) {
    ecritures.push({
      date, journal, numero_piece: numFac, compte: compteVente19, libelle: libelleVente19,
      description: desc, debit: invoice.ht19, credit: 0
    });
  }

  // TVA collectee 19% (436711 for JC, 436710 for C)
  const compteTVA = journal === 'VT J.C' ? '436711' : '436710';
  const libelleTVA = journal === 'VT J.C' ? 'TVA COLLECTEE 19% J.C' : 'TVA COLLECTEE 19% C';
  if (invoice.tva19 > 0) {
    ecritures.push({
      date, journal, numero_piece: numFac, compte: compteTVA, libelle: libelleTVA,
      description: desc, debit: 0, credit: invoice.tva19
    });
  }

  // Timbre fiscal (437500)
  ecritures.push({
    date, journal, numero_piece: numFac, compte: '437500', libelle: 'TIMBRE FISCAL',
    description: desc, debit: 0, credit: invoice.timbre
  });

  // Ecarts de reglement (634500)
  const ecart = Math.round((invoice.ttc - invoice.ht0 - invoice.tva19 - invoice.timbre) * 1000) / 1000;
  if (Math.abs(ecart) > 0.001) {
    ecritures.push({
      date, journal, numero_piece: numFac, compte: '634500', libelle: 'ECARTS DE REGLEMENT',
      description: desc, debit: ecart > 0 ? ecart : 0, credit: ecart < 0 ? -ecart : 0
    });
  }

  return ecritures;
}

async function main() {
  const jcDir = 'D:\\ANIMAL  CITY\\EXERCICE\\2026\\VENTE\\06-2026\\VTE J.C';
  const cDir = 'D:\\ANIMAL  CITY\\EXERCICE\\2026\\VENTE\\06-2026\\VTE C';

  console.log('=== VT ANIMAL TEST - JUIN 2026 ===\n');

  // === JC INVOICES ===
  const jcFiles = fs.readdirSync(jcDir).filter(f => f.endsWith('.pdf') && !f.includes('Rapport'));
  let ok = 0, fail = 0, total = { ht0: 0, ht19: 0, tva19: 0, timbre: 0, ttc: 0 };
  const jcInvoices = [];
  let allJCEcritures = [];

  console.log('=== JC INVOICES ===');
  for (const f of jcFiles) {
    try {
      const text = await extractTextFromPDF(path.join(jcDir, f));
      const inv = parseInvoice(text);
      if (inv.ht0 === 0 && inv.ht19 === 0 && inv.ttc === 0) { fail++; console.log('FAIL:', f); continue; }
      ok++;
      total.ht0 += inv.ht0; total.ht19 += inv.ht19; total.tva19 += inv.tva19;
      total.timbre += inv.timbre; total.ttc += inv.ttc;
      jcInvoices.push({ file: f, ...inv });
      const ecritures = generateEcritures(inv, 'VT J.C', inv.numero || f.replace(/[^0-9]/g, '').substring(0, 8));
      allJCEcritures.push(...ecritures);
      console.log('OK:', f.padEnd(55), 'HT0=' + inv.ht0.toFixed(3), 'HT19=' + inv.ht19.toFixed(3), 'TVA=' + inv.tva19.toFixed(3), 'TF=' + inv.timbre.toFixed(3), 'TTC=' + inv.ttc.toFixed(3));
    } catch (e) { fail++; console.log('ERR:', f, e.message); }
  }
  console.log('OK=' + ok + ' FAIL=' + fail);
  console.log('TOTALS: HT0=' + total.ht0.toFixed(3) + ' HT19=' + total.ht19.toFixed(3) + ' TVA=' + total.tva19.toFixed(3) + ' TF=' + total.timbre.toFixed(3) + ' TTC=' + total.ttc.toFixed(3));

  // === C INVOICES ===
  const cFiles = fs.readdirSync(cDir).filter(f => f.endsWith('.pdf') && !f.includes('Rapport'));
  let ok2 = 0, fail2 = 0, total2 = { ht0: 0, ht19: 0, tva19: 0, timbre: 0, ttc: 0 };
  const cInvoices = [];
  let allCEcritures = [];

  console.log('\n=== C INVOICES ===');
  for (const f of cFiles) {
    try {
      const text = await extractTextFromPDF(path.join(cDir, f));
      const inv = parseInvoice(text);
      if (inv.ht0 === 0 && inv.ht19 === 0 && inv.ttc === 0) { fail2++; console.log('FAIL:', f); continue; }
      ok2++;
      total2.ht0 += inv.ht0; total2.ht19 += inv.ht19; total2.tva19 += inv.tva19;
      total2.timbre += inv.timbre; total2.ttc += inv.ttc;
      cInvoices.push({ file: f, ...inv });
      const ecritures = generateEcritures(inv, 'VT C', inv.numero || f.replace(/[^0-9]/g, '').substring(0, 8));
      allCEcritures.push(...ecritures);
      console.log('OK:', f.padEnd(55), 'HT0=' + inv.ht0.toFixed(3), 'HT19=' + inv.ht19.toFixed(3), 'TVA=' + inv.tva19.toFixed(3), 'TF=' + inv.timbre.toFixed(3), 'TTC=' + inv.ttc.toFixed(3));
    } catch (e) { fail2++; console.log('ERR:', f, e.message); }
  }
  console.log('OK=' + ok2 + ' FAIL=' + fail2);
  console.log('TOTALS: HT0=' + total2.ht0.toFixed(3) + ' HT19=' + total2.ht19.toFixed(3) + ' TVA=' + total2.tva19.toFixed(3) + ' TF=' + total2.timbre.toFixed(3) + ' TTC=' + total2.ttc.toFixed(3));

  // === RAPPORTS ===
  console.log('\n=== RAPPORT JC ===');
  const rapportJCFile = fs.readdirSync(jcDir).find(f => f.startsWith('Rapport'));
  if (rapportJCFile) {
    const rapportJCText = await extractTextFromPDF(path.join(jcDir, rapportJCFile));
    const rapportJC = parseRapportPage(rapportJCText);
    let jcR = { especes: 0, cheques: 0, tpe: 0, bonsAchat: 0, avoir: 0, credit: 0 };
    for (const [, v] of Object.entries(rapportJC)) for (const k of Object.keys(jcR)) jcR[k] += v[k];
    console.log('Days:', Object.keys(rapportJC).length);
    console.log('Especes=' + jcR.especes.toFixed(3) + ' Cheques=' + jcR.cheques.toFixed(3) + ' TPE=' + jcR.tpe.toFixed(3) + ' Bons=' + jcR.bonsAchat.toFixed(3) + ' Credit=' + jcR.credit.toFixed(3));
    console.log('Rapport TTC=' + (jcR.especes + jcR.cheques + jcR.tpe + jcR.bonsAchat + jcR.avoir + jcR.credit).toFixed(3));
  }

  console.log('\n=== RAPPORT C ===');
  const rapportCFile = fs.readdirSync(cDir).find(f => f.startsWith('Rapport'));
  if (rapportCFile) {
    const rapportCText = await extractTextFromPDF(path.join(cDir, rapportCFile));
    const rapportC = parseRapportPage(rapportCText);
    let cR = { especes: 0, cheques: 0, tpe: 0, bonsAchat: 0, avoir: 0, credit: 0 };
    for (const [, v] of Object.entries(rapportC)) for (const k of Object.keys(cR)) cR[k] += v[k];
    console.log('Days:', Object.keys(rapportC).length);
    console.log('Especes=' + cR.especes.toFixed(3) + ' Cheques=' + cR.cheques.toFixed(3) + ' TPE=' + cR.tpe.toFixed(3) + ' Bons=' + cR.bonsAchat.toFixed(3) + ' Credit=' + cR.credit.toFixed(3));
    console.log('Rapport TTC=' + (cR.especes + cR.cheques + cR.tpe + cR.bonsAchat + cR.avoir + cR.credit).toFixed(3));
  }

  // === GENERATE ECRITURES ===
  console.log('\n=== ECRITURES GENEREES ===');
  console.log(`Total ecritures JC: ${allJCEcritures.length}`);
  console.log(`Total ecritures C: ${allCEcritures.length}`);

  // Export to CSV
  const csvLines = ['Jour;Journal;N° Pièce;Compte;Libellé;Description;Débit;Crédit'];
  for (const e of allJCEcritures) {
    csvLines.push(`${e.date};${e.journal};${e.numero_piece};${e.compte};${e.libelle};${e.description};${e.debit};${e.credit}`);
  }
  for (const e of allCEcritures) {
    csvLines.push(`${e.date};${e.journal};${e.numero_piece};${e.compte};${e.libelle};${e.description};${e.debit};${e.credit}`);
  }
  fs.writeFileSync('ecritures_vtjc_juin2026.csv', csvLines.join('\n'), 'utf8');
  console.log('Exported to ecritures_vtjc_juin2026.csv');

  // === VERIFY ===
  console.log('\n=== VERIFICATION ===');
  console.log('JC Invoice TTC=' + total.ttc.toFixed(3));
  console.log('C  Invoice TTC=' + total2.ttc.toFixed(3));
  console.log('Total TTC=' + (total.ttc + total2.ttc).toFixed(3));
}

main().catch(console.error);