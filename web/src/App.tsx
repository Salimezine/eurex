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
import QuotaIndicator from './components/QuotaIndicator';

export default function App() {
  const loc = useLocation();
  const path = loc.pathname;

  return (
    <div className="min-h-screen bg-gray-50">
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
          </div>
          <QuotaIndicator />
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
