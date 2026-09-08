import { PlanComptable } from './achatsPlanComptable';
import defaultData from './planComptableDefault.json';

export function getDefaultPlanComptable(): PlanComptable {
  const obj = defaultData as any;
  return {
    comptes: new Map(Object.entries(obj.comptes || {})),
    fournisseurs: new Map(Object.entries(obj.fournisseurs || {})),
    achats: obj.achats || [],
    tva: obj.tva || [],
    taxes: obj.taxes || [],
    allByCode: obj.allByCode || {},
  };
}

export const DEFAULT_SOCIETE = {
  id: 'proyash-metropoli',
  nom: 'PROYASH METROPOLI',
  mf: '',
};
