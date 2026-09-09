import { getDocument } from './web/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';

const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const DID = 'dossier_animal';
const SOC_ID = 'soc_animal';

async function extractText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await getDocument({ data }).promise;
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.filter(item => 'str' in item).map(item => item.str).join('\n') + '\n';
  }
  return fullText;
}

function parseInvoice(text) {
  let numero = '';
  let m = text.match(/FACTURE\s*N[°o∞.]\s*:\s*(\d{4})\s*\/\s*(\d+)/);
  if (m) numero = m[1] + '/' + m[2];

  let date = '';
  m = text.match(/LE\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) date = m[3] + '-' + m[2] + '-' + m[1];

  let client = '';
  m = text.match(/(?<!Code )Client\s*:\s*(.+?)(?:\n|$)/);
  if (m) {
    const c = m[1].trim();
    client = c.toUpperCase().includes('PASSAGERS') ? 'CLIENTS PASSAGERS' : c;
  }

  let ht0 = 0, ht19 = 0, tva19 = 0, ttc = 0, timbre = 1.0;
  const lines = text.split('\n');

  for (const line of lines) {
    if (ht0 === 0) {
      m = line.match(/^([\d][\d ,.]+?)\s+0%\s/);
      if (m) { try { ht0 = parseFloat(m[1].trim().replace(/ /g, '').replace(',', '.')); } catch {} }
    }
    if (ht19 === 0) {
      m = line.match(/^([\d][\d ,.]+?)\s+19%\s+([\d ,.]+)/);
      if (m) {
        try { ht19 = parseFloat(m[1].trim().replace(/ /g, '').replace(',', '.')); } catch {}
        try { tva19 = parseFloat(m[2].trim().replace(/ /g, '').replace(',', '.')); } catch {}
      }
    }
    if (timbre === 1.0) {
      m = line.match(/TIMBRE\s+FIS\.\s*:\s*([\d ,.]+)/);
      if (m) { try { timbre = parseFloat(m[1].trim().replace(/ /g, '').replace(',', '.')); } catch {} }
    }
    if (ttc === 0) {
      m = line.match(/NET\s+T\.T\.C\.\s*([\d ,.]+)/);
      if (m) { try { ttc = parseFloat(m[1].trim().replace(/ /g, '').replace(',', '.')); } catch {} }
    }
  }

  return { date, numero, client, ht0, ht19, tva19, timbre, ttc };
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  return r.json();
}

// --- PHASE 1: Extract and parse all PDFs ---
const jcDir = 'D:\\ANIMAL  CITY\\EXERCICE\\2026\\VENTE\\01-2026\\JC';
const cDir = 'D:\\ANIMAL  CITY\\EXERCICE\\2026\\VENTE\\01-2026\\C';

console.log('=== EXTRACTING PDF TEXT ===\n');

// Extract first JC invoice to see format
const jcFiles = fs.readdirSync(jcDir).filter(f => f.endsWith('.pdf') && !f.startsWith('Rapport'));
const cFiles = fs.readdirSync(cDir).filter(f => f.endsWith('.pdf') && !f.startsWith('Rapport'));

console.log(`JC invoices: ${jcFiles.length}`);
console.log(`C invoices: ${cFiles.length}`);

// Show first 3 JC invoice texts
console.log('\n--- SAMPLE JC INVOICE TEXT ---');
for (const f of jcFiles.slice(0, 3)) {
  const text = await extractText(path.join(jcDir, f));
  console.log(`\n=== ${f} ===`);
  console.log(text.substring(0, 500));
}

// Show first 3 C invoice texts
console.log('\n--- SAMPLE C INVOICE TEXT ---');
for (const f of cFiles.slice(0, 3)) {
  const text = await extractText(path.join(cDir, f));
  console.log(`\n=== ${f} ===`);
  console.log(text.substring(0, 500));
}

// Show rapport text
const rapportJC = fs.readdirSync(jcDir).filter(f => f.startsWith('Rapport'));
const rapportC = fs.readdirSync(cDir).filter(f => f.startsWith('Rapport'));
if (rapportJC.length) {
  const text = await extractText(path.join(jcDir, rapportJC[0]));
  console.log('\n--- RAPPORT JC TEXT ---');
  console.log(text);
}
if (rapportC.length) {
  const text = await extractText(path.join(cDir, rapportC[0]));
  console.log('\n--- RAPPORT C TEXT ---');
  console.log(text);
}

// --- PHASE 2: Parse all JC invoices as factures ---
console.log('\n\n=== PHASE 2: PARSE ALL JC INVOICES ===\n');

// Clear existing data first
await api('DELETE', `/api/dossiers/${DID}/factures`);

const allJCInvoices = [];
const parseErrors = [];
const totalHT0 = { sum: 0 };
const totalHT19 = { sum: 0 };
const totalTVA19 = { sum: 0 };

for (const f of jcFiles) {
  const text = await extractText(path.join(jcDir, f));
  const inv = parseInvoice(text);
  if (!inv.numero) inv.numero = f.replace(/[^0-9]/g, '').substring(0, 8);
  inv.fileName = f;
  allJCInvoices.push(inv);
  totalHT0.sum += inv.ht0;
  totalHT19.sum += inv.ht19;
  totalTVA19.sum += inv.tva19;
  
  if (inv.ht0 === 0 && inv.ht19 === 0) {
    parseErrors.push({ file: f, inv });
  }
}

console.log(`Parsed ${allJCInvoices.length} JC invoices`);
console.log(`Parse errors (no HT detected): ${parseErrors.length}`);
if (parseErrors.length) {
  console.log('Errors:');
  parseErrors.forEach(e => console.log(`  ${e.file}: ht0=${e.inv.ht0} ht19=${e.inv.ht19} ttc=${e.inv.ttc} num=${e.inv.numero}`));
}

console.log(`\nTotals: HT0=${totalHT0.sum.toFixed(3)} HT19=${totalHT19.sum.toFixed(3)} TVA19=${totalTVA19.sum.toFixed(3)}`);

// Show per-invoice details
console.log('\n--- PARSED INVOICES ---');
for (const inv of allJCInvoices) {
  console.log(`${inv.fileName}: date=${inv.date} num=${inv.numero} client=${inv.client} ht0=${inv.ht0} ht19=${inv.ht19} tva=${inv.tva19} ttc=${inv.ttc} timbre=${inv.timbre}`);
}

// --- PHASE 3: Upload factures to API ---
console.log('\n\n=== PHASE 3: UPLOAD FACTURES ===\n');

let uploaded = 0;
for (const inv of allJCInvoices) {
  await api('POST', `/api/dossiers/${DID}/factures`, {
    date_facture: inv.date,
    numero_facture: inv.numero,
    client: inv.client,
    total_ht_0: inv.ht0,
    total_ht_19: inv.ht19,
    tva_19: inv.tva19,
    timbre: inv.timbre,
    total_ttc: inv.ttc
  });
  uploaded++;
}
console.log(`Uploaded ${uploaded} factures`);

// Verify upload
const factures = await api('GET', `/api/dossiers/${DID}/factures`);
console.log(`Factures in DB: ${Array.isArray(factures) ? factures.length : 'ERROR: ' + JSON.stringify(factures)}`);
