import * as XLSX from 'xlsx';

export interface CompteComptable {
  code: string;
  libelle: string;
  nature: 'Regroupement' | 'Comptable';
  sens: 'D' | 'C' | 'DC';
}

export interface PlanComptable {
  comptes: Map<string, CompteComptable>;
  fournisseurs: Map<string, CompteComptable>;
  achats: CompteComptable[];
  tva: CompteComptable[];
  taxes: CompteComptable[];
  allByCode: Record<string, CompteComptable>;
}

export function parsePlanComptable(workbook: XLSX.WorkBook): PlanComptable {
  const comptes = new Map<string, CompteComptable>();
  const fournisseurs = new Map<string, CompteComptable>();
  const achats: CompteComptable[] = [];
  const tva: CompteComptable[] = [];
  const taxes: CompteComptable[] = [];
  const allByCode: Record<string, CompteComptable> = {};

  const sheetNames = workbook.SheetNames;
  for (const sn of sheetNames) {
    const ws = workbook.Sheets[sn];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
    if (data.length < 2) continue;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const code = String(row[0] || '').trim();
      const libelle = String(row[1] || '').trim();
      const nature = (row[2] || 'Comptable') as 'Regroupement' | 'Comptable';
      const sens = (row[3] || 'D') as 'D' | 'C' | 'DC';

      if (!code || !libelle) continue;

      const compte: CompteComptable = { code, libelle, nature, sens };
      comptes.set(code, compte);
      allByCode[code] = compte;

      if (code.startsWith('401') && nature === 'Comptable') {
        fournisseurs.set(code, compte);
      }
      if (code.startsWith('60') && nature === 'Comptable') {
        achats.push(compte);
      }
      if (code.startsWith('436') && nature === 'Comptable') {
        tva.push(compte);
      }
      if (code.startsWith('437') && nature === 'Comptable') {
        taxes.push(compte);
      }
    }
  }

  return { comptes, fournisseurs, achats, tva, taxes, allByCode };
}

export function searchComptes(plan: PlanComptable, query: string): CompteComptable[] {
  const q = query.toLowerCase();
  const results: CompteComptable[] = [];
  for (const [, c] of plan.comptes) {
    if (c.nature !== 'Comptable') continue;
    if (c.code.includes(q) || c.libelle.toLowerCase().includes(q)) {
      results.push(c);
    }
  }
  return results.slice(0, 50);
}

export function findFournisseurByName(plan: PlanComptable, name: string): CompteComptable | null {
  const n = name.toUpperCase().trim();
  for (const [, c] of plan.fournisseurs) {
    if (c.libelle.toUpperCase().includes(n) || n.includes(c.libelle.toUpperCase())) {
      return c;
    }
  }
  return null;
}

export function matchAchatCompte(plan: PlanComptable, description: string): CompteComptable | null {
  const code = ruleAccount(plan, description);
  if (code) return plan.comptes.get(code) || null;
  // Fallback : 1er 6xxxxx du plan (606600 n'existe pas dans tous les plans)
  for (const [c2, c] of plan.comptes) {
    if (/^6\d{5}$/.test(c2) && c.nature === 'Comptable') return c;
  }
  return null;
}

// Règles de mapping description → compte, calibrées sur les écritures de
// référence du cabinet (dossiers TEBIB 01-03/2026). Ne retient que les codes
// présents dans LE plan (Comptables), sinon null (pas de fallback ici).
export function ruleAccount(plan: PlanComptable, description: string): string | null {
  const d = (description || '').toLowerCase();
  if (!d) return null;
  const rules: [RegExp, string[]][] = [
    [/syndic|copropri|syndique/, ['614100', '614001']],
    [/loyer|location|bail|\bcle\b|\bsarl\b/, ['613002', '614000']],
    [/\beau\b|sonede/, ['606003', '606012', '606013']],
    [/electricit|edf|steg|kwh|energie|énergie/, ['606002', '606010', '606011']],
    [/ordinateur|pc\b|ecran|écran|informatique|imprimante|intel|dell|materiel info|matériel info/, ['228300']],
    [/tenue.*comptab|comptab|honoraires|expertise/, ['622100', '622000']],
    [/ticket.*rest|restaurant|pluxee|sodexo|repas|cantine/, ['617010', '617000']],
    [/internet|fsi|wifi|fibre|spacenet/, ['626200']],
    [/telephone|téléphone|mobile|telecom|gsm|fixe|tunisip/, ['626100']],
    [/transport|livraison|fret/, ['624100']],
    [/assurance|prime.*assur/, ['616000']],
    [/publicit|pub|marketing/, ['623000']],
    [/bancaire|commission.*banq|agios/, ['627000']],
    [/entretien|maintenance|reparation|réparation|nettoyage|kss/, ['615000']],
    [/prestation|clinique|bordereau|sous-traitance|etude|étude/, ['604000']],
    [/emballage|packaging/, ['602600', '602601']],
    [/marchandise|produits alimentaires|alimentaire|nourriture/, ['607000']],
    [/mati[eè]re premi[eè]re|MP\b/, ['601000']],
    [/quincaillerie|outillage|outil/, ['601010']],
    [/consommable/, ['602100', '602200']],
    [/fourniture.*(bureau|bureautique)|bureau/, ['602400', '606700', '602100']],
    [/divers|autre/, ['606600']],
  ];

  for (const [regex, accounts] of rules) {
    if (regex.test(d)) {
      for (const code of accounts) {
        const c = plan.comptes.get(code);
        if (c && c.nature === 'Comptable') return code;
      }
    }
  }
  return null;
}

export function formatPlanComptable(plan: PlanComptable): string {
  const lines: string[] = [];
  for (const [code, c] of plan.comptes) {
    if (c.nature !== 'Comptable') continue;
    const indent = '  '.repeat(Math.max(0, Math.floor(code.length / 2) - 1));
    lines.push(`${indent}${code} ${c.libelle} (${c.sens})`);
  }
  return lines.join('\n');
}

export function getPlanSummary(plan: PlanComptable): { totalComptes: number; totalFournisseurs: number; totalAchats: number } {
  return {
    totalComptes: plan.comptes.size,
    totalFournisseurs: plan.fournisseurs.size,
    totalAchats: plan.achats.length,
  };
}
