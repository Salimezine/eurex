import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ShoppingCart, FolderOpen, FileSpreadsheet, Upload } from 'lucide-react';
import { PlanComptable, getPlanSummary } from '../../lib/achatsPlanComptable';
import { getDefaultPlanComptable } from '../../lib/achatsPlanComptableDefault';
import { savePlanForDossier, deletePlanForDossier, planSourceForDossier, parsePlanFromFile } from '../../lib/achatsPlanStore';

interface Dossier { id: string; societe_id: string; nom: string; mois: number; annee: number; statut: string; nb_factures: number; nb_ecritures: number; }
interface Societe { id: string; nom: string; }

const STORAGE_KEY_DOSSIERS = 'achats_dossiers';
const STORAGE_KEY_SOCIETES = 'achats_societes';
const DEFAULT_SOCIETE: Societe = { id: 'proyash-metropoli', nom: 'PROYASH METROPOLI' };

function loadSocietes(): Societe[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SOCIETES);
    if (!raw) return [DEFAULT_SOCIETE];
    const arr: Societe[] = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return [DEFAULT_SOCIETE];
    return arr.filter(s => s && s.id && s.nom);
  } catch { return [DEFAULT_SOCIETE]; }
}
function saveSocietes(societes: Societe[]) {
  try { localStorage.setItem(STORAGE_KEY_SOCIETES, JSON.stringify(societes)); } catch {}
}
function loadAllDossiers(): Dossier[] {
  try {
    const all: Dossier[] = JSON.parse(localStorage.getItem(STORAGE_KEY_DOSSIERS) || '[]');
    return Array.isArray(all) ? all : [];
  } catch { return []; }
}
function saveDossiers(dossiers: Dossier[]) {
  try { localStorage.setItem(STORAGE_KEY_DOSSIERS, JSON.stringify(dossiers)); } catch {}
}
function genId() { return Math.random().toString(36).substring(2, 10) + Date.now().toString(36); }

export default function AchatsSocietes() {
  const navigate = useNavigate();
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [societes, setSocietes] = useState<Societe[]>([DEFAULT_SOCIETE]);
  const [selectedSocieteId, setSelectedSocieteId] = useState<string>(DEFAULT_SOCIETE.id);
  const [newSocieteNom, setNewSocieteNom] = useState('');
  const [societeErr, setSocieteErr] = useState('');
  const [newDossierMonth, setNewDossierMonth] = useState('');
  const [newDossierNom, setNewDossierNom] = useState('');
  const [dossierErr, setDossierErr] = useState('');
  const [planMode, setPlanMode] = useState<'default' | 'upload'>('default');
  const [pendingPlanFile, setPendingPlanFile] = useState<File | null>(null);
  const [planUploadErr, setPlanUploadErr] = useState('');
  const [defaultPlan, setDefaultPlan] = useState<PlanComptable | null>(null);

  useEffect(() => {
    const loadedSocietes = loadSocietes();
    saveSocietes(loadedSocietes);
    setSocietes(loadedSocietes);
    setSelectedSocieteId(loadedSocietes[0].id);

    let loadedDossiers = loadAllDossiers();
    const def = getDefaultPlanComptable();
    setDefaultPlan(def);

    if (loadedDossiers.length === 0) {
      const now = new Date();
      const d: Dossier = {
        id: genId(), societe_id: loadedSocietes[0].id,
        nom: loadedSocietes[0].nom, mois: now.getMonth() + 1, annee: now.getFullYear(),
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

  const selectedSociete = societes.find(s => s.id === selectedSocieteId) || societes[0];
  const visibleDossiers = dossiers.filter(d => d.societe_id === selectedSociete.id);

  const createSociete = () => {
    const nom = newSocieteNom.trim().toUpperCase();
    if (!nom) { setSocieteErr('Nom de société requis'); return; }
    if (societes.some(s => s.nom.toUpperCase() === nom)) { setSocieteErr('Société déjà existante'); return; }
    const slug = nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'societe';
    const s: Societe = { id: `${slug}-${genId()}`, nom };
    const updated = [...societes, s];
    setSocietes(updated);
    saveSocietes(updated);
    setSelectedSocieteId(s.id);
    setNewSocieteNom('');
    setSocieteErr('');
  };

  const deleteSociete = (id: string) => {
    if (societes.length <= 1) { setSocieteErr('Impossible : une société minimum'); return; }
    const s = societes.find(x => x.id === id);
    if (!s) return;
    if (!confirm(`Supprimer ${s.nom} et ses dossiers ?`)) return;
    const dossierIds = new Set(dossiers.filter(d => d.societe_id === id).map(d => d.id));
    for (const did of dossierIds) deletePlanForDossier(did);
    try {
      const raw = localStorage.getItem('achats_dossier_data');
      if (raw) {
        const all = JSON.parse(raw);
        for (const did of dossierIds) delete all[did];
        localStorage.setItem('achats_dossier_data', JSON.stringify(all));
      }
    } catch {}
    setDossiers(dossiers.filter(d => d.societe_id !== id));
    const updated = societes.filter(x => x.id !== id);
    setSocietes(updated);
    saveSocietes(updated);
    if (selectedSocieteId === id) setSelectedSocieteId(updated[0].id);
    setSocieteErr('');
  };

  const createDossier = async () => {
    if (!newDossierMonth) { setDossierErr('Choisissez le mois/année du dossier'); return; }
    if (!defaultPlan) { setDossierErr('Plan par défaut non chargé'); return; }
    const [y, m] = newDossierMonth.split('-').map(Number);
    const id = genId();
    const nom = (newDossierNom.trim() || `${selectedSociete.nom} ${String(m).padStart(2, '0')}/${y}`);
    const d: Dossier = {
      id, societe_id: selectedSociete.id,
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
    setDossierErr('');
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
          <h1 className="text-2xl font-bold text-gray-800">ACHATS — {selectedSociete.nom}</h1>
          <p className="text-sm text-gray-500">Factures d'achat, Plan comptable, Journal AC</p>
        </div>
      </div>

      {/* Sociétés */}
      <div className="bg-white rounded-lg border p-4">
        <h2 className="font-semibold text-gray-700 text-sm mb-3">Sociétés</h2>
        <div className="flex gap-2 flex-wrap items-center mb-3">
          {societes.map(s => (
            <div key={s.id} className={`flex items-center gap-1 border rounded px-3 py-1.5 text-sm ${s.id === selectedSociete.id ? 'border-orange-500 bg-orange-50 text-orange-800 font-medium' : 'hover:bg-gray-50'}`}>
              <button onClick={() => setSelectedSocieteId(s.id)}>{s.nom}</button>
              {societes.length > 1 && (
                <button onClick={() => deleteSociete(s.id)} title={`Supprimer ${s.nom}`} className="text-red-300 hover:text-red-600 ml-1"><Trash2 size={12} /></button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs text-gray-500 block mb-1">Nouvelle société</label>
            <input value={newSocieteNom} onChange={e => { setNewSocieteNom(e.target.value); setSocieteErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') createSociete(); }}
              placeholder="TEBIB TUNISIE" className="border rounded px-3 py-2 text-sm w-full" />
          </div>
          <button onClick={createSociete} className="bg-gray-700 text-white px-3 py-2 rounded text-sm hover:bg-gray-800 flex items-center gap-1">
            <Plus size={14} /> Ajouter société
          </button>
        </div>
        {societeErr && <p className="text-xs text-red-600 mt-2">{societeErr}</p>}
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
          <h2 className="font-semibold text-gray-700 text-sm">Dossiers — {selectedSociete.nom}</h2>
        </div>

        {/* Form create */}
        <div className="border rounded p-3 mb-4 bg-gray-50 space-y-3">
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Mois/Année</label>
              <input type="month" value={newDossierMonth} onChange={e => { setNewDossierMonth(e.target.value); setDossierErr(''); }} className="border rounded px-3 py-2 text-sm" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-gray-500 block mb-1">Nom du dossier</label>
              <input value={newDossierNom} onChange={e => setNewDossierNom(e.target.value)} placeholder={`${selectedSociete.nom} 10/2026`} className="border rounded px-3 py-2 text-sm w-full" />
            </div>
            <button onClick={createDossier} className="bg-orange-500 text-white px-3 py-2 rounded text-sm hover:bg-orange-600 flex items-center gap-1">
              <Plus size={14} /> Nouveau dossier
            </button>
          </div>
          {dossierErr && <p className="text-xs text-red-600">{dossierErr}</p>}

          <div className="space-y-2">
            <label className="text-xs text-gray-500 block">Plan comptable du dossier</label>
            <div className="flex gap-4 flex-wrap text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={planMode === 'default'} onChange={() => { setPlanMode('default'); setPendingPlanFile(null); setPlanUploadErr(''); }} />
                Plan par défaut
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

        {visibleDossiers.length === 0 ? (
          <p className="text-xs text-gray-400">Aucun dossier pour {selectedSociete.nom}. Créez-en un pour commencer.</p>
        ) : (
          <div className="space-y-2">
            {visibleDossiers.map(d => (
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
