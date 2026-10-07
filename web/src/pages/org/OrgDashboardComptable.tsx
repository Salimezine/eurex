import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { orgApi, OrgClient, OrgMyGrant, OrgRecentTask } from '../../lib/orgApi';
import { t } from '../../lib/orgI18n';
import ProgressDonut, { DonutLegend } from '../../components/ProgressDonut';
import Skeleton, { SkeletonCardGrid } from '../../components/Skeleton';
import OrgAccountButton from '../../components/OrgAccount';
import OrgAlerts from '../../components/OrgAlerts';
import MesHeures from '../../components/MesHeures';
import { EXPORT_LABELS } from '../../lib/orgAlerts';
import { FolderOpen, AlertTriangle, Clock, ArrowUpDown, Search } from 'lucide-react';

type SortKey = 'name' | 'progress' | 'blocked';

// created_at (UTC) -> heure Tunisie (UTC+1, pas d'heure d'ete) : DD/MM a HHhMM
const fmtCreatedAt = (s: string) => {
  const d = new Date(Date.parse(String(s).replace(' ', 'T') + 'Z') + 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} a ${p(d.getUTCHours())}h${p(d.getUTCMinutes())}`;
};

const restBadge = (daysLeft: number | null) => {
  if (daysLeft === null) return { cls: 'bg-gray-100 text-gray-500', label: 'Sans echeance' };
  if (daysLeft < 0) return { cls: 'bg-red-100 text-red-700', label: `Retard +${-daysLeft} j` };
  if (daysLeft === 0) return { cls: 'bg-amber-100 text-amber-700', label: "Echeance aujourd'hui" };
  if (daysLeft === 1) return { cls: 'bg-amber-100 text-amber-700', label: 'Demain' };
  return { cls: 'bg-indigo-100 text-indigo-700', label: `J-${daysLeft}` };
};

export default function OrgDashboardComptable() {
  const [clients, setClients] = useState<OrgClient[]>([]);
  const [myGrants, setMyGrants] = useState<OrgMyGrant[]>([]);
  const [recentTasks, setRecentTasks] = useState<OrgRecentTask[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('blocked');
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([orgApi.getClients(), orgApi.getMyGrants(), orgApi.getMyRecentTasks()])
      .then(([cs, gs, rt]) => { setClients(cs); setMyGrants(gs); setRecentTasks(rt.tasks || []); setLoadError(false); })
      .catch(e => { console.error(e); setLoadError(true); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = clients
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.matricule_fiscal?.includes(search))
    .sort((a, b) => {
      if (sort === 'blocked') return b.task_stats.bloque_client - a.task_stats.bloque_client || a.progress - b.progress;
      if (sort === 'progress') return a.progress - b.progress;
      return a.name.localeCompare(b.name);
    });

  if (loading) return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-48" />
      <div className="flex gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-28" />
      </div>
      <SkeletonCardGrid count={6} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">{t('dash.my_clients')}</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{clients.length} client{clients.length > 1 ? 's' : ''}</span>
          <OrgAccountButton />
        </div>
      </div>

      {/* API indisponible : ne PAS afficher une liste vide qui ressemble a des clients/dossiers perdus */}
      {loadError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4 text-sm text-rose-700">
          <span>Chargement impossible : l'API est momentanément indisponible. Aucune donnée n'a été supprimée.</span>
          <button onClick={load} className="shrink-0 px-3 py-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors">Réessayer</button>
        </div>
      )}

      {/* Nouvelles tâches — dernières tâches ajoutées aux dossiers accessibles */}
      {recentTasks.length > 0 && (
        <div data-testid="nouvelles-taches">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-2">
            🆕 Nouvelles tâches
            <span className="text-gray-400 font-normal">— dernières tâches ajoutées à vos dossiers</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentTasks.map(rt => {
              const rest = restBadge(rt.days_left);
              return (
                <Link
                  key={rt.id}
                  to={`/cabinet/dossier/${rt.dossier_id}`}
                  data-testid="recent-task-card"
                  className="bg-white border border-indigo-200 rounded-xl p-4 hover:shadow-md hover:border-indigo-300 transition-all group"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h4 className="font-bold text-sm text-gray-800 group-hover:text-indigo-700 truncate" data-testid="recent-task-label">{rt.label}</h4>
                    <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${rest.cls}`} data-testid="recent-task-rest">{rest.label}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 truncate" data-testid="recent-task-dossier">📁 {rt.client_name} · Exercice {rt.exercice}</p>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-gray-500 flex items-center gap-1" data-testid="recent-task-created">🕒 Ajoutée le {fmtCreatedAt(rt.created_at)}</span>
                    <span className="text-gray-400">{t(`status.${rt.status}`)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Mes heures — realises vs norme 8h30 (lun-ven), repos sam-dim, solde net */}
      <MesHeures />

      {/* Échéances fiscales — alertes dates butoirs */}
      <OrgAlerts />

      {/* Dossiers en renfort (acces temporaire ouvert par l'expert) */}
      {myGrants.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-2">
            🔧 Dossiers en renfort
            <span className="text-gray-400 font-normal">— accès temporaire ouvert par l'expert</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {myGrants.map(g => (
              <Link
                key={g.id}
                to={`/cabinet/dossier/${g.dossier_id}`}
                className="bg-amber-50 border border-amber-200 rounded-xl p-4 hover:shadow-md hover:border-amber-300 transition-all group"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h4 className="font-bold text-sm text-gray-800 group-hover:text-amber-700 truncate">{g.client_name}</h4>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">🔧 Renfort</span>
                </div>
                <p className="text-[11px] text-gray-500">Exercice {g.exercice} · expire le {String(g.expires_at).slice(0, 16)}</p>
                {g.reason && <p className="text-[11px] text-gray-500 italic truncate">« {g.reason} »</p>}
              </Link>
            ))}
          </div>
        </div>
      )}

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
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {client.matricule_fiscal && (
                      <p className="text-[11px] text-gray-400 font-mono">{client.matricule_fiscal}</p>
                    )}
                    {client.export_status && (
                      <span className="text-[10px] font-semibold text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded-full" title="Statut export du client">
                        {EXPORT_LABELS[client.export_status] || client.export_status}
                      </span>
                    )}
                  </div>
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
    </div>
  );
}
