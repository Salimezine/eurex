import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { orgApi, OrgComptable, OrgDossier, OrgClient, OrgVerifyTask } from '../../lib/orgApi';
import { t } from '../../lib/orgI18n';
import ProgressDonut, { DonutLegend } from '../../components/ProgressDonut';
import { SkeletonKpiGrid, SkeletonRows } from '../../components/Skeleton';
import OrgAccountButton from '../../components/OrgAccount';
import OrgAlerts from '../../components/OrgAlerts';
import MesHeures from '../../components/MesHeures';
import NouvellesTaches from '../../components/NouvellesTaches';
import { EXPORT_LABELS } from '../../lib/orgAlerts';
import { Users, BarChart3, AlertTriangle, Search, Filter, Plus, X, Pencil, Trash2, Save } from 'lucide-react';

type Tab = 'comptables' | 'global';

// L'endpoint /org/comptables renvoie tout le personnel (pour la gestion des roles
// dans Settings) : le dashboard n'affiche que les comptables.
const onlyComptables = (cs: OrgComptable[]) => cs.filter(c => c.role === 'comptable');

// Delai de validation restant (en heures, negatif = delai depasse)
const verifyBadge = (h: number | null) => {
  if (h === null) return { cls: 'bg-gray-100 text-gray-500', label: 'Sans délai' };
  if (h < 0) return { cls: 'bg-red-100 text-red-700', label: `Délai dépassé +${Math.abs(Math.round(h))} h` };
  if (h < 1) return { cls: 'bg-orange-100 text-orange-700', label: `${Math.max(1, Math.round(h * 60))} min restantes` };
  return { cls: 'bg-amber-100 text-amber-700', label: `${Math.round(h)} h restantes` };
};

export default function OrgDashboardExpert() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('comptables');
  const [comptables, setComptables] = useState<OrgComptable[]>([]);
  const [allDossiers, setAllDossiers] = useState<any[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [allClients, setAllClients] = useState<OrgClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterComptable, setFilterComptable] = useState<string>('all');
  // Tâches faites par les comptables, en attente de vérification expert/manager
  const [verifyTasks, setVerifyTasks] = useState<OrgVerifyTask[]>([]);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  // New dossier modal
  const [showNewDossier, setShowNewDossier] = useState(false);
  const [selectedClient, setSelectedClient] = useState('');
  const [newExercice, setNewExercice] = useState(new Date().getFullYear());
  const [creating, setCreating] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientMF, setNewClientMF] = useState('');
  const [newClientType, setNewClientType] = useState('');
  const [newClientExport, setNewClientExport] = useState('');
  const [newDossierComp, setNewDossierComp] = useState('');
  // Edition / suppression d'un client (expert + manager)
  const [editClient, setEditClient] = useState<OrgClient | null>(null);
  const [ecName, setEcName] = useState('');
  const [ecMF, setEcMF] = useState('');
  const [ecEmail, setEcEmail] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [ecSaving, setEcSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      orgApi.getComptables().then(onlyComptables),
      orgApi.getAllDossiers(),
      orgApi.getClients(),
    ]).then(([c, d, cl]) => {
      setComptables(c);
      setAllDossiers(d);
      setAllClients(cl);
      setLoadError(false);
    }).catch(e => { console.error(e); setLoadError(true); }).finally(() => setLoading(false));
  }, []);

  // Presence en direct : rafraichit statut connecte + heures du jour toutes les 60s (pausé si onglet cache)
  useEffect(() => {
    const tick = () => { if (!document.hidden) orgApi.getComptables().then(cs => setComptables(onlyComptables(cs))).catch(() => {}); };
    const iv = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick); };
  }, []);

  // Tâches à vérifier : indépendant du reste (un échec ne bloque pas le dashboard)
  useEffect(() => {
    const loadVerify = () => orgApi.getTasksToVerify().then(r => setVerifyTasks(r.tasks || [])).catch(() => setVerifyTasks([]));
    loadVerify();
    const iv = setInterval(() => { if (!document.hidden) loadVerify(); }, 60000);
    return () => clearInterval(iv);
  }, []);

  const verifyOne = async (vt: OrgVerifyTask) => {
    if (!confirm(`Valider la tâche « ${vt.label} » (${vt.client_name}) ?`)) return;
    setVerifyingId(vt.id);
    try {
      await orgApi.verifyTask(vt.dossier_id, vt.id);
      setVerifyTasks(prev => prev.filter(x => x.id !== vt.id));
    } catch (e: any) {
      alert(e.message || 'Erreur lors de la validation');
    } finally {
      setVerifyingId(null);
    }
  };

  // Create dossier
  const load = () => {
    setLoading(true);
    Promise.all([
      orgApi.getComptables().then(onlyComptables),
      orgApi.getAllDossiers(),
      orgApi.getClients(),
    ]).then(([c, d, cl]) => {
      setComptables(c);
      setAllDossiers(d);
      setAllClients(cl);
      setLoadError(false);
    }).catch(e => { console.error(e); setLoadError(true); }).finally(() => setLoading(false));
  };

  const createDossier = async () => {
    setCreating(true);
    try {
      let clientId = selectedClient;
      // If new client, create it first
      if (selectedClient === '__new__') {
        if (!newClientName.trim()) { alert('Nom du client requis'); setCreating(false); return; }
        const newClient = await orgApi.createClient({ name: newClientName.trim(), matricule_fiscal: newClientMF.trim() || undefined, person_type: newClientType || undefined, export_status: newClientExport || undefined });
        clientId = newClient.id;
      }
      if (!clientId) return;
      if (!newDossierComp) { alert('Comptable requis : sélectionnez le comptable du dossier'); setCreating(false); return; }
      await orgApi.createDossier(clientId, newExercice, newDossierComp);
      setShowNewDossier(false);
      setSelectedClient('');
      setNewClientName('');
      setNewClientMF('');
      setNewClientType('');
      setNewClientExport('');
      setNewDossierComp('');
      setNewExercice(new Date().getFullYear());
      load();
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la création');
    } finally {
      setCreating(false);
    }
  };

  // Edition / suppression d'un client (expert + manager)
  const startEditClient = (clientId: string) => {
    const cl = allClients.find(c => c.id === clientId);
    if (!cl) return;
    setEditClient(cl);
    setEcName(cl.name || '');
    setEcMF(cl.matricule_fiscal || '');
    setEcEmail(cl.contact_email || '');
    setEcPhone(cl.contact_phone || '');
  };

  const saveEditClient = async () => {
    if (!editClient) return;
    if (!ecName.trim()) { alert('Nom requis'); return; }
    setEcSaving(true);
    try {
      await orgApi.updateClientInfo(editClient.id, {
        name: ecName.trim(),
        matricule_fiscal: ecMF.trim() || null,
        contact_email: ecEmail.trim() || null,
        contact_phone: ecPhone.trim() || null,
      });
      setEditClient(null);
      load();
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la modification');
    } finally {
      setEcSaving(false);
    }
  };

  const deleteClientById = async (clientId: string, clientName: string) => {
    if (!window.confirm(`Supprimer le client « ${clientName} » ainsi que TOUS ses dossiers, tâches et temps ? Cette action est définitive.`)) return;
    try {
      await orgApi.deleteClient(clientId);
      load();
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la suppression');
    }
  };

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

  // Presence comptables : heures pointees aujourd'hui / norme 8h30
  const fmtHm = (sec?: number) => {
    const s = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  };
  const presMap: Record<string, OrgComptable> = Object.fromEntries(comptables.map(c => [c.id, c]));

  if (loading) return (
    <div className="space-y-4">
      <SkeletonKpiGrid count={4} />
      <SkeletonRows rows={6} cols={5} />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* API indisponible : ne PAS afficher une liste vide qui ressemble a des dossiers perdus */}
      {loadError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4 text-sm text-rose-700">
          <span>Chargement impossible : l'API est momentanément indisponible. Aucune donnée n'a été supprimée.</span>
          <button onClick={load} className="shrink-0 px-3 py-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors">Réessayer</button>
        </div>
      )}
      {/* KPIs — 2 catégories : fait / bloqué client */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Dossiers actifs', value: activeDossiers, icon: '📁', color: 'blue' },
          { label: 'Avancement moyen', value: `${avgProgress}%`, icon: '📊', color: 'emerald' },
          { label: 'Bloqué client', value: blockedCount, icon: '🔴', color: 'red' },
          { label: 'Comptables', value: comptables.length, icon: '👥', color: 'purple' },
        ].map((kpi, i) => {
          const bgMap: Record<string, string> = {
            blue: 'bg-blue-50 border-blue-200',
            emerald: 'bg-emerald-50 border-emerald-200',
            red: 'bg-red-50 border-red-200',
            purple: 'bg-purple-50 border-purple-200',
            gray: 'bg-gray-50 border-gray-200',
          };
          const valMap: Record<string, string> = {
            blue: 'text-blue-700',
            emerald: 'text-emerald-700',
            red: 'text-red-700',
            purple: 'text-purple-700',
            gray: 'text-gray-700',
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

      {/* Nouvelles tâches — dernières tâches ajoutées aux dossiers de l'organisation */}
      <NouvellesTaches />

      {/* Tâches à vérifier — faites par les comptables, en attente de validation */}
      {verifyTasks.length > 0 && (
        <div data-testid="a-verifier">
          <h3 className="text-[13px] font-semibold text-gray-700 flex items-center gap-1.5 mb-1.5">
            ✅ À vérifier
            <span className="text-gray-400 font-normal">— tâches terminées par les comptables, en attente de votre validation</span>
            <span className="ml-auto text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full" data-testid="a-verifier-count">{verifyTasks.length}</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {verifyTasks.map(vt => {
              const badge = verifyBadge(vt.verify_left_hours);
              return (
                <div key={vt.id} data-testid="verify-task-card" className="bg-white border border-amber-200 rounded-lg px-3 py-2 hover:shadow-md hover:border-amber-300 transition-all">
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <h4 className="font-bold text-[13px] leading-tight text-gray-800 truncate" data-testid="verify-task-label">{vt.label}</h4>
                    <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${badge.cls}`} data-testid="verify-task-delay">{badge.label}</span>
                  </div>
                  <Link
                    to={`/cabinet/dossier/${vt.dossier_id}?task=${vt.id}`}
                    className="block text-[10px] text-gray-500 truncate hover:text-amber-700"
                    data-testid="verify-task-dossier"
                  >
                    📁 {vt.client_name} · Exercice {vt.exercice}
                  </Link>
                  <p className="mt-1 text-[10px] text-purple-600 font-medium" data-testid="verify-task-doneby">
                    👤 Travaillé par {vt.done_by_name || '—'}
                  </p>
                  <button
                    onClick={() => verifyOne(vt)}
                    disabled={verifyingId === vt.id}
                    className="mt-2 w-full px-2 py-1 rounded-lg text-[11px] font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50 transition-all"
                    data-testid="verify-task-btn"
                  >
                    {verifyingId === vt.id ? 'Validation…' : '✅ Valider la vérification'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mes heures (les miennes) — realises vs norme 8h30, solde net de semaine */}
      <MesHeures />

      {/* Échéances fiscales — alertes dates butoirs */}
      <OrgAlerts />

      {/* Tabs + New dossier button */}
      <div className="flex items-center justify-between">
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
        <div className="flex items-center gap-2">
          <OrgAccountButton />
          <button
            onClick={() => setShowNewDossier(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 shadow-lg shadow-purple-200 transition-all hover:shadow-purple-300 hover:-translate-y-0.5"
          >
            <Plus size={16} />
            Nouveau dossier
          </button>
        </div>
      </div>

      {/* Tab: Comptables */}
      {tab === 'comptables' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {comptables.map(c => (
            <div
              key={c.id}
              onClick={() => navigate(`/cabinet/comptable/${c.id}`)}
              className={`group bg-white border rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-purple-100/50 hover:border-purple-300 hover:-translate-y-1 ${c.is_active ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}
            >
              <div className="flex items-start gap-5">
                <div className="relative">
                  <ProgressDonut
                    fait={c.task_stats.fait}
                    enCours={c.task_stats.en_cours}
                    bloqueClient={c.task_stats.bloque_client}
                    size={128}
                  />
                  {/* Pulse ring on hover */}
                  <div className="absolute inset-0 rounded-full border-2 border-purple-400 opacity-0 group-hover:opacity-30 group-hover:animate-ping" style={{ margin: -8 }} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-gray-800 group-hover:text-purple-700 transition-colors">{c.full_name}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{c.email}</p>
                  <div className="flex items-center gap-4 mt-2 text-[11px]">
                    <span className={`flex items-center gap-1.5 font-semibold ${c.online ? 'text-emerald-600' : 'text-gray-400'}`} title="Présence (activité < 3 min)">
                      <span className={`inline-block w-2 h-2 rounded-full ${c.online ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
                      {c.online ? 'Connecté' : 'Hors ligne'}
                    </span>
                    {c.norm_seconds ? (
                      <span className="text-gray-500">Aujourd'hui : <b className="text-gray-700">{fmtHm(c.worked_today_seconds)} / 8h30</b></span>
                    ) : (
                      <span className="text-gray-400 italic">Repos (samedi / dimanche){(c.worked_today_seconds || 0) > 0 ? ` · ${fmtHm(c.worked_today_seconds)} pointées` : ''}</span>
                    )}
                  </div>
                  {c.norm_seconds ? (
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1.5">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(100, Math.round(((c.worked_today_seconds || 0) / (c.norm_seconds || 30600)) * 100))}%`,
                          background: (c.worked_today_seconds || 0) >= (c.norm_seconds || 30600)
                            ? 'linear-gradient(90deg,#10b981,#34d399)'
                            : (c.worked_today_seconds || 0) >= (c.norm_seconds || 30600) / 2
                              ? 'linear-gradient(90deg,#3b82f6,#60a5fa)'
                              : 'linear-gradient(90deg,#f59e0b,#fbbf24)',
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="flex items-center gap-3 mt-3 text-xs">
                    <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-lg font-medium">
                      {c.client_count} client{c.client_count > 1 ? 's' : ''}
                    </span>
                    <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg font-medium">
                      {c.avg_progress}%
                    </span>
                    {c.task_stats.bloque_client > 0 && (
                      <span className="bg-red-50 text-red-600 px-2 py-1 rounded-lg font-medium animate-pulse">
                        🔴 {c.task_stats.bloque_client} bloqué{c.task_stats.bloque_client > 1 ? 's' : ''} client
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <DonutLegend
                fait={c.task_stats.fait}
                enCours={c.task_stats.en_cours}
                bloqueClient={c.task_stats.bloque_client}
                className="mt-4 pt-4 border-t border-gray-100"
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
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-5 py-3.5 font-semibold text-gray-600">Client</th>
                  <th className="text-left px-5 py-3.5 font-semibold text-gray-600">Exercice</th>
                  <th className="text-left px-5 py-3.5 font-semibold text-gray-600">Comptable</th>
                  <th className="text-center px-5 py-3.5 font-semibold text-gray-600">Avancement</th>
                  <th className="text-center px-5 py-3.5 font-semibold text-gray-600">Statut</th>
                  <th className="text-center px-5 py-3.5 font-semibold text-gray-600">Bloqué client</th>
                </tr>
              </thead>
              <tbody>
                {filteredDossiers.map(d => (
                  <tr key={d.id} className="border-b border-gray-50 hover:bg-purple-50/30 transition-all duration-200">
                    <td className="px-5 py-4">
                      <Link to={`/cabinet/dossier/${d.id}`} className="font-semibold text-purple-700 hover:text-purple-900 hover:underline transition-colors">
                        {d.client_name}
                      </Link>
                      {d.export_status && (
                        <span className="ml-2 inline-block align-middle text-[10px] font-semibold text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded-full" title="Statut export du client">
                          {EXPORT_LABELS[d.export_status] || d.export_status}
                        </span>
                      )}
                      {d.client_id && (
                        <span className="ml-2 inline-flex align-middle gap-1">
                          <button
                            onClick={() => startEditClient(d.client_id)}
                            title="Modifier le client"
                            className="p-1 rounded-md text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-colors"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => deleteClientById(d.client_id, d.client_name)}
                            title="Supprimer le client et ses dossiers"
                            className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-500 font-mono">{d.exercice}</td>
                    <td className="px-5 py-4 text-gray-600">
                      {d.comptable_name || '—'}
                      {d.comptable_id && presMap[d.comptable_id] && (
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-gray-400" title="Heures pointées aujourd'hui (norme 8h30 du lundi au vendredi)">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${presMap[d.comptable_id].online ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                          {presMap[d.comptable_id].norm_seconds
                            ? `${fmtHm(presMap[d.comptable_id].worked_today_seconds)} / 8h30`
                            : ((presMap[d.comptable_id].worked_today_seconds || 0) > 0 ? `${fmtHm(presMap[d.comptable_id].worked_today_seconds)} (repos)` : 'Repos')}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3 justify-center">
                        <div className="w-24 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                          <div
                            className="h-2.5 rounded-full transition-all duration-1000 ease-out"
                            style={{
                              width: `${d.progress || 0}%`,
                              background: d.progress >= 80 ? 'linear-gradient(90deg, #10b981, #34d399)' : d.progress >= 40 ? 'linear-gradient(90deg, #3b82f6, #60a5fa)' : 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                              boxShadow: d.progress >= 80 ? '0 0 8px #10b98140' : d.progress >= 40 ? '0 0 8px #3b82f640' : '0 0 8px #f59e0b40',
                            }}
                          />
                        </div>
                        <span className="text-xs font-bold text-gray-700 w-10 text-right">{d.progress || 0}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-center">
                      {d.status === 'cloture' && (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">
                          {t('status.cloture')}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-center">
                      {d.task_stats?.bloque_client > 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold animate-pulse">
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

      {/* Modal: Nouveau dossier */}
      {showNewDossier && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Plus size={20} className="text-purple-600" />
                Nouveau dossier
              </h3>
              <button onClick={() => { setShowNewDossier(false); setSelectedClient(''); setNewClientName(''); setNewClientType(''); setNewDossierComp(''); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Client: select existing or type new */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Client</label>
                <div className="space-y-2">
                  <select
                    value={selectedClient === '__new__' ? '__new__' : selectedClient}
                    onChange={e => {
                      if (e.target.value === '__new__') {
                        setSelectedClient('__new__');
                        setNewDossierComp('');
                      } else {
                        setSelectedClient(e.target.value);
                        setNewClientName('');
                        const cl = allClients.find(c => c.id === e.target.value);
                        setNewDossierComp(cl?.assigned_comptable_id || '');
                      }
                    }}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                  >
                    <option value="">— Sélectionner un client existant —</option>
                    {allClients.map(c => (
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
                      <select
                        value={newClientType}
                        onChange={e => setNewClientType(e.target.value)}
                        title="Type de client"
                        className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                      >
                        <option value="">— Type de client (optionnel) —</option>
                        <option value="morale">🏢 Personne morale</option>
                        <option value="physique">👤 Personne physique</option>
                      </select>
                      <select
                        value={newClientExport}
                        onChange={e => setNewClientExport(e.target.value)}
                        title="Statut export du client"
                        className="w-full border border-cyan-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none bg-white"
                      >
                        <option value="">🌍 Statut export (optionnel) —</option>
                        <option value="exportatrice">{t('alerts.export_exportatrice')}</option>
                        <option value="semi_exportatrice">{t('alerts.export_semi')}</option>
                        <option value="non_exportatrice">{t('alerts.export_non')}</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Exercice */}
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

              {/* Comptable assigné (obligatoire) */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  Comptable <span className="text-red-500">*</span>
                </label>
                <select
                  value={newDossierComp}
                  onChange={e => setNewDossierComp(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                >
                  <option value="">— Sélectionner un comptable —</option>
                  {comptables.filter(c => c.is_active).map(c => (
                    <option key={c.id} value={c.id}>{c.full_name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={createDossier}
                disabled={(!selectedClient && !newClientName.trim()) || !newDossierComp || creating}
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

      {/* Modal: Modifier un client (expert + manager) */}
      {editClient && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Pencil size={20} className="text-purple-600" />
                Modifier le client
              </h3>
              <button onClick={() => setEditClient(null)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Nom du client *</label>
              <input value={ecName} onChange={e => setEcName(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Matricule fiscal</label>
              <input value={ecMF} onChange={e => setEcMF(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
                <input type="email" value={ecEmail} onChange={e => setEcEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Téléphone</label>
                <input value={ecPhone} onChange={e => setEcPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none" />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={saveEditClient}
                disabled={ecSaving || !ecName.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-all"
              >
                <Save size={15} />
                {ecSaving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              <button
                onClick={() => setEditClient(null)}
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
