import { AchatInvoice } from './achatsParser';
import { PlanComptable, CompteComptable } from './achatsPlanComptable';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@4.9.155/build/pdf.worker.min.mjs`;

async function pdfToImages(file: File, maxPages: number = 3): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const doc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
  const images: string[] = [];

  const MAX_DIM = 1024;

  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const scale = Math.min(1, MAX_DIM / Math.max(viewport.width, viewport.height));
    if (scale < 1) {
      const w = Math.round(viewport.width * scale);
      const h = Math.round(viewport.height * scale);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const octx = out.getContext('2d')!;
      octx.drawImage(canvas, 0, 0, w, h);
      images.push(out.toDataURL('image/jpeg', 0.85));
    } else {
      images.push(canvas.toDataURL('image/png'));
    }
  }

  return images;
}

export interface EcritureAchat {
  id: string;
  numero_doc: string;
  date_operation: string;
  journal_code: string;
  compte: string;
  libelle: string;
  sens: 'D' | 'C';
  montant: number;
}

export interface VerificationResult {
  verdict: 'OK' | 'ERREUR' | 'ATTENTION';
  score: number;
  checks: { name: string; status: 'ok' | 'error' | 'warning'; detail: string }[];
  summary: string;
}

const AI_PROXY = import.meta.env.VITE_AI_PROXY_URL || 'https://eurex-api.ezzinesalim21.workers.dev/api/achats/ai';

function genId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function round3(n: number): number {
  return Math.round((n || 0) * 1000) / 1000;
}

function buildExtractionPrompt(plan: PlanComptable, planText: string, fournText: string): string {
  return `Extrais les données COMPLÈTES des factures d'achat tunisiennes sur cette page.

IMPORTANT: la page peut contenir UNE seule facture OU PLUSIEURS factures collées (souvent un tableau récapitulatif).
- Une seule facture → réponds UN objet JSON.
- Plusieurs factures distinctes → réponds un TABLEAU JSON [ {...}, {...} ] (un élément par facture, chaque facture = une ligne du tableau).
- Aucune facture utilisable → réponds null.

Schéma de chaque facture:
{"numero":"numero de facture","date":"YYYY-MM-DD","fournisseur":"nom du fournisseur","lignes":[{"designation":"","quantite":0,"prix_unitaire":0,"montant_ht":0,"taux_tva":0}],"ht0":0,"ht19":0,"tva19":0,"tva7":0,"fodec":0,"timbre":0,"ttc":0}

Règles EXACTES (pour CHAQUE facture séparément):
- ht19 = somme des montants_ht des lignes à 19%; ht0 = somme des lignes à 0%; ht7 = somme des lignes à 7%
- tva19 = TVA 19% AFFICHÉE sur la facture (0 si la facture n'affiche AUCUNE ligne TVA; ne la calcule pas toi-même depuis l'HT)
- tva7 = TVA 7% affichée (0 sinon)
- fodec = FODEC si mentionné, sinon 0
- timbre = 1 DT si mentionné, sinon 0
- ttc = Total "NET A PAYER" / "TOTAL TTC" affiché (pivot de comptabilisation); si absent: ht0 + ht19 + ht7 + tva19 + tva7 + fodec + timbre
- numero: UNIQUEMENT le numéro (ex: "FV10-26+107258", "FA-31378") — jamais de texte autour
- date: format YYYY-MM-DD; si la case date est VIDE sur la facture, mets ""
- fournisseur: le nom EXACT depuis la liste "Fournisseurs connus" si reconnaissable

Fournisseur attendu: ${planText}
Fournisseurs connus: ${fournText}`;
}

function getPlanText(plan: PlanComptable): string {
  const lines: string[] = [];
  for (const [code, c] of plan.comptes) {
    if (c.nature !== 'Comptable') continue;
    if (code.startsWith('401') || code.startsWith('60') || code.startsWith('436') || code.startsWith('437')) {
      lines.push(`${code} | ${c.libelle} | sens=${c.sens}`);
    }
  }
  return lines.join('\n');
}

function getFournisseursText(plan: PlanComptable): string {
  const lines: string[] = [];
  for (const [code, c] of plan.fournisseurs) {
    lines.push(`${code} | ${c.libelle}`);
  }
  return lines.join('\n');
}

function sigTokens(s: string): string[] {
  return s.toUpperCase().replace(/[^A-Z0-9À-ÿ ]/g, ' ').split(/\s+/)
    .filter(t => t.length >= 3 && !['LE', 'LA', 'LES', 'DE', 'DU', 'DES', 'STE', 'SOCIETE'].includes(t));
}

function matchFournisseur(fournisseur: string, plan: PlanComptable): { code: string; libelle: string } | null {
  if (!fournisseur) return null;
  const tokens = sigTokens(fournisseur);
  const target = fournisseur.toUpperCase().replace(/[^A-Z0-9À-ÿ]/g, '');
  if (target.length < 3) return null;

  let best: { code: string; libelle: string; score: number } | null = null;
  for (const [code, c] of plan.fournisseurs) {
    const name = c.libelle.toUpperCase().replace(/[^A-Z0-9À-ÿ]/g, '');
    if (!name) continue;
    if (name === target) return { code, libelle: c.libelle };
    if (name.includes(target) && target.length >= 6) return { code, libelle: c.libelle };
    if (target.includes(name) && name.length >= 6) return { code, libelle: c.libelle };

    const nt = sigTokens(c.libelle);
    const common = tokens.filter(t => nt.includes(t)).length;
    const maxTokens = Math.max(tokens.length, nt.length);
    if (common >= 2 && common / maxTokens >= 0.5) {
      const score = common / maxTokens;
      if (!best || score > best.score) best = { code, libelle: c.libelle, score };
    }
  }
  return best ? { code: best.code, libelle: best.libelle } : null;
}

async function callAI(prompt: string, systemPrompt: string): Promise<string | null> {
  try {
    const response = await fetch(AI_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'text',
        prompt,
        systemPrompt,
        max_tokens: 2000,
      }),
    });

    const result = await response.json();
    if (!result.ok) {
      console.warn('AI error:', result.error);
      return null;
    }
    return typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
  } catch (e) {
    console.warn('AI call failed:', e);
    return null;
  }
}

async function callVisionAI(images: string[], prompt: string, systemPrompt: string): Promise<string | null> {
  try {
    const imageDataUrl = images[0].startsWith('data:') ? images[0] : `data:image/png;base64,${images[0]}`;

    const response = await fetch(AI_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vision',
        prompt,
        systemPrompt,
        image: imageDataUrl,
        max_tokens: 9000,
      }),
    });

    const result = await response.json();
    if (!result.ok) {
      console.warn('Vision AI error:', result.error);
      return null;
    }
    return typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
  } catch (e) {
    console.warn('Vision AI call failed:', e);
    return null;
  }
}

function parseNum(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;
  s = s.replace(/[^\d,.\-]/g, '');
  if (!s || s === '-' || s === '.') return 0;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function extractJSON(response: string | object | null | undefined): any | null {
  if (!response) return null;
  if (typeof response !== 'string') response = JSON.stringify(response);
  const t = response.trim();
  if (t === 'null') return null;
  try {
    return JSON.parse(t);
  } catch {}
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }
  const arr = t.match(/\[[\s\S]*\]/);
  if (arr) {
    try {
      return JSON.parse(arr[0]);
    } catch {}
  }
  const obj = t.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      return JSON.parse(obj[0]);
    } catch {}
  }
  return null;
}

function toInvoices(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter(Boolean);
  if (typeof data === 'object') {
    if ('lignes' in data || 'ttc' in data || 'ht19' in data || 'numero' in data || 'fournisseur' in data) {
      return [data];
    }
    for (const k of ['factures', 'invoices', 'liste', 'items', 'rows']) {
      if (Array.isArray(data[k]) && data[k].length) return data[k].filter(Boolean);
    }
  }
  return [];
}

function cleanDate(d: string): string {
  const s = (d || '').trim();
  if (!s) return '';
  if (/jj[/-]mm[/-]aaaa|dd[/-]mm[/-]yyyy|-+[/-]*-+|NÀ|N:/i.test(s)) return '';
  return s;
}

function cleanNumero(n: string): string {
  const raw = String(n || '');
  if (/identifi|inconn|ind[eé]termin|non lisible|nonlisible/i.test(raw)) return '';
  const s = raw.replace(/^(n°|no\s?|num|nà\s*:?\s*|facture\s*:?\s*|factura\s*:?\s*|bl\s*:?\s*)/i, '').trim();
  return s.replace(/\s+/g, ' ').trim();
}

function normalizeInvoiceData(data: any): any {
  if (!data) return null;
  const numero = cleanNumero(data.numero);
  const date = cleanDate(data.date);
  const fournisseur = String(data.fournisseur || '').trim();
  const lignes = Array.isArray(data.lignes) ? data.lignes : [];

  let ht0 = parseNum(data.ht0);
  let ht19 = parseNum(data.ht19);
  let ht7 = parseNum(data.ht7);
  let tva19 = parseNum(data.tva19);
  let tva7 = parseNum(data.tva7);
  let fodec = parseNum(data.fodec);
  let timbre = parseNum(data.timbre);
  let ttc = parseNum(data.ttc);

  if (lignes.length > 0) {
    let s0 = 0, s19 = 0, s7 = 0;
    for (const l of lignes) {
      const rate = parseNum(l.taux_tva);
      let m = parseNum(l.montant_ht || l.montant);
      const q = parseNum(l.quantite);
      const p = parseNum(l.prix_unitaire);
      const mQp = q && p ? Math.round(q * p * 1000) / 1000 : 0;
      if (mQp > 0 && (m === 0 || Math.abs(m - mQp) <= 0.001 || Math.abs(m - mQp * 1000) <= 0.001)) {
        m = mQp;
      }
      if (rate >= 19) s19 += m;
      else if (rate >= 7) s7 += m;
      else s0 += m;
    }
    const total = s0 + s19 + s7;
    if (total > 0 && total < 100000000) {
      ht0 = Math.round(s0 * 1000) / 1000;
      ht19 = Math.round(s19 * 1000) / 1000;
      ht7 = Math.round(s7 * 1000) / 1000;
    }
  }
  // Ne PAS inventer de TVA: la TVA ne se déduit que si elle est affichée sur la facture.
  // Si le TTC imprimé est absent, on reconstruit le TTC avec l'HT seul (la TVA non affichée n'est pas déductible).
  const computedSum = Math.round((ht0 + ht19 + ht7 + tva19 + tva7 + fodec + timbre) * 1000) / 1000;
  if (ttc === 0 && (ht0 > 0 || ht19 > 0 || ht7 > 0 || tva19 > 0 || tva7 > 0 || fodec > 0)) {
    ttc = computedSum;
  }

  const description = String(data.description || '').trim()
    || lignes.map((l: any) => String(l.designation || '').trim()).filter(Boolean).join(', ');

  return { numero, date, fournisseur, description, ht0, ht19, ht7, tva19, tva7, fodec, timbre, ttc };
}

export async function parseInvoiceWithAI(
  rawText: string,
  plan: PlanComptable,
  file?: File
): Promise<Omit<AchatInvoice, 'id' | 'is_handwritten' | 'raw_text' | 'ocr_confidence'>> {
  const planText = getPlanText(plan);
  const fournText = getFournisseursText(plan);
  const systemPrompt = `Tu es un expert-comptable tunisien. Tu dois extraire les données d'une facture d'achat à partir d'une image de facture scannée.
Réponds TOUJOURS en JSON valide sans aucun texte avant ou après.`;

  const prompt = `## IMAGE DE LA FACTURE D'ACHAT

## PLAN COMPTABLE DISPONIBLE (comptes d'achats et fournisseurs)
${planText}

## FOURNISSEURS CONNUS
${fournText}

## EXTRAIS les données suivantes en JSON:
{
  "numero": "numéro de facture",
  "date": "YYYY-MM-DD",
  "fournisseur": "nom du fournisseur",
  "description": "description des biens/services achetés",
  "ht0": montant HT 0% (nombre),
  "ht19": montant HT 19% (nombre),
  "tva19": montant TVA 19% (nombre),
  "tva7": montant TVA 7% (nombre),
  "fodec": montant FODEC (nombre),
  "timbre": montant timbre fiscal (nombre),
  "ttc": montant total TTC (nombre)
}

Règles:
- Si un montant n'existe pas, mets 0
- La TVA 19% = HT 19% × 0.19 (arrondi à 3 décimales)
- Le timbre fiscal est généralement 1.000 DT
- Cherche le nom du fournisseur dans la liste des fournisseurs connus`;

  let response: string | null = null;

  if (file && file.type === 'application/pdf' && rawText.replace(/\s/g, '').length < 50) {
    try {
      const images = await pdfToImages(file, 3);
      if (images.length > 0) {
        response = await callVisionAI(images, prompt, systemPrompt);
      }
    } catch (e) {
      console.warn('Vision AI failed, trying text fallback:', e);
    }
  }

  if (!response) {
    const textPrompt = `## TEXTE BRUT DE LA FACTURE\n${rawText}\n\n${prompt}`;
    response = await callAI(textPrompt, systemPrompt);
  }

  if (response) {
    const data = normalizeInvoiceData(extractJSON(response));
    if (data) {
      const fm = matchFournisseur(data.fournisseur, plan);
      if (fm) data.fournisseur = fm.libelle;
      return {
        numero: data.numero,
        date: data.date,
        fournisseur: data.fournisseur,
        description: data.description,
        ht0: data.ht0, ht19: data.ht19, tva19: data.tva19, tva7: data.tva7,
        fodec: data.fodec, timbre: data.timbre, ttc: data.ttc,
      };
    }
  }

  return {
    numero: '', date: '', fournisseur: '', description: '',
    ht0: 0, ht19: 0, tva19: 0, tva7: 0, fodec: 0, timbre: 1, ttc: 0,
  };
}

export async function processFileWithAI(file: File, plan: PlanComptable): Promise<AchatInvoice[]> {
  const isImage = file.type.startsWith('image/');
  let text = '';
  let isHandwritten = false;
  let confidence = 100;

  console.log(`[ACHATS] Fichier: ${file.name}, type: ${file.type}, taille: ${(file.size/1024).toFixed(0)}KB`);

  if (isImage) {
    console.log('[ACHATS] Mode IMAGE - extraction OCR...');
    const imgResult = await (await import('./achatsParser')).extractFromImage(file);
    text = imgResult.text;
    confidence = imgResult.confidence;
    isHandwritten = true;
  } else {
    console.log('[ACHATS] Mode PDF - extraction texte...');
    const pdfResult = await (await import('./achatsParser')).extractFromPDF(file);
    text = pdfResult.text;
    isHandwritten = !text || text.replace(/\s/g, '').length < 50;
    console.log(`[ACHATS] Texte extrait: ${text.length} chars, isHandwritten: ${isHandwritten}`);
  }

  const allInvoices: AchatInvoice[] = [];
  const needsVision = (isImage || isHandwritten) && file.type === 'application/pdf';
  console.log(`[ACHATS] needsVision: ${needsVision}`);

  if (needsVision) {
    console.log('[ACHATS] Début conversion PDF → images...');
    try {
      const pages = await pdfToImages(file, 37);
      console.log(`[ACHATS] ${pages.length} pages extraites, début Vision AI...`);
      const planText = getPlanText(plan);
      const fournText = getFournisseursText(plan);
      const prompt = buildExtractionPrompt(plan, planText, fournText);
      const systemPrompt = `Tu es un expert-comptable tunisien. Tu dois extraire les données d'une facture d'achat à partir d'une image de facture scannée.
Réponds TOUJOURS en JSON valide sans aucun texte avant ou après. Si la page ne contient pas de facture, réponds exactement: null`;

      for (let i = 0; i < pages.length; i++) {
        try {
          console.log(`[ACHATS] Page ${i + 1}/${pages.length}...`);
          let response = await callVisionAI([pages[i]], prompt, systemPrompt);
          console.log(`[ACHATS] Page ${i + 1} réponse:`, response?.substring(0, 160) || 'VIDE');
          let data = extractJSON(response);

          if (!data) {
            console.log(`[ACHATS] Page ${i + 1} JSON absent, conversion texte AI...`);
            const fixPrompt = `Convertis ce texte en un objet JSON avec exactement ce schéma, sans rien d'autre (ni texte, ni markdown):\n{"numero":"","date":"YYYY-MM-DD","fournisseur":"","description":"","ht0":0,"ht19":0,"tva19":0,"tva7":0,"fodec":0,"timbre":1,"ttc":0}\n\nTEXTE À CONVERTIR:\n${(response || '').substring(0, 6000)}`;
            const fixResponse = await callAI(fixPrompt, 'Tu réponds uniquement avec le JSON demandé, rien d\'autre.');
            data = extractJSON(fixResponse);
            console.log(`[ACHATS] Page ${i + 1} conversion:`, (data ? 'OK' : 'ÉCHEC'));
          }

          const invs = toInvoices(data);
          for (const raw of invs) {
            const inv = normalizeInvoiceData(raw);
            if (inv && (inv.numero || inv.fournisseur || inv.ttc > 0)) {
              const fm = matchFournisseur(inv.fournisseur, plan);
              if (fm) inv.fournisseur = fm.libelle;
              allInvoices.push({
                id: genId(),
                numero: inv.numero, date: inv.date, fournisseur: inv.fournisseur,
                description: inv.description, ht0: inv.ht0, ht19: inv.ht19,
                tva19: inv.tva19, tva7: inv.tva7, fodec: inv.fodec,
                timbre: inv.timbre, ttc: inv.ttc,
                is_handwritten: true, raw_text: '', ocr_confidence: confidence,
              });
              console.log(`[ACHATS]   ✓ ${inv.numero || '(sans n°)'} ${inv.fournisseur || 'inconnu'} HT=${inv.ht0 + inv.ht19} TTC=${inv.ttc}`);
            }
          }
        } catch (e) {
          console.error(`[ACHATS] ✗ Page ${i + 1} failed:`, e);
        }
      }
      console.log(`[ACHATS] Total: ${allInvoices.length} factures extraites`);
    } catch (e) {
      console.error('[ACHATS] Vision AI failed:', e);
    }
  }

  if (allInvoices.length === 0 && isImage) {
    try {
      const Tesseract = await import('tesseract.js');
      const result = await Tesseract.default.recognize(file, 'fra+ara');
      text = result.data.text;
      confidence = result.data.confidence;
      if (text.replace(/\s/g, '').length > 50) {
        const planText = getPlanText(plan);
        const fournText = getFournisseursText(plan);
        const prompt = `## TEXTE OCR DE LA FACTURE\n${text}\n\nExtrait les données en JSON: {"numero":"","date":"YYYY-MM-DD","fournisseur":"","description":"","ht0":0,"ht19":0,"tva19":0,"tva7":0,"fodec":0,"timbre":1,"ttc":0}\n\nPlan: ${planText}\nFournisseurs: ${fournText}`;
        const systemPrompt = 'Tu es un expert-comptable tunisien. Extrais les données de la facture.';
        const aiResponse = await callAI(prompt, systemPrompt);
        if (aiResponse) {
          const data = extractJSON(aiResponse);
          if (data) {
            const fm = matchFournisseur(String(data.fournisseur || ''), plan);
            allInvoices.push({
              id: genId(), numero: String(data.numero || ''), date: String(data.date || ''), fournisseur: fm ? fm.libelle : String(data.fournisseur || ''),
              description: String(data.description || ''), ht0: parseNum(data.ht0), ht19: parseNum(data.ht19),
              tva19: parseNum(data.tva19), tva7: parseNum(data.tva7), fodec: parseNum(data.fodec),
              timbre: typeof data.timbre !== 'undefined' ? parseNum(data.timbre) : 0, ttc: parseNum(data.ttc),
              is_handwritten: true, raw_text: text.substring(0, 500), ocr_confidence: confidence,
            });
          }
        }
      }
    } catch (e) {
      console.warn('Tesseract OCR failed:', e);
    }
  }

  if (allInvoices.length === 0) {
    console.log('[ACHATS] Fallback: parseInvoiceText');
    const parsed = (await import('./achatsParser')).parseInvoiceText(text, isHandwritten);
    allInvoices.push({
      ...parsed,
      id: genId(),
      is_handwritten: isHandwritten,
      raw_text: text.substring(0, 500),
      ocr_confidence: confidence,
    });
  }

  console.log(`[ACHATS] Retour: ${allInvoices.length} facture(s)`);
  return allInvoices;
}

export async function generateEcrituresWithAI(
  invoice: AchatInvoice,
  plan: PlanComptable
): Promise<EcritureAchat[]> {
  const fournText = getFournisseursText(plan);

  let compteAchat = pickCompteAchat(invoice.description);
  let compteFournisseur = pickCompteFournisseur(invoice.fournisseur, plan);

  try {
    const response = await callAI(
      `## FACTURE D'ACHAT
- Numéro: ${invoice.numero}
- Fournisseur: ${invoice.fournisseur}
- Description: ${invoice.description}
- TTC à payer: ${invoice.ttc}

## FOURNISSEURS CONNUS
${fournText}

## PLAN (extrait comptes achat)
${getAchatComptesText(plan)}

## CHOISIS uniquement les comptes pour cette facture (pas les montants):
{
  "compte_achat": "compte 6xxxxx adapté à la nature de l'achat (description)",
  "compte_fournisseur": "compte 401xxx EXACT depuis FOURNISSEURS CONNUS, sinon 401999"
}
Réponds UNIQUEMENT ce JSON.`,
      'Tu es un expert-comptable tunisien. Réponds uniquement avec le JSON demandé.'
    );
    const data = extractJSON(response);
    if (data) {
      const ac = String(data.compte_achat || '').trim();
      if (/^6\d{5}$/.test(ac) && plan.comptes.has(ac)) compteAchat = ac;
      const fc = String(data.compte_fournisseur || '').trim();
      if (/^401\d{3}$/.test(fc) && plan.comptes.has(fc)) compteFournisseur = fc;
    }
  } catch {
    // garde le fallback
  }

  return buildBalancedEcritures(invoice, compteAchat, compteFournisseur);
}

function getAchatComptesText(plan: PlanComptable): string {
  const lines: string[] = [];
  for (const [code, c] of plan.comptes) {
    if (c.nature !== 'Comptable') continue;
    if (code.startsWith('6')) lines.push(`${code} | ${c.libelle}`);
  }
  return lines.join('\n');
}

function pickCompteAchat(description: string): string {
  let compteAchat = '606600';
  if (description) {
    const d = description.toLowerCase();
    if (/marchandise|produits?|alimentaire/.test(d)) compteAchat = '607000';
    else if (/mati[eè]re/.test(d)) compteAchat = '601000';
    else if (/entretien|maintenance/.test(d)) compteAchat = '601002';
    else if (/bureau/.test(d)) compteAchat = '602400';
    else if (/transport|livraison/.test(d)) compteAchat = '624100';
    else if (/location|loyer/.test(d)) compteAchat = '613002';
    else if (/assurance/.test(d)) compteAchat = '616000';
    else if (/quincaill/.test(d)) compteAchat = '601010';
  }
  return compteAchat;
}

function pickCompteFournisseur(fournisseur: string, plan: PlanComptable): string {
  if (fournisseur) {
    const fm = matchFournisseur(fournisseur, plan);
    if (fm) return fm.code;
    for (const [code, c] of plan.fournisseurs) {
      if (c.libelle.toUpperCase().includes(fournisseur.toUpperCase())) return code;
    }
  }
  return '401999';
}

function frsTag(invoice: AchatInvoice): string {
  if (invoice.fournisseur) {
    const first = sigTokens(invoice.fournisseur)[0];
    if (first) return first.replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }
  return 'SD';
}

function safeDocNum(invoice: AchatInvoice): string {
  if (invoice.numero && invoice.numero.trim()) return invoice.numero.trim();
  const datePart = invoice.date ? String(invoice.date).slice(0, 10) : 'SD';
  return `NC-${frsTag(invoice)}-${datePart}-${String(invoice.ttc).replace('.', '_')}`;
}

function splitTVA(tva: number, tva7Model: number, tva19Model: number): { c7: number; c19: number } {
  if (tva <= 0.005) return { c7: 0, c19: 0 };
  if (tva7Model > 0 && tva19Model > 0) {
    const r = tva7Model / (tva7Model + tva19Model);
    const c7 = Math.round(tva * r * 1000) / 1000;
    return { c7, c19: round3(tva - c7) };
  }
  if (tva7Model > 0) return { c7: round3(tva), c19: 0 };
  return { c7: 0, c19: round3(tva) };
}

function buildBalancedEcritures(invoice: AchatInvoice, compteAchat: string, compteFournisseur: string): EcritureAchat[] {
  const docNum = safeDocNum(invoice);
  const lib = `ACHAT ${invoice.fournisseur || invoice.numero || 'DIVERS'}`;
  const date_operation = invoice.date;

  const ht = round3(invoice.ht0 + invoice.ht19);
  const tvaModel = round3(invoice.tva19 + invoice.tva7);
  const fodec = round3(invoice.fodec);
  const timbre = round3(invoice.timbre);

  let ttc = round3(invoice.ttc);
  if (ttc <= 0 && (ht > 0 || tvaModel > 0 || fodec > 0 || timbre > 0)) {
    ttc = round3(ht + tvaModel + fodec + timbre);
  }

  // TVA déductible = TVA réellement affichée (ancrée au TTC imprimé)
  let tva = tvaModel;
  let achat = ht;
  if (ttc > 0 && ht > 0) {
    const implied = round3(ttc - ht - fodec - timbre);
    if (Math.abs(implied) < 0.011) {
      tva = 0;
    } else if (tvaModel > 0 && Math.abs(implied - tvaModel) <= 0.011) {
      tva = tvaModel;
    } else {
      tva = Math.max(0, implied);
    }
    achat = round3(ttc - tva - fodec - timbre);
  } else if (ttc > 0 && ht <= 0 && tvaModel === 0) {
    achat = round3(ttc - fodec - timbre);
  }
  if (achat < 0) {
    achat = 0;
  }

  const entries: EcritureAchat[] = [];
  if (achat > 0.005) {
    entries.push({ id: genId(), numero_doc: docNum, date_operation, journal_code: 'AC', compte: compteAchat, libelle: lib, sens: 'D', montant: achat });
  }
  const { c7, c19 } = splitTVA(tva, invoice.tva7, invoice.tva19);
  if (c19 > 0.005) entries.push({ id: genId(), numero_doc: docNum, date_operation, journal_code: 'AC', compte: '436660', libelle: 'TVA DEDUCTIBLE 19%', sens: 'D', montant: c19 });
  if (c7 > 0.005) entries.push({ id: genId(), numero_doc: docNum, date_operation, journal_code: 'AC', compte: '436663', libelle: 'TVA DEDUCTIBLE 7%', sens: 'D', montant: c7 });
  if (fodec > 0.005) entries.push({ id: genId(), numero_doc: docNum, date_operation, journal_code: 'AC', compte: '436680', libelle: 'FODEC', sens: 'D', montant: fodec });
  if (timbre > 0.005) entries.push({ id: genId(), numero_doc: docNum, date_operation, journal_code: 'AC', compte: '437003', libelle: 'TIMBRE FISCAL', sens: 'D', montant: timbre });

  const totalD = round3(entries.reduce((s, e) => s + e.montant, 0));
  if (totalD > 0.005) {
    entries.push({ id: genId(), numero_doc: docNum, date_operation, journal_code: 'AC', compte: compteFournisseur, libelle: `FRS ${invoice.fournisseur || docNum}`, sens: 'C', montant: totalD });
  }

  return entries;
}

export async function verifyEcrituresWithAI(
  ecritures: EcritureAchat[],
  plan: PlanComptable
): Promise<VerificationResult> {
  const local = verifyEcrituresLocally(ecritures, plan);

  if (local.verdict !== 'OK') {
    return local;
  }

  // Tout passe en local: on demande UNIQUEMENT des alerts qualitatives à l'IA
  try {
    const ecrituresText = ecritures.map(e =>
      `${e.numero_doc} | ${e.date_operation} | ${e.compte} | ${e.libelle} | ${e.sens}=${e.montant}`
    ).join('\n');
    const response = await callAI(
      `## ÉCRITURES DU JOURNAL AC (déjà équilibrées et validées)
${ecrituresText}

## VÉRIFICATION MAX 3 MINUTES
Identifie uniquement les PROBLÈMES QUANTITATIFS suivants (sinon réponds {"warnings":[]}):
1. "TVA non déductible" : facture dont la TVA affichée ne devrait pas être portée en déductible (TVA au taux forfaitaire, restaurateur, non assujetti), listée par numéro de facture
2. "TVA douteuse" : facture où D(TVA 436660/436663) s'écarte nettement de 19%/7% du débit achat
3. "Montant suspect" : montants > 2 000 DT sans rapport avec les autres lignes

## RÉPONSE JSON
{
  "warnings": [
    {"facture": "numéro", "type": "TVA non déductible | TVA douteuse | Montant suspect", "detail": "explication"}
  ]
}`,
      'Tu es un expert-comptable tunisien. Réponds uniquement avec le JSON demandé.'
    );
    const data = extractJSON(response);
    const warns = data && Array.isArray(data.warnings) ? data.warnings : [];
    const checks = [...local.checks];
    warns.slice(0, 8).forEach((w: any) => {
      checks.push({ name: w.type || 'Warning', status: 'warning', detail: `${w.facture || ''} — ${w.detail || ''}` });
    });
    if (warns.length > 0) {
      return {
        verdict: 'ATTENTION',
        score: Math.max(0, local.score - warns.length * 5),
        checks,
        summary: `Comptablement 100% équilibré, ${warns.length} alerte(s) qualité à vérifier`,
      };
    }
  } catch {
    // warning IA non bloquant
  }

  return local;
}

export function verifyEcrituresLocally(
  ecritures: EcritureAchat[],
  plan: PlanComptable
): VerificationResult {
  const checks: VerificationResult['checks'] = [];
  let errors = 0;
  let warnings = 0;
  let unknownNum = 0;

  const byFacture = new Map<string, EcritureAchat[]>();
  for (const e of ecritures) {
    const key = e.numero_doc || '';
    if (!byFacture.has(key)) byFacture.set(key, []);
    byFacture.get(key)!.push(e);
  }

  for (const [num, entries] of byFacture) {
    const totalD = round3(entries.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0));
    const totalC = round3(entries.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0));
    const diff = Math.abs(totalD - totalC);

    if (diff > 0.01) {
      checks.push({ name: `Balance ${num || '(sans n°)'}`, status: 'error', detail: `D=${totalD.toFixed(3)} ≠ C=${totalC.toFixed(3)} (écart ${diff.toFixed(3)})` });
      errors++;
    } else {
      checks.push({ name: `Balance ${num || '(sans n°)'}`, status: 'ok', detail: `D=C=${totalD.toFixed(3)}` });
    }

    if (!num || num.startsWith('NC-')) {
      unknownNum++;
    }
    if (entries.some(e => !e.date_operation || !/\d/.test(e.date_operation))) {
      checks.push({ name: `Date invalide (${num || '?'})`, status: 'warning', detail: 'Un ou plusieurs montants ont une date non lisible (case absente sur le scan)' });
      warnings++;
    }
  }

  if (unknownNum > 0) {
    checks.push({ name: 'Facture sans n°', status: 'warning', detail: `${unknownNum} facture(s) extraite(s) sans numéro lisible (identifiées par NC-…) à vérifier sur le scan` });
    warnings++;
  }

  const globalD = round3(ecritures.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0));
  const globalC = round3(ecritures.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0));
  const gDiff = Math.abs(globalD - globalC);
  checks.push({
    name: `Balance totale du journal`,
    status: gDiff > 0.011 ? 'error' : 'ok',
    detail: gDiff <= 0.011 ? `D=C=${globalD.toFixed(3)}` : `D=${globalD.toFixed(3)} ≠ C=${globalC.toFixed(3)} (écart ${gDiff.toFixed(3)})`,
  });
  if (gDiff > 0.011) errors++;

  for (const e of ecritures) {
    const compte = plan.comptes.get(e.compte);
    if (!compte) {
      checks.push({ name: `Compte ${e.compte}`, status: 'error', detail: `${e.compte} introuvable dans le plan comptable` });
      errors++;
      continue;
    }
    if (compte.nature === 'Regroupement') {
      checks.push({ name: `Compte ${e.compte}`, status: 'error', detail: `${e.compte} (${compte.libelle}) est un regroupement, pas postable` });
      errors++;
      continue;
    }
    if (e.compte.startsWith('401') && e.sens === 'D') {
      checks.push({ name: `Sens ${e.compte}`, status: 'warning', detail: `Fournisseur ${e.compte} débité dans le journal AC (normalement crédité)` });
      warnings++;
    } else if ((e.compte.startsWith('60') || e.compte.startsWith('436') || e.compte.startsWith('437')) && e.sens === 'C') {
      checks.push({ name: `Sens ${e.compte}`, status: 'warning', detail: `${e.compte} ${compte.libelle} crédité dans le journal AC (normalement débité)` });
      warnings++;
    }
    if (e.montant === 0) {
      checks.push({ name: `Montant nul ${e.compte}`, status: 'warning', detail: `Écriture ${e.numero_doc || '?'} d'un montant de 0.000` });
      warnings++;
    }
  }

  const has401999 = ecritures.some(e => e.compte === '401999');
  if (has401999) {
    checks.push({ name: 'Fournisseur inconnu', status: 'warning', detail: "Au moins une facture a été affectée à 'FRS DIVERS' (401999), fournisseur absent du plan comptable" });
    warnings++;
  }

  return {
    verdict: errors > 0 ? 'ERREUR' : warnings > 0 ? 'ATTENTION' : 'OK',
    score: Math.max(0, 100 - errors * 20 - (warnings > 0 ? 10 : 0)),
    checks,
    summary: errors > 0
      ? `${errors} erreur(s) comptable(s): le journal doit être équilibré et utiliser des comptes valides`
      : warnings > 0
        ? 'Journal équilibré (100/100) — alertes qualité à vérifier manuellement'
        : 'Toutes les vérifications passent: journal équilibré, comptes valides',
  };
}
