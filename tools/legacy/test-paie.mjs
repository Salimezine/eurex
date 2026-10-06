import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

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

function parseBulletinPage(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const p = s => { try { return parseFloat(s.replace(/ /g, '').replace(',', '.')); } catch { return 0; } };

  let matricule = '', nom = '', emploi = '';
  let salaireBase = 0, indemnites = 0, totalBrut = 0;
  let cnss = 0, irpp = 0, css = 0, totalRetenues = 0, netAPayer = 0;
  let hasCNSS = false;

  for (const line of lines) {
    // Employee info
    let m = line.match(/Matricule\s+(\d+)/);
    if (m) matricule = m[1];

    m = line.match(/(?:Mme|Mlle|Mr)\s+(.+?)(?:\s+N°|\s+Adresse|\s+Emploi)/);
    if (m) nom = m[1].trim();

    m = line.match(/Emploi\s+(.+?)(?:\s+Matricule|\s+N°|$)/);
    if (m && !emploi) emploi = m[1].trim();

    // Salaire de base (code 1000)
    m = line.match(/1000\s+Salaire de base.*?([\d ]*,\d+)\s+([\d ]*,\d+)/);
    if (m) salaireBase = p(m[2]);

    // Indemnités (codes 1300, 2100, 2200)
    m = line.match(/(?:1300|2100|2200)\s+.*?[\d ]*,\d+\s+([\d ]*,\d+)/);
    if (m) indemnites += p(m[1]);

    // Total Brut
    m = line.match(/Total Brut\s+([\d ]*,\d+)/);
    if (m) totalBrut = p(m[1]);

    // CNSS (code 8110)
    m = line.match(/8110\s+CNSS\s+([\d ]*,\d+)\s+([\d ]*,\d+)\s+([\d ]*,\d+)/);
    if (m) { cnss = p(m[3]); hasCNSS = true; }

    // IRPP (code 8310)
    m = line.match(/8310\s+IRPP\s+([\d ]*,\d+)/);
    if (m) irpp = p(m[1]);

    // CSS (code 8350)
    m = line.match(/8350\s+CSS\s+([\d ]*,\d+)/);
    if (m) css = p(m[1]);

    // Total Retenues
    m = line.match(/Total Retenues\s+([\d ]*,\d+)/);
    if (m) totalRetenues = p(m[1]);

    // Net à payer (last number before "Pour vous aider")
    m = line.match(/([\d ]*,\d+)\s+Pour vous aider/);
    if (m) netAPayer = p(m[1]);
  }

  // If netAPayer not found, calculate
  if (netAPayer === 0 && totalBrut > 0) {
    netAPayer = Math.round((totalBrut - totalRetenues) * 1000) / 1000;
  }

  return { matricule, nom, emploi, salaireBase, indemnites, totalBrut, cnss, irpp, css, totalRetenues, netAPayer, hasCNSS };
}

function generatePaieEcritures(bulletins, month) {
  const ecritures = [];
  if (bulletins.length === 0) return ecritures;

  const jour = 'ECR PAIE';
  const date = month + '-28'; // End of month
  const piece = `PAIE ${config.months[month] || month} 2026`;

  // Aggregate totals
  let totalSalaireBase = 0, totalIndemnites = 0, totalBrut = 0;
  let totalCNSS = 0, totalIRPP = 0, totalCSS = 0, totalNet = 0;

  for (const b of bulletins) {
    totalSalaireBase += b.salaireBase;
    totalIndemnites += b.indemnites;
    totalBrut += b.totalBrut;
    totalCNSS += b.cnss;
    totalIRPP += b.irpp;
    totalCSS += b.css;
    totalNet += b.netAPayer;
  }

  // DEBIT: 641100 Rémunération du personnel - Salaires
  if (totalSalaireBase > 0) {
    ecritures.push({
      date, journal: jour, numero_piece: piece,
      compte: '641100', libelle: 'REMUNERATION DU PERSONNEL - SALAIRES',
      description: piece, debit: Math.round(totalSalaireBase * 1000) / 1000, credit: 0
    });
  }

  // DEBIT: 641300 Indemnités
  if (totalIndemnites > 0) {
    ecritures.push({
      date, journal: jour, numero_piece: piece,
      compte: '641300', libelle: 'REMUNERATION DU PERSONNEL - INDEMNITES',
      description: piece, debit: Math.round(totalIndemnites * 1000) / 1000, credit: 0
    });
  }

  // CREDIT: 431100 Sécurité sociale - Cotisations salariales
  if (totalCNSS > 0) {
    ecritures.push({
      date, journal: jour, numero_piece: piece,
      compte: '431100', libelle: 'SECURITE SOCIALE - COTISATIONS SALARIALES',
      description: piece, debit: 0, credit: Math.round(totalCNSS * 1000) / 1000
    });
  }

  // CREDIT: 445600 Impôts - IRPP
  if (totalIRPP > 0) {
    ecritures.push({
      date, journal: jour, numero_piece: piece,
      compte: '445600', libelle: 'IMPOTS SUR LES REVENUS - IRPP',
      description: piece, debit: 0, credit: Math.round(totalIRPP * 1000) / 1000
    });
  }

  // CREDIT: 445610 Impôts - CSS
  if (totalCSS > 0) {
    ecritures.push({
      date, journal: jour, numero_piece: piece,
      compte: '445610', libelle: 'COTISATION SOLIDARITE - CSS',
      description: piece, debit: 0, credit: Math.round(totalCSS * 1000) / 1000
    });
  }

  // CREDIT: 421100 Personnel - Rémunérations dues (Net à payer)
  if (totalNet > 0) {
    ecritures.push({
      date, journal: jour, numero_piece: piece,
      compte: '421100', libelle: 'PERSONNEL - REMUNERATIONS DUES',
      description: piece, debit: 0, credit: Math.round(totalNet * 1000) / 1000
    });
  }

  return ecritures;
}

async function main() {
  const month = process.argv[2] || '06-2026';
  const basePath = `${config.basePath}\\..\\SOCIALE\\PAIE\\${month}`;

  if (!fs.existsSync(basePath)) {
    console.error(`Cannot find PAIE directory: ${basePath}`);
    return;
  }

  const pdfFiles = fs.readdirSync(basePath).filter(f => f.toUpperCase().startsWith('BP') && f.toUpperCase().endsWith('.PDF'));
  console.log(`=== PAIE ${config.months[month] || month} 2026 ===\n`);
  console.log(`Found ${pdfFiles.length} bulletin(s)\n`);

  const bulletins = [];
  let totalBrut = 0, totalNet = 0;

  for (const f of pdfFiles) {
    try {
      const text = await extractTextFromPDF(path.join(basePath, f));
      
      // Parse each page as separate employee
      const pages = text.split(/(?=ANIMAL CITY)/g).filter(p => p.includes('Bulletin de Paie'));
      
      for (const pageText of pages) {
        const b = parseBulletinPage(pageText);
        if (b.totalBrut > 0) {
          bulletins.push(b);
          totalBrut += b.totalBrut;
          totalNet += b.netAPayer;
          console.log(`${b.matricule} ${b.nom}: Brut=${b.totalBrut.toFixed(3)} Net=${b.netAPayer.toFixed(3)}`);
        }
      }
    } catch (e) {
      console.log('ERR:', f, e.message);
    }
  }

  console.log(`\nTotal: ${bulletins.length} employés, Brut=${totalBrut.toFixed(3)}, Net=${totalNet.toFixed(3)}`);

  // Generate entries
  const ecritures = generatePaieEcritures(bulletins, month);

  // Export CSV
  const outputFile = `${config.outputDir}\\ecritures_paie_${month.replace('-', '_')}.csv`;
  const csvLines = ['Jour;Journal;N° Pièce;Compte;Libellé;Description;Débit;Crédit'];
  for (const e of ecritures) {
    csvLines.push(`${e.date};${e.journal};${e.numero_piece};${e.compte};${e.libelle};${e.description};${e.debit};${e.credit}`);
  }
  fs.writeFileSync(outputFile, csvLines.join('\n'), 'utf8');
  console.log(`\nExported ${ecritures.length} entries to ${outputFile}`);

  // Balance check
  let deb = 0, cred = 0;
  for (const e of ecritures) { deb += e.debit; cred += e.credit; }
  const diff = Math.round((deb - cred) * 1000) / 1000;
  console.log(`\nBalance: D=${deb.toFixed(3)} C=${cred.toFixed(3)} ${Math.abs(diff) < 0.01 ? '✓ Balanced' : '⚠ UNBALANCED diff=' + diff}`);
}

main().catch(console.error);
