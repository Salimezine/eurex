const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = new Database(path.join(__dirname, 'comptaflow.db'));
db.pragma('journal_mode = WAL');

function genId() { return crypto.randomBytes(8).toString('hex'); }

// PDF text extraction using pdfjs-dist
async function extractTextFromPDF(filePath) {
  const pdfjsLib = require('pdfjs-dist');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(item => item.str).join(' ') + '\n';
  }
  return fullText;
}

function parseNumber(s) {
  if (!s) return 0;
  return parseFloat(s.replace(/\s/g, '').replace(',', '.')) || 0;
}

function parseInvoice(text) {
  let numero = '';
  const numPatterns = [
    /(?:FACTURE\s*N[°o∞.]\s*:?)(\S+)/i,
    /(?:N[°o]\s*facture\s*:?)(\S+)/i,
    /(\d{4}\/\d{2,4})/,
    /(?:Edition facture vente)(\d+)/i,
  ];
  for (const p of numPatterns) {
    const m = text.match(p);
    if (m) { numero = m[1]; break; }
  }

  let date = '';
  const datePatterns = [
    /(\d{2}\/\d{2}\/\d{4})/,
    /(\d{2}\s+\w+\s+\d{4})/,
  ];
  for (const p of datePatterns) {
    const m = text.match(p);
    if (m) {
      const raw = m[1];
      if (raw.includes('/')) {
        const [d, mo, y] = raw.split('/');
        date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      break;
    }
  }

  let client = '';
  const clientMatch = text.match(/^Client\s*:\s*(.+?)$/m);
  if (clientMatch) {
    const c = clientMatch[1].trim();
    client = c.toUpperCase().includes('PASSAGERS') ? 'CLIENTS PASSAGERS' : c;
  }

  let ht0 = 0, ht19 = 0, tva19 = 0, ttc = 0, timbre = 1;

  const ht0Match = text.match(/(?:HT\s*0%?|Base\s*0%|0%)\s*[:=]?\s*([\d\s.,]+)/i);
  const ht19Match = text.match(/(?:HT\s*19%?|Base\s*19%|19%)\s*[:=]?\s*([\d\s.,]+)/i);
  const tvaMatch = text.match(/(?:TVA\s*19%?)\s*[:=]?\s*([\d\s.,]+)/i);
  const ttcMatch = text.match(/(?:Net\s*TTC|Total\s*TTC|A\s*payer|Net\s*à\s*payer)\s*[:=]?\s*([\d\s.,]+)/i);
  const timbreMatch = text.match(/(?:Timbre)\s*[:=]?\s*([\d\s.,]+)/i);

  if (ht0Match) ht0 = parseNumber(ht0Match[1]);
  if (ht19Match) ht19 = parseNumber(ht19Match[1]);
  if (tvaMatch) tva19 = parseNumber(tvaMatch[1]);
  if (ttcMatch) ttc = parseNumber(ttcMatch[1]);
  if (timbreMatch) timbre = parseNumber(timbreMatch[1]);

  if (ttc === 0 && (ht0 + ht19 + tva19) > 0) ttc = ht0 + ht19 + tva19 + timbre;

  return { date, numero, client, ht0, ht19, tva19, ttc, timbre, rawText: text.substring(0, 500) };
}

async function main() {
  const uploadsDir = path.join(__dirname, 'uploads');
  const pdfFiles = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.pdf') && f.startsWith('Edition'));

  console.log(`Found ${pdfFiles.length} invoice PDFs to process`);

  const dossier = db.prepare('SELECT id, societe_id FROM dossiers WHERE nom = ?').get('ANIMAL');
  if (!dossier) { console.error('Dossier ANIMAL not found'); return; }

  // Clear old factures
  db.prepare('DELETE FROM factures WHERE dossier_id = ?').run(dossier.id);
  db.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'VT J.C'").run(dossier.id);

  const results = [];
  for (const file of pdfFiles) {
    const filePath = path.join(uploadsDir, file);
    try {
      const text = await extractTextFromPDF(filePath);
      const inv = parseInvoice(text);
      if (!inv.numero) inv.numero = file.replace(/[^0-9]/g, '');

      const id = genId();
      db.prepare('INSERT INTO factures (id, dossier_id, societe_id, date_facture, numero_facture, client, total_ht_0, total_ht_19, tva_19, timbre, total_ttc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, dossier.id, dossier.societe_id, inv.date, inv.numero, inv.client, inv.ht0, inv.ht19, inv.tva19, inv.timbre, inv.ttc);

      results.push({ file, numero: inv.numero, date: inv.date, ht0: inv.ht0, ht19: inv.ht19, tva19: inv.tva19, ttc: inv.ttc });
      console.log(`OK: ${inv.numero} | ${inv.date} | HT0=${inv.ht0} HT19=${inv.ht19} TVA=${inv.tva19} TTC=${inv.ttc}`);
    } catch (e) {
      console.error(`ERROR ${file}: ${e.message}`);
    }
  }

  console.log(`\nProcessed ${results.length} invoices`);
  console.log('\nSample raw text from first invoice:');
  if (results.length > 0) {
    const first = results[0];
    console.log(JSON.stringify(first, null, 2));
  }

  db.close();
}

main().catch(console.error);
