import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { orgApi, OrgComptable, OrgDossier, OrgClient } from '../../lib/orgApi';
import { t } from '../../lib/orgI18n';
import ProgressDonut, { DonutLegend } from '../../components/ProgressDonut';
import { Users, BarChart3, AlertTriangle, Search, Filter } from 'lucide-react';

type Tab = 'comptables' | 'global';

export default function OrgDashboardExpert() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('comptables');
  const [comptables, setComptables] = useState<OrgComptable[]>([]);
  const [allDossiers, setAllDossiers] = useState<any[]>([]);
  const [allClients, setAllClients] = useState<OrgClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterComptable, setFilterComptable] = useState<string>('all');

  useEffect(() => {
    Promise.all([
      orgApi.getComptables(),
      orgApi.getAllDossiers(),
      orgApi.getClients(),
    ]).then(([c, d, cl]) => {
      setComptables(c);
      setAllDossiers(d);
      setAllClients(cl);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  // KPIs
  const totalDossiers = allDossiers.length;
  const activeDossiers = allDossiers.filter(d => d.status === 'en_cours').length;
  const avgProgress = totalDossiers > 0
    ? Math.round(allDossiers.reduce((s, d) => s + (d.progress || 0), 0) / totalDossiers * 10) / 10
    : 0;
  const blockedCount = allDossiers.filter(d => d.task_stats?.bloque_client > 0).length; // used for table badge

  const filteredDossiers = allDossiers
    .filter(d => filterComptable === 'all' || d.comptable_id === filterComptable)
    .filter(d => !search || d.client_name?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="animate-spin w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Dossiers actifs', value: activeDossiers, icon: '📁', color: 'blue' },
          { label: 'Avancement moyen', value: `${avgProgress}%`, icon: '📊', color: 'emerald' },
          { label: 'En cours', value: activeDossiers, icon: '🔴', color: 'red' },
          { label: 'Comptables', value: comptables.length, icon: '👥', color: 'purple' },
        ].map((kpi, i) => {
          const bgMap: Record<string, string> = {
            blue: 'bg-blue-50 border-blue-200',
            emerald: 'bg-emerald-50 border-emerald-200',
            red: 'bg-red-50 border-red-200',
            purple: 'bg-purple-50 border-purple-200',
          };
          const valMap: Record<string, string> = {
            blue: 'text-blue-700',
            emerald: 'text-emerald-700',
            red: 'text-red-700',
            purple: 'text-purple-700',
          };
          return (
            <div key={i} className={`${bgMap[kpi.color] || 'bg-white border-gray-200'} border rounded-xl p-4`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{kpi.icon}</span>
                <span className="text-xs text-gray-500">{kpi.label}</span>
              </div>
              <p className={`text-2xl font-bold ${valMap[kpi.color] || 'text-gray-800'}`}>{kpi.value}</p>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { key: 'comptables' as Tab, label: t('dash.by_comptable'), icon: <Users size={14} /> },
          { key: 'global' as Tab, label: t('dash.global_view'), icon: <BarChart3 size={14} /> },
        ]).map(t2 => (
          <button
            key={t2.key}
            onClick={() => setTab(t2.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t2.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t2.icon} {t2.label}
          </button>
        ))}
      </div>

      {/* Tab: Comptables */}
      {tab === 'comptables' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {comptables.map(c => (
            <div key={c.id} onClick={() => navigate(`/cabinet/comptable/${c.id}`)} className={`bg-white border rounded-xl p-5 cursor-pointer hover:shadow-md transition-all ${c.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start gap-4">
                <ProgressDonut
                  fait={c.task_stats.fait}
                  enCours={c.task_stats.en_cours}
                  bloqueClient={c.task_stats.bloque_client}
                  size={72}
                />
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800">{c.full_name}</h3>
                  <p className="text-xs text-gray-500">{c.email}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                    <span>{c.client_count} client{c.client_count > 1 ? 's' : ''}</span>
                    <span>•</span>
                    <span>{t('expert.avg_progress')} : {c.avg_progress}%</span>
                    {c.task_stats.bloque_client > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-red-600 font-medium">{c.task_stats.bloque_client} bloqué{c.task_stats.bloque_client > 1 ? 's' : ''}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <DonutLegend
                fait={c.task_stats.fait}
                enCours={c.task_stats.en_cours}
                bloqueClient={c.task_stats.bloque_client}
                className="mt-3 pt-3 border-t border-gray-100"
              />
            </div>
          ))}
        </div>
      )}

      {/* Tab: Global view */}
      {tab === 'global' && (
        <div className="space-y-3">
          {/* Filters */}
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
            <select
              value={filterComptable}
              onChange={e => setFilterComptable(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 outline-none"
            >
              <option value="all">Tous les comptables</option>
              {comptables.map(c => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
          </div>

          {/* Dossier list */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Client</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Exercice</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Comptable</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Avancement</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Statut</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Bloqué</th>
                </tr>
              </thead>
              <tbody>
                {filteredDossiers.map(d => (
                  <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/cabinet/dossier/${d.id}`} className="font-medium text-purple-700 hover:underline">
                        {d.client_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{d.exercice}</td>
                    <td className="px-4 py-3 text-gray-500">{d.comptable_name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-20 bg-gray-200 rounded-full h-2">
                          <div
                            className="h-2 rounded-full transition-all"
                            style={{
                              width: `${d.progress || 0}%`,
                              background: d.progress >= 80 ? '#10b981' : d.progress >= 40 ? '#3b82f6' : '#f59e0b',
                            }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-600">{d.progress || 0}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        d.status === 'cloture' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {t(`status.${d.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {d.task_stats?.bloque_client > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">
                          <AlertTriangle size={11} />
                          {d.task_stats.bloque_client}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
