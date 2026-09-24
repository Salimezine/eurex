import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ShoppingCart, FolderOpen, FileSpreadsheet, Upload } from 'lucide-react';
import { PlanComptable, getPlanSummary } from '../../lib/achatsPlanComptable';
import { getDefaultPlanComptable } from '../../lib/achatsPlanComptableDefault';
import { savePlanForDossier, deletePlanForDossier, planSourceForDossier, parsePlanFromFile } from '../../lib/achatsPlanStore';

interface Dossier { id: string; societe_id: string; nom: string; mois: number; annee: number; statut: string; nb_factures: number; nb_ecritures: number; }

const STORAGE_KEY_DOSSIERS = 'achats_dossiers';
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
function genId() { return Math.random().toString(36).substring(2, 10) + Date.now().toString(36); }

export default function AchatsSocietes() {
  const navigate = useNavigate();
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [newDossierMonth, setNewDossierMonth] = useState('');
  const [newDossierNom, setNewDossierNom] = useState('');
  const [planMode, setPlanMode] = useState<'default' | 'upload'>('default');
  const [pendingPlanFile, setPendingPlanFile] = useState<File | null>(null);
  const [planUploadErr, setPlanUploadErr] = useState('');
  const [defaultPlan, setDefaultPlan] = useState<PlanComptable | null>(null);

  useEffect(() => {
    let loadedDossiers = loadDossiers();
    const def = getDefaultPlanComptable();
    setDefaultPlan(def);

    if (loadedDossiers.length === 0) {
      const now = new Date();
      const d: Dossier = {
        id: genId(), societe_id: SOCIETE_ID,
        nom: 'PROYASH METROPOLI', mois: now.getMonth() + 1, annee: now.getFullYear(),
        statut: 'brouillon', nb_factures: 0, nb_ecritures: 0,
      };
      loadedDossiers = [d];
      saveDossiers(loadedDossiers);
      savePlanForDossier(d.id, def);
    } else {
      for (const d of loadedDossiers) {
        if (planSourceForDossier(d.id) === 'default') savePlanForDossier(d.id, def);
      }
    }

    setDossiers(loadedDossiers);
  }, []);

  const createDossier = async () => {
    if (!newDossierMonth || !defaultPlan) return;
    const [y, m] = newDossierMonth.split('-').map(Number);
    const id = genId();
    const nom = (newDossierNom.trim() || `PROYASH ${String(m).padStart(2, '0')}/${y}`);
    const d: Dossier = {
      id, societe_id: SOCIETE_ID,
      nom, mois: m, annee: y,
      statut: 'brouillon', nb_factures: 0, nb_ecritures: 0,
    };

    try {
      let plan = defaultPlan;
      if (planMode === 'upload') {
        if (!pendingPlanFile) {
          setPlanUploadErr('Choisissez un fichier .xlsx pour le plan');
          return;
        }
        plan = await parsePlanFromFile(pendingPlanFile);
      }
      savePlanForDossier(id, plan);
    } catch (e: any) {
      setPlanUploadErr(e.message || 'Import du plan échoué');
      return;
    }

    const updated = [d, ...dossiers];
    setDossiers(updated);
    saveDossiers(updated);
    setNewDossierMonth('');
    setNewDossierNom('');
    setPlanMode('default');
    setPendingPlanFile(null);
    setPlanUploadErr('');
    navigate(`/achats/dossier/${id}`);
  };

  const deleteDossier = (id: string) => {
    if (!confirm('Supprimer ce dossier ?')) return;
    const updated = dossiers.filter(d => d.id !== id);
    setDossiers(updated);
    saveDossiers(updated);
    deletePlanForDossier(id);
    try {
      const raw = localStorage.getItem('achats_dossier_data');
      if (raw) {
        const all = JSON.parse(raw);
        delete all[id];
        localStorage.setItem('achats_dossier_data', JSON.stringify(all));
      }
    } catch {}
  };

  const planSummary = defaultPlan ? getPlanSummary(defaultPlan) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShoppingCart size={28} className="text-orange-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-800">ACHATS — PROYASH METROPOLI</h1>
          <p className="text-sm text-gray-500">Factures d'achat, Plan comptable, Journal AC</p>
        </div>
      </div>

      {/* Plan Comptable par défaut */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center gap-2 mb-2">
          <FileSpreadsheet size={18} className="text-orange-600" />
          <h2 className="font-semibold text-gray-700 text-sm">Plan par défaut (nouveaux dossiers)</h2>
          {planSummary && <span className="text-green-600 text-xs ml-2">✓ {planSummary.totalComptes} comptes / {planSummary.totalFournisseurs} fournisseurs</span>}
        </div>
        <p className="text-xs text-gray-400">Chaque dossier reçoit sa propre copie. Vous pourrez le remplacer dans l'onglet Plan du dossier.</p>
      </div>

      {/* Nouveau dossier */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
          <h2 className="font-semibold text-gray-700 text-sm">Dossiers</h2>
        </div>

        {/* Form create */}
        <div className="border rounded p-3 mb-4 bg-gray-50 space-y-3">
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Mois/Année</label>
              <input type="month" value={newDossierMonth} onChange={e => setNewDossierMonth(e.target.value)} className="border rounded px-3 py-2 text-sm" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-gray-500 block mb-1">Nom du dossier</label>
              <input value={newDossierNom} onChange={e => setNewDossierNom(e.target.value)} placeholder="PROYASH 10/2026" className="border rounded px-3 py-2 text-sm w-full" />
            </div>
            <button onClick={createDossier} className="bg-orange-500 text-white px-3 py-2 rounded text-sm hover:bg-orange-600 flex items-center gap-1">
              <Plus size={14} /> Nouveau dossier
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-500 block">Plan comptable du dossier</label>
            <div className="flex gap-4 flex-wrap text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={planMode === 'default'} onChange={() => { setPlanMode('default'); setPendingPlanFile(null); setPlanUploadErr(''); }} />
                Plan PROYASH par défaut
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={planMode === 'upload'} onChange={() => setPlanMode('upload')} />
                Importer un plan .xlsx
              </label>
            </div>
            {planMode === 'upload' && (
              <div className="flex items-center gap-2">
                <label className="bg-white border px-3 py-1.5 rounded text-xs cursor-pointer flex items-center gap-1 hover:bg-gray-50">
                  <Upload size={13} /> Choisir .xlsx
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setPendingPlanFile(f);
                    setPlanUploadErr('');
                  }} />
                </label>
                {pendingPlanFile && <span className="text-xs text-gray-600">{pendingPlanFile.name}</span>}
              </div>
            )}
            {planUploadErr && <p className="text-xs text-red-600">{planUploadErr}</p>}
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
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600">
                    plan {planSourceForDossier(d.id) === 'dossier' ? 'dossier' : planSourceForDossier(d.id) === 'legacy' ? 'global' : 'défaut'}
                  </span>
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
