import { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import DossierPage from './pages/DossierPage';
import BaudSocietes from './pages/baud/BaudSocietes';
import BaudDossierPage from './pages/baud/BaudDossierPage';
import BaudParametres from './pages/baud/BaudParametres';
import ScanSocietes from './pages/scanflash/ScanSocietes';
import ScanDossierPage from './pages/scanflash/ScanDossierPage';
import EtatsFinanciers from './pages/ef/EtatsFinanciers';
import AchatsSocietes from './pages/achats/AchatsSocietes';
import AchatsDossierPage from './pages/achats/AchatsDossierPage';
import OrgLayout from './pages/org/OrgLayout';
import QuotaIndicator from './components/QuotaIndicator';
import { OrgAuthProvider, useOrgAuth } from './lib/orgAuth';
import { getLang, setLang, onLangChange, initLang, t } from './lib/orgI18n';
import { Building2, LayoutDashboard, Settings, LogOut, Globe } from 'lucide-react';

initLang();

function GlobalNav({ path }: { path: string }) {
  const { state, logout } = useOrgAuth();
  const [lang, setLangState] = useState(getLang());

  useEffect(() => onLangChange(() => setLangState(getLang())), []);

  const onCabinet = path.startsWith('/cabinet');
  const cabUser = onCabinet && state.user && !state.user.must_change_password ? state.user : null;

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-1">
        <Link to="/" className="flex items-center gap-2 mr-4">
          <span className="text-lg font-bold">EUREX</span>
        </Link>
        <div className="flex gap-1 border-l pl-4">
          <Link to="/" className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${path === '/' ? 'bg-gray-100 text-gray-800' : 'text-gray-600 hover:bg-gray-50'}`}>
            Dossiers
          </Link>
          <Link to="/achats" className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${path.startsWith('/achats') ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            ACHATS
          </Link>
          <Link to="/ef" className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${path.startsWith('/ef') ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            EF
          </Link>
          <Link to="/baud/societes" className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${path.startsWith('/baud') ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            BAUD
          </Link>
          <Link to="/scanflash" className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${path.startsWith('/scanflash') ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            SCANFLASH
          </Link>
          <Link to="/cabinet" className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1 ${onCabinet ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Building2 size={14} />
            CABINET
          </Link>

          {/* Onglets Cabinet fusionnés dans la nav globale (une seule barre) */}
          {cabUser && (
            <>
              <Link
                to="/cabinet"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${path === '/cabinet' ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <LayoutDashboard size={14} className="inline mr-1.5" />
                {cabUser.role === 'expert' ? 'Dashboard' : t('dash.my_clients')}
              </Link>
              {cabUser.role === 'expert' && (
                <Link
                  to="/cabinet/settings"
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${path.includes('/settings') ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <Settings size={14} className="inline mr-1.5" />
                  {t('nav.settings')}
                </Link>
              )}
            </>
          )}
        </div>
        <QuotaIndicator />

        {/* Infos utilisateur + langue + déconnexion (une seule fois, nav globale) */}
        {cabUser && (
          <div className="flex items-center gap-2 pl-3 border-l ml-2">
            <button
              onClick={() => setLang(lang === 'fr' ? 'ar' : 'fr')}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              title={lang === 'fr' ? 'العربية' : 'Français'}
            >
              <Globe size={16} />
            </button>
            <div className="text-right">
              <p className="text-xs font-semibold text-gray-700">{cabUser.full_name}</p>
              <p className="text-[10px] text-gray-400">{cabUser.organization || cabUser.role}</p>
            </div>
            <button
              onClick={logout}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
              title={t('nav.logout')}
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

export default function App() {
  const loc = useLocation();
  const path = loc.pathname;
  const onCabinet = path.startsWith('/cabinet');

  return (
    <OrgAuthProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <GlobalNav path={path} />
        {/* /cabinet : conteneur sans padding → le login pleine largeur, les pages cabinet gèrent leur propre max-w */}
        <main className={onCabinet ? 'flex-1 flex flex-col' : 'max-w-7xl mx-auto px-4 py-6 w-full'}>
          <Routes>
            {/* Organization module — has its own layout with auth */}
            <Route path="/cabinet/*" element={<OrgLayout />} />

            {/* Existing routes */}
            <Route path="/" element={<Home />} />
            <Route path="/dossier/:id" element={<DossierPage />} />
            <Route path="/baud/societes" element={<BaudSocietes />} />
            <Route path="/baud/parametres" element={<BaudParametres />} />
            <Route path="/baud/dossier/:id" element={<BaudDossierPage />} />
            <Route path="/scanflash" element={<ScanSocietes />} />
            <Route path="/scanflash/dossier/:id" element={<ScanDossierPage />} />
            <Route path="/ef" element={<EtatsFinanciers />} />
            <Route path="/achats" element={<AchatsSocietes />} />
            <Route path="/achats/dossier/:id" element={<AchatsDossierPage />} />
          </Routes>
        </main>
        <footer className="border-t border-gray-200 mt-10">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between text-xs text-gray-400">
            <span>EUREX — Générateur d'Écritures Comptables IA</span>
            <span>Created by Med Salim Ezzine</span>
          </div>
        </footer>
      </div>
    </OrgAuthProvider>
  );
}
