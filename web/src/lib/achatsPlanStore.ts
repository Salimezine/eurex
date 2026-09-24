import * as XLSX from 'xlsx';
import { PlanComptable, parsePlanComptable } from './achatsPlanComptable';
import { getDefaultPlanComptable } from './achatsPlanComptableDefault';

const STORAGE_KEY_PLANS = 'achats_plans';
const STORAGE_KEY_LEGACY_PLAN = 'achats_plan_comptable';

export function serializePlan(plan: PlanComptable): any {
  return {
    comptes: Object.fromEntries(plan.comptes),
    fournisseurs: Object.fromEntries(plan.fournisseurs),
    achats: plan.achats,
    tva: plan.tva,
    taxes: plan.taxes,
    allByCode: plan.allByCode,
  };
}

export function deserializePlan(obj: any): PlanComptable {
  return {
    comptes: new Map(Object.entries(obj?.comptes || {})),
    fournisseurs: new Map(Object.entries(obj?.fournisseurs || {})),
    achats: obj?.achats || [],
    tva: obj?.tva || [],
    taxes: obj?.taxes || [],
    allByCode: obj?.allByCode || {},
  };
}

function loadAllPlans(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_PLANS) || '{}');
  } catch { return {}; }
}

function saveAllPlans(all: Record<string, any>) {
  try {
    localStorage.setItem(STORAGE_KEY_PLANS, JSON.stringify(all));
  } catch {}
}

export function savePlanForDossier(dossierId: string, plan: PlanComptable) {
  const all = loadAllPlans();
  all[dossierId] = serializePlan(plan);
  saveAllPlans(all);
}

export function deletePlanForDossier(dossierId: string) {
  const all = loadAllPlans();
  if (dossierId in all) {
    delete all[dossierId];
    saveAllPlans(all);
  }
}

export function loadPlanForDossier(dossierId: string): PlanComptable {
  const all = loadAllPlans();
  if (all[dossierId]) return deserializePlan(all[dossierId]);

  // Migration: ancien plan global unique
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LEGACY_PLAN);
    if (raw) return deserializePlan(JSON.parse(raw));
  } catch {}

  return getDefaultPlanComptable();
}

export function planSourceForDossier(dossierId: string): 'dossier' | 'legacy' | 'default' {
  const all = loadAllPlans();
  if (all[dossierId]) return 'dossier';
  try {
    if (localStorage.getItem(STORAGE_KEY_LEGACY_PLAN)) return 'legacy';
  } catch {}
  return 'default';
}

export async function parsePlanFromFile(file: File): Promise<PlanComptable> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const plan = parsePlanComptable(wb);
  if (plan.comptes.size === 0) {
    throw new Error('Plan comptable vide ou format inattendu (colonnes: code, libellé, nature, sens)');
  }
  return plan;
}
