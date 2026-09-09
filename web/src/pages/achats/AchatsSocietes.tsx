import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ShoppingCart, FolderOpen, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { parsePlanComptable, PlanComptable, getPlanSummary } from '../../lib/achatsPlanComptable';
import { getDefaultPlanComptable } from '../../lib/achatsPlanComptableDefault';

interface Dossier { id: string; societe_id: string; nom: string; mois: number; annee: number; statut: string; nb_factures: number; nb_ecritures: number; }

const STORAGE_KEY_DOSSIERS = 'achats_dossiers';
const STORAGE_KEY_PLAN = 'achats_plan_comptable';
const SOCIETE_ID = 'proyash-metropoli';

function loadDossiers(): Dossier[] {
  try {
    const all: Dossier[] = JSON.parse(localStorage.getItem(STORAGE_KEY_DOSSIERS) || '[]');
    return all.filter(d => d.societe_id === SOCIETE_ID);
  } catch { return []; }
}
function saveDossiers(dossiers: Dossier[]) {
  try {
    const all: Dossier[] = JSON.parse(localStorage.getItem(STORAGE_KEY_DOSSIERS) || '[]');
    const others = all.filter(d => d.societe_id !== SOCIETE_ID);
    localStorage.setItem(STORAGE_KEY_DOSSIERS, JSON.stringify([...others, ...dossiers]));
  } catch {}
}
function loadPlan(): PlanComptable | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PLAN);
    if (!raw) return getDefaultPlanComptable();
    const obj = JSON.parse(raw);
    return {
      comptes: new Map(Object.entries(obj.comptes || {})),
      fournisseurs: new Map(Object.entries(obj.fournisseurs || {})),
      achats: obj.achats || [],
      tva: obj.tva || [],
      taxes: obj.taxes || [],
      allByCode: obj.allByCode || {},
    };
  } catch { return getDefaultPlanComptable(); }
}
function savePlan(plan: PlanComptable) {
  const obj = {
    comptes: Object.fromEntries(plan.comptes),
    fournisseurs: Object.fromEntries(plan.fournisseurs),
    achats: plan.achats,
    tva: plan.tva,
    taxes: plan.taxes,
    allByCode: plan.allByCode,
  };
  localStorage.setItem(STORAGE_KEY_PLAN, JSON.stringify(obj));
}
function genId() { return Math.random().toString(36).substring(2, 10) + Date.now().toString(36); }

export default function AchatsSocietes() {
  const navigate = useNavigate();
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [newDossierMonth, setNewDossierMonth] = useState('');
  const [plan, setPlan] = useState<PlanComptable | null>(null);

  useEffect(() => {
    let loadedDossiers = loadDossiers();
    const p = loadPlan();
    if (!p) {
      const def = getDefaultPlanComptable();
      savePlan(def);
      setPlan(def);
    } else {
      setPlan(p);
    }

    if (loadedDossiers.length === 0) {
      const now = new Date();
      const d: Dossier = {
        id: genId(), societe_id: SOCIETE_ID,
        nom: 'PROYASH METROPOLI', mois: now.getMonth() + 1, annee: now.getFullYear(),
        statut: 'brouillon', nb_factures: 0, nb_ecritures: 0,
      };
      loadedDossiers = [d];
      saveDossiers(loadedDossiers);
    }

    setDossiers(loadedDossiers);
  }, []);

  const createDossier = () => {
    if (!newDossierMonth) return;
    const [y, m] = newDossierMonth.split('-').map(Number);
    const d: Dossier = {
      id: genId(), societe_id: SOCIETE_ID,
      nom: 'PROYASH METROPOLI', mois: m, annee: y,
      statut: 'brouillon', nb_factures: 0, nb_ecritures: 0,
    };
    const updated = [d, ...dossiers];
    setDossiers(updated);
    saveDossiers(updated);
    setNewDossierMonth('');
  };

  const deleteDossier = (id: string) => {
    if (!confirm('Supprimer ce dossier ?')) return;
    const updated = dossiers.filter(d => d.id !== id);
    setDossiers(updated);
    saveDossiers(updated);
  };

  const planSummary = plan ? getPlanSummary(plan) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShoppingCart size={28} className="text-orange-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-800">ACHATS — PROYASH METROPOLI</h1>
          <p className="text-sm text-gray-500">Factures d'achat, Plan comptable, Journal AC</p>
        </div>
      </div>

      {/* Plan Comptable */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center gap-2 mb-2">
          <FileSpreadsheet size={18} className="text-orange-600" />
          <h2 className="font-semibold text-gray-700 text-sm">Plan Comptable</h2>
          {planSummary && <span className="text-green-600 text-xs ml-2">✓ Chargé</span>}
        </div>
        {planSummary ? (
          <div className="flex gap-4 text-xs text-gray-500">
            <span>{planSummary.totalComptes} comptes</span>
            <span>{planSummary.totalFournisseurs} fournisseurs</span>
            <span>{planSummary.totalAchats} comptes d'achats</span>
          </div>
        ) : (
          <p className="text-xs text-amber-600">Plan non chargé</p>
        )}
      </div>

      {/* Nouveau dossier */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-700 text-sm">Dossiers</h2>
          <div className="flex gap-2 items-end">
            <div>
              <label className="text-xs text-gray-500">Mois/Année</label>
              <input type="month" value={newDossierMonth} onChange={e => setNewDossierMonth(e.target.value)} className="border rounded px-3 py-2 text-sm ml-2" />
            </div>
            <button onClick={createDossier} className="bg-orange-500 text-white px-3 py-2 rounded text-sm hover:bg-orange-600 flex items-center gap-1">
              <Plus size={14} /> Nouveau dossier
            </button>
          </div>
        </div>
        {dossiers.length === 0 ? (
          <p className="text-xs text-gray-400">Aucun dossier. Créez-en un pour commencer.</p>
        ) : (
          <div className="space-y-2">
            {dossiers.map(d => (
              <div key={d.id} className="flex items-center justify-between border rounded px-3 py-2 hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <FolderOpen size={16} className="text-orange-500" />
                  <span className="font-medium text-sm">{d.nom}</span>
                  <span className="text-xs text-gray-400">{String(d.mois).padStart(2, '0')}/{d.annee}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${d.statut === 'valide' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {d.statut}
                  </span>
                  <span className="text-xs text-gray-400">{d.nb_factures} factures / {d.nb_ecritures} écritures</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => navigate(`/achats/dossier/${d.id}`)} className="text-orange-600 hover:underline text-sm">Ouvrir</button>
                  <button onClick={() => deleteDossier(d.id)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
