import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { FolderOpen, Trash2 } from 'lucide-react';

export default function Home() {
  const [dossiers, setDossiers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const d = await api.dashboard();
      const animals = (d.recentDossiers || []).map((dd: any) => ({ ...dd, type: 'animal' }));
      const bauds = (d.baudDossiers || []).map((dd: any) => ({ ...dd, type: 'baud' }));
      const scans = (d.scanDossiers || []).map((dd: any) => ({ ...dd, type: 'scanflash' }));
      setDossiers([...animals, ...bauds, ...scans]);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const deleteDossier = async (id: string, type: string) => {
    if (!confirm('Supprimer ce dossier ?')) return;
    if (type === 'baud') {
      // BAUD delete not implemented yet
    } else if (type === 'scanflash') {
      await api.scan.deleteDossier(id);
    } else {
      await api.deleteDossier(id);
    }
    setDossiers(dossiers.filter(d => d.id !== id));
  };

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-4 mt-4">
      <h2 className="text-xl font-semibold">Dossiers</h2>

      {dossiers.length === 0 && (
        <div className="bg-white border rounded-lg p-8 text-center text-gray-400 text-sm">
          Aucun dossier.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {dossiers.map((d: any) => {
          const isBaud = d.type === 'baud';
          const isScan = d.type === 'scanflash';
          const link = isBaud ? `/baud/dossier/${d.id}` : isScan ? `/scanflash/dossier/${d.id}` : `/dossier/${d.id}`;
          const color = isBaud ? 'purple' : isScan ? 'emerald' : 'blue';
          return (
            <Link key={d.id} to={link}
              className={`bg-white border rounded-lg p-4 hover:shadow-md transition-all group`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FolderOpen size={20} className={`text-${color}-500`} />
                  <span className="font-medium">{d.nom || d.fichier_navette_nom || 'Dossier'}</span>
                </div>
                {!isScan && (
                <button onClick={(e) => { e.preventDefault(); deleteDossier(d.id, d.type); }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">
                  <Trash2 size={14} />
                </button>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
