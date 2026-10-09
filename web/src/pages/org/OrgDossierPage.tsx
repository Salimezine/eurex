import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { orgApi, OrgDossier, OrgTask, OrgDocument, OrgComptable, OrgCollabCandidate } from '../../lib/orgApi';
import { useOrgAuth } from '../../lib/orgAuth';
import { t } from '../../lib/orgI18n';
import {
  monthLabel, monthShort, currentMonth, groupTasksByMonth, filterTasksByMonth,
  taskStats, MonthFilter, MonthGroup,
} from '../../lib/orgMonths';
import { groupDocsByTask, docOpenKind, docIcon, formatFileSize, DOC_ACCEPT } from '../../lib/orgDocs';
import { alertState, formatDueDate, EXPORT_LABELS } from '../../lib/orgAlerts';
import OrgAlerts from '../../components/OrgAlerts';
import ProgressDonut, { DonutLegend } from '../../components/ProgressDonut';
import Timeline from '../../components/Timeline';
import { SkeletonDossier } from '../../components/Skeleton';
import {
  ArrowLeft, CheckCircle2, Circle, AlertTriangle, Lock, Unlock,
  Send, MessageSquare, ChevronDown, ChevronUp,
  ExternalLink, Eye, Users, UserRound, CalendarDays,
} from 'lucide-react';

type Tab = 'checklist' | 'documents' | 'notes' | 'timeline' | 'year';

const STATUS_ICONS: Record<string, any> = {
  a_faire: Circle,
  en_cours: Circle,
  a_verifier: Eye,
  fait: CheckCircle2,
  bloque_client: AlertTriangle,
};

const STATUS_COLORS: Record<string, string> = {
  a_faire: 'text-gray-500 bg-gray-50',
  en_cours: 'text-gray-500 bg-gray-50',
  a_verifier: 'text-amber-600 bg-amber-50',
  fait: 'text-emerald-600 bg-emerald-50',
  bloque_client: 'text-red-600 bg-red-50',
};

export default function OrgDossierPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = useOrgAuth();
  const isExpert = state.user?.role === 'expert' || state.user?.role === 'manager';
  const [dossier, setDossier] = useState<OrgDossier | null>(null);
  const [loadError, setLoadError] = useState('');
  const [grantComp, setGrantComp] = useState('');
  const [grantDays, setGrantDays] = useState(7);
  const [grantReason, setGrantReason] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const canEditType = isExpert || (state.user?.role === 'comptable' && !!dossier && dossier.client_comptable_id === state.user.id);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('checklist');
  const [timeline, setTimeline] = useState<any[]>([]);
  const [noteText, setNoteText] = useState('');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [closeJustification, setCloseJustification] = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showNewDossierModal, setShowNewDossierModal] = useState(false);
  const [newExercice, setNewExercice] = useState(new Date().getFullYear());
  const [newDossierComp, setNewDossierComp] = useState('');
  const [timerNow, setTimerNow] = useState(Date.now());
  const [newTaskLabel, setNewTaskLabel] = useState('');
  const [showAddTask, setShowAddTask] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskLabel, setEditTaskLabel] = useState('');
  const [comptables, setComptables] = useState<OrgComptable[]>([]);
  const [monthFilter, setMonthFilter] = useState<MonthFilter>(currentMonth());
  const [showAddDocFor, setShowAddDocFor] = useState<string | null>(null);
  const [newDocLabel, setNewDocLabel] = useState('');
  const [newDocUrl, setNewDocUrl] = useState('');
  // arrivée depuis un lien direct (?task=<id>) : surligner la tâche
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileTargetTask = useRef<string | null>(null);

  const load = () => {
    if (!id) return;
    setLoadError('');
    orgApi.getDossier(id).then(setDossier).catch(e => { setLoadError(e.message || 'Erreur'); console.error(e); }).finally(() => setLoading(false));
  };

  // Renfort : ouvrir / revoquer un acces temporaire (expert/manager)
  const openGrant = async () => {
    if (!dossier || !grantComp || !grantReason.trim()) return;
    setGrantBusy(true);
    try {
      await orgApi.createGrant(dossier.id, { granted_to: grantComp, days: grantDays, reason: grantReason.trim() });
      setGrantComp(''); setGrantReason('');
      load();
    } catch (err: any) { alert(err.message); }
    finally { setGrantBusy(false); }
  };
  const revokeGrant = async (grantId: string) => {
    if (!dossier) return;
    if (!confirm('Révoquer cet accès ?')) return;
    try { await orgApi.revokeGrant(dossier.id, grantId); load(); } catch (err: any) { alert(err.message); }
  };

  // Tâche optionnelle « Reporting mensuel » : masquer (exclue des compteurs) / restaurer
  const [reportingBusy, setReportingBusy] = useState(false);
  const reportingIsHidden = !dossier?.reporting?.total || (dossier?.reporting?.hidden || 0) > 0;
  const toggleReporting = async () => {
    if (!dossier) return;
    if (reportingIsHidden) {
      if (!confirm('Restaurer la tâche « Reporting mensuel » dans ce dossier ?')) return;
    } else {
      if (!confirm('Masquer la tâche « Reporting mensuel » ? Elle sera exclue des compteurs et de la progression.')) return;
    }
    setReportingBusy(true);
    try {
      if (reportingIsHidden) await orgApi.restoreReporting(dossier.id);
      else await orgApi.hideReporting(dossier.id);
      load();
    } catch (err: any) { alert(err.message); }
    finally { setReportingBusy(false); }
  };

  // Collaboration : taguer un autre comptable sur une tache (acces auto au dossier)
  const [collabCands, setCollabCands] = useState<OrgCollabCandidate[]>([]);
  const [collabTaskId, setCollabTaskId] = useState<string | null>(null);
  const [collabUser, setCollabUser] = useState('');
  const [collabDays, setCollabDays] = useState(7);
  const [collabBusy, setCollabBusy] = useState(false);

  const openCollab = async (taskId: string) => {
    if (collabTaskId === taskId) { setCollabTaskId(null); return; }
    setCollabTaskId(taskId);
    setCollabUser('');
    setCollabDays(7);
    if (!collabCands.length) {
      try { setCollabCands(await orgApi.listCollabCandidates(id!)); } catch (err: any) { alert(err.message); setCollabTaskId(null); }
    }
  };
  const submitCollab = async (taskId: string) => {
    if (!dossier || !collabUser) return;
    setCollabBusy(true);
    try {
      await orgApi.addCollaborator(dossier.id, taskId, collabUser, collabDays);
      setCollabTaskId(null);
      load();
      try { setCollabCands(await orgApi.listCollabCandidates(dossier.id)); } catch {}
    } catch (err: any) { alert(err.message); }
    finally { setCollabBusy(false); }
  };
  const removeCollab = async (taskId: string, userId: string) => {
    if (!dossier) return;
    try {
      await orgApi.removeCollaborator(dossier.id, taskId, userId);
      load();
      try { setCollabCands(await orgApi.listCollabCandidates(dossier.id)); } catch {}
    } catch (err: any) { alert(err.message); }
  };

  useEffect(() => { load(); }, [id]);

  // Lien direct vers une tâche : /cabinet/dossier/<id>?task=<taskId>
  // et/ou vers un onglet : ?tab=documents|notes|timeline|year (depuis la recherche globale)
  // (re-exécuté aussi quand les params changent : résultat de recherche cliqué sur le même dossier)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tid = params.get('task');
    if (tid) {
      setHighlightTaskId(tid);
      setExpandedTask(tid);
      setMonthFilter('tous');
      setTab('checklist');
    } else {
      setHighlightTaskId(null);
    }
    const tb = params.get('tab');
    if (tb && ['checklist', 'documents', 'notes', 'timeline', 'year'].includes(tb)) setTab(tb as Tab);
  }, [id, location.search]);

  // Après chargement : scroll vers la tâche ciblée
  useEffect(() => {
    if (loading || !highlightTaskId) return;
    const tries = [0, 300, 800];
    tries.forEach(ms => setTimeout(() => {
      document.getElementById('task-' + highlightTaskId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, ms));
  }, [loading, dossier, highlightTaskId]);

  useEffect(() => {
    if (isExpert) orgApi.getComptables().then(cs => setComptables(cs.filter(c => c.role === 'comptable'))).catch(() => {});
  }, [isExpert]);

  // Live timer tick
  useEffect(() => {
    const hasActiveTimer = dossier?.tasks?.some(t => t.timer_started_at) || !!dossier?.running_timers?.length;
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

  const [vdH, setVdH] = useState<Record<string, string>>({});

  const updateTaskStatus = async (taskId: string, newStatus: string, reason?: string) => {
    if (!dossier) return;
    try {
      await orgApi.updateTask(dossier.id, taskId, newStatus, reason);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Delai de validation : compte a rebours (verify_due_at stocke en UTC)
  const verifyLeftSec = (due?: string | null) =>
    due ? Math.floor((Date.parse(String(due).replace(' ', 'T') + 'Z') - Date.now()) / 1000) : 0;
  const verifyLabel = (due?: string | null) => {
    if (!due) return 'Aucun délai';
    const left = verifyLeftSec(due);
    if (left < 0) {
      const m = Math.floor(-left / 60);
      return m >= 60 ? `Délai dépassé de ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `Délai dépassé de ${m} min`;
    }
    const m = Math.floor(left / 60);
    return `Reste ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  };
  const setVerifyDue = async (taskId: string) => {
    if (!dossier) return;
    const h = Number(vdH[taskId]);
    if (!h || !isFinite(h) || h < 1 || h > 720) { alert('Délai invalide (1 à 720 heures)'); return; }
    try {
      await orgApi.setTaskVerifyDue(dossier.id, taskId, h);
      setVdH(prev => { const n = { ...prev }; delete n[taskId]; return n; });
      load();
    } catch (err: any) { alert(err.message); }
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

  const addDocument = async (taskId: string | null) => {
    if (!dossier || !newDocLabel.trim()) return;
    try {
      await orgApi.addDocument(dossier.id, {
        task_id: taskId,
        label: newDocLabel.trim(),
        url: newDocUrl.trim() || null,
      });
      setNewDocLabel('');
      setNewDocUrl('');
      setShowAddDocFor(null);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const deleteDocument = async (docId: string) => {
    if (!dossier) return;
    if (!window.confirm(t('dossier.delete_doc') + ' ?')) return;
    try {
      await orgApi.deleteDocument(dossier.id, docId);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const editDocUrl = async (doc: OrgDocument) => {
    if (!dossier) return;
    const url = window.prompt(t('dossier.doc_url'), doc.url || '');
    if (url === null) return;
    const trimmed = url.trim();
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      alert('URL invalide — commencez par http:// ou https://');
      return;
    }
    try {
      await orgApi.setDocumentUrl(dossier.id, doc.id, trimmed || null);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const pickFile = (taskId: string) => {
    fileTargetTask.current = taskId;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const taskId = fileTargetTask.current;
    e.target.value = '';
    if (!files.length || !dossier) return;
    try {
      await orgApi.uploadDocument(dossier.id, taskId, files);
    } catch (err: any) {
      alert(err.message);
    }
    load();
  };

  const openDoc = async (doc: OrgDocument) => {
    if (!dossier) return;
    const kind = docOpenKind(doc);
    if (kind === 'link' && doc.url) {
      window.open(doc.url, '_blank', 'noopener');
      return;
    }
    if (kind === 'file') {
      try {
        const blob = await orgApi.fetchDocumentBlob(dossier.id, doc.id);
        const objectUrl = URL.createObjectURL(blob);
        window.open(objectUrl, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      } catch (err: any) {
        alert(err.message);
      }
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

  // Retour a la page precedente (recherche, planning, dashboard...) — sinon dashboard
  const goBack = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate('/cabinet');
  };

  const openNextExercice = async () => {
    if (!dossier) return;
    if (!newDossierComp) { alert('Comptable requis : sélectionnez le comptable du dossier'); return; }
    try {
      await orgApi.createDossier(dossier.client_id, newExercice, newDossierComp);
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

  const [timeTaskId, setTimeTaskId] = useState<string | null>(null);
  const [timeH, setTimeH] = useState('');
  const [timeM, setTimeM] = useState('');
  const [timeNote, setTimeNote] = useState('');

  const addManualTime = async (taskId: string) => {
    if (!dossier) return;
    const h = parseInt(timeH || '0', 10) || 0;
    const m = parseInt(timeM || '0', 10) || 0;
    const seconds = h * 3600 + m * 60;
    if (seconds <= 0) { alert('Indiquez une durée : heures et/ou minutes'); return; }
    if (seconds > 86400) { alert('Durée maximale : 24 h par saisie'); return; }
    try {
      await orgApi.addTaskTime(dossier.id, taskId, seconds, timeNote.trim() || undefined);
      setTimeTaskId(null);
      setTimeH('');
      setTimeM('');
      setTimeNote('');
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
    const month = typeof monthFilter === 'number' ? monthFilter : null;
    try {
      await orgApi.addTask(dossier.id, newTaskLabel.trim(), null, month);
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

  const setTaskDueValue = async (taskId: string, value: string) => {
    if (!dossier) return;
    try {
      await orgApi.setTaskDue(dossier.id, taskId, value || null);
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

  if (loading) return <SkeletonDossier />;

  if (!dossier) return loadError === 'Accès refusé' ? (
    <div className="text-center py-16">
      <div className="text-4xl mb-3">🔒</div>
      <h2 className="text-lg font-bold text-gray-800 mb-1">Accès refusé</h2>
      <p className="text-sm text-gray-500 max-w-md mx-auto">
        Ce dossier n'est pas assigné à votre compte. Demandez un renfort à l'expert/manager pour y accéder temporairement.
      </p>
      <button onClick={() => navigate('/cabinet')} className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors">
        Retour au tableau de bord
      </button>
    </div>
  ) : (
    <div className="text-center py-12 text-gray-400">Dossier non trouvé</div>
  );

  const allTasks = dossier.tasks || [];
  const docsMap = groupDocsByTask(dossier.documents || []);
  const monthChips: { key: MonthFilter; label: string; count: number }[] = [
    { key: 'tous', label: t('dossier.filter_all'), count: allTasks.length },
    { key: 'annuel', label: t('dossier.filter_annual'), count: filterTasksByMonth(allTasks, 'annuel').length },
    ...Array.from({ length: 12 }, (_, i) => ({
      key: (i + 1) as MonthFilter,
      label: monthShort(i + 1),
      count: filterTasksByMonth(allTasks, i + 1).length,
    })),
  ];
  const visibleTasks = filterTasksByMonth(allTasks, monthFilter);
  const scopeStats = taskStats(visibleTasks);
  const scopePct = scopeStats.total > 0 ? Math.round((scopeStats.fait / scopeStats.total) * 100) : 0;
  const scopeLabel = typeof monthFilter === 'number'
    ? monthLabel(monthFilter)
    : monthFilter === 'tous'
      ? t('dossier.filter_all')
      : t('dossier.filter_annual');
  const visibleGroups: MonthGroup[] = monthFilter === 'tous'
    ? groupTasksByMonth(allTasks).filter(g => g.tasks.length > 0)
    : [{ month: typeof monthFilter === 'number' ? monthFilter : null, tasks: visibleTasks, stats: taskStats(visibleTasks) }];

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={DOC_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={goBack} title="Page précédente" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-800">
            {dossier.client_name}
            {dossier.is_granted && (
              <span className="ml-2 align-middle text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700" title="Accès temporaire (renfort) ouvert par l'expert">
                🔧 Renfort
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <p className="text-sm text-gray-500">
              Exercice {dossier.exercice} — Matricule fiscal : {dossier.matricule_fiscal || '—'}
            </p>
            {canEditType ? (
              <select
                value={dossier.person_type || ''}
                onChange={async e => {
                  const personType = e.target.value || null;
                  try {
                    await orgApi.updateClient(dossier.client_id, { person_type: personType });
                    setDossier({ ...dossier, person_type: personType });
                  } catch (err: any) { alert(err.message); }
                }}
                title={t('alerts.client_type')}
                className="text-xs border border-gray-200 rounded-lg px-2 py-0.5 focus:ring-2 focus:ring-amber-500 outline-none bg-white"
              >
                <option value="">— {t('alerts.cat_none')}</option>
                <option value="morale">🏢 {t('alerts.cat_morale')}</option>
                <option value="physique">👤 {t('alerts.cat_physique')}</option>
              </select>
            ) : dossier.person_type ? (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${dossier.person_type === 'morale' ? 'text-blue-600 bg-blue-50' : 'text-pink-600 bg-pink-50'}`}>
                {dossier.person_type === 'morale' ? '🏢' : '👤'} {t(`alerts.cat_${dossier.person_type}`)}
              </span>
            ) : null}
            {canEditType ? (
              <select
                value={dossier.export_status || ''}
                onChange={async e => {
                  const exportStatus = e.target.value || null;
                  try {
                    await orgApi.updateClient(dossier.client_id, { export_status: exportStatus });
                    setDossier({ ...dossier, export_status: exportStatus });
                    load();
                  } catch (err: any) { alert(err.message); }
                }}
                title={t('alerts.client_export')}
                className="text-xs border border-cyan-200 rounded-lg px-2 py-0.5 focus:ring-2 focus:ring-cyan-500 outline-none bg-white"
              >
                <option value="">🌍 {t('alerts.export_none')}</option>
                <option value="exportatrice">{t('alerts.export_exportatrice')}</option>
                <option value="semi_exportatrice">{t('alerts.export_semi')}</option>
                <option value="non_exportatrice">{t('alerts.export_non')}</option>
              </select>
            ) : dossier.export_status ? (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-cyan-700 bg-cyan-50" title={t('alerts.client_export')}>
                {EXPORT_LABELS[dossier.export_status] || dossier.export_status}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
          <ProgressDonut
            key={String(monthFilter)}
            fait={scopeStats.fait}
            enCours={scopeStats.enCours}
            bloqueClient={scopeStats.bloque}
            size={128}
          />
          <div className="text-right">
            <span className="text-3xl font-extrabold text-gray-900 tracking-tight">{scopePct}%</span>
            <p className="text-xs text-gray-500 font-medium">avancement</p>
            <p className="text-[11px] text-purple-600 font-semibold mt-0.5">📅 {scopeLabel}</p>
            <p className="text-[11px] text-gray-400 mt-1">
              ⏱ {formatTime(dossier.tasks?.reduce((s: number, t: any) => s + (t.total_time_seconds || 0), 0) || 0)}
            </p>
          </div>
        </div>
      </div>

      {/* Renfort : ouverture d'acces temporaire (expert/manager) */}
      {isExpert && dossier.status === 'en_cours' && (
        <div className="bg-white border border-amber-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-gray-700">🔧 Renfort — accès temporaire à ce dossier</h3>
            <span className="text-[11px] text-gray-400">{(dossier.grants || []).length} accès actif{(dossier.grants || []).length > 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
            <select
              value={grantComp}
              onChange={e => setGrantComp(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
              title="Comptable bénéficiaire"
            >
              <option value="">Comptable : —</option>
              {comptables.filter(c => c.is_active && c.id !== dossier.client_comptable_id).map(c => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
            <select
              value={grantDays}
              onChange={e => setGrantDays(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
              title="Durée du renfort"
            >
              <option value={1}>1 jour</option>
              <option value={7}>7 jours</option>
              <option value={30}>30 jours</option>
              <option value={180}>6 mois</option>
              <option value={365}>1 an</option>
              <option value={0}>À vie</option>
            </select>
            <input
              type="text"
              value={grantReason}
              onChange={e => setGrantReason(e.target.value)}
              placeholder="Motif du renfort"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
              onKeyDown={e => e.key === 'Enter' && openGrant()}
            />
            <button
              onClick={openGrant}
              disabled={!grantComp || !grantReason.trim() || grantBusy}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              Ouvrir l'accès
            </button>
          </div>
          {(dossier.grants || []).length > 0 && (
            <div className="space-y-1.5">
              {dossier.grants!.map(g => (
                <div key={g.id} className="flex items-center gap-3 text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <span className="font-semibold text-gray-800">{g.granted_to_name || g.granted_to}</span>
                  <span className="text-gray-500 whitespace-nowrap">
                    {g.days === 0 ? 'Accès à vie' : `${g.days === 180 ? '6 mois' : g.days === 365 ? '1 an' : `J-${g.days}`} · expire le ${String(g.expires_at).slice(0, 16)}`}
                  </span>
                  {g.reason && <span className="text-gray-500 italic flex-1 truncate">« {g.reason} »</span>}
                  <button
                    onClick={() => revokeGrant(g.id)}
                    className="ml-auto text-red-500 hover:text-red-700 font-medium whitespace-nowrap"
                  >
                    Révoquer
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
        {isExpert && dossier.status === 'cloture' && (
          <button
            onClick={() => { setNewDossierComp(dossier?.client_comptable_id || ''); setShowNewDossierModal(true); }}
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

      {/* Échéances fiscales du dossier (alertes dates butoirs) */}
          <OrgAlerts dossierId={dossier.id} personType={dossier.person_type} exportStatus={dossier.export_status} />

      {/* Legend */}
      <DonutLegend fait={scopeStats.fait} enCours={scopeStats.enCours} bloqueClient={scopeStats.bloque} />

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {([
          { key: 'checklist' as Tab, label: t('dossier.checklist'), count: scopeStats.total },
          { key: 'year' as Tab, label: t('dossier.year'), icon: <CalendarDays size={14} /> },
          { key: 'documents' as Tab, label: t('dossier.documents'), count: dossier.documents.length },
          { key: 'notes' as Tab, label: t('dossier.notes'), count: dossier.notes.length },
          { key: 'timeline' as Tab, label: t('dossier.timeline') },
        ]).map(t2 => (
          <button
            key={t2.key}
            data-testid={`tab-${t2.key}`}
            onClick={() => setTab(t2.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t2.key ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t2.icon} {t2.label}
            {t2.count !== undefined && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-200 text-[10px] text-gray-600">{t2.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Checklist */}
      {tab === 'checklist' && (
        <div className="space-y-2">
          {/* Tâche optionnelle : Reporting mensuel (masquer / restaurer par dossier) */}
          <div className="flex justify-end">
            <button
              data-testid="reporting-toggle"
              onClick={toggleReporting}
              disabled={reportingBusy}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
                reportingIsHidden
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:border-emerald-300'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-purple-300 hover:text-purple-700'
              }`}
            >
              {reportingIsHidden ? '↩️ Restaurer « Reporting mensuel »' : '🙈 Masquer « Reporting mensuel »'}
            </button>
          </div>
          {/* Filtre par mois */}
          <div className="flex flex-wrap gap-1.5">
            {monthChips.map(chip => (
              <button
                key={String(chip.key)}
                data-testid={`month-chip-${String(chip.key)}`}
                onClick={() => setMonthFilter(chip.key)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  monthFilter === chip.key
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-purple-300'
                }`}
              >
                {chip.label}
                <span className={`ml-1 text-[10px] ${monthFilter === chip.key ? 'text-purple-200' : 'text-gray-400'}`}>
                  {chip.count}
                </span>
              </button>
            ))}
          </div>

          {visibleGroups.map(group => (
          <div key={String(group.month)} className="space-y-2">
            {monthFilter === 'tous' && (
              <div className="flex items-center gap-2 pt-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                  {group.month ? monthLabel(group.month) : t('dossier.filter_annual')}
                </h4>
                <span className="text-[10px] text-gray-400 font-mono">{group.stats.fait}/{group.stats.total}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${group.stats.total ? Math.round((group.stats.fait / group.stats.total) * 100) : 0}%` }}
                  />
                </div>
                {group.stats.bloque > 0 && (
                  <span className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full font-medium">
                    🔴 {group.stats.bloque}
                  </span>
                )}
              </div>
            )}
            {group.tasks.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4 bg-white border border-dashed border-gray-200 rounded-xl">
                {t('dossier.empty_month')}
              </p>
            ) : group.tasks.map(task => {
            const Icon = STATUS_ICONS[task.status] || Circle;
            const isExpanded = expandedTask === task.id;
            const isBlocked = task.status === 'bloque_client';
            const taskDocs = docsMap[task.id] || [];

            return (
              <div
                key={task.id}
                id={`task-${task.id}`}
                data-testid="task-row"
                className={`bg-white border rounded-xl overflow-hidden transition-all ${
                  isBlocked ? 'border-red-200' : 'border-gray-200'
                } ${highlightTaskId === task.id ? 'border-red-500 ring-2 ring-red-400 shadow-lg shadow-red-100' : ''}`}
              >
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors group/task"
                  onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                >
                  <Icon size={18} className={STATUS_COLORS[task.status]?.split(' ')[0] || 'text-gray-400'} />
                  {/* Etat de verification : fait NON verifie vs fait verifie */}
                  {task.status === 'a_verifier' && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-amber-100 text-amber-700"
                      title="Travaillée, mais pas encore vérifiée par l'expert/manager"
                      data-testid="tag-a-verifier"
                    >
                      ⏳ À vérifier
                    </span>
                  )}
                  {task.status === 'fait' && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-teal-50 text-teal-700"
                      title={task.verified_by_name ? 'Vérifiée par un expert/manager' : 'Fait — pas encore vérifié par un expert/manager'}
                      data-testid="tag-fait"
                    >
                      {task.verified_by_name ? '✅ Vérifié' : '✅ Fait'}
                    </span>
                  )}
                  {monthFilter === 'tous' && task.month && (
                    <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">
                      {monthShort(task.month)}
                    </span>
                  )}
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
                  {task.due_date && editingTaskId !== task.id && (
                    <span
                      title={`${t('alerts.due_date')} : ${formatDueDate(task.due_date)}`}
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                        alertState(task.due_date, 7) === 'overdue'
                          ? 'bg-red-100 text-red-700'
                          : alertState(task.due_date, 7) === 'soon'
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      📅 {formatDueDate(task.due_date)}
                    </span>
                  )}
                  {task.status === 'a_verifier' && task.verify_due_at && editingTaskId !== task.id && (
                    <span
                      title="Délai de validation (fixé par l'expert/manager)"
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                        verifyLeftSec(task.verify_due_at) < 0
                          ? 'bg-red-100 text-red-700 animate-pulse'
                          : verifyLeftSec(task.verify_due_at) < 3600
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      ⏳ {verifyLabel(task.verify_due_at)}
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
                  {task.done_by_name && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded-full font-medium"
                      title="Qui a travaillé cette tâche"
                      data-testid="tag-done-by"
                    >
                      <UserRound size={10} />
                      Travaillé par {task.done_by_name}
                    </span>
                  )}
                  {task.status === 'fait' && task.verified_by_name && (
                    <span
                      className="text-[10px] text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded-full font-medium"
                      title="Qui a fait la vérification"
                      data-testid="tag-verified-by"
                    >
                      ✓ Vérifié par {task.verified_by_name} ({task.verified_by_role || 'expert'})
                    </span>
                  )}
                  {isBlocked && (
                    <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-medium">
                      {task.blocked_reason || t('status.bloque_client')}
                    </span>
                  )}
                  {taskDocs.length > 0 && (
                    <span
                      title={t('dossier.documents')}
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        taskDocs.some(d => d.received) ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      📎 {taskDocs.length}
                    </span>
                  )}
                  {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-gray-100">
                    {/* Timer section : chrono par comptable (plusieurs comptables en parallele sur la meme tache) */}
                    <div className="flex items-center gap-3 mb-3 p-2 bg-gray-50 rounded-lg">
                      {(() => {
                        const running = (dossier?.running_timers || []).filter(r => r.task_id === task.id);
                        const mine = running.find(r => r.user_id === state.user?.id);
                        const others = running.filter(r => r.user_id !== state.user?.id);
                        const othersNames = others.map(o => o.user_name).join(', ');
                        if (mine) {
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                <span className="text-xs text-gray-500">Depuis</span>
                                <span className="text-sm font-mono font-bold text-red-600" data-testid="my-timer-elapsed">
                                  {formatTime(getLiveElapsed(mine.started_at))}
                                </span>
                              </div>
                              {others.length > 0 && (
                                <span className="text-[11px] text-orange-600 font-medium" data-testid="other-timers">
                                  + {othersNames} chronomètre aussi
                                </span>
                              )}
                              <button
                                data-testid="timer-stop"
                                onClick={() => stopTimer(task.id)}
                                className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-all"
                              >
                                ⏹ Arrêter
                              </button>
                            </>
                          );
                        }
                        return (
                          <>
                            <span className="text-xs text-gray-400">
                              {task.total_time_seconds > 0 ? (
                                <>⏱ Temps total: <strong className="text-gray-600">{formatTime(task.total_time_seconds)}</strong></>
                              ) : (
                                '⏱ Pas encore chronométré'
                              )}
                            </span>
                            {others.length > 0 && (
                              <span className="text-[11px] text-orange-600 font-medium" data-testid="other-timers">
                                ⏱ {othersNames} chronomètre
                              </span>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); setTimeTaskId(timeTaskId === task.id ? null : task.id); setTimeH(''); setTimeM(''); setTimeNote(''); }}
                              disabled={task.status === 'fait'}
                              title="Ajouter du temps passé manuellement"
                              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                            >
                              ➕ Temps
                            </button>
                            <button
                              data-testid="timer-start"
                              onClick={() => startTimer(task.id)}
                              disabled={task.status === 'fait'}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                            >
                              ▶ Commencer
                            </button>
                          </>
                        );
                      })()}
                    </div>

                    {/* Collaboration : taguer un autre comptable sur cette tache */}
                    <div className="flex flex-wrap items-center gap-2 mb-3 p-2 bg-indigo-50/60 border border-indigo-100 rounded-lg" onClick={e => e.stopPropagation()}>
                      <span className="text-xs font-semibold text-indigo-700">👥 Collaboration</span>
                      {(task.collaborators || []).map(c => (
                        <span
                          key={c.user_id}
                          data-testid="task-collab"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[11px] font-medium"
                        >
                          {c.full_name}
                          <button
                            onClick={() => removeCollab(task.id, c.user_id)}
                            title="Retirer le collaborateur"
                            data-testid="task-collab-remove"
                            className="text-indigo-400 hover:text-indigo-700 font-bold leading-none"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      {collabTaskId !== task.id && (
                        <button
                          onClick={() => openCollab(task.id)}
                          data-testid="task-collab-add"
                          className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-all"
                        >
                          + Taguer un comptable
                        </button>
                      )}
                      {collabTaskId === task.id && (
                        <div className="flex flex-wrap items-center gap-1.5 w-full">
                          <select
                            value={collabUser}
                            onChange={e => setCollabUser(e.target.value)}
                            data-testid="task-collab-select"
                            className="border border-indigo-200 rounded-lg px-2 py-1 text-xs bg-white focus:ring-2 focus:ring-indigo-500 outline-none max-w-[190px]"
                          >
                            <option value="">Choisir un comptable…</option>
                            {collabCands.map(c => (
                              <option key={c.id} value={c.id}>{c.full_name}{c.has_access ? ' (accès)' : ''}</option>
                            ))}
                          </select>
                          <select
                            value={collabDays}
                            onChange={e => setCollabDays(Number(e.target.value))}
                            data-testid="task-collab-days"
                            className="border border-indigo-200 rounded-lg px-2 py-1 text-xs bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                          >
                            <option value={1}>1 jour</option>
                            <option value={7}>7 jours</option>
                            <option value={30}>30 jours</option>
                            <option value={180}>6 mois</option>
                            <option value={365}>1 an</option>
                            <option value={0}>À vie</option>
                          </select>
                          <button
                            onClick={() => submitCollab(task.id)}
                            disabled={!collabUser || collabBusy}
                            data-testid="task-collab-confirm"
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                          >
                            {collabBusy ? '…' : '✓ Taguer'}
                          </button>
                          <button
                            onClick={() => setCollabTaskId(null)}
                            className="px-2 py-1 rounded-lg text-xs text-gray-500 hover:text-gray-700 hover:bg-indigo-100 transition-all"
                          >
                            ✕
                          </button>
                          <span className="text-[10px] text-indigo-500 w-full">
                            Le comptable reçoit un accès temporaire au dossier et chronomètre sa part des heures.
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Validation : delai + fixation par l'expert/manager */}
                    {task.status === 'a_verifier' && (
                      <div className="flex items-center gap-2 mb-3 p-2 bg-amber-50 border border-amber-200 rounded-lg" onClick={e => e.stopPropagation()}>
                        <span className="text-xs font-semibold text-amber-800">Validation :</span>
                        <span className={`text-xs font-bold ${verifyLeftSec(task.verify_due_at) < 0 ? 'text-red-600' : verifyLeftSec(task.verify_due_at) < 3600 ? 'text-orange-600' : 'text-amber-700'}`}>
                          {verifyLabel(task.verify_due_at)}
                        </span>
                        {isExpert && (
                          <>
                            <input
                              type="number"
                              min={1}
                              max={720}
                              placeholder="h"
                              value={vdH[task.id] || ''}
                              onChange={e => setVdH(prev => ({ ...prev, [task.id]: e.target.value }))}
                              className="w-16 px-2 py-1 text-xs border border-amber-300 rounded outline-none focus:ring-2 focus:ring-amber-400"
                            />
                            <button
                              onClick={() => setVerifyDue(task.id)}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-all"
                            >
                              Fixer le délai
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {timeTaskId === task.id && (
                      <div
                        className="flex items-center gap-2 mb-3 p-2 bg-purple-50 border border-purple-200 rounded-lg"
                        onClick={e => e.stopPropagation()}
                      >
                        <span className="text-xs font-medium text-purple-700">Temps passé :</span>
                        <input
                          value={timeH}
                          onChange={e => setTimeH(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="hh"
                          maxLength={2}
                          autoFocus
                          className="w-12 text-center border border-purple-200 rounded-lg px-2 py-1 text-sm font-mono focus:ring-2 focus:ring-purple-500 outline-none bg-white"
                        />
                        <span className="text-xs text-purple-600 font-semibold">h</span>
                        <input
                          value={timeM}
                          onChange={e => setTimeM(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="mm"
                          maxLength={2}
                          className="w-12 text-center border border-purple-200 rounded-lg px-2 py-1 text-sm font-mono focus:ring-2 focus:ring-purple-500 outline-none bg-white"
                        />
                        <span className="text-xs text-purple-600 font-semibold">m</span>
                        <input
                          value={timeNote}
                          onChange={e => setTimeNote(e.target.value)}
                          placeholder="Note : sur quoi porte ce temps ?"
                          maxLength={200}
                          className="flex-1 min-w-[140px] border border-purple-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-purple-500 outline-none bg-white"
                        />
                        <button
                          onClick={() => addManualTime(task.id)}
                          className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 transition-all"
                        >
                          ✓ Ajouter
                        </button>
                        <button
                          onClick={() => setTimeTaskId(null)}
                          className="px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-700 hover:bg-purple-100 transition-all"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* Saisies temps de CETTE tâche : chaque ajout (avec sa note) s'inscrit ici */}
                    {(() => {
                      const entries = (dossier.time_entries || []).filter((e: any) => e.task_id === task.id);
                      if (!entries.length) return null;
                      return (
                        <div className="mt-1 mb-3 space-y-1" onClick={e => e.stopPropagation()}>
                          <span className="text-[11px] font-semibold text-gray-500" data-testid="task-time-entries">
                            ⏱ Saisies ({entries.length})
                          </span>
                          {entries.map((e: any) => (
                            <div
                              key={e.id}
                              data-testid="task-time-entry"
                              className="flex flex-wrap items-center gap-2 text-[11px] bg-purple-50/50 border border-purple-100 rounded-lg px-2 py-1"
                            >
                              <span className="font-mono font-bold text-purple-700">{formatTime(e.duration_seconds || 0)}</span>
                              <span className="text-gray-500">{e.user_name}</span>
                              <span className="text-gray-400">
                                {new Date(e.started_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {e.note && <span className="text-purple-600 italic flex-1 min-w-[120px]">📝 {e.note}</span>}
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    <div className="flex flex-wrap gap-2">
                      {/* Edit label button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingTaskId(task.id); setEditTaskLabel(task.label); }}
                        className="px-3 py-1.5 rounded-lg text-xs bg-purple-100 text-purple-700 hover:bg-purple-200"
                      >
                        ✏️ Renommer
                      </button>
                      {/* Date butoir */}
                      <label
                        className="flex items-center gap-1.5 text-xs text-gray-600 bg-amber-50 px-2.5 py-1.5 rounded-lg hover:bg-amber-100 cursor-pointer"
                        onClick={e => e.stopPropagation()}
                      >
                        📅 {t('alerts.due_date')}
                        <input
                          type="date"
                          value={task.due_date || ''}
                          onChange={e => setTaskDueValue(task.id, e.target.value)}
                          className="border border-amber-200 rounded px-1.5 py-0.5 text-xs bg-white focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </label>
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
                      {task.status !== 'fait' && task.status !== 'a_verifier' && (
                        <button onClick={() => updateTaskStatus(task.id, 'fait')} className="px-3 py-1.5 rounded-lg text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                          {t('status.fait')}
                        </button>
                      )}
                      {task.status === 'a_verifier' && isExpert && (
                        <button onClick={() => updateTaskStatus(task.id, 'fait')} className="px-3 py-1.5 rounded-lg text-xs bg-amber-100 text-amber-800 hover:bg-amber-200 font-semibold">
                          ✅ {t('status.a_verifier_ok')}
                        </button>
                      )}
                      {task.status === 'a_verifier' && !isExpert && (
                        <span className="px-3 py-1.5 rounded-lg text-xs bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                          ⏳ {t('status.a_verifier_pending')}
                        </span>
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

                    {/* Documents de la tâche */}
                    <div className="mt-3 border-t border-gray-100 pt-2.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                          📎 {t('dossier.documents')}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (showAddDocFor === task.id) { setShowAddDocFor(null); } else { setShowAddDocFor(task.id); setNewDocLabel(''); setNewDocUrl(''); }
                          }}
                          className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all ${
                            showAddDocFor === task.id
                              ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                          }`}
                        >
                          {showAddDocFor === task.id ? '✕' : `+ ${t('dossier.add_document')}`}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); pickFile(task.id); }}
                          className="px-2 py-1 rounded-lg text-[11px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all"
                          title="PDF, images, Word, Excel, CSV, TXT, ZIP — 10 Mo max par fichier — plusieurs fichiers possibles"
                        >
                          📤 {t('dossier.attach_file')}
                        </button>
                      </div>

                      {showAddDocFor === task.id && (
                        <div className="flex flex-col gap-2 mb-2 p-2.5 bg-blue-50/60 rounded-lg border border-blue-100" onClick={e => e.stopPropagation()}>
                          <input
                            autoFocus
                            value={newDocLabel}
                            onChange={e => setNewDocLabel(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && newDocLabel.trim()) addDocument(task.id);
                              if (e.key === 'Escape') setShowAddDocFor(null);
                            }}
                            placeholder={t('dossier.doc_label')}
                            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                          <div className="flex gap-2">
                            <input
                              value={newDocUrl}
                              onChange={e => setNewDocUrl(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && newDocLabel.trim()) addDocument(task.id);
                                if (e.key === 'Escape') setShowAddDocFor(null);
                              }}
                              placeholder={t('dossier.doc_url')}
                              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button
                              onClick={() => addDocument(task.id)}
                              disabled={!newDocLabel.trim()}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-all whitespace-nowrap"
                            >
                              {t('dossier.save')}
                            </button>
                          </div>
                        </div>
                      )}

                      {taskDocs.length === 0 && showAddDocFor !== task.id && (
                        <p className="text-[11px] text-gray-400 italic py-1">{t('dossier.no_task_docs')}</p>
                      )}
                      {taskDocs.map(doc => {
                        const kind = docOpenKind(doc);
                        return (
                          <div key={doc.id} className="flex items-center gap-2 py-1.5 text-xs border-b border-gray-50 last:border-0">
                            <span title={doc.received ? 'Reçu' : 'Attendu'}>
                              {doc.received ? '✅' : docIcon(doc)}
                            </span>
                            <span className={`flex-1 min-w-0 truncate ${doc.received ? 'text-gray-400 line-through' : 'text-gray-700'}`} title={doc.label}>
                              {doc.label}
                              {doc.file_size != null && (
                                <span className="text-gray-400 ml-1.5">({formatFileSize(doc.file_size)})</span>
                              )}
                            </span>
                            {kind && (
                              <button
                                onClick={(e) => { e.stopPropagation(); openDoc(doc); }}
                                title={kind === 'file' ? t('dossier.open_file') : doc.url || ''}
                                className="inline-flex items-center gap-0.5 text-blue-600 hover:underline font-medium whitespace-nowrap"
                              >
                                {kind === 'file' ? t('dossier.open_file') : t('dossier.open_link')} <ExternalLink size={10} />
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); editDocUrl(doc); }}
                              title={t('dossier.edit_link')}
                              className="text-gray-400 hover:text-blue-600 transition-colors"
                            >
                              🔗
                            </button>
                            {!doc.received && (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleDocument(doc.id, true); }}
                                title={t('dossier.mark_received')}
                                className="text-gray-400 hover:text-emerald-600 transition-colors"
                              >
                                ✓
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteDocument(doc.id); }}
                              title={t('dossier.delete_doc')}
                              className="text-gray-400 hover:text-red-600 transition-colors"
                            >
                              🗑
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </div>
          ))}
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
                  <span className="text-[11px] text-gray-500 whitespace-nowrap bg-gray-50 px-2 py-1.5 rounded-lg">
                    {typeof monthFilter === 'number' ? `📅 ${monthLabel(monthFilter)}` : `📆 ${t('dossier.filter_annual')}`}
                  </span>
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

      {/* Tab: Year overview */}
      {tab === 'year' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarDays size={16} className="text-purple-600" />
            <h3 className="text-sm font-semibold text-gray-700">{t('dossier.year_overview')} {dossier.exercice}</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {groupTasksByMonth(allTasks).map(group => {
              const pct = group.stats.total ? Math.round((group.stats.fait / group.stats.total) * 100) : 0;
              return (
                <button
                  key={String(group.month)}
                  onClick={() => { setMonthFilter(group.month ?? 'annuel'); setTab('checklist'); }}
                  className={`bg-white border rounded-xl p-3 text-left transition-all ${
                    group.stats.total === 0
                      ? 'border-dashed border-gray-200 opacity-50'
                      : 'border-gray-200 hover:border-purple-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-sm font-semibold ${group.month === currentMonth() ? 'text-purple-700' : 'text-gray-800'}`}>
                      {group.month ? monthLabel(group.month) : t('dossier.filter_annual')}
                    </span>
                    <span className="text-xs font-bold text-gray-600">{pct}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#10b981' : group.stats.bloque > 0 ? '#ef4444' : '#8b5cf6' }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <span>{group.stats.fait}/{group.stats.total} {t('dossier.month_tasks')}</span>
                    {group.stats.bloque > 0 && <span className="text-red-500 font-medium">🔴 {group.stats.bloque}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab: Documents */}
      {tab === 'documents' && (
        <div className="space-y-2">
          {dossier.documents.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">Aucun document attendu</p>
          )}
          {dossier.documents.map(doc => {
            const kind = docOpenKind(doc);
            return (
            <div key={doc.id} className={`bg-white border rounded-xl p-3 flex items-center gap-3 ${
              doc.received ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200'
            }`}>
              <span className="text-lg leading-none">{docIcon(doc)}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${doc.received ? 'text-gray-500' : 'text-gray-800'}`}>
                  {doc.label}
                  {doc.file_size != null && (
                    <span className="text-gray-400 font-normal ml-1.5">({formatFileSize(doc.file_size)})</span>
                  )}
                </p>
                {kind && (
                  <button
                    onClick={() => openDoc(doc)}
                    className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline mt-0.5"
                    title={kind === 'file' ? t('dossier.open_file') : doc.url || ''}
                  >
                    {kind === 'file' ? t('dossier.open_file') : t('dossier.open_link')} <ExternalLink size={10} />
                  </button>
                )}
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
              <div className="flex items-center gap-1">
                <button
                  onClick={() => editDocUrl(doc)}
                  title={t('dossier.edit_link')}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                >
                  🔗
                </button>
                <button
                  onClick={() => deleteDocument(doc.id)}
                  title={t('dossier.delete_doc')}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
                >
                  🗑
                </button>
              </div>
            </div>
            );
          })}
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
            <label className="block text-xs font-semibold text-gray-700 mb-1 mt-3">
              Comptable <span className="text-red-500">*</span>
            </label>
            <select
              value={newDossierComp}
              onChange={e => setNewDossierComp(e.target.value)}
              className="w-full border border-gray-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none bg-white"
            >
              <option value="">— Sélectionner un comptable —</option>
              {comptables.filter(c => c.is_active).map(c => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
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
