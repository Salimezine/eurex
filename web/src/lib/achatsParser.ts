import Tesseract from 'tesseract.js';
import { extractTextFromPDF } from './pdf';

export interface AchatInvoice {
  id: string;
  numero: string;
  date: string;
  fournisseur: string;
  description: string;
  ht0: number;
  ht19: number;
  tva19: number;
  tva7: number;
  fodec: number;
  timbre: number;
  ttc: number;
  is_handwritten: boolean;
  raw_text: string;
  ocr_confidence: number;
}

function genId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function parseNumber(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/\s/g, '').replace(/,/g, '.').replace(/'/g, '').replace(/-/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : Math.round(val * 1000) / 1000;
}

function extractAmount(text: string, patterns: RegExp[]): number {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const v = parseNumber(m[1]);
      if (v > 0) return v;
    }
  }
  return 0;
}

export function parseInvoiceText(text: string, isHandwritten: boolean = false): Omit<AchatInvoice, 'id' | 'is_handwritten' | 'raw_text' | 'ocr_confidence'> {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = lines.join(' ');

  let numero = '';
  const numPatterns = [
    /(?:facture|fac|fct)\s*(?:n[°o]?\s*:?\s*)(\S+)/i,
    /(?:n[°o]\s*(?:facture|fac|fct)\s*:?\s*)(\S+)/i,
    /(\d{4}\/\d{2,4})/,
    /(?:BL|bon\s*livraison)\s*(?:n[°o]?\s*:?\s*)(\S+)/i,
  ];
  for (const p of numPatterns) {
    const m = fullText.match(p);
    if (m) { numero = m[1].replace(/[^0-9\/\-]/g, ''); break; }
  }

  let date = '';
  const datePatterns = [
    /(?:date|du|le)\s*:?\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i,
    /(\d{2})[\/\-](\d{2})[\/\-](\d{4})/,
    /(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,
  ];
  for (const p of datePatterns) {
    const m = fullText.match(p);
    if (m) {
      if (m[1].length === 4) {
        date = `${m[1]}-${m[2]}-${m[3]}`;
      } else {
        date = `${m[3]}-${m[2]}-${m[1]}`;
      }
      break;
    }
  }

  let fournisseur = '';
  const fournPatterns = [
    /(?:fournisseur|vendeur|exp[eé]diteur|de|from|supplier)\s*:?\s*(.+?)(?:\n|$)/i,
    /(?:ste|sarl|sa|sas|sc)\s+(.+?)(?:\n|$)/i,
  ];
  for (const p of fournPatterns) {
    const m = fullText.match(p);
    if (m) { fournisseur = m[1].trim().substring(0, 60); break; }
  }

  let description = '';
  const descPatterns = [
    /(?:objet|description|d[eé]signation|prestation)\s*:?\s*(.+?)(?:\n|$)/i,
    /(?:pour|portant\s*sur)\s+(.+?)(?:\n|$)/i,
  ];
  for (const p of descPatterns) {
    const m = fullText.match(p);
    if (m) { description = m[1].trim().substring(0, 100); break; }
  }

  const ht0 = extractAmount(fullText, [
    /(?:ht|base\s*hors\s*taxe)\s*0\s*%\s*[:=]?\s*([\d\s.,':-]+)/i,
    /(?:montant\s*ht|total\s*ht)\s*[:=]?\s*([\d\s.,':-]+)/i,
    /([\d\s.,':-]+)\s*0\s*%/,
    /0\s*%\s*[:=]?\s*([\d\s.,':-]+)/i,
  ]);

  const ht19 = extractAmount(fullText, [
    /(?:ht|base)\s*19\s*%\s*[:=]?\s*([\d\s.,':-]+)/i,
    /([\d\s.,':-]+)\s*19\s*%/,
    /19\s*%\s*[:=]?\s*([\d\s.,':-]+)/i,
  ]);

  const tva19 = extractAmount(fullText, [
    /(?:tva|t\.v\.a\.?)\s*19\s*%\s*[:=]?\s*([\d\s.,':-]+)/i,
    /(?:tva)\s*[:=]?\s*([\d\s.,':-]+)/i,
    /19\s*%\s*[:=]?\s*([\d\s.,':-]+)/i,
  ]);

  const tva7 = extractAmount(fullText, [
    /(?:tva|t\.v\.a\.?)\s*7\s*%\s*[:=]?\s*([\d\s.,':-]+)/i,
  ]);

  const fodec = extractAmount(fullText, [
    /(?:fodec)\s*[:=]?\s*([\d\s.,':-]+)/i,
    /([\d\s.,':-]+)\s*%\s*fodec/i,
  ]);

  const timbre = extractAmount(fullText, [
    /(?:timbre|timbre\s*fiscal)\s*[:=]?\s*([\d\s.,':-]+)/i,
  ]);

  let ttc = extractAmount(fullText, [
    /(?:net\s*t\.?t\.?c\.?|total\s*t\.?t\.?c\.?|[aà]\s*payer|montant\s*net|solde)\s*[:=]?\s*([\d\s.,':-]+)/i,
    /(?:ttc)\s*[:=]?\s*([\d\s.,':-]+)/i,
  ]);

  if (ttc === 0 && (ht0 + ht19 + tva19 + tva7 + fodec + timbre) > 0) {
    ttc = ht0 + ht19 + tva19 + tva7 + fodec + timbre;
  }

  return { numero, date, fournisseur, description, ht0, ht19, tva19, tva7, fodec, timbre, ttc };
}

export async function extractFromPDF(file: File): Promise<{ text: string; isHandwritten: boolean }> {
  try {
    const text = await extractTextFromPDF(file);
    const hasSubstantialText = text.replace(/\s/g, '').length > 50;
    return { text, isHandwritten: !hasSubstantialText };
  } catch {
    return { text: '', isHandwritten: true };
  }
}

export async function extractFromImage(file: File): Promise<{ text: string; confidence: number }> {
  const result = await Tesseract.recognize(file, 'fra+ara', {
    logger: () => {},
  });
  return { text: result.data.text, confidence: result.data.confidence };
}

export async function processAchatFile(file: File): Promise<AchatInvoice> {
  const isImage = file.type.startsWith('image/');
  let text = '';
  let isHandwritten = false;
  let confidence = 100;

  if (isImage) {
    const imgResult = await extractFromImage(file);
    text = imgResult.text;
    confidence = imgResult.confidence;
    isHandwritten = true;
  } else {
    const pdfResult = await extractFromPDF(file);
    text = pdfResult.text;
    isHandwritten = pdfResult.isHandwritten;
    if (isHandwritten) {
      try {
        const blob = new Blob([await file.arrayBuffer()], { type: file.type });
        const imgFile = new File([blob], 'page.png', { type: file.type });
        const imgResult = await extractFromImage(imgFile);
        text = imgResult.text;
        confidence = imgResult.confidence;
      } catch {}
    }
  }

  const parsed = parseInvoiceText(text, isHandwritten);
  return {
    ...parsed,
    id: genId(),
    is_handwritten: isHandwritten,
    raw_text: text.substring(0, 500),
    ocr_confidence: confidence,
  };
}
