import { AchatInvoice } from './achatsParser';
import { PlanComptable, CompteComptable } from './achatsPlanComptable';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@4.9.155/build/pdf.worker.min.mjs`;

async function pdfToImages(file: File, maxPages: number = 3): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const doc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
  const images: string[] = [];

  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    images.push(base64);
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

const CF_ACCOUNT_ID = '7923ab56e04f76467ba94aa508a8f018';
const CF_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const CF_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

function genId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
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
  const apiToken = import.meta.env.VITE_CF_API_TOKEN;
  if (!apiToken) {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          max_tokens: 2000,
          temperature: 0.1,
        }),
      }
    );

    const result = await response.json();
    if (!result.success) {
      console.warn('AI error:', result.errors);
      return null;
    }

    const choice = result.result?.choices?.[0];
    const text = choice?.message?.content || result.result?.response || result.result || '';
    return typeof text === 'string' ? text : JSON.stringify(text);
  } catch (e) {
    console.warn('AI call failed:', e);
    return null;
  }
}

async function callVisionAI(images: string[], prompt: string, systemPrompt: string): Promise<string | null> {
  const apiToken = import.meta.env.VITE_CF_API_TOKEN;
  if (!apiToken) {
    return null;
  }

  try {
    const imageMessages = images.map((img, i) => ({
      type: 'image_url' as const,
      image_url: { url: `data:image/png;base64,${img}` },
    }));

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_VISION_MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: [...imageMessages, { type: 'text' as const, text: prompt }] },
          ],
          max_tokens: 2000,
          temperature: 0.1,
        }),
      }
    );

    const result = await response.json();
    if (!result.success) {
      console.warn('Vision AI error:', result.errors);
      return null;
    }

    const choice = result.result?.choices?.[0];
    const text = choice?.message?.content || result.result?.response || result.result || '';
    return typeof text === 'string' ? text : JSON.stringify(text);
  } catch (e) {
    console.warn('Vision AI call failed:', e);
    return null;
  }
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
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return {
          numero: data.numero || '',
          date: data.date || '',
          fournisseur: data.fournisseur || '',
          description: data.description || '',
          ht0: parseFloat(data.ht0) || 0,
          ht19: parseFloat(data.ht19) || 0,
          tva19: parseFloat(data.tva19) || 0,
          tva7: parseFloat(data.tva7) || 0,
          fodec: parseFloat(data.fodec) || 0,
          timbre: parseFloat(data.timbre) || 1,
          ttc: parseFloat(data.ttc) || 0,
        };
      }
    } catch {}
  }

  return {
    numero: '', date: '', fournisseur: '', description: '',
    ht0: 0, ht19: 0, tva19: 0, tva7: 0, fodec: 0, timbre: 1, ttc: 0,
  };
}

export async function processFileWithAI(file: File, plan: PlanComptable): Promise<AchatInvoice[]> {
  const apiToken = import.meta.env.VITE_CF_API_TOKEN;
  const isImage = file.type.startsWith('image/');
  let text = '';
  let isHandwritten = false;
  let confidence = 100;

  if (isImage) {
    const imgResult = await (await import('./achatsParser')).extractFromImage(file);
    text = imgResult.text;
    confidence = imgResult.confidence;
    isHandwritten = true;
  } else {
    const pdfResult = await (await import('./achatsParser')).extractFromPDF(file);
    text = pdfResult.text;
    isHandwritten = !text || text.replace(/\s/g, '').length < 50;
  }

  const allInvoices: AchatInvoice[] = [];
  const needsVision = (isImage || isHandwritten) && file.type === 'application/pdf';

  if (needsVision && apiToken) {
    try {
      const pages = await pdfToImages(file, 37);
      console.log(`PDF: ${pages.length} pages à traiter`);
      for (let i = 0; i < pages.length; i++) {
        try {
          const planText = getPlanText(plan);
          const fournText = getFournisseursText(plan);
          const prompt = `Extrait les données de cette facture d'achat en JSON: {"numero":"","date":"YYYY-MM-DD","fournisseur":"","description":"","ht0":0,"ht19":0,"tva19":0,"tva7":0,"fodec":0,"timbre":1,"ttc":0}\nPlan: ${planText}\nFournisseurs: ${fournText}`;
          const systemPrompt = 'Tu es un expert-comptable tunisien. Extrais les données de la facture. Si la page ne contient pas de facture, réponds juste "null".';
          const response = await callVisionAI([pages[i]], prompt, systemPrompt);
          if (response && response.trim() !== 'null' && response.trim() !== '{}') {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const data = JSON.parse(jsonMatch[0]);
              if (data.numero || data.fournisseur || data.ttc > 0) {
                allInvoices.push({
                  id: genId(),
                  numero: data.numero || '', date: data.date || '', fournisseur: data.fournisseur || '',
                  description: data.description || '', ht0: parseFloat(data.ht0) || 0, ht19: parseFloat(data.ht19) || 0,
                  tva19: parseFloat(data.tva19) || 0, tva7: parseFloat(data.tva7) || 0, fodec: parseFloat(data.fodec) || 0,
                  timbre: parseFloat(data.timbre) || 1, ttc: parseFloat(data.ttc) || 0,
                  is_handwritten: true, raw_text: '', ocr_confidence: confidence,
                });
                console.log(`Page ${i + 1}: facture trouvée - ${data.fournisseur || 'inconnu'} ${data.ttc} DT`);
              }
            }
          }
        } catch (e) {
          console.warn(`Page ${i + 1} failed:`, e);
        }
      }
      console.log(`Total: ${allInvoices.length} factures extraites`);
    } catch (e) {
      console.warn('Vision AI failed:', e);
    }
  }

  if (allInvoices.length === 0 && isImage) {
    try {
      const Tesseract = await import('tesseract.js');
      const result = await Tesseract.default.recognize(file, 'fra+ara');
      text = result.data.text;
      confidence = result.data.confidence;
      if (text.replace(/\s/g, '').length > 50 && apiToken) {
        const planText = getPlanText(plan);
        const fournText = getFournisseursText(plan);
        const prompt = `## TEXTE OCR DE LA FACTURE\n${text}\n\nExtrait les données en JSON: {"numero":"","date":"YYYY-MM-DD","fournisseur":"","description":"","ht0":0,"ht19":0,"tva19":0,"tva7":0,"fodec":0,"timbre":1,"ttc":0}\n\nPlan: ${planText}\nFournisseurs: ${fournText}`;
        const systemPrompt = 'Tu es un expert-comptable tunisien. Extrais les données de la facture.';
        const aiResponse = await callAI(prompt, systemPrompt);
        if (aiResponse) {
          const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            allInvoices.push({
              id: genId(), numero: data.numero || '', date: data.date || '', fournisseur: data.fournisseur || '',
              description: data.description || '', ht0: parseFloat(data.ht0) || 0, ht19: parseFloat(data.ht19) || 0,
              tva19: parseFloat(data.tva19) || 0, tva7: parseFloat(data.tva7) || 0, fodec: parseFloat(data.fodec) || 0,
              timbre: parseFloat(data.timbre) || 1, ttc: parseFloat(data.ttc) || 0,
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
    const parsed = (await import('./achatsParser')).parseInvoiceText(text, isHandwritten);
    allInvoices.push({
      ...parsed,
      id: genId(),
      is_handwritten: isHandwritten,
      raw_text: text.substring(0, 500),
      ocr_confidence: confidence,
    });
  }

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
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        if (data.ecritures && Array.isArray(data.ecritures)) {
          return data.ecritures.map((e: any) => ({
            id: genId(),
            numero_doc: invoice.numero,
            date_operation: invoice.date,
            journal_code: 'AC',
            compte: String(e.compte),
            libelle: String(e.libelle),
            sens: e.sens === 'C' ? 'C' : 'D',
            montant: Math.round(parseFloat(e.montant) * 1000) / 1000,
          }));
        }
      }
    } catch {}
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
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return {
          verdict: data.verdict || 'ATTENTION',
          score: parseInt(data.score) || 0,
          checks: data.checks || [],
          summary: data.summary || '',
        };
      }
    } catch {}
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
