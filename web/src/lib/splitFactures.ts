// Scinde un PDF multi-pages en un PDF par page/facture, nomme fournisseur_date.
// Texte extrait via pdfjs ; si la page est un scan sans texte -> OCR (tesseract, fra).

export interface SplitResult {
  page: number;
  name: string;    // 001_Fournisseur_2026-06-17.pdf
  supplier: string;
  date: string;    // YYYY-MM-DD ou ''
  blob: Blob;
}

const NOTE_RE = /^(?:AC|PC|CA|RC|NC|FC|N)\s*[\d\s]{0,8}[/\-.]\s*\d{1,2}(?:\s*[/\-.]\s*\d{1,2})?(?:\s+|$)/i;
const LEGAL = /\b(?:SARL|S\.?\s?A\.?\b|S\.?\s?C\.?\s?S|SAS|STE|SU\b|ST\b|ETS|Ets\b|ETABLISSEMENT|ÉTABLISSEMENT|SOCI[EÉ]T[EÉ]|ENTREPRISE|GROUPE|COMPTOIR|DISTRIBUTION|IMPORT|EXPORT|FILIALE|UNION|COOP[ÉE]RATIVE|C\.I\.E|CIE\b)\b/i;
const ADDR = /\b(?:RUE|AVENUE|AV\.|BD\b|BOULEVARD|IMMEUBLE|BLOT|BP\b|ETAGE|ETG|RESIDENCE|ZONE\s*(?:INDUS|ACTIV)|CODE\s*POSTAL)\b/i;
const DOCTYPE = /\b(?:FACTURE\s*ESTIM|FACTURE|DEVIS|BON\s*DE|LIVRAISON|REGLEMENT|R[ÉE]CEPISSE|RECU\b|PROFORMA|COMMANDE|PI[EÈ]CE\s*JUST|NOTA\s*BENE|DEJA\s*SAISIE|SAISIE\b|DUPLICATA|COPIE\b|ANNUL[ÉE]|PAY[ÉE]\b|IMPAY[ÉE]|QUITTANCE|DE?SIGNATION\b|PUHT|ARTICLE\b|TOTAL(?:HT|TTC)?\b|BAILLEUR|LOCATAIRE|ESPECES?\b|MONNAIE)\b|CAISSE\s*[:;]|RIEN\s*A\s*COMPTABILISER|IMPRIMER\s*LA\s*PAGE/i;
const PRICE = /\b\d{1,3}[.,]\d{3}\b|\b\d+[.,]\d{2}\b/;

interface Line { text: string; size: number; y: number }

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function stripNote(line: string): string {
  return line
    .replace(/^[\s'‘’`"“”«».,;:—–\-—]+/, '')
    .replace(NOTE_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractDate(text: string): string {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ');
  const cands: { d: string; i: number; ctx: string; s: number }[] = [];
  const chk = (y: string, mo: string, d: string): string | null => {
    const Y = +y, MO = +mo, D = +d;
    if (MO < 1 || MO > 12 || D < 1 || D > 31 || Y < 2000 || Y > 2100) return null;
    return fmtDate(new Date(Y, MO - 1, D));
  };
  const add = (m: RegExpExecArray, d: string | null) => {
    if (d) cands.push({ d, i: m.index, ctx: t.slice(Math.max(0, m.index - 50), m.index), s: 0 });
  };

  for (const m of t.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) add(m, chk(m[1], m[2], m[3]));
  for (const m of t.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](20\d{2}|\d{2})\b/g)) {
    add(m, chk(m[3].length === 2 ? '20' + m[3] : m[3], m[2], m[1]));
  }
  const mo: Record<string, number> = { janv: 1, fevr: 2, 'févr': 2, mars: 3, avr: 4, avri: 4, mai: 5, juin: 6, juil: 7, aout: 8, 'août': 8, sept: 9, oct: 10, nov: 11, dec: 12, 'déc': 12 };
  for (const m of t.matchAll(/\b(\d{1,2})\s+(janv|fevr|févr|mars|avr|avri|mai|juin|juil|aout|août|sept|oct|nov|dec|déc)\w*\.?\s+(20\d{2})\b/gi)) {
    const M = mo[m[2].toLowerCase().slice(0, 4)] ?? mo[m[2].toLowerCase().slice(0, 3)];
    if (M) add(m, chk(m[3], String(M), m[1]));
  }
  if (!cands.length) return '';
  for (const c of cands) {
    let s = 0;
    if (/\bdate\b|\bd[ée]livr|émis|emission|facture\s*(n|N)?\s*o?\.?\s*\d|du\s+\d{1,2}\s/i.test(c.ctx)) s += 70;
    if (NOTE_RE.test(c.ctx.trim())) s -= 100;
    if (c.ctx.length <= 5) s += 15;
    c.s = s;
  }
  cands.sort((a, b) => b.s - a.s || a.i - b.i);
  return cands[0].s > -50 ? cands[0].d : '';
}

function scoreLine(line: string, y: number, size: number, pageH: number): number {
  const txt = stripNote(line);
  if (!txt || (/^[\d\s./+-]+$/.test(txt) && txt.replace(/[\d\s./-]/g, '').length < 4)) return -Infinity;
  if (txt.length < 3 || txt.length > 70) return -Infinity;
  const letters = (txt.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (letters < 4) return -Infinity;
  const symbols = (txt.match(/[^\wÀ-ÿ\s]/g) || []).length;
  if (symbols / txt.length > 0.3) return -Infinity;
  if (/@|http|www\./.test(txt)) return -Infinity;

  let s = Math.min(size || 10, 34) * 1.2;
  if (LEGAL.test(txt)) s += 55;
  if (ADDR.test(txt)) s -= 55;
  if (DOCTYPE.test(txt)) s -= 60;
  if (PRICE.test(txt)) s -= 45;
  if (/[[\]{}#£€$]/.test(txt)) s -= 40;
  if ((txt.match(/\d/g) || []).length >= 3) s -= 35;
  const words = txt.match(/\S+/g) || [];
  const longW = words.filter(w => w.length >= 4).length;
  if (words.length >= 3 && longW / words.length < 0.4) s -= 45;
  if (!words.some(w => w.length >= 4)) s -= 60;
  if (txt.length > 45) s -= 30;
  if (txt === txt.toUpperCase() && /[A-ZÀ-Þ]{4}/.test(txt)) s += 10;
  if (words.length >= 2) s += 10;
  if (y < pageH * 0.45) s += 25; else if (y > pageH * 0.65) s -= 30;
  if (txt.length < 6) s -= 15;
  return s;
}

function pickSupplier(lines: Line[], pageH: number): string {
  let best: { txt: string; s: number; hasLegal: boolean } | null = null;
  for (const l of lines) {
    const s = scoreLine(l.text, l.y, l.size, pageH);
    const txt = stripNote(l.text);
    if (best === null || s > best.s) best = { txt, s, hasLegal: LEGAL.test(txt) };
  }
  if (best && best.s >= (best.hasLegal ? 25 : 45)) return best.txt;
  for (const l of lines) {
    const txt = stripNote(l.text);
    if (txt && LEGAL.test(txt) && txt.length <= 70 && !ADDR.test(txt)) return txt;
  }
  return '';
}

export function slug(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s\-_.,;:'’"]+/, '')
    .slice(0, 60)
    .replace(/[\s.\-_]+$/, '');
}

function linesFromPdfItems(items: any[], viewport: any): Line[] {
  const rows = new Map<number, { y: number; parts: { x: number; str: string; size: number }[] }>();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const tr = viewport.transform;
    const x = tr[0] * it.transform[4] + tr[2] * it.transform[5] + tr[4];
    const y = tr[1] * it.transform[4] + tr[3] * it.transform[5] + tr[5];
    const size = Math.hypot(it.transform[2], it.transform[3]) || 10;
    const key = Math.round(y / 5);
    if (!rows.has(key)) rows.set(key, { y, parts: [] });
    rows.get(key)!.parts.push({ x, str: it.str, size });
  }
  return [...rows.values()]
    .map(r => ({
      text: r.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim(),
      size: Math.max(...r.parts.map(p => p.size)),
      y: r.y,
    }))
    .filter(r => r.text);
}

function linesFromOcr(data: any): Line[] {
  const words: any[] = data.words?.length
    ? data.words
    : (data.blocks || []).flatMap((b: any) => b.paragraphs || []).flatMap((p: any) => p.lines || []).flatMap((l: any) => l.words || []);
  if (words.length) {
    const rows = new Map<number, { y: number; parts: { x: number; str: string; size: number }[] }>();
    for (const w of words) {
      if (!w.text?.trim()) continue;
      const key = Math.round(w.bbox.y0 / 8);
      if (!rows.has(key)) rows.set(key, { y: w.bbox.y0, parts: [] });
      rows.get(key)!.parts.push({ x: w.bbox.x0, str: w.text, size: w.bbox.y1 - w.bbox.y0 });
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
    .map((t: string, i: number) => ({ text: t.trim(), size: 12, y: 20 + i * 20 }))
    .filter((r: Line) => r.text);
}

async function renderPageToBlob(page: any, scale: number): Promise<Blob> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas, background: '#ffffff' }).promise;
  return new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
}

export async function splitPdfFile(file: File, onProgress: (msg: string) => void): Promise<SplitResult[]> {
  const [{ PDFDocument }, pdfjsLib, TesseractMod] = await Promise.all([
    import('pdf-lib'),
    import('pdfjs-dist'),
    import('tesseract.js'),
  ]);
  const Tesseract = TesseractMod.default;
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }

  onProgress('Lecture du PDF...');
  const srcBytes = await file.arrayBuffer();
  const srcPdf = await PDFDocument.load(srcBytes.slice(0));
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const total = doc.numPages;

  let worker: any = null;
  const getWorker = async () => {
    if (!worker) {
      onProgress('Chargement du module OCR (fra)...');
      worker = await Tesseract.createWorker('fra');
    }
    return worker;
  };

  const results: SplitResult[] = [];
  const used = new Set<string>();

  for (let i = 1; i <= total; i++) {
    onProgress(`Page ${i}/${total} : analyse...`);
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const embedded = (tc.items as any[]).map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
    let text = embedded;
    let lines: Line[];

    if (embedded.length >= 40) {
      lines = linesFromPdfItems(tc.items, page.getViewport({ scale: 1 }));
    } else {
      onProgress(`Page ${i}/${total} : OCR en cours...`);
      const w = await getWorker();
      const blob = await renderPageToBlob(page, 2);
      const { data } = await w.recognize(blob);
      lines = linesFromOcr(data);
      text = (embedded + ' ' + (data.text || '').replace(/\s+/g, ' ')).trim();
    }

    const supplier = pickSupplier(lines, vp.height);
    const date = extractDate(text);

    const one = await PDFDocument.create();
    const [copied] = await one.copyPages(srcPdf, [i - 1]);
    one.addPage(copied);
    const bytes = await one.save();

    const base = `${String(i).padStart(3, '0')}_${slug(supplier) || 'fournisseur-inconnu'}_${date || 'sans-date'}`;
    let name = base + '.pdf';
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${base}-${n++}.pdf`;
    used.add(name.toLowerCase());

    results.push({
      page: i,
      name,
      supplier: supplier || '(introuvable)',
      date: date || '(pas de date)',
      blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    });
  }

  if (worker) await worker.terminate();
  onProgress('');
  return results;
}
