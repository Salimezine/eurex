import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { api } from '../../lib/api';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';

export default function BaudSocietes() {
  const [societes, setSocietes] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dossiers, setDossiers] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [nom, setNom] = useState('');
  const [formeJuridique, setFormeJuridique] = useState('SARL');

  useEffect(() => { api.baud.getSocietes().then(setSocietes).catch(() => {}); }, []);
  useEffect(() => { if (selectedId) api.baud.getDossiers(selectedId).then(setDossiers).catch(() => {}); }, [selectedId]);

  const createSociete = async () => {
    if (!nom.trim()) return;
    const s = await api.baud.createSociete({ nom: nom.trim(), forme_juridique: formeJuridique });
    setSocietes([...societes, s]);
    setNom(''); setFormeJuridique('SARL'); setShowNew(false);
  };

  const createDossier = async () => {
    if (!selectedId) return;
    try {
      const now = new Date();
      const d = await api.baud.createDossier(selectedId, { mois: now.getMonth() + 1, annee: now.getFullYear() });
      setDossiers([d, ...dossiers]);
    } catch {}
  };

  const deleteSociete = async (id: string) => {
    if (!confirm('Supprimer cette societe ?')) return;
    await api.baud.deleteSociete(id);
    setSocietes(societes.filter(s => s.id !== id));
    if (selectedId === id) { setSelectedId(null); setDossiers([]); }
  };

  const selected = societes.find(s => s.id === selectedId);

  // All dossiers across all societes (flat list like ANIMALS)
  const allDossiers: any[] = [];
  for (const s of societes) {
    // We'll show dossiers only for selected societe
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Societes</h2>
        <div className="flex items-center gap-2">
          <Link to="/baud/parametres" className="text-gray-400 hover:text-gray-600" title="Paramètres"><Settings size={18} /></Link>
          <button onClick={() => setShowNew(!showNew)} className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700">+ Nouvelle</button>
        </div>
      </div>

      {showNew && (
        <div className="bg-white border rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Nom de la societe" value={nom} onChange={e => setNom(e.target.value)} className="border rounded px-3 py-2 text-sm" />
            <select value={formeJuridique} onChange={e => setFormeJuridique(e.target.value)} className="border rounded px-3 py-2 text-sm">
              <option value="SARL">SARL</option>
              <option value="SA">SA</option>
              <option value="SNC">SNC</option>
              <option value="SAS">SAS</option>
              <option value="SASU">SASU</option>
              <option value="SUARL">SUARL</option>
              <option value="GIE">GIE</option>
              <option value="AUTO">Auto-entrepreneur</option>
              <option value="OTHER">Autre</option>
            </select>
          </div>
          <button onClick={createSociete} className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700">Creer</button>
        </div>
      )}

      {/* Societes list */}
      <div className="flex flex-wrap gap-2">
        {societes.map(s => (
          <button key={s.id} onClick={() => setSelectedId(selectedId === s.id ? null : s.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedId === s.id ? 'bg-purple-100 text-purple-700 ring-2 ring-purple-300' : 'bg-white border hover:bg-purple-50'}`}>
            {s.nom}
            <span className="ml-2 text-xs text-gray-400">{s.forme_juridique || ''}</span>
          </button>
        ))}
      </div>

      {/* Dossiers for selected societe */}
      {selected && (
        <div className="bg-white border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm">{selected.nom}</h3>
            <div className="flex gap-2 items-end">
              <button onClick={createDossier}
                className="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 flex items-center gap-1">
                <Plus size={12} />Nouveau dossier
              </button>
            </div>
          </div>
          {dossiers.length === 0 && <p className="text-xs text-gray-400">Aucun dossier</p>}
          <div className="divide-y">
            {dossiers.map((d: any) => (
              <Link key={d.id} to={`/baud/dossier/${d.id}`}
                className="flex items-center justify-between py-2 hover:bg-gray-50 px-2 rounded">
                <div className="flex items-center gap-2">
                  <FolderOpen size={16} className="text-purple-500" />
                  <span className="text-sm font-medium">{d.fichier_navette_nom || `Dossier ${String(d.mois).padStart(2, '0')}/${d.annee}`}</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${d.statut === 'valide' ? 'bg-green-100 text-green-700' : d.statut === 'controle' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    {d.statut}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!selected && societes.length > 0 && (
        <div className="bg-white border rounded-lg p-8 text-center text-gray-400 text-sm">
          Selectionnez une societe pour voir ses dossiers
        </div>
      )}
      {societes.length === 0 && (
        <div className="bg-white border rounded-lg p-8 text-center text-gray-400 text-sm">
          Aucune societe. Cliquez "+ Nouvelle" pour creer.
        </div>
      )}
    </div>
  );
}
