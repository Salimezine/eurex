import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { orgApi, OrgDossier, OrgTask, OrgDocument, OrgComptable } from '../../lib/orgApi';
import { useOrgAuth } from '../../lib/orgAuth';
import { t } from '../../lib/orgI18n';
import ProgressDonut, { DonutLegend } from '../../components/ProgressDonut';
import Timeline from '../../components/Timeline';
import {
  ArrowLeft, CheckCircle2, Circle, AlertTriangle, Lock, Unlock,
  Send, FileText, MessageSquare, Clock, ChevronDown, ChevronUp,
  ExternalLink, Eye, Users, UserRound,
} from 'lucide-react';

type Tab = 'checklist' | 'documents' | 'notes' | 'timeline';

const STATUS_ICONS: Record<string, any> = {
  a_faire: Circle,
  en_cours: Clock,
  fait: CheckCircle2,
  bloque_client: AlertTriangle,
};

const STATUS_COLORS: Record<string, string> = {
  a_faire: 'text-gray-500 bg-gray-50',
  en_cours: 'text-gray-600 bg-gray-100',
  fait: 'text-emerald-600 bg-emerald-50',
  bloque_client: 'text-red-600 bg-red-50',
};

export default function OrgDossierPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state } = useOrgAuth();
  const isExpert = state.user?.role === 'expert';
  const [dossier, setDossier] = useState<OrgDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('checklist');
  const [timeline, setTimeline] = useState<any[]>([]);
  const [noteText, setNoteText] = useState('');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [closeJustification, setCloseJustification] = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showNewDossierModal, setShowNewDossierModal] = useState(false);
  const [newExercice, setNewExercice] = useState(new Date().getFullYear());
  const [timerNow, setTimerNow] = useState(Date.now());
  const [newTaskLabel, setNewTaskLabel] = useState('');
  const [showAddTask, setShowAddTask] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskLabel, setEditTaskLabel] = useState('');
  const [comptables, setComptables] = useState<OrgComptable[]>([]);

  const load = () => {
    if (!id) return;
    orgApi.getDossier(id).then(setDossier).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (isExpert) orgApi.getComptables().then(setComptables).catch(() => {});
  }, [isExpert]);

  // Live timer tick
  useEffect(() => {
    const hasActiveTimer = dossier?.tasks?.some(t => t.timer_started_at);
    if (!hasActiveTimer) return;
    const interval = setInterval(() => setTimerNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [dossier?.tasks]);

  const loadTimeline = async () => {
    if (!id) return;
    try {
      const t = await orgApi.getTimeline(id);
      setTimeline(t);
    } catch {}
  };

  useEffect(() => {
    if (tab === 'timeline' && id) loadTimeline();
  }, [tab, id]);

  const updateTaskStatus = async (taskId: string, newStatus: string, reason?: string) => {
    if (!dossier) return;
    try {
      await orgApi.updateTask(dossier.id, taskId, newStatus, reason);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const toggleDocument = async (docId: string, received: boolean, note?: string) => {
    if (!dossier) return;
    try {
      await orgApi.updateDocument(dossier.id, docId, received, note);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const addNote = async () => {
    if (!dossier || !noteText.trim()) return;
    try {
      await orgApi.addNote(dossier.id, noteText.trim());
      setNoteText('');
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const closeDossier = async (force = false) => {
    if (!dossier) return;
    try {
      await orgApi.closeDossier(dossier.id, force, force ? closeJustification : undefined);
      setShowCloseModal(false);
      setCloseJustification('');
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const openNextExercice = async () => {
    if (!dossier) return;
    try {
      await orgApi.createDossier(dossier.client_id, newExercice);
      setShowNewDossierModal(false);
      navigate('/cabinet');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const startTimer = async (taskId: string) => {
    if (!dossier) return;
    try {
      await orgApi.startTimer(dossier.id, taskId);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const stopTimer = async (taskId: string) => {
    if (!dossier) return;
    try {
      await orgApi.stopTimer(dossier.id, taskId);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || seconds <= 0) return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const getLiveElapsed = (startedAt: string) => {
    const start = new Date(startedAt + 'Z').getTime();
    return Math.floor((timerNow - start) / 1000);
  };

  const addTask = async () => {
    if (!dossier || !newTaskLabel.trim()) return;
    try {
      await orgApi.addTask(dossier.id, newTaskLabel.trim());
      setNewTaskLabel('');
      setShowAddTask(false);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const renameTask = async (taskId: string) => {
    if (!dossier || !editTaskLabel.trim()) return;
    try {
      await orgApi.renameTask(dossier.id, taskId, editTaskLabel.trim());
      setEditingTaskId(null);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const assignTask = async (taskId: string, comptableId: string | null) => {
    if (!dossier) return;
    try {
      await orgApi.assignTask(dossier.id, taskId, comptableId);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const deleteTask = async (taskId: string, label: string) => {
    if (!dossier) return;
    if (!confirm(`Supprimer la tâche "${label}" ? Cette action est irréversible.`)) return;
    try {
      await orgApi.deleteTask(dossier.id, taskId);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="animate-spin w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!dossier) return (
    <div className="text-center py-12 text-gray-400">Dossier non trouvé</div>
  );

  const ts = dossier.task_stats;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/cabinet')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-800">{dossier.client_name}</h2>
          <p className="text-sm text-gray-500">
            Exercice {dossier.exercice} — Matricule fiscal : {dossier.matricule_fiscal || '—'}
          </p>
        </div>
        <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
          <ProgressDonut fait={ts.fait} enCours={ts.en_cours} bloqueClient={ts.bloque_client} size={128} />
          <div className="text-right">
            <span className="text-3xl font-extrabold text-gray-900 tracking-tight">{dossier.progress}%</span>
            <p className="text-xs text-gray-500 font-medium">avancement</p>
            <p className="text-[11px] text-gray-400 mt-1">
              ⏱ {formatTime(dossier.tasks?.reduce((s: number, t: any) => s + (t.total_time_seconds || 0), 0) || 0)}
            </p>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {dossier.status === 'en_cours' && (
          <>
            <button
              onClick={() => setShowCloseModal(true)}
              disabled={!dossier.can_close && !dossier.can_force_close}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                dossier.can_close
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Lock size={14} />
              {t('dossier.close')}
            </button>
            {!dossier.can_close && dossier.can_force_close && (
              <button
                onClick={() => setShowCloseModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-orange-100 text-orange-700 hover:bg-orange-200 transition-all"
              >
                <Unlock size={14} />
                Clôture forcée
              </button>
            )}
          </>
        )}
        {dossier.status === 'cloture' && (
          <button
            onClick={() => setShowNewDossierModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition-all"
          >
            {t('dossier.open_next')}
          </button>
        )}

        {/* Link to EUREX invoicing */}
        {dossier.status === 'en_cours' && (
          <a
            href={`/eurex/achats`}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-orange-50 text-orange-700 hover:bg-orange-100 transition-all"
          >
            <ExternalLink size={14} />
            Générer les écritures
          </a>
        )}
      </div>

      {/* Expert: Time by user + details */}
      {isExpert && (
        <div className="bg-white border border-purple-100 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Users size={14} className="text-purple-600" />
            Vue expert — Détails par comptable
          </h3>
          {/* Time breakdown */}
          {dossier.time_by_user && dossier.time_by_user.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {dossier.time_by_user.map((u: any, i: number) => (
                <div key={i} className="bg-gray-50 rounded-lg p-2.5">
                  <p className="text-[11px] text-gray-500">{u.user_name}</p>
                  <p className="text-sm font-bold font-mono text-gray-800">{formatTime(u.seconds)}</p>
                </div>
              ))}
            </div>
          )}
          {dossier.time_by_user?.length === 0 && (
            <p className="text-xs text-gray-400">Aucun temps enregistré</p>
          )}
        </div>
      )}

      {/* Legend */}
      <DonutLegend fait={ts.fait} enCours={ts.en_cours} bloqueClient={ts.bloque_client} />

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {([
          { key: 'checklist' as Tab, label: t('dossier.checklist'), count: ts.total },
          { key: 'documents' as Tab, label: t('dossier.documents'), count: dossier.documents.length },
          { key: 'notes' as Tab, label: t('dossier.notes'), count: dossier.notes.length },
          { key: 'timeline' as Tab, label: t('dossier.timeline') },
        ]).map(t2 => (
          <button
            key={t2.key}
            onClick={() => setTab(t2.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t2.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t2.label}
            {t2.count !== undefined && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-200 text-[10px] text-gray-600">{t2.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Checklist */}
      {tab === 'checklist' && (
        <div className="space-y-2">
          {(dossier.tasks || []).map(task => {
            const Icon = STATUS_ICONS[task.status] || Circle;
            const isExpanded = expandedTask === task.id;
            const isBlocked = task.status === 'bloque_client';

            return (
              <div key={task.id} className={`bg-white border rounded-xl overflow-hidden transition-all ${isBlocked ? 'border-red-200' : 'border-gray-200'}`}>
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors group/task"
                  onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                >
                  <Icon size={18} className={STATUS_COLORS[task.status]?.split(' ')[0] || 'text-gray-400'} />
                  {editingTaskId === task.id ? (
                    <input
                      autoFocus
                      value={editTaskLabel}
                      onChange={e => setEditTaskLabel(e.target.value)}
                      onBlur={() => renameTask(task.id)}
                      onKeyDown={e => { if (e.key === 'Enter') renameTask(task.id); if (e.key === 'Escape') setEditingTaskId(null); }}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 text-sm font-medium border border-purple-300 rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  ) : (
                    <span className={`flex-1 text-sm font-medium ${task.status === 'fait' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                      {task.label}
                    </span>
                  )}
                  {task.total_time_seconds > 0 && (
                    <span className="text-[11px] text-gray-400 font-mono">
                      {formatTime(task.total_time_seconds)}
                    </span>
                  )}
                  {task.assigned_comptable_name && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full font-medium">
                      <UserRound size={10} />
                      {task.assigned_comptable_name}
                    </span>
                  )}
                  {isExpert && task.updated_by_name && (
                    <span className="text-[10px] text-purple-500 bg-purple-50 px-1.5 py-0.5 rounded-full">
                      {task.updated_by_name}
                    </span>
                  )}
                  {isBlocked && (
                    <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-medium">
                      {task.blocked_reason || t('status.bloque_client')}
                    </span>
                  )}
                  {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-gray-100">
                    {/* Timer section */}
                    <div className="flex items-center gap-3 mb-3 p-2 bg-gray-50 rounded-lg">
                      {task.timer_started_at ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-xs text-gray-500">En cours depuis</span>
                            <span className="text-sm font-mono font-bold text-red-600">
                              {formatTime(getLiveElapsed(task.timer_started_at))}
                            </span>
                          </div>
                          <button
                            onClick={() => stopTimer(task.id)}
                            className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-all"
                          >
                            ⏹ Arrêter
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-gray-400">
                            {task.total_time_seconds > 0 ? (
                              <>⏱ Temps total: <strong className="text-gray-600">{formatTime(task.total_time_seconds)}</strong></>
                            ) : (
                              '⏱ Pas encore chronométré'
                            )}
                          </span>
                          <button
                            onClick={() => startTimer(task.id)}
                            disabled={task.status === 'fait'}
                            className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                          >
                            ▶ Commencer
                          </button>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {/* Edit label button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingTaskId(task.id); setEditTaskLabel(task.label); }}
                        className="px-3 py-1.5 rounded-lg text-xs bg-purple-100 text-purple-700 hover:bg-purple-200"
                      >
                        ✏️ Renommer
                      </button>
                      {isExpert && (
                        <label className="flex items-center gap-1.5 text-xs text-gray-600" onClick={e => e.stopPropagation()}>
                          <UserRound size={12} className="text-emerald-600" />
                          <select
                            value={task.assigned_comptable_id || ''}
                            onChange={e => assignTask(task.id, e.target.value || null)}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-purple-500 outline-none max-w-[150px]"
                          >
                            <option value="">Aucun comptable</option>
                            {comptables.filter(c => c.is_active).map(c => (
                              <option key={c.id} value={c.id}>{c.full_name}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      {/* Delete button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteTask(task.id, task.label); }}
                        disabled={!!task.timer_started_at}
                        className="px-3 py-1.5 rounded-lg text-xs bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
                      >
                        🗑️ Supprimer
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {task.status !== 'a_faire' && task.status !== 'fait' && (
                        <button onClick={() => updateTaskStatus(task.id, 'a_faire')} className="px-3 py-1.5 rounded-lg text-xs bg-gray-100 text-gray-600 hover:bg-gray-200">
                          {t('status.a_faire')}
                        </button>
                      )}
                      {task.status !== 'en_cours' && task.status !== 'fait' && (
                        <button onClick={() => updateTaskStatus(task.id, 'en_cours')} className="px-3 py-1.5 rounded-lg text-xs bg-gray-200 text-gray-700 hover:bg-gray-300">
                          {t('status.en_cours_task')}
                        </button>
                      )}
                      {task.status !== 'fait' && (
                        <button onClick={() => updateTaskStatus(task.id, 'fait')} className="px-3 py-1.5 rounded-lg text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                          {t('status.fait')}
                        </button>
                      )}
                      {task.status !== 'bloque_client' && task.status !== 'fait' && (
                        <button
                          onClick={() => {
                            const reason = prompt('Raison du blocage :');
                            if (reason) updateTaskStatus(task.id, 'bloque_client', reason);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs bg-red-100 text-red-700 hover:bg-red-200"
                        >
                          {t('status.bloque_client')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {/* Add task form */}
          {dossier.status === 'en_cours' && (
            <div className="mt-2">
              {showAddTask ? (
                <div className="bg-white border border-purple-200 rounded-xl p-3 flex items-center gap-2">
                  <input
                    autoFocus
                    value={newTaskLabel}
                    onChange={e => setNewTaskLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newTaskLabel.trim()) addTask(); if (e.key === 'Escape') { setShowAddTask(false); setNewTaskLabel(''); } }}
                    placeholder="Libellé de la nouvelle tâche..."
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  />
                  <button
                    onClick={addTask}
                    disabled={!newTaskLabel.trim()}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-all"
                  >
                    Ajouter
                  </button>
                  <button
                    onClick={() => { setShowAddTask(false); setNewTaskLabel(''); }}
                    className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-600 hover:bg-gray-200"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddTask(true)}
                  className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-purple-400 hover:text-purple-600 transition-all"
                >
                  + Ajouter une tâche
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab: Documents */}
      {tab === 'documents' && (
        <div className="space-y-2">
          {dossier.documents.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">Aucun document attendu</p>
          )}
          {dossier.documents.map(doc => (
            <div key={doc.id} className={`bg-white border rounded-xl p-3 flex items-center gap-3 ${
              doc.received ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200'
            }`}>
              <FileText size={18} className={doc.received ? 'text-emerald-500' : 'text-gray-400'} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${doc.received ? 'text-gray-500' : 'text-gray-800'}`}>
                  {doc.label}
                </p>
                {doc.received_at && (
                  <p className="text-[11px] text-gray-400">
                    Reçu le {new Date(doc.received_at).toLocaleDateString('fr-FR')}
                    {doc.received_note && ` — ${doc.received_note}`}
                  </p>
                )}
              </div>
              {doc.received ? (
                <button
                  onClick={() => toggleDocument(doc.id, false)}
                  className="px-3 py-1.5 rounded-lg text-xs bg-gray-100 text-gray-500 hover:bg-gray-200"
                >
                  Annuler
                </button>
              ) : (
                <div className="flex gap-1">
                  <button
                    onClick={() => toggleDocument(doc.id, true)}
                    className="px-3 py-1.5 rounded-lg text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                  >
                    {t('dossier.mark_received')}
                  </button>
                  <button
                    onClick={() => {
                      const note = prompt(t('dossier.manual_received'));
                      if (note !== null) toggleDocument(doc.id, true, note || undefined);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs bg-blue-100 text-blue-700 hover:bg-blue-200"
                    title="Reçu par WhatsApp/email"
                  >
                    📱
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tab: Notes */}
      {tab === 'notes' && (
        <div className="space-y-3">
          {/* Add note */}
          <div className="bg-white border border-gray-200 rounded-xl p-3">
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder={t('dossier.add_note')}
              rows={2}
              className="w-full border border-gray-200 rounded-lg p-2.5 text-sm resize-none focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={addNote}
                disabled={!noteText.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-all"
              >
                <Send size={12} />
                Envoyer
              </button>
            </div>
          </div>

          {/* Notes list */}
          {dossier.notes.map(note => (
            <div key={note.id} className="bg-white border border-gray-200 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare size={14} className="text-purple-500" />
                <span className="text-xs font-semibold text-gray-700">{note.user_name}</span>
                <span className="text-[11px] text-gray-400">
                  {new Date(note.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Timeline */}
      {tab === 'timeline' && (
        <Timeline events={timeline} />
      )}

      {/* Close Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="font-bold text-gray-800 mb-3">
              {dossier.can_close ? t('dossier.close') : 'Clôture forcée'}
            </h3>
            {!dossier.can_close && (
              <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <p className="text-sm text-orange-700 font-medium mb-1">Tâches non terminées :</p>
                <ul className="text-xs text-orange-600 space-y-0.5">
                  {dossier.block_reasons.map((r, i) => <li key={i}>• {r}</li>)}
                </ul>
              </div>
            )}
            {(!dossier.can_close || dossier.can_force_close) && (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-700 mb-1">Justification (obligatoire pour clôture forcée)</label>
                <textarea
                  value={closeJustification}
                  onChange={e => setCloseJustification(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg p-2.5 text-sm resize-none focus:ring-2 focus:ring-purple-500 outline-none"
                  placeholder="Expliquez la raison de la clôture..."
                />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowCloseModal(false); setCloseJustification(''); }} className="px-4 py-2 rounded-lg text-sm bg-gray-100 text-gray-600 hover:bg-gray-200">
                Annuler
              </button>
              <button
                onClick={() => closeDossier(!dossier.can_close)}
                disabled={!dossier.can_close && !closeJustification.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Dossier Modal */}
      {showNewDossierModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-gray-800 mb-3">{t('dossier.open_next')}</h3>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Exercice</label>
            <input
              type="number"
              value={newExercice}
              onChange={e => setNewExercice(parseInt(e.target.value) || new Date().getFullYear())}
              className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
            />
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowNewDossierModal(false)} className="px-4 py-2 rounded-lg text-sm bg-gray-100 text-gray-600">
                Annuler
              </button>
              <button onClick={openNextExercice} className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700">
                Créer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
