import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Building2, FolderOpen, Upload, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { parsePlanComptable, PlanComptable, getPlanSummary } from '../../lib/achatsPlanComptable';

interface Societe { id: string; nom: string; mf: string; }
interface Dossier { id: string; societe_id: string; nom: string; mois: number; annee: number; statut: string; nb_factures: number; nb_ecritures: number; }

const STORAGE_KEY_SOCIETES = 'achats_societes';
const STORAGE_KEY_DOSSIERS = 'achats_dossiers';
const STORAGE_KEY_PLAN = 'achats_plan_comptable';

function loadSocietes(): Societe[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_SOCIETES) || '[]'); } catch { return []; }
}
function saveSocietes(s: Societe[]) { localStorage.setItem(STORAGE_KEY_SOCIETES, JSON.stringify(s)); }
function loadDossiers(): Dossier[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_DOSSIERS) || '[]'); } catch { return []; }
}
function saveDossiers(d: Dossier[]) { localStorage.setItem(STORAGE_KEY_DOSSIERS, JSON.stringify(d)); }
function loadPlan(): PlanComptable | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PLAN);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const plan: PlanComptable = {
      comptes: new Map(Object.entries(obj.comptes || {})),
      fournisseurs: new Map(Object.entries(obj.fournisseurs || {})),
      achats: obj.achats || [],
      tva: obj.tva || [],
      taxes: obj.taxes || [],
      allByCode: obj.allByCode || {},
    };
    return plan;
  } catch { return null; }
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
  const [societes, setSocietes] = useState<Societe[]>([]);
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [selectedSoc, setSelectedSoc] = useState<string | null>(null);
  const [showNewSoc, setShowNewSoc] = useState(false);
  const [newNom, setNewNom] = useState('');
  const [newMF, setNewMF] = useState('');
  const [newDossierMonth, setNewDossierMonth] = useState('');
  const [plan, setPlan] = useState<PlanComptable | null>(null);
  const [uploadingPlan, setUploadingPlan] = useState(false);

  useEffect(() => {
    setSocietes(loadSocietes());
    setDossiers(loadDossiers());
    setPlan(loadPlan());
  }, []);

  const createSociete = () => {
    if (!newNom.trim()) return;
    const s: Societe = { id: genId(), nom: newNom.trim(), mf: newMF.trim() };
    const updated = [...societes, s];
    setSocietes(updated);
    saveSocietes(updated);
    setNewNom(''); setNewMF(''); setShowNewSoc(false);
  };

  const deleteSociete = (id: string) => {
    if (!confirm('Supprimer cette société et tous ses dossiers ?')) return;
    const updated = societes.filter(s => s.id !== id);
    setSocietes(updated);
    saveSocietes(updated);
    const updatedD = dossiers.filter(d => d.societe_id !== id);
    setDossiers(updatedD);
    saveDossiers(updatedD);
    if (selectedSoc === id) setSelectedSoc(null);
  };

  const createDossier = () => {
    if (!selectedSoc || !newDossierMonth) return;
    const [y, m] = newDossierMonth.split('-').map(Number);
    const d: Dossier = {
      id: genId(), societe_id: selectedSoc,
      nom: `ACHATS ${m}/${y}`, mois: m, annee: y,
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

  const handleUploadPlan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPlan(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const parsed = parsePlanComptable(wb);
      setPlan(parsed);
      savePlan(parsed);
    } catch (err: any) {
      alert('Erreur lecture Excel: ' + err.message);
    }
    setUploadingPlan(false);
    e.target.value = '';
  };

  const selected = societes.find(s => s.id === selectedSoc);
  const filteredDossiers = selectedSoc ? dossiers.filter(d => d.societe_id === selectedSoc) : [];
  const planSummary = plan ? getPlanSummary(plan) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Building2 size={28} className="text-orange-600" />
        <h1 className="text-2xl font-bold text-gray-800">ACHATS — Factures d'Achat</h1>
      </div>

      {/* Plan Comptable */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-orange-600" />
            <h2 className="font-semibold text-gray-700 text-sm">Plan Comptable</h2>
          </div>
          <label className="bg-orange-600 text-white px-3 py-1.5 rounded text-sm hover:bg-orange-700 cursor-pointer flex items-center gap-1">
            <Upload size={14} />
            {uploadingPlan ? 'Chargement...' : plan ? 'Remplacer' : 'Importer Excel'}
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUploadPlan} />
          </label>
        </div>
        {plan && planSummary ? (
          <div className="flex gap-4 text-xs text-gray-500">
            <span>{planSummary.totalComptes} comptes</span>
            <span>{planSummary.totalFournisseurs} fournisseurs</span>
            <span>{planSummary.totalAchats} comptes d'achats</span>
            <span className="text-green-600">Plan chargé</span>
          </div>
        ) : (
          <p className="text-xs text-amber-600">Aucun plan comptable chargé. Importez le fichier Excel du plan comptable PROYASH METROPOLI 2026.</p>
        )}
      </div>

      {/* Nouvelle société */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-700 text-sm">Sociétés</h2>
          <button onClick={() => setShowNewSoc(!showNewSoc)} className="bg-orange-600 text-white px-3 py-1.5 rounded text-sm hover:bg-orange-700 flex items-center gap-1">
            <Plus size={14} /> Nouvelle
          </button>
        </div>
        {showNewSoc && (
          <div className="flex gap-2 items-end mb-3">
            <input value={newNom} onChange={e => setNewNom(e.target.value)} placeholder="Nom société" className="flex-1 border rounded px-3 py-2 text-sm" />
            <input value={newMF} onChange={e => setNewMF(e.target.value)} placeholder="Matricule fiscal" className="w-48 border rounded px-3 py-2 text-sm" />
            <button onClick={createSociete} className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700">Créer</button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {societes.map(s => (
            <button key={s.id} onClick={() => setSelectedSoc(selectedSoc === s.id ? null : s.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedSoc === s.id ? 'bg-orange-100 text-orange-700 ring-2 ring-orange-300' : 'bg-white border hover:bg-orange-50'}`}>
              {s.nom}
              {s.mf && <span className="ml-2 text-xs text-gray-400">MF: {s.mf}</span>}
              <button onClick={(e) => { e.stopPropagation(); deleteSociete(s.id); }} className="ml-2 text-red-400 hover:text-red-600">×</button>
            </button>
          ))}
          {societes.length === 0 && <p className="text-xs text-gray-400">Aucune société</p>}
        </div>
      </div>

      {/* Dossiers */}
      {selected && (
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm text-gray-700">{selected.nom} — Dossiers</h3>
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
          {filteredDossiers.length === 0 ? (
            <p className="text-xs text-gray-400">Aucun dossier</p>
          ) : (
            <div className="space-y-2">
              {filteredDossiers.map(d => (
                <div key={d.id} className="flex items-center justify-between border rounded px-3 py-2 hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <FolderOpen size={16} className="text-orange-500" />
                    <span className="font-medium text-sm">{d.nom}</span>
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
      )}

      {!selected && societes.length > 0 && (
        <div className="bg-white border rounded-lg p-8 text-center text-gray-400 text-sm">
          Sélectionnez une société pour voir ses dossiers
        </div>
      )}
    </div>
  );
}
