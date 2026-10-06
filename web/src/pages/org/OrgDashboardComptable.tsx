import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { orgApi, OrgClient, OrgMyGrant, OrgMyHours } from '../../lib/orgApi';
import { t } from '../../lib/orgI18n';
import ProgressDonut, { DonutLegend } from '../../components/ProgressDonut';
import Skeleton, { SkeletonCardGrid } from '../../components/Skeleton';
import OrgAccountButton from '../../components/OrgAccount';
import OrgAlerts from '../../components/OrgAlerts';
import { EXPORT_LABELS } from '../../lib/orgAlerts';
import { FolderOpen, AlertTriangle, Clock, ArrowUpDown, Search } from 'lucide-react';

type SortKey = 'name' | 'progress' | 'blocked';

const DAY_LABELS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

export default function OrgDashboardComptable() {
  const [clients, setClients] = useState<OrgClient[]>([]);
  const [myGrants, setMyGrants] = useState<OrgMyGrant[]>([]);
  const [hours, setHours] = useState<OrgMyHours | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('blocked');
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([orgApi.getClients(), orgApi.getMyGrants(), orgApi.getMyHours()])
      .then(([cs, gs, h]) => { setClients(cs); setMyGrants(gs); setHours(h); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Heures en direct : le chrono en cours s'ajoute au jour courant (rafraichit toutes les 15s)
  useEffect(() => {
    const iv = setInterval(() => { orgApi.getMyHours().then(setHours).catch(() => {}); }, 15000);
    return () => clearInterval(iv);
  }, []);

  const fmtHm = (sec?: number) => {
    const s = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  };

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

      {/* Mes heures — realises vs norme 8h30 (lun-ven), repos sam-dim */}
      {hours && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4" data-testid="mes-heures">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
            ⏱ Mes heures
            <span className="text-gray-400 font-normal">— norme 8h30 du lundi au vendredi · repos sam-dim</span>
          </h3>

          {/* Aujourd'hui */}
          <div className="flex items-center justify-between flex-wrap gap-2 text-sm">
            <span className="text-gray-500">
              Aujourd'hui ({DAY_LABELS[hours.today.dow]} {hours.today.date.slice(8, 10)}/{hours.today.date.slice(5, 7)}) :{' '}
              <b className="text-gray-800">
                {fmtHm(hours.today.worked_seconds)} / {hours.today.rest ? 'Repos' : '8h30'}
              </b>
              {hours.today.overtime_seconds > 0 && (
                <span className="text-green-600 font-semibold ml-1">· +{fmtHm(hours.today.overtime_seconds)}</span>
              )}
            </span>
            <span className="text-xs text-gray-500">
              Semaine (7 jours) : <b className="text-gray-700">{fmtHm(hours.totals.worked_seconds)} / {fmtHm(hours.totals.norm_seconds)}</b>
              {hours.totals.net_missing_seconds > 0
                ? <span className="text-rose-500 font-semibold"> · manque {fmtHm(hours.totals.net_missing_seconds)} (solde net)</span>
                : hours.totals.surplus_seconds > 0
                  ? <span className="text-green-600 font-semibold"> · +{fmtHm(hours.totals.surplus_seconds)} au-delà de la norme</span>
                  : <span className="text-green-600 font-semibold"> · à jour</span>}
            </span>
          </div>

          {/* Barre du jour */}
          <div className="h-2 bg-gray-100 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${hours.today.rest ? 100 : Math.min(100, Math.round((hours.today.worked_seconds / (hours.today.norm_seconds || 1)) * 100))}%`,
                background: hours.today.rest ? '#e5e7eb'
                  : hours.today.worked_seconds >= hours.today.norm_seconds ? '#22c55e'
                  : hours.today.worked_seconds >= hours.today.norm_seconds / 2 ? '#f59e0b'
                  : '#f43f5e',
              }}
            />
          </div>

          {/* Detail par jour */}
          <table className="w-full text-xs mt-3" data-testid="heures-table">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-100">
                <th className="py-1.5 font-medium">Jour</th>
                <th className="py-1.5 font-medium text-right">Réalisé</th>
                <th className="py-1.5 font-medium text-right">Norme</th>
                <th className="py-1.5 font-medium text-right">Écart norme</th>
              </tr>
            </thead>
            <tbody>
              {hours.days.map(d => (
                <tr key={d.date} className={`border-b border-gray-50 ${d.is_today ? 'bg-purple-50/50 font-semibold' : ''}`}>
                  <td className="py-1.5 text-gray-600">
                    {DAY_LABELS[d.dow]} {d.date.slice(8, 10)}/{d.date.slice(5, 7)}
                    {d.is_today && <span className="text-purple-500 ml-1">· aujourd'hui</span>}
                  </td>
                  <td className="py-1.5 text-right text-gray-700">{fmtHm(d.worked_seconds)}</td>
                  <td className="py-1.5 text-right">
                    {d.rest ? <span className="text-gray-400 italic">Repos</span> : <span className="text-gray-600">8h30</span>}
                  </td>
                  <td className="py-1.5 text-right">
                    {d.overtime_seconds > 0 ? <span className="text-green-600 font-semibold">+{fmtHm(d.overtime_seconds)}</span>
                      : d.rest ? <span className="text-gray-300">—</span>
                      : d.missing_seconds > 0 ? <span className="text-rose-500 font-semibold">{fmtHm(d.missing_seconds)}</span>
                      : <span className="text-green-600 font-semibold">✓ atteint</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
