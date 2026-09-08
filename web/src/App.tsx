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

export default function App() {
  const loc = useLocation();
  const isBaud = loc.pathname.startsWith('/baud');
  const isScan = loc.pathname.startsWith('/scanflash');
  const isEF = loc.pathname.startsWith('/ef');
  const isDossier = loc.pathname.startsWith('/dossier/');
  const isBaudDossier = loc.pathname.startsWith('/baud/dossier/');
  const isScanDossier = loc.pathname.startsWith('/scanflash/dossier/');
  const isAchats = loc.pathname.startsWith('/achats');

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14">
          <Link to="/" className="flex items-center gap-2 mr-4">
            <span className="text-lg font-bold">EUREX</span>
          </Link>

          {isDossier && (
            <div className="flex gap-1 border-l pl-4">
              <Link to="/" className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700">
                ANIMALS
              </Link>
            </div>
          )}

          {(isBaud || isBaudDossier) && (
            <div className="flex gap-1 border-l pl-4">
              <Link to="/baud/societes" className="px-3 py-1.5 rounded-lg text-sm font-medium bg-purple-50 text-purple-700">
                BAUD
              </Link>
            </div>
          )}

          {(isScan || isScanDossier) && (
            <div className="flex gap-1 border-l pl-4">
              <Link to="/scanflash" className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-50 text-emerald-700">
                SCANFLASH
              </Link>
            </div>
          )}

          {isEF && (
            <div className="flex gap-1 border-l pl-4">
              <Link to="/ef" className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700">
                EF
              </Link>
            </div>
          )}

          {isAchats && (
            <div className="flex gap-1 border-l pl-4">
              <Link to="/achats" className="px-3 py-1.5 rounded-lg text-sm font-medium bg-orange-50 text-orange-700">
                ACHATS
              </Link>
            </div>
          )}
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Routes>
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
    </div>
  );
}
