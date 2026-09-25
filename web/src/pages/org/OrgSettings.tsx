import { useState, useEffect } from 'react';
import { orgApi, OrgTemplate, OrgComptable, OrgFrequency } from '../../lib/orgApi';
import { useOrgAuth } from '../../lib/orgAuth';
import { t } from '../../lib/orgI18n';
import { SkeletonSection } from '../../components/Skeleton';
import { Settings, Users, ListChecks, Plus, Trash2, Eye, EyeOff, RefreshCw } from 'lucide-react';

type Tab = 'templates' | 'comptables';

export default function OrgSettings() {
  const { state } = useOrgAuth();
  const isExpert = state.user?.role === 'expert';
  const [tab, setTab] = useState<Tab>('templates');
  const [templates, setTemplates] = useState<OrgTemplate[]>([]);
  const [comptables, setComptables] = useState<OrgComptable[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [newRequiresDoc, setNewRequiresDoc] = useState(false);
  const [newAssignedComp, setNewAssignedComp] = useState('');
  const [newFrequency, setNewFrequency] = useState<OrgFrequency>('annuelle');
  const [newCompName, setNewCompName] = useState('');
  const [newCompEmail, setNewCompEmail] = useState('');
  const [newCompPassword, setNewCompPassword] = useState('');

  useEffect(() => {
    Promise.all([orgApi.getTemplates(), orgApi.getComptables()])
      .then(([t, c]) => { setTemplates(t); setComptables(c); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const addTemplate = async () => {
    if (!newLabel.trim()) return;
    try {
      await orgApi.createTemplate(newLabel.trim(), newRequiresDoc, newAssignedComp || null, newFrequency);
      setNewLabel('');
      setNewRequiresDoc(false);
      setNewAssignedComp('');
      setTemplates(await orgApi.getTemplates());
    } catch (err: any) {
      alert(err.message);
    }
  };

  const assignTemplate = async (id: string, comptableId: string | null) => {
    try {
      await orgApi.updateTemplate(id, { assigned_comptable_id: comptableId });
      setTemplates(templates.map(t => t.id === id
        ? { ...t, assigned_comptable_id: comptableId, assigned_comptable_name: comptables.find(c => c.id === comptableId)?.full_name || null }
        : t));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const changeFrequency = async (id: string, frequency: OrgFrequency) => {
    try {
      await orgApi.updateTemplate(id, { frequency });
      setTemplates(templates.map(t => t.id === id ? { ...t, frequency } : t));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Supprimer ce modèle ?')) return;
    try {
      await orgApi.deleteTemplate(id);
      setTemplates(templates.filter(t => t.id !== id));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const addComptable = async () => {
    if (!newCompName.trim() || !newCompEmail.trim() || !newCompPassword.trim()) return;
    try {
      await orgApi.createComptable({
        full_name: newCompName.trim(),
        email: newCompEmail.trim(),
        password: newCompPassword.trim(),
      });
      setNewCompName('');
      setNewCompEmail('');
      setNewCompPassword('');
      setComptables(await orgApi.getComptables());
    } catch (err: any) {
      alert(err.message);
    }
  };

  const toggleComptable = async (id: string, current: number) => {
    try {
      await orgApi.toggleComptable(id, !current);
      setComptables(comptables.map(c => c.id === id ? { ...c, is_active: current ? 0 : 1 } : c));
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) return <SkeletonSection />;

  if (!isExpert) return <div className="text-center py-12 text-gray-400">Accès réservé à l'expert</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
        <Settings size={20} className="text-purple-600" />
        {t('nav.settings')}
      </h2>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { key: 'templates' as Tab, label: t('templates.title'), icon: <ListChecks size={14} /> },
          { key: 'comptables' as Tab, label: 'Comptables', icon: <Users size={14} /> },
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

      {/* Tab: Templates */}
      {tab === 'templates' && (
        <div className="space-y-3">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="font-semibold text-sm text-gray-700 mb-3">{t('templates.add')}</h3>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  placeholder="Libellé de la tâche"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                  onKeyDown={e => e.key === 'Enter' && addTemplate()}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={newRequiresDoc}
                  onChange={e => setNewRequiresDoc(e.target.checked)}
                  className="rounded border-gray-300"
                />
                {t('templates.requires_doc')}
              </label>
              <select
                value={newFrequency}
                onChange={e => setNewFrequency(e.target.value as OrgFrequency)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                title={t('templates.frequency')}
              >
                <option value="annuelle">{t('templates.freq_annual')}</option>
                <option value="trimestrielle">{t('templates.freq_quarterly')}</option>
                <option value="mensuelle">{t('templates.freq_monthly')}</option>
              </select>
              <select
                value={newAssignedComp}
                onChange={e => setNewAssignedComp(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              >
                <option value="">Comptable : —</option>
                {comptables.filter(c => c.is_active).map(c => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>              <button
                onClick={addTemplate}
                disabled={!newLabel.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Plus size={14} /> Ajouter
              </button>
            </div>
          </div>

          {templates.map(tmpl => (
            <div key={tmpl.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3">
              <span className="text-gray-300 text-sm">#{tmpl.order_index}</span>
              <span className="flex-1 text-sm font-medium text-gray-700">{tmpl.label}</span>
              <select
                value={tmpl.frequency || 'annuelle'}
                onChange={e => changeFrequency(tmpl.id, e.target.value as OrgFrequency)}
                onClick={e => e.stopPropagation()}
                className={`border rounded-lg px-2 py-1 text-[11px] font-medium focus:ring-2 focus:ring-purple-500 outline-none cursor-pointer ${
                  tmpl.frequency === 'mensuelle'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : tmpl.frequency === 'trimestrielle'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-gray-200 bg-gray-50 text-gray-600'
                }`}
                title={t('templates.frequency')}
              >
                <option value="mensuelle">{t('templates.freq_monthly')}</option>
                <option value="trimestrielle">{t('templates.freq_quarterly')}</option>
                <option value="annuelle">{t('templates.freq_annual')}</option>
              </select>
              {tmpl.requires_document ? (
                <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-medium">📄 Doc requis</span>
              ) : null}
              <select
                value={tmpl.assigned_comptable_id || ''}
                onChange={e => assignTemplate(tmpl.id, e.target.value || null)}
                onClick={e => e.stopPropagation()}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-purple-500 outline-none max-w-[160px]"
                title="Comptable assigné par défaut"
              >
                <option value="">Comptable : —</option>
                {comptables.filter(c => c.is_active).map(c => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
              <button
                onClick={() => deleteTemplate(tmpl.id)}
                className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Comptables */}
      {tab === 'comptables' && (
        <div className="space-y-3">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="font-semibold text-sm text-gray-700 mb-3">Ajouter un comptable</h3>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <input
                type="text"
                value={newCompName}
                onChange={e => setNewCompName(e.target.value)}
                placeholder="Nom complet"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <input
                type="email"
                value={newCompEmail}
                onChange={e => setNewCompEmail(e.target.value)}
                placeholder="Email"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <input
                type="password"
                value={newCompPassword}
                onChange={e => setNewCompPassword(e.target.value)}
                placeholder="Mot de passe (12+ car.)"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              />
            </div>
            <button
              onClick={addComptable}
              disabled={!newCompName.trim() || !newCompEmail.trim() || newCompPassword.length < 12}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Plus size={14} /> Créer le compte
            </button>
          </div>

          {comptables.map(c => (
            <div key={c.id} className={`bg-white border rounded-xl p-4 flex items-center gap-4 ${c.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex-1">
                <p className="font-semibold text-sm text-gray-800">{c.full_name}</p>
                <p className="text-xs text-gray-500">{c.email}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span>{c.client_count} clients</span>
                  <span>•</span>
                  <span>{c.avg_progress}% avancement</span>
                </div>
              </div>
              <button
                onClick={() => toggleComptable(c.id, c.is_active)}
                className={`p-2 rounded-lg transition-colors ${c.is_active ? 'text-emerald-500 hover:bg-emerald-50' : 'text-gray-400 hover:bg-gray-100'}`}
                title={c.is_active ? 'Désactiver' : 'Activer'}
              >
                {c.is_active ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
