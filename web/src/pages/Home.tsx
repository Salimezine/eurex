import { useEffect, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { FolderOpen, Trash2, BarChart3, ShoppingCart, Scissors, Pencil, Check, X } from 'lucide-react';
import SplitPdfTool from '../components/SplitPdfTool';

export default function Home() {
  const [dossiers, setDossiers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [splitOpen, setSplitOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNom, setEditNom] = useState('');
  const [saving, setSaving] = useState(false);
  const icons: Record<string, any> = { animal: FolderOpen, baud: FolderOpen, scanflash: FolderOpen, achats: ShoppingCart };

  const load = async () => {
    try {
      const d = await api.dashboard();
      const animals = (d.recentDossiers || []).map((dd: any) => ({ ...dd, type: 'animal' }));
      const bauds = (d.baudDossiers || []).map((dd: any) => ({ ...dd, type: 'baud' }));
      const scans = (d.scanDossiers || []).map((dd: any) => ({ ...dd, type: 'scanflash' }));
      setDossiers([...animals, ...bauds, ...scans]);
    } catch {}

    // Load ACHATS dossiers from localStorage
    try {
      const achatsDossiers = JSON.parse(localStorage.getItem('achats_dossiers') || '[]');
      const achatsMapped = achatsDossiers.map((dd: any) => ({ ...dd, type: 'achats' }));
      setDossiers(prev => [...prev, ...achatsMapped]);
    } catch {}

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const deleteDossier = async (id: string, type: string) => {
    if (!confirm('Supprimer ce dossier ?')) return;
    if (type === 'baud') {
      await api.baud.deleteDossier(id);
    } else if (type === 'scanflash') {
      await api.scan.deleteDossier(id);
    } else if (type === 'achats') {
      try {
        const dossiers = JSON.parse(localStorage.getItem('achats_dossiers') || '[]');
        localStorage.setItem('achats_dossiers', JSON.stringify(dossiers.filter((d: any) => d.id !== id)));
      } catch {}
      try {
        const plans = JSON.parse(localStorage.getItem('achats_plans') || '{}');
        delete plans[id];
        localStorage.setItem('achats_plans', JSON.stringify(plans));
      } catch {}
      try {
        const data = JSON.parse(localStorage.getItem('achats_dossier_data') || '{}');
        delete data[id];
        localStorage.setItem('achats_dossier_data', JSON.stringify(data));
      } catch {}
    } else {
      await api.deleteDossier(id);
    }
    setDossiers(dossiers.filter(d => d.id !== id));
  };

  const dossierName = (d: any, label: string) => d.nom || d.raison_sociale || label;

  const startRename = (e: ReactMouseEvent, d: any, label: string) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(d.id);
    setEditNom(dossierName(d, label));
  };

  const cancelRename = (e?: ReactMouseEvent | ReactKeyboardEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setEditingId(null);
    setEditNom('');
  };

  const saveRename = async (d: any) => {
    const nom = editNom.trim();
    if (!nom || saving) { setEditingId(null); return; }
    setSaving(true);
    try {
      if (d.type === 'achats') {
        const all = JSON.parse(localStorage.getItem('achats_dossiers') || '[]');
        localStorage.setItem('achats_dossiers', JSON.stringify(all.map((x: any) => (x.id === d.id ? { ...x, nom } : x))));
      } else if (d.type === 'baud') {
        await api.baud.updateDossier(d.id, nom);
      } else if (d.type === 'scanflash') {
        await api.scan.updateDossier(d.id, nom);
      } else {
        await api.updateDossier(d.id, nom);
      }
      setDossiers(prev => prev.map(x => (x.id === d.id ? { ...x, nom } : x)));
      setEditingId(null);
      setEditNom('');
    } catch (err: any) {
      alert('Renommage impossible : ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold">Dossiers</h2>
        <button onClick={() => setSplitOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2">
          <Scissors size={16} /> Scinder un PDF
        </button>
      </div>

      {dossiers.length === 0 && (
        <div className="bg-white border rounded-lg p-8 text-center text-gray-400 text-sm">
          Aucun dossier.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <Link to="/ef" className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg p-4 hover:shadow-md transition-all group">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 size={20} className="text-indigo-600" />
            <span className="font-medium text-indigo-800">Etats Financiers</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700">EF</span>
            <span className="text-xs text-gray-500">Bilan, Resultat, SIG, Flux, Immob</span>
          </div>
        </Link>
        <Link to="/achats" className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-lg p-4 hover:shadow-md transition-all group">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart size={20} className="text-orange-600" />
            <span className="font-medium text-orange-800">Achats</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-xs bg-orange-100 text-orange-700">AC</span>
            <span className="text-xs text-gray-500">Factures d'achat, Plan comptable, Journal AC</span>
          </div>
        </Link>
        {dossiers.map((d: any) => {
          const isBaud = d.type === 'baud';
          const isScan = d.type === 'scanflash';
          const isAchat = d.type === 'achats';
          const link = isAchat ? `/achats/dossier/${d.id}` : isBaud ? `/baud/dossier/${d.id}` : isScan ? `/scanflash/dossier/${d.id}` : `/dossier/${d.id}`;
          const label = isAchat ? 'ACHATS' : isBaud ? 'BAUD' : isScan ? 'SCANFLASH' : 'ANIMAL';
          const color = isAchat ? 'orange' : isBaud ? 'purple' : isScan ? 'emerald' : 'blue';
          return (
            <Link key={d.id} to={link}
              className={`bg-white border rounded-lg p-4 hover:shadow-md transition-all group`}>
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {(() => { const Icon = icons[d.type] || FolderOpen; return <Icon size={20} className={`text-${color}-500 shrink-0`} />; })()}
                  {editingId === d.id ? (
                    <span className="flex items-center gap-1 min-w-0 flex-1"
                      onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
                      <input autoFocus value={editNom} onFocus={e => e.target.select()} disabled={saving}
                        onChange={e => setEditNom(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); saveRename(d); }
                          if (e.key === 'Escape') cancelRename(e);
                        }}
                        className="min-w-0 flex-1 text-sm border border-indigo-300 rounded px-2 py-1" />
                      <button onClick={e => { e.preventDefault(); e.stopPropagation(); saveRename(d); }} disabled={saving}
                        className="text-green-600 hover:text-green-700 disabled:opacity-50" title="Enregistrer">
                        <Check size={15} />
                      </button>
                      <button onClick={cancelRename} disabled={saving}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-50" title="Annuler">
                        <X size={15} />
                      </button>
                    </span>
                  ) : (
                    <span className="font-medium truncate" title={dossierName(d, label)}>{dossierName(d, label)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={e => startRename(e, d, label)} title="Renommer"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-400 hover:text-indigo-600 transition-opacity">
                    <Pencil size={14} />
                  </button>
                  {!isScan && (
                  <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteDossier(d.id, d.type); }} title="Supprimer"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-red-400 hover:text-red-600 transition-opacity">
                    <Trash2 size={14} />
                  </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs bg-${color}-100 text-${color}-700`}>{label}</span>
              </div>
            </Link>
          );
        })}
      </div>
      {splitOpen && <SplitPdfTool onClose={() => setSplitOpen(false)} />}
    </div>
  );
}
