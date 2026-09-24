import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { orgApi } from '../../lib/orgApi';
import { t } from '../../lib/orgI18n';
import { useOrgAuth } from '../../lib/orgAuth';
import ProgressDonut from '../../components/ProgressDonut';
import {
  ArrowLeft, Users, Clock, FileText, MessageSquare, CheckCircle2,
  Circle, AlertTriangle, BarChart3, Activity, Timer,
} from 'lucide-react';

type Tab = 'overview' | 'dossiers' | 'tasks' | 'notes' | 'time' | 'audit';

export default function OrgComptableDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state } = useOrgAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    orgApi.getComptableDetail(id).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-center py-12 text-gray-400">Chargement...</div>;
  if (!data) return <div className="text-center py-12 text-gray-400">Comptable non trouvé</div>;

  const { comptable: c, dossiers, recent_tasks, recent_notes, time_entries, time_by_dossier, total_time_seconds, audit_log, active_timer, kpis } = data;

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h${String(m).padStart(2, '0')}min`;
    if (m > 0) return `${m}min${sec}s`;
    return `${sec}s`;
  };

  const formatDateTime = (d: string) => {
    const dt = new Date(d + 'Z');
    return dt.toLocaleDateString('fr-TN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const STATUS_COLORS: Record<string, string> = {
    fait: 'text-emerald-600 bg-emerald-50',
    en_cours: 'text-gray-600 bg-gray-100',
    a_faire: 'text-gray-500 bg-gray-50',
    bloque_client: 'text-red-600 bg-red-50',
  };
  const STATUS_ICONS: Record<string, any> = {
    fait: CheckCircle2,
    en_cours: Clock,
    a_faire: Circle,
    bloque_client: AlertTriangle,
  };

  const tabs: { key: Tab; label: string; icon: any; count?: number }[] = [
    { key: 'overview', label: t('comp.overview'), icon: BarChart3 },
    { key: 'dossiers', label: t('comp.all_dossiers'), icon: FileText, count: dossiers.length },
    { key: 'tasks', label: t('comp.recent_tasks'), icon: CheckCircle2, count: recent_tasks.length },
    { key: 'notes', label: t('comp.recent_notes'), icon: MessageSquare, count: recent_notes.length },
    { key: 'time', label: t('comp.total_time'), icon: Timer, count: time_entries.length },
    { key: 'audit', label: t('comp.audit_log'), icon: Activity, count: audit_log.length },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/cabinet')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Users size={20} className="text-purple-600" />
            {c.full_name}
          </h2>
          <p className="text-sm text-gray-500">{c.email} • Membre depuis {new Date(c.created_at).toLocaleDateString('fr-TN')}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
          {c.is_active ? 'Actif' : 'Inactif'}
        </span>
      </div>

      {/* Active timer alert */}
      {active_timer && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-3">
          <Timer size={16} className="text-red-500 animate-pulse" />
          <span className="text-sm text-red-700">
            ⏱ Chrono actif : <strong>{active_timer.task_label}</strong> — en cours depuis {formatTime(Math.floor((Date.now() - new Date(active_timer.started_at + 'Z').getTime()) / 1000))}
          </span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {[
          { label: 'Dossiers', value: kpis.total_dossiers, color: 'blue' },
          { label: 'En cours', value: kpis.en_cours, color: 'red' },
          { label: 'Avancement', value: `${kpis.avg_progress}%`, color: 'emerald' },
          { label: 'Tâches faites', value: kpis.tasks_done, color: 'purple' },
          { label: 'Notes', value: kpis.total_notes, color: 'orange' },
          { label: 'Temps total', value: formatTime(total_time_seconds), color: 'gray' },
        ].map((kpi, i) => {
          const bgMap: Record<string, string> = { blue: 'bg-blue-50 border-blue-200', red: 'bg-red-50 border-red-200', emerald: 'bg-emerald-50 border-emerald-200', purple: 'bg-purple-50 border-purple-200', orange: 'bg-orange-50 border-orange-200', gray: 'bg-gray-50 border-gray-200' };
          const valMap: Record<string, string> = { blue: 'text-blue-700', red: 'text-red-700', emerald: 'text-emerald-700', purple: 'text-purple-700', orange: 'text-orange-700', gray: 'text-gray-700' };
          return (
            <div key={i} className={`${bgMap[kpi.color]} border rounded-xl p-3 text-center`}>
              <p className="text-[11px] text-gray-500 mb-0.5">{kpi.label}</p>
              <p className={`text-lg font-bold ${valMap[kpi.color]}`}>{kpi.value}</p>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto bg-gray-100 rounded-xl p-1">
        {tabs.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              tab === key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={14} />
            {label}
            {count !== undefined && (
              <span className="bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full text-[10px]">{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Dossiers summary */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">{t('comp.all_dossiers')}</h3>
            {dossiers.length === 0 && <p className="text-xs text-gray-400">Aucun dossier assigné</p>}
            {dossiers.map((d: any) => (
              <div key={d.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer" onClick={() => navigate(`/cabinet/dossier/${d.id}`)}>
                <ProgressDonut fait={d.task_stats.fait} enCours={d.task_stats.en_cours} bloqueClient={d.task_stats.bloque_client} size={96} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{d.client_name}</p>
                  <p className="text-[11px] text-gray-400">Exercice {d.exercice} • {d.progress}%</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${d.status === 'en_cours' ? 'bg-blue-100 text-blue-700' : d.status === 'clos' ? 'bg-gray-100 text-gray-500' : 'bg-red-100 text-red-600'}`}>
                  {d.status === 'en_cours' ? 'En cours' : d.status === 'clos' ? 'Clos' : d.status}
                </span>
              </div>
            ))}
          </div>

          {/* Time summary */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">{t('comp.time_by_dossier')}</h3>
            {time_by_dossier.length === 0 && <p className="text-xs text-gray-400">Aucun temps enregistré</p>}
            {time_by_dossier.map((td: any, i: number) => {
              const pct = total_time_seconds > 0 ? Math.round(td.seconds / total_time_seconds * 100) : 0;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-700">{td.client_name} (ex. {td.exercice})</span>
                    <span className="font-mono text-gray-500">{formatTime(td.seconds)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-purple-500 rounded-full h-2 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recent tasks */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-700">{t('comp.recent_tasks')} (5 dernières)</h3>
            {recent_tasks.slice(0, 5).map((task: any) => {
              const Icon = STATUS_ICONS[task.status] || Circle;
              return (
                <div key={task.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                  <Icon size={14} className={STATUS_COLORS[task.status]?.split(' ')[0]} />
                  <span className="text-xs text-gray-700 flex-1 truncate">{task.label}</span>
                  <span className="text-[10px] text-gray-400">{task.client_name}</span>
                </div>
              );
            })}
          </div>

          {/* Recent notes */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-700">{t('comp.recent_notes')} (5 dernières)</h3>
            {recent_notes.slice(0, 5).map((note: any) => (
              <div key={note.id} className="p-2 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-700 line-clamp-2">{note.content}</p>
                <p className="text-[10px] text-gray-400 mt-1">{note.client_name} (ex. {note.exercice}) • {formatDateTime(note.created_at)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: All dossiers */}
      {tab === 'dossiers' && (
        <div className="space-y-2">
          {dossiers.length === 0 && <p className="text-center text-gray-400 py-8">Aucun dossier assigné</p>}
          {dossiers.map((d: any) => (
            <div key={d.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => navigate(`/cabinet/dossier/${d.id}`)}>
                <ProgressDonut fait={d.task_stats.fait} enCours={d.task_stats.en_cours} bloqueClient={d.task_stats.bloque_client} size={72} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-800">{d.client_name}</p>
                <p className="text-xs text-gray-500">Exercice {d.exercice} • Matricule {d.matricule_fiscal || '—'}</p>
                <div className="flex gap-3 mt-1 text-[11px] text-gray-500">
                  <span>✅ {d.task_stats.fait}/{d.task_stats.total}</span>
                  <span>🔄 {d.task_stats.en_cours}</span>
                  {d.task_stats.bloque_client > 0 && <span className="text-red-500">🔴 {d.task_stats.bloque_client}</span>}
                  {d.total_time_seconds > 0 && <span className="font-mono">⏱ {formatTime(d.total_time_seconds)}</span>}
                </div>
              </div>
              <span className="text-lg font-bold text-gray-700">{d.progress}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Recent tasks */}
      {tab === 'tasks' && (
        <div className="space-y-2">
          {recent_tasks.length === 0 && <p className="text-center text-gray-400 py-8">Aucune tâche modifiée</p>}
          {recent_tasks.map((task: any) => {
            const Icon = STATUS_ICONS[task.status] || Circle;
            return (
              <div key={task.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/cabinet/dossier/${task.dossier_id}`)}>
                <Icon size={18} className={STATUS_COLORS[task.status]?.split(' ')[0]} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{task.label}</p>
                  <p className="text-[11px] text-gray-400">{task.client_name} (ex. {task.exercice})</p>
                </div>
                {task.total_time_seconds > 0 && (
                  <span className="text-[11px] text-gray-400 font-mono">⏱ {formatTime(task.total_time_seconds)}</span>
                )}
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[task.status]}`}>
                  {task.status}
                </span>
                <span className="text-[10px] text-gray-400">{formatDateTime(task.updated_at)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab: Recent notes */}
      {tab === 'notes' && (
        <div className="space-y-2">
          {recent_notes.length === 0 && <p className="text-center text-gray-400 py-8">Aucune note rédigée</p>}
          {recent_notes.map((note: any) => (
            <div key={note.id} className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-sm text-gray-700">{note.content}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-gray-400">{note.client_name} (ex. {note.exercice})</span>
                <span className="text-[11px] text-gray-400">{formatDateTime(note.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Time entries */}
      {tab === 'time' && (
        <div className="space-y-2">
          {time_entries.length === 0 && <p className="text-center text-gray-400 py-8">Aucune entrée temps</p>}
          {time_entries.map((te: any) => (
            <div key={te.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3">
              <Timer size={16} className={te.stopped_at ? 'text-gray-400' : 'text-red-500 animate-pulse'} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{te.task_label}</p>
                <p className="text-[11px] text-gray-400">{te.client_name} (ex. {te.exercice})</p>
              </div>
              <span className="text-sm font-mono font-bold text-gray-700">{formatTime(te.duration_seconds || 0)}</span>
              <span className="text-[10px] text-gray-400">{formatDateTime(te.started_at)}</span>
            </div>
          ))}
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
            <span className="text-sm font-semibold text-purple-700">Temps total : {formatTime(total_time_seconds)}</span>
          </div>
        </div>
      )}

      {/* Tab: Audit log */}
      {tab === 'audit' && (
        <div className="space-y-2">
          {audit_log.length === 0 && <p className="text-center text-gray-400 py-8">Aucune activité</p>}
          {audit_log.map((log: any) => {
            const actionLabels: Record<string, string> = {
              task_status_changed: '📋 Statut tâche modifié',
              task_added: '➕ Tâche ajoutée',
              task_deleted: '🗑️ Tâche supprimée',
              task_renamed: '✏️ Tâche renommée',
              timer_started: '▶️ Chrono démarré',
              timer_stopped: '⏹️ Chrono arrêté',
              note_added: '📝 Note ajoutée',
              dossier_closed: '📁 Dossier clôturé',
              dossier_force_closed: '⚡ Clôture forcée',
              document_received: '📄 Document reçu',
            };
            let details: any;
            try { details = JSON.parse(log.details || '{}'); } catch { details = {}; }
            return (
              <div key={log.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-start gap-3">
                <div className="text-lg mt-0.5">{(actionLabels[log.action] || log.action).split(' ')[0]}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700">{(actionLabels[log.action] || log.action).split(' ').slice(1).join(' ')}</p>
                  {details.old_status && details.new_status && (
                    <p className="text-[11px] text-gray-400 mt-0.5">{details.old_status} → {details.new_status}</p>
                  )}
                  {details.label && (
                    <p className="text-[11px] text-gray-400 mt-0.5">{details.label}</p>
                  )}
                  {details.content && (
                    <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{details.content}</p>
                  )}
                </div>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDateTime(log.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
