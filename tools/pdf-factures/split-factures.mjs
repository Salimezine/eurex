import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as ns from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';

globalThis.DOMMatrix = ns.DOMMatrix;
globalThis.Path2D = ns.Path2D;
globalThis.ImageData = ns.ImageData;

// ------------------------------------------------------------------ usage
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!args[0]) {
  console.log('Usage : node split-factures.mjs <fichier.pdf> [dossier_sortie]');
  process.exit(1);
}
const input = path.resolve(args[0]);
if (!fs.existsSync(input)) { console.error('Fichier introuvable : ' + input); process.exit(1); }
const base = path.basename(input, path.extname(input));
const outDir = path.resolve(args[1] || path.join(path.dirname(input), base + '_PDFs'));
fs.mkdirSync(outDir, { recursive: true });

// --------------------------------------------------------------- helpers
const pdfjsDir = fileURLToPath(new URL('.', import.meta.resolve('pdfjs-dist/package.json')));
const PDFJS_OPTS = {
  useSystemFonts: true,
  wasmUrl: pdfjsDir + 'wasm/',
  cMapUrl: pdfjsDir + 'cmaps/',
  cMapPacked: true,
  standardFontDataUrl: pdfjsDir + 'standard_fonts/',
};

// note ecrasee sur le scan ("AC 02/06", "PC 1200 ...") : a retirer des candidats
const NOTE_RE = /^(?:AC|PC|CA|RC|NC|FC|N)\s*[\d\s]{0,8}[/\-.]\s*\d{1,2}(?:\s*[/\-.]\s*\d{1,2})?(?:\s+|$)/i;

function stripNote(line) {
  return line
    .replace(/^[\s'‘’`"“”«».,;:—–\-—]+/, '')
    .replace(NOTE_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}



function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function extractDate(text) {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ');
  const cands = [];
  const add = (m, d) => { if (d) cands.push({ d, i: m.index, ctx: t.slice(Math.max(0, m.index - 50), m.index) }); };

  for (const m of t.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) add(m, chk(m[1], m[2], m[3]));
  for (const m of t.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](20\d{2}|\d{2})\b/g)) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    add(m, chk(y, m[2], m[1]));
  }
  const mo = { janv: 1, fevr: 2, 'févr': 2, mars: 3, avr: 4, avri: 4, mai: 5, juin: 6, juil: 7, aout: 8, 'août': 8, sept: 9, oct: 10, nov: 11, dec: 12, 'déc': 12 };
  for (const m of t.matchAll(/\b(\d{1,2})\s+(janv|fevr|févr|mars|avr|avri|mai|juin|juil|aout|août|sept|oct|nov|dec|déc)\w*\.?\s+(20\d{2})\b/gi)) {
    const M = mo[m[2].toLowerCase().slice(0, 4)] ?? mo[m[2].toLowerCase().slice(0, 3)];
    if (M) add(m, chk(m[3], M, m[1]));
  }
  if (!cands.length) return null;
  for (const c of cands) {
    let s = 0;
    if (/\bdate\b|\bd[ée]livr|émis|emission|facture\s*(n|N)?\s*o?\.?\s*\d|du\s+\d{1,2}\s/i.test(c.ctx)) s += 70;
    if (NOTE_RE.test(c.ctx.trim())) s -= 100;      // la note "AC 02/06..."
    if (c.ctx.length <= 5) s += 15;                // tout en debut de texte
    c.s = s;
  }
  cands.sort((a, b) => b.s - a.s || a.i - b.i);
  return cands[0].s > -50 ? cands[0].d : null;

  function chk(y, mo2, d) {
    const Y = +y, MO = +mo2, D = +d;
    if (MO < 1 || MO > 12 || D < 1 || D > 31 || Y < 2000 || Y > 2100) return null;
    return fmtDate(new Date(Y, MO - 1, D));
  }
}

const LEGAL = /\b(SARL|S\.?\s?A\.?\b|S\.?\s?C\.?\s?S|SAS|STE|SU\b|ST\b|ETS|Ets\b|ETABLISSEMENT|ÉTABLISSEMENT|SOCI[EÉ]T[EÉ]|ENTREPRISE|GROUPE|COMPTOIR|DISTRIBUTION|IMPORT|EXPORT|FILIALE|UNION|COOP[ÉE]RATIVE|C\.I\.E|CIE\b)\b/i;
const ADDR = /\b(RUE|AVENUE|AV\.|BD\b|BOULEVARD|IMMEUBLE|BLOT|BP\b|ETAGE|ETG|RESIDENCE|ZONE\s*(INDUS|ACTIV)|CODE\s*POSTAL)\b/i;
const DOCTYPE = /\b(?:FACTURE\s*ESTIM|FACTURE|DEVIS|BON\s*DE|LIVRAISON|REGLEMENT|R[ÉE]CEPISSE|RECU\b|PROFORMA|COMMANDE|PI[EÈ]CE\s*JUST|NOTA\s*BENE|DEJA\s*SAISIE|SAISIE\b|DUPLICATA|COPIE\b|ANNUL[ÉE]|PAY[ÉE]\b|IMPAY[ÉE]|QUITTANCE|DE?SIGNATION\b|PUHT|ARTICLE\b|TOTAL(?:HT|TTC)?\b|BAILLEUR|LOCATAIRE|ESPECES?\b|MONNAIE)\b|CAISSE\s*[:;]|RIEN\s*A\s*COMPTABILISER|IMPRIMER\s*LA\s*PAGE/i;
const PRICE = /\b\d{1,3}[.,]\d{3}\b|\b\d+[.,]\d{2}\b/;


function slug(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s\-_.,;:'’"]+/, '')
    .slice(0, 60)
    .replace(/[\s.\-_]+$/, '');
}

function scoreLine(line, y, size, pageH) {
  let txt = stripNote(line);
  if (!txt || /(^|\s)\d{1,2}[/\-.]\d{1,2}([/\-.]\d{2,4})?(\s|$)/.test(txt) && txt.replace(/[\d\s./-]/g, '').length < 4) {
    return -Infinity;                                 // reste une date seule
  }
  if (txt.length < 3 || txt.length > 70) return -Infinity;
  const letters = (txt.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (letters < 4) return -Infinity;
  const symbols = (txt.match(/[^\wÀ-ÿ\s]/g) || []).length;
  if (symbols / txt.length > 0.3) return -Infinity;   // texte casse (graphes, bruit OCR)
  if (/^[\d\s./+-]+$/.test(txt)) return -Infinity;
  if (/@|http|www\.|^\s*\d+\s*$/.test(txt)) return -Infinity;

  let s = Math.min(size || 10, 34) * 1.2;
  if (LEGAL.test(txt)) s += 55;
  if (ADDR.test(txt)) s -= 55;
  if (DOCTYPE.test(txt)) s -= 60;
  if (PRICE.test(txt)) s -= 45;
  if (/[[\]{}#£€$]/.test(txt)) s -= 40;
  if ((txt.match(/\d/g) || []).length >= 3) s -= 35;
  const words = txt.match(/\S+/g) || [];
  const longW = words.filter(w => w.length >= 4).length;
  if (words.length >= 3 && longW / words.length < 0.4) s -= 45;  // bruit OCR (mots trop courts)
  if (!words.some(w => w.length >= 4)) s -= 60;
  if (txt.length > 45) s -= 30;
  if (txt === txt.toUpperCase() && /[A-ZÀ-Þ]{4}/.test(txt)) s += 10;
  if (words.length >= 2) s += 10;
  if (y < pageH * 0.45) s += 25; else if (y > pageH * 0.65) s -= 30;
  if (txt.length < 6) s -= 15;
  return s;
}


// lignes {text,size,y} à partir des items pdfjs
function linesFromPdfItems(items, viewport) {
  const rows = new Map();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const tr = viewport.transform;
    const x = tr[0] * it.transform[4] + tr[2] * it.transform[5] + tr[4];
    const y = tr[1] * it.transform[4] + tr[3] * it.transform[5] + tr[5];
    const size = Math.hypot(it.transform[2], it.transform[3]) || 10;
    const key = Math.round(y / 5);
    if (!rows.has(key)) rows.set(key, { y, parts: [] });
    rows.get(key).parts.push({ x, str: it.str, size });
  }
  return [...rows.values()]
    .map(r => ({
      text: r.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim(),
      size: Math.max(...r.parts.map(p => p.size)),
      y: r.y,
    }))
    .filter(r => r.text);
}

// lignes {text,size,y} à partir des words tesseract (fallback : lignes texte)
function linesFromOcr(data, pageH) {
  const words = data.words?.length ? data.words : (data.blocks || [])
    .flatMap(b => b.paragraphs || []).flatMap(p => p.lines || []).flatMap(l => l.words || []);
  if (words.length) {
    const rows = new Map();
    for (const w of words) {
      if (!w.text?.trim()) continue;
      const key = Math.round(w.bbox.y0 / 8);
      if (!rows.has(key)) rows.set(key, { y: w.bbox.y0, parts: [] });
      rows.get(key).parts.push({ x: w.bbox.x0, str: w.text, size: w.bbox.y1 - w.bbox.y0 });
    }
    return [...rows.values()]
      .map(r => ({
        text: r.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').trim(),
        size: Math.max(...r.parts.map(p => p.size), 8),
        y: r.y,
      }))
      .filter(r => r.text);
  }
  return (data.text || '')
    .split('\n')
    .map((t, i) => ({ text: t.trim(), size: 12, y: 20 + i * 20 }))
    .filter(r => r.text);
}

function pickSupplier(lines, pageH) {
  let best = null, bestScore = -Infinity;
  for (const l of lines) {
    const s = scoreLine(l.text, l.y, l.size, pageH);
    if (s > bestScore) { bestScore = s; best = { txt: stripNote(l.text), s, hasLegal: LEGAL.test(stripNote(l.text)) }; }
  }
  if (best && best.s >= (best.hasLegal ? 25 : 45)) return best.txt;
  // secours : toute ligne avec forme juridique, sans note ni adresse
  for (const l of lines) {
    const txt = stripNote(l.text);
    if (txt && LEGAL.test(txt) && txt.length <= 70 && !ADDR.test(txt)) return txt;
  }
  return null;
}


// ------------------------------------------------------------------ main
console.log('Fichier : ' + input);
console.log('Sortie  : ' + outDir);

const doc = await getDocument({ ...PDFJS_OPTS, url: input }).promise;
const srcPdf = await PDFDocument.load(fs.readFileSync(input));
console.log('Pages   : ' + doc.numPages);

let worker = null;
async function getWorker() {
  if (!worker) {
    console.log('OCR : telechargement du modele Francais (1ere fois)...');
    worker = await createWorker('fra');
  }
  return worker;
}

const used = new Set();
const results = [];

for (let i = 1; i <= doc.numPages; i++) {
  const t0 = Date.now();
  const page = await doc.getPage(i);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  let text = tc.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
  let lines, mode;

  if (text.length >= 40) {
    lines = linesFromPdfItems(tc.items, page.getViewport({ scale: 1 }));
    mode = 'texte';
  } else {
    // scan -> rendu + OCR
    const w = await getWorker();
    const vp2 = page.getViewport({ scale: 2 });
    const canvas = ns.createCanvas(Math.ceil(vp2.width), Math.ceil(vp2.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas: null, viewport: vp2, background: '#ffffff' }).promise;
    const png = await canvas.encode('png');
    const { data } = await w.recognize(png);
    const ocrText = (data.text || '').replace(/\s+/g, ' ').trim();
    lines = linesFromOcr(data, vp2.height);
    text = (text + ' ' + ocrText).replace(/\s+/g, ' ').trim();
    mode = 'OCR';
  }

  const supplier = pickSupplier(lines, vp.height) || '';
  const date = extractDate(text) || '';

  // page seule
  const one = await PDFDocument.create();
  const [copied] = await one.copyPages(srcPdf, [i - 1]);
  one.addPage(copied);
  const bytes = await one.save();

  const name0 = `${String(i).padStart(3, '0')}_${slug(supplier) || 'fournisseur-inconnu'}_${date || 'sans-date'}`;
  let name = name0 + '.pdf', n = 2;
  while (used.has(name.toLowerCase())) name = `${name0}-${n++}.pdf`;
  used.add(name.toLowerCase());
  fs.writeFileSync(path.join(outDir, name), bytes);

  results.push({ page: i, name, supplier: supplier || '(introuvable)', date: date || '(pas de date)', mode });
  console.log(
    `page ${String(i).padStart(2)}/${doc.numPages} [${mode}] -> ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`
  );
}

if (worker) await worker.terminate();

console.log('\n===== RESUME =====');
for (const r of results) console.log(`p${String(r.page).padStart(2)} | ${r.supplier} | ${r.date} | ${r.name}`);
console.log(`\n${results.length} PDF cree(s) dans : ${outDir}`);
