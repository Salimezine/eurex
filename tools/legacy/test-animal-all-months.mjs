import { getDocument } from './web/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';

// === EXTRACT TEXT FROM PDF ===
async function extractText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await getDocument({ data }).promise;
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.filter(item => 'str' in item && item.str.trim());
    const sorted = items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
    const rows = [];
    for (const item of sorted) {
      const y = Math.round(item.transform[5]);
      const existing = rows.find(r => Math.abs(r.y - y) < 4);
      if (existing) existing.items.push(item);
      else rows.push({ y, items: [item] });
    }
    for (const row of rows) row.items.sort((a, b) => a.transform[4] - b.transform[4]);
    fullText += rows.map(r => r.items.map(i => i.str).join(' ')).join('\n') + '\n';
  }
  return fullText;
}

// === NEW PARSE INVOICE (fixed regex) ===
function parseInvoice(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  let numero = '';
  let date = '';
  let client = '';
  let ht0 = 0, ht19 = 0, tva19 = 0, ttc = 0, timbre = 1.0;
  const p = (s) => { try { return parseFloat(s.replace(/ /g, '').replace(',', '.')); } catch { return 0; } };

  for (const line of lines) {
    if (!numero) {
      const m = line.match(/FACTURE\s*N[°o∞.]\s*:\s*(\d{4})\s*\/\s*(\d+)/);
      if (m) numero = m[1] + '/' + m[2];
    }
    if (!date) {
      const m = line.match(/LE\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) date = m[3] + '-' + m[2] + '-' + m[1];
    }
    if (!client) {
      // FIXED: ^Client matches "Client :" at start of line, NOT "Code Client :"
      const m = line.match(/^Client\s*:\s*(.+)/);
      if (m) {
        const c = m[1].trim();
        client = c.toUpperCase().includes('PASSAGERS') ? 'CLIENTS PASSAGERS' : c;
      }
    }
    if (!ht0) {
      const m = line.match(/([\d][\d ]*,\d+)\s+0%\s+NET\s+H\.TVA\s*:\s*([\d ][\d ]*,\d+)/);
      if (m) { ht0 = p(m[1]); }
    }
    if (!ht19) {
      const m = line.match(/([\d][\d ]*,\d+)\s+19%\s+([\d ]*,\d+)/);
      if (m) { ht19 = p(m[1]); tva19 = p(m[2]); }
    }
    if (timbre === 1.0) {
      const m = line.match(/TIMBRE\s+FIS\.?\s*:\s*([\d ]*,\d+)/);
      if (m) timbre = p(m[1]);
    }
    if (!ttc) {
      const m = line.match(/NET\s+T\.T\.C\.?\s+([\d ]*,\d+)/);
      if (m) ttc = p(m[1]);
    }
  }

  return { date, numero, client, ht0, ht19, tva19, timbre, ttc };
}

// === MAIN ===
const BASE = 'D:\\ANIMAL  CITY\\EXERCICE\\2026\\VENTE';
const months = fs.readdirSync(BASE).filter(d => fs.statSync(path.join(BASE, d)).isDirectory());

let totalInvoices = 0;
let totalParsed = 0;
let totalClientOK = 0;
let totalClientEmpty = 0;
let totalClientCode = 0;
let totalHT0OK = 0;
let totalTTCOK = 0;
let totalTTCMatch = 0;

const allClients = new Map(); // client name -> count
const errors = [];

for (const month of months) {
  const monthDir = path.join(BASE, month);
  const subDirs = fs.readdirSync(monthDir).filter(d => fs.statSync(path.join(monthDir, d)).isDirectory());

  let monthTotal = 0;
  let monthParsed = 0;
  let monthClientOK = 0;
  let monthClientEmpty = 0;
  let monthClientCode = 0;

  for (const sub of subDirs) {
    const pdfDir = path.join(monthDir, sub);
    const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf') && !f.startsWith('Rapport'));

    for (const file of files) {
      monthTotal++;
      totalInvoices++;
      try {
        const text = await extractText(path.join(pdfDir, file));
        const inv = parseInvoice(text);

        if (inv.numero) monthParsed++;
        if (inv.client) {
          monthClientOK++;
          allClients.set(inv.client, (allClients.get(inv.client) || 0) + 1);
        } else {
          monthClientEmpty++;
          errors.push({ month, sub, file, field: 'client', value: 'EMPTY' });
        }

        // Check if client is a pure number (should not happen with new regex)
        if (/^\d+$/.test(inv.client)) {
          monthClientCode++;
          totalClientCode++;
          errors.push({ month, sub, file, field: 'client', value: inv.client + ' (NUMERIC!)' });
        }

        if (inv.ht0 > 0) totalHT0OK++;
        if (inv.ttc > 0) {
          totalTTCOK++;
          const expected = Math.round((inv.ht0 + inv.ht19 + inv.tva19 + inv.timbre) * 1000) / 1000;
          if (Math.abs(inv.ttc - expected) < 0.02) totalTTCMatch++;
        }
      } catch (err) {
        errors.push({ month, sub, file, field: 'EXTRACT_ERROR', value: err.message });
      }
    }
  }

  console.log(`${month.padEnd(10)} ${monthTotal.toString().padStart(3)} PDFs  parsed=${monthParsed.toString().padStart(3)}  client_ok=${monthClientOK.toString().padStart(3)}  empty=${monthClientEmpty.toString().padStart(3)}  numeric=${monthClientCode.toString().padStart(3)}`);
}

console.log('\n=== TOTALS ===');
console.log(`Total invoices: ${totalInvoices}`);
console.log(`Parsed (have numero): ${totalParsed}`);
console.log(`Client extracted: ${totalClientOK}`);
console.log(`Client empty: ${totalClientEmpty}`);
console.log(`Client NUMERIC (bad): ${totalClientCode}`);
console.log(`HT0 extracted: ${totalHT0OK}`);
console.log(`TTC extracted: ${totalTTCOK}`);
console.log(`TTC matches sum: ${totalTTCMatch}`);

console.log('\n=== UNIQUE CLIENTS ===');
const sorted = [...allClients.entries()].sort((a, b) => b[1] - a[1]);
for (const [name, count] of sorted) {
  console.log(`  ${count.toString().padStart(4)}x  ${name}`);
}

if (errors.length > 0) {
  console.log('\n=== ERRORS (first 20) ===');
  for (const e of errors.slice(0, 20)) {
    console.log(`  ${e.month}/${e.sub}/${e.file}: ${e.field} = ${e.value}`);
  }
}
