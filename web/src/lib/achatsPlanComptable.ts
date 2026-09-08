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
  const d = description.toLowerCase();
  const rules: [RegExp, string[]][] = [
    [/marchandise|produits alimentaires|alimentaire|nourriture/, ['607000']],
    [/mati[eè]re premi[eè]re|MP\b/, ['601000']],
    [/entretien|maintenance|r[eé]paration/, ['601002', '615000']],
    [/quincaillerie|outillage|outil/, ['601010']],
    [/consommable/, ['602100', '602200']],
    [/fourniture.*(bureau|bureautique)/, ['602400', '606700']],
    [/emballage/, ['602600', '602601']],
    [/[eé]lectricit[eé]|EDF|kwh/, ['606002', '606010', '606011']],
    [/eau|SONEDE/, ['606003', '606012', '606013']],
    [/transport|livraison|fret/, ['624100']],
    [/location|loyer|bail/, ['613002']],
    [/assurance|prime.*assur/, ['616000']],
    [/r[eé]paration.*clim|climatisation|frig/, ['615000']],
    [/publicit[eé]|pub|marketing/, ['623000']],
    [/honoraires|conseil|expertise/, ['622000']],
    [/t[eé]l[eé]phone|internet|forfait/, ['626000']],
    [/bancaire|commission.*banq|agios/, ['627000']],
    [/divers|autre/, ['606600']],
  ];

  for (const [regex, accounts] of rules) {
    if (regex.test(d)) {
      for (const code of accounts) {
        const c = plan.comptes.get(code);
        if (c) return c;
      }
    }
  }

  return plan.comptes.get('606600') || null;
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
