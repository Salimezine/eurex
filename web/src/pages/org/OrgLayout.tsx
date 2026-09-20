import { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { OrgAuthProvider, useOrgAuth } from '../../lib/orgAuth';
import { initLang, setLang, getLang, onLangChange, t, Lang } from '../../lib/orgI18n';
import OrgLogin from './OrgLogin';
import OrgDashboardComptable from './OrgDashboardComptable';
import OrgDashboardExpert from './OrgDashboardExpert';
import OrgDossierPage from './OrgDossierPage';
import OrgSettings from './OrgSettings';
import OrgComptableDetail from './OrgComptableDetail';
import { Building2, LayoutDashboard, Users, Settings, LogOut, Globe } from 'lucide-react';

initLang();

function OrgInner() {
  const { state, logout } = useOrgAuth();
  const loc = useLocation();
  const [lang, setLangState] = useState<Lang>(getLang());

  useEffect(() => {
    return onLangChange(() => setLangState(getLang()));
  }, []);

  if (state.loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!state.user) return <OrgLogin />;

  const isExpert = state.user.role === 'expert';
  const path = loc.pathname;

  // Must change password screen
  if (state.user.must_change_password) {
    return <ChangePasswordScreen />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-1">
          <Link to="/cabinet" className="flex items-center gap-2 mr-4">
            <Building2 size={20} className="text-purple-600" />
            <span className="text-lg font-bold text-gray-800">Cabinet</span>
          </Link>

          <div className="flex gap-1 border-l pl-4">
            <Link
              to="/cabinet"
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                path === '/cabinet' ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <LayoutDashboard size={14} className="inline mr-1.5" />
              {isExpert ? 'Dashboard' : t('dash.my_clients')}
            </Link>

            {isExpert && (
              <Link
                to="/cabinet/settings"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  path.includes('/settings') ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Settings size={14} className="inline mr-1.5" />
                {t('nav.settings')}
              </Link>
            )}
          </div>

          <div className="flex-1" />

          {/* Lang toggle */}
          <button
            onClick={() => setLang(lang === 'fr' ? 'ar' : 'fr')}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            title={lang === 'fr' ? 'العربية' : 'Français'}
          >
            <Globe size={16} />
          </button>

          {/* User info */}
          <div className="flex items-center gap-2 pl-3 border-l">
            <div className="text-right">
              <p className="text-xs font-semibold text-gray-700">{state.user.full_name}</p>
              <p className="text-[10px] text-gray-400 capitalize">{state.user.role}</p>
            </div>
            <button
              onClick={logout}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
              title={t('nav.logout')}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <Routes>
          <Route path="/" element={isExpert ? <OrgDashboardExpert /> : <OrgDashboardComptable />} />
          <Route path="/dossier/:id" element={<OrgDossierPage />} />
          <Route path="/settings" element={isExpert ? <OrgSettings /> : <Navigate to="/cabinet" />} />
          <Route path="/comptable/:id" element={isExpert ? <OrgComptableDetail /> : <Navigate to="/cabinet" />} />
          <Route path="*" element={<Navigate to="/cabinet" />} />
        </Routes>
      </main>

      <footer className="border-t border-gray-200 mt-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between text-xs text-gray-400">
          <span>EUREX — Module Cabinet</span>
          <span>{state.user.organization}</span>
        </div>
      </footer>
    </div>
  );
}

function ChangePasswordScreen() {
  const { changePassword } = useOrgAuth();
  const [current, setCurrent] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPwd.length < 12) { setError(t('auth.min_12_chars')); return; }
    if (newPwd !== confirm) { setError('Les mots de passe ne correspondent pas'); return; }
    setLoading(true);
    try {
      await changePassword(current, newPwd);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <h2 className="text-xl font-bold text-gray-900 mb-2">{t('auth.change_password')}</h2>
        <p className="text-sm text-gray-500 mb-6">Vous devez changer votre mot de passe par défaut.</p>
        <form onSubmit={submit}>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Mot de passe actuel</label>
          <input type="password" value={current} onChange={e => setCurrent(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-purple-500 outline-none" />

          <label className="block text-xs font-semibold text-gray-700 mb-1">{t('auth.new_password')}</label>
          <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="12 caractères minimum" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-purple-500 outline-none" />

          <label className="block text-xs font-semibold text-gray-700 mb-1">Confirmer</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-purple-500 outline-none" />

          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

          <button type="submit" disabled={loading} className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm">
            {loading ? '...' : 'Changer'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function OrgLayout() {
  return (
    <OrgAuthProvider>
      <OrgInner />
    </OrgAuthProvider>
  );
}
