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
  return `Extrais les données COMPLÈTES de cette facture d'achat tunisienne.

Lis TOUTES les lignes de détail de la facture (designations, quantites, prix unitaires, taux TVA).

Réponds UNIQUEMENT avec un objet JSON valide, sans texte, sans markdown, sans code block:
{"numero":"numero de la facture","date":"YYYY-MM-DD","fournisseur":"nom du fournisseur","lignes":[{"designation":"","quantite":0,"prix_unitaire":0,"montant_ht":0,"taux_tva":0}],"ht0":0,"ht19":0,"tva19":0,"tva7":0,"fodec":0,"timbre":1,"ttc":0}

Règles de calcul EXACTES:
- ht19 = somme des montants_ht de toutes les lignes à TVA 19%
- ht0 = somme des montants_ht de toutes les lignes à TVA 0%
- tva19 = ht19 × 0.19 (arrondi à 3 décimales)
- tva7 = somme de la TVA des lignes à 7% (= ht7 × 0.07)
- fodec = FODEC 1% si clairement mentionné sur la facture, sinon 0
- timbre = 1 DT si timbre mentionné, sinon 0
- ttc = Total "NET A PAYER" / "TOTAL TTC" affiché sur la facture; si absent: ht0 + ht19 + tva19 + tva7 + fodec + timbre
- numero: numéro de facture tel qu'affiché (ex: "FV100-26", "123/2026", "FA-0042")

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
        max_tokens: 3000,
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
  const obj = t.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      return JSON.parse(obj[0]);
    } catch {}
  }
  return null;
}

function normalizeInvoiceData(data: any): any {
  if (!data) return null;
  const numero = String(data.numero || '').trim();
  const date = String(data.date || '').trim();
  const fournisseur = String(data.fournisseur || '').trim();
  const lignes = Array.isArray(data.lignes) ? data.lignes : [];

  let ht0 = parseNum(data.ht0);
  let ht19 = parseNum(data.ht19);
  let ht7 = parseNum(data.ht7) || 0;
  let tva19 = parseNum(data.tva19);
  let tva7 = parseNum(data.tva7);
  let fodec = parseNum(data.fodec);
  let timbre = data.timbre === null || data.timbre === undefined ? 1 : parseNum(data.timbre);
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
  if (tva19 === 0 && ht19 > 0) tva19 = Math.round(ht19 * 0.19 * 1000) / 1000;
  if (tva7 === 0 && ht7 > 0) tva7 = Math.round(ht7 * 0.07 * 1000) / 1000;

  const known = !(ht0 === 0 && ht19 === 0 && tva19 === 0 && tva7 === 0 && fodec === 0);
  const computedSum = Math.round((ht0 + ht19 + ht7 + tva19 + tva7 + fodec + timbre) * 1000) / 1000;
  if (ttc === 0 && known) {
    ttc = computedSum;
  } else if (ttc > 0 && computedSum > 0 && ht19 > 0) {
    if (Math.abs(ttc - computedSum) > 0.5) ttc = computedSum;
  }

  const description = `${String(data.description || '')}`.trim()
    || lignes.map((l: any) => String(l.designation || '').trim()).filter(Boolean).join(', ');

  return { numero, date, fournisseur, description, ht0, ht19, tva19, tva7, fodec, timbre, ttc };
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

          const inv = normalizeInvoiceData(data);
          if (inv && (inv.numero || inv.fournisseur || inv.ttc > 0)) {
            allInvoices.push({
              id: genId(),
              numero: inv.numero, date: inv.date, fournisseur: inv.fournisseur,
              description: inv.description, ht0: inv.ht0, ht19: inv.ht19,
              tva19: inv.tva19, tva7: inv.tva7, fodec: inv.fodec,
              timbre: inv.timbre, ttc: inv.ttc,
              is_handwritten: true, raw_text: '', ocr_confidence: confidence,
            });
            console.log(`[ACHATS] ✓ Page ${i + 1}: ${inv.fournisseur || 'inconnu'} HT=${inv.ht0 + inv.ht19} TTC=${inv.ttc}`);
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
            allInvoices.push({
              id: genId(), numero: String(data.numero || ''), date: String(data.date || ''), fournisseur: String(data.fournisseur || ''),
              description: String(data.description || ''), ht0: parseNum(data.ht0), ht19: parseNum(data.ht19),
              tva19: parseNum(data.tva19), tva7: parseNum(data.tva7), fodec: parseNum(data.fodec),
              timbre: parseNum(data.timbre) || 1, ttc: parseNum(data.ttc),
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
  const planText = getPlanText(plan);
  const fournText = getFournisseursText(plan);

  const systemPrompt = `Tu es un expert-comptable tunisien. Tu dois générer les écritures comptables pour une facture d'achat dans le journal AC.
Réponds TOUJOURS en JSON valide sans aucun texte avant ou après.`;

  const prompt = `## FACTURE D'ACHAT
- Numéro: ${invoice.numero}
- Date: ${invoice.date}
- Fournisseur: ${invoice.fournisseur}
- Description: ${invoice.description}
- HT 0%: ${invoice.ht0}
- HT 19%: ${invoice.ht19}
- TVA 19%: ${invoice.tva19}
- TVA 7%: ${invoice.tva7}
- FODEC: ${invoice.fodec}
- Timbre: ${invoice.timbre}
- TTC: ${invoice.ttc}

## PLAN COMPTABLE (comptes d'achats et fournisseurs)
${planText}

## FOURNISSEURS CONNUS
${fournText}

## GÉNÈRE les écritures comptables en JSON:
{
  "ecritures": [
    {
      "compte": "numéro de compte",
      "libelle": "libellé de l'écriture",
      "sens": "D ou C",
      "montant": montant (nombre)
    }
  ]
}

Règles de comptabilisation:
1. DEBIT: Compte d'achat (601xxx, 602xxx, 604xxx, 605xxx, 606xxx, 607xxx) selon la nature de l'achat
2. DEBIT: TVA déductible 19% → 436660 (ou 436663 pour TVA 7%)
3. DEBIT: FODEC si applicable → 436680
4. DEBIT: Timbre fiscal → 437003
5. CREDIT: Fournisseur 401xxx (cherche le bon compte dans la liste)
6. La somme des DEBITs doit = somme des CREDITs

Mapping description → compte d'achat:
- "marchandise" / "produits" → 607000
- "matière première" → 601000
- "entretien" / "maintenance" → 601002
- "quincaillerie" → 601010
- "consommable" → 602100 / 602200
- "fourniture bureau" → 602400
- "emballage" → 602600
- "électricité" → 606002
- "eau" → 606003
- "transport" → 624100
- "location" → 613002
- "assurance" → 616000
- "réparation" → 615000
- "divers" → 606600`;

  const response = await callAI(prompt, systemPrompt);

  if (response) {
    const data = extractJSON(response);
    if (data?.ecritures && Array.isArray(data.ecritures)) {
      return data.ecritures.map((e: any) => ({
        id: genId(),
        numero_doc: invoice.numero,
        date_operation: invoice.date,
        journal_code: 'AC',
        compte: String(e.compte),
        libelle: String(e.libelle),
        sens: e.sens === 'C' ? 'C' : 'D',
        montant: Math.round(parseNum(e.montant) * 1000) / 1000,
      }));
    }
  }

  return generateFallbackEcritures(invoice, plan);
}

function generateFallbackEcritures(invoice: AchatInvoice, plan: PlanComptable): EcritureAchat[] {
  const entries: EcritureAchat[] = [];
  const lib = `ACHAT ${invoice.fournisseur || invoice.numero}`;

  let compteAchat = '606600';
  if (invoice.description) {
    const d = invoice.description.toLowerCase();
    if (/marchandise|produits?|alimentaire/.test(d)) compteAchat = '607000';
    else if (/mati[eè]re/.test(d)) compteAchat = '601000';
    else if (/entretien|maintenance/.test(d)) compteAchat = '601002';
    else if (/bureau/.test(d)) compteAchat = '602400';
    else if (/transport|livraison/.test(d)) compteAchat = '624100';
    else if (/location|loyer/.test(d)) compteAchat = '613002';
    else if (/assurance/.test(d)) compteAchat = '616000';
  }

  let compteFournisseur = '401999';
  if (invoice.fournisseur) {
    const found = plan.fournisseurs;
    for (const [code, c] of found) {
      if (c.libelle.toUpperCase().includes(invoice.fournisseur.toUpperCase())) {
        compteFournisseur = code;
        break;
      }
    }
  }

  const totalHT = invoice.ht0 + invoice.ht19;

  if (totalHT > 0) {
    if (invoice.ht19 > 0) {
      entries.push({ id: genId(), numero_doc: invoice.numero, date_operation: invoice.date, journal_code: 'AC', compte: compteAchat, libelle: lib, sens: 'D', montant: invoice.ht19 });
    }
    if (invoice.ht0 > 0) {
      entries.push({ id: genId(), numero_doc: invoice.numero, date_operation: invoice.date, journal_code: 'AC', compte: compteAchat, libelle: lib, sens: 'D', montant: invoice.ht0 });
    }
  } else if (invoice.ttc > 0) {
    entries.push({ id: genId(), numero_doc: invoice.numero, date_operation: invoice.date, journal_code: 'AC', compte: compteAchat, libelle: lib, sens: 'D', montant: invoice.ttc - invoice.tva19 - invoice.tva7 - invoice.fodec - invoice.timbre });
  }

  if (invoice.tva19 > 0) entries.push({ id: genId(), numero_doc: invoice.numero, date_operation: invoice.date, journal_code: 'AC', compte: '436660', libelle: 'TVA DEDUCTIBLE 19%', sens: 'D', montant: invoice.tva19 });
  if (invoice.tva7 > 0) entries.push({ id: genId(), numero_doc: invoice.numero, date_operation: invoice.date, journal_code: 'AC', compte: '436663', libelle: 'TVA DEDUCTIBLE 7%', sens: 'D', montant: invoice.tva7 });
  if (invoice.fodec > 0) entries.push({ id: genId(), numero_doc: invoice.numero, date_operation: invoice.date, journal_code: 'AC', compte: '436680', libelle: 'FODEC', sens: 'D', montant: invoice.fodec });
  if (invoice.timbre > 0) entries.push({ id: genId(), numero_doc: invoice.numero, date_operation: invoice.date, journal_code: 'AC', compte: '437003', libelle: 'TIMBRE FISCAL', sens: 'D', montant: invoice.timbre });

  if (invoice.ttc > 0) {
    entries.push({ id: genId(), numero_doc: invoice.numero, date_operation: invoice.date, journal_code: 'AC', compte: compteFournisseur, libelle: `FRS ${invoice.fournisseur || invoice.numero}`, sens: 'C', montant: invoice.ttc });
  }

  return entries;
}

export async function verifyEcrituresWithAI(
  ecritures: EcritureAchat[],
  plan: PlanComptable
): Promise<VerificationResult> {
  const planText = getPlanText(plan);
  const ecrituresText = ecritures.map(e =>
    `${e.numero_doc} | ${e.date_operation} | ${e.journal_code} | ${e.compte} | ${e.libelle} | ${e.sens}=${e.montant}`
  ).join('\n');

  const systemPrompt = `Tu es un expert-comptable tunisien. Tu dois vérifier des écritures comptables d'achat.
Réponds TOUJOURS en JSON valide sans aucun texte avant ou après.`;

  const prompt = `## ÉCRITURES À VÉRIFIER
${ecrituresText}

## PLAN COMPTABLE
${planText}

## VÉRIFICATIONS À EFFECTUER
1. Balance: somme(D) = somme(C) pour chaque facture
2. TVA: vérifier que TVA = HT × 19% (tolérance 0.01)
3. Comptes: vérifier que tous les comptes existent dans le plan
4. Sens: vérifier le sens normal des comptes (D pour charges, C pour fournisseurs)
5. Cohérence: HT + TVA + FODEC + Timbre = TTC

## RÉPONSE JSON
{
  "verdict": "OK" ou "ERREUR" ou "ATTENTION",
  "score": nombre 0-100,
  "checks": [
    {"name": "nom du check", "status": "ok" ou "error" ou "warning", "detail": "description"}
  ],
  "summary": "résumé en une ligne"
}`;

  const response = await callAI(prompt, systemPrompt);

  if (response) {
    const data = extractJSON(response);
    if (data) {
      return {
        verdict: data.verdict || 'ATTENTION',
        score: parseInt(data.score) || 0,
        checks: data.checks || [],
        summary: data.summary || '',
      };
    }
  }

  return verifyEcrituresLocally(ecritures, plan);
}

export function verifyEcrituresLocally(
  ecritures: EcritureAchat[],
  plan: PlanComptable
): VerificationResult {
  const checks: VerificationResult['checks'] = [];
  let errors = 0;

  const byFacture = new Map<string, EcritureAchat[]>();
  for (const e of ecritures) {
    const key = e.numero_doc;
    if (!byFacture.has(key)) byFacture.set(key, []);
    byFacture.get(key)!.push(e);
  }

  for (const [num, entries] of byFacture) {
    const totalD = entries.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalC = entries.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    const diff = Math.abs(totalD - totalC);

    if (diff > 0.01) {
      checks.push({ name: `Balance ${num}`, status: 'error', detail: `D=${totalD.toFixed(3)} ≠ C=${totalC.toFixed(3)} (écart ${diff.toFixed(3)})` });
      errors++;
    } else {
      checks.push({ name: `Balance ${num}`, status: 'ok', detail: `D=C=${totalD.toFixed(3)}` });
    }

    for (const e of entries) {
      const compte = plan.comptes.get(e.compte);
      if (!compte) {
        checks.push({ name: `Compte ${e.compte}`, status: 'error', detail: `Compte ${e.compte} introuvable dans le plan comptable` });
        errors++;
      } else if (compte.nature === 'Regroupement') {
        checks.push({ name: `Compte ${e.compte}`, status: 'error', detail: `Compte ${e.compte} est un regroupement, pas un compte postable` });
        errors++;
      } else {
        checks.push({ name: `Compte ${e.compte}`, status: 'ok', detail: `${compte.libelle} (${compte.sens})` });
      }
    }
  }

  return {
    verdict: errors > 0 ? 'ERREUR' : 'OK',
    score: Math.max(0, 100 - errors * 10),
    checks,
    summary: errors > 0 ? `${errors} erreur(s) détectée(s)` : 'Toutes les vérifications passent',
  };
}
