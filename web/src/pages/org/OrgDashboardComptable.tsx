import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { orgApi, OrgClient } from '../../lib/orgApi';
import { t } from '../../lib/orgI18n';
import ProgressDonut, { DonutLegend } from '../../components/ProgressDonut';
import { FolderOpen, AlertTriangle, Clock, ArrowUpDown, Search, Plus, X } from 'lucide-react';

type SortKey = 'name' | 'progress' | 'blocked';

export default function OrgDashboardComptable() {
  const [clients, setClients] = useState<OrgClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('blocked');
  const [search, setSearch] = useState('');
  const [showNewDossier, setShowNewDossier] = useState(false);
  const [selectedClient, setSelectedClient] = useState('');
  const [newExercice, setNewExercice] = useState(new Date().getFullYear());
  const [creating, setCreating] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientMF, setNewClientMF] = useState('');

  const load = () => {
    setLoading(true);
    orgApi.getClients().then(setClients).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const createDossier = async () => {
    setCreating(true);
    try {
      let clientId = selectedClient;
      if (selectedClient === '__new__') {
        if (!newClientName.trim()) { alert('Nom du client requis'); setCreating(false); return; }
        const newClient = await orgApi.createClient({ name: newClientName.trim(), matricule_fiscal: newClientMF.trim() || undefined });
        clientId = newClient.id;
      }
      if (!clientId) return;
      await orgApi.createDossier(clientId, newExercice);
      setShowNewDossier(false);
      setSelectedClient('');
      setNewClientName('');
      setNewClientMF('');
      setNewExercice(new Date().getFullYear());
      load();
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la création');
    } finally {
      setCreating(false);
    }
  };

  const filtered = clients
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.matricule_fiscal?.includes(search))
    .sort((a, b) => {
      if (sort === 'blocked') return b.task_stats.bloque_client - a.task_stats.bloque_client || a.progress - b.progress;
      if (sort === 'progress') return a.progress - b.progress;
      return a.name.localeCompare(b.name);
    });

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="animate-spin w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">{t('dash.my_clients')}</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{clients.length} client{clients.length > 1 ? 's' : ''}</span>
          <button
            onClick={() => setShowNewDossier(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 shadow-lg shadow-purple-200 transition-all hover:shadow-purple-300 hover:-translate-y-0.5"
          >
            <Plus size={16} />
            Nouveau dossier
          </button>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un client..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
          />
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          {([
            { key: 'blocked' as SortKey, label: '⚠' },
            { key: 'progress' as SortKey, label: '%' },
            { key: 'name' as SortKey, label: 'A-Z' },
          ]).map(s => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                sort === s.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Client cards */}
      {filtered.length === 0 && (
        <div className="bg-white border rounded-xl p-8 text-center text-gray-400 text-sm">
          {t('dash.no_clients')}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map(client => {
          const hasBlocked = client.task_stats.bloque_client > 0;
          const hasMissingDocs = client.doc_stats.total > client.doc_stats.received;
          const d = client.dossier_actuel;

          return (
            <Link
              key={client.id}
              to={`/cabinet/dossier/${d?.id || ''}`}
              className={`group bg-white border rounded-2xl p-5 transition-all duration-300 hover:shadow-xl hover:shadow-purple-100/50 hover:-translate-y-1 relative overflow-hidden ${
                hasBlocked ? 'border-red-200 bg-red-50/30 hover:border-red-300' : 'border-gray-200 hover:border-purple-300'
              }`}
            >
              {/* Badges */}
              {hasBlocked && (
                <span className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold animate-pulse">
                  <AlertTriangle size={12} />
                  {t('dash.blocked')}
                </span>
              )}
              {hasMissingDocs && !hasBlocked && (
                <span className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-100 text-orange-600 text-[11px] font-medium">
                  📄 Manquant
                </span>
              )}

              {/* Header */}
              <div className="flex items-start gap-4 mb-4">
                <ProgressDonut
                  fait={client.task_stats.fait}
                  enCours={client.task_stats.en_cours}
                  bloqueClient={client.task_stats.bloque_client}
                  size={104}
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-800 text-base group-hover:text-purple-700 transition-colors truncate">{client.name}</h3>
                  {client.matricule_fiscal && (
                    <p className="text-[11px] text-gray-400 font-mono">{client.matricule_fiscal}</p>
                  )}
                  {d && (
                    <p className="text-[11px] text-gray-500 mt-1">
                      Exercice {d.exercice}{d.status === 'cloture' && <> — <span className="font-medium">{t('status.cloture')}</span></>}
                    </p>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg font-medium">
                  {client.task_stats.total - client.task_stats.fait} {t('dash.tasks_remaining')}
                </span>
                {client.task_stats.bloque_client > 0 && (
                  <span className="bg-red-100 text-red-600 px-2.5 py-1 rounded-lg font-semibold">
                    🔴 {client.task_stats.bloque_client} bloqué{client.task_stats.bloque_client > 1 ? 's' : ''} client
                  </span>
                )}
              </div>

              {/* Legend */}
              <DonutLegend
                fait={client.task_stats.fait}
                enCours={client.task_stats.en_cours}
                bloqueClient={client.task_stats.bloque_client}
                className="pt-3 border-t border-gray-100"
              />

              {/* Last activity indicator */}
              {d && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-1.5 text-[11px] text-gray-400">
                  <Clock size={12} />
                  <span>{t('dash.open_dossier')}</span>
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {/* Modal: Nouveau dossier */}
      {showNewDossier && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Plus size={20} className="text-purple-600" />
                Nouveau dossier
              </h3>
              <button onClick={() => { setShowNewDossier(false); setSelectedClient(''); setNewClientName(''); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Client</label>
                <div className="space-y-2">
                  <select
                    value={selectedClient === '__new__' ? '__new__' : selectedClient}
                    onChange={e => {
                      if (e.target.value === '__new__') {
                        setSelectedClient('__new__');
                      } else {
                        setSelectedClient(e.target.value);
                        setNewClientName('');
                      }
                    }}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                  >
                    <option value="">— Sélectionner un client existant —</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name} {c.matricule_fiscal ? `(${c.matricule_fiscal})` : ''}</option>
                    ))}
                    <option value="__new__">✨ Nouveau client...</option>
                  </select>

                  {selectedClient === '__new__' && (
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 space-y-2">
                      <input
                        autoFocus
                        value={newClientName}
                        onChange={e => setNewClientName(e.target.value)}
                        placeholder="Nom du client *"
                        className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                      />
                      <input
                        value={newClientMF}
                        onChange={e => setNewClientMF(e.target.value)}
                        placeholder="Matricule fiscal (optionnel)"
                        className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Exercice</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setNewExercice(y => y - 1)}
                    className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold transition-colors"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={newExercice}
                    onChange={e => setNewExercice(Number(e.target.value))}
                    className="flex-1 text-center border border-gray-200 rounded-xl px-4 py-2.5 text-lg font-bold text-gray-800 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  />
                  <button
                    onClick={() => setNewExercice(y => y + 1)}
                    className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={createDossier}
                disabled={(!selectedClient && !newClientName.trim()) || creating}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-200"
              >
                {creating ? 'Création...' : 'Créer le dossier'}
              </button>
              <button
                onClick={() => { setShowNewDossier(false); setSelectedClient(''); setNewClientName(''); }}
                className="px-5 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
