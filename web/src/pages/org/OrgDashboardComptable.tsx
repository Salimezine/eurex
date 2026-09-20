import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { orgApi, OrgClient } from '../../lib/orgApi';
import { t } from '../../lib/orgI18n';
import ProgressDonut, { DonutLegend } from '../../components/ProgressDonut';
import { FolderOpen, AlertTriangle, Clock, ArrowUpDown, Search } from 'lucide-react';

type SortKey = 'name' | 'progress' | 'blocked';

export default function OrgDashboardComptable() {
  const [clients, setClients] = useState<OrgClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('blocked');
  const [search, setSearch] = useState('');

  useEffect(() => {
    orgApi.getClients().then(setClients).catch(console.error).finally(() => setLoading(false));
  }, []);

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
        <span className="text-sm text-gray-500">{clients.length} client{clients.length > 1 ? 's' : ''}</span>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(client => {
          const hasBlocked = client.task_stats.bloque_client > 0;
          const hasMissingDocs = client.doc_stats.total > client.doc_stats.received;
          const d = client.dossier_actuel;

          return (
            <Link
              key={client.id}
              to={`/cabinet/dossier/${d?.id || ''}`}
              className={`bg-white border rounded-xl p-4 transition-all hover:shadow-md group relative ${
                hasBlocked ? 'border-red-200 bg-red-50/30' : 'border-gray-200'
              }`}
            >
              {/* Badges */}
              {hasBlocked && (
                <span className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">
                  <AlertTriangle size={12} />
                  {t('dash.blocked')}
                </span>
              )}
              {hasMissingDocs && !hasBlocked && (
                <span className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-orange-400" title="Documents manquants" />
              )}

              {/* Header */}
              <div className="flex items-start gap-3 mb-3">
                <ProgressDonut
                  fait={client.task_stats.fait}
                  enCours={client.task_stats.en_cours}
                  bloqueClient={client.task_stats.bloque_client}
                  size={56}
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-800 text-sm truncate">{client.name}</h3>
                  {client.matricule_fiscal && (
                    <p className="text-[11px] text-gray-400">{client.matricule_fiscal}</p>
                  )}
                  {d && (
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Exercice {d.exercice} — {t(`status.${d.status}`)}
                    </p>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  {client.task_stats.total - client.task_stats.fait} {t('dash.tasks_remaining')}
                </span>
                {client.task_stats.bloque_client > 0 && (
                  <span className="text-red-600 font-medium">
                    {client.task_stats.bloque_client} bloqué{client.task_stats.bloque_client > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Legend */}
              <DonutLegend
                fait={client.task_stats.fait}
                enCours={client.task_stats.en_cours}
                bloqueClient={client.task_stats.bloque_client}
                className="mt-2"
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
    </div>
  );
}
