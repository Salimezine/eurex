import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, FileText, Table2, Trash2, Download, Zap, CheckCircle, ShieldCheck, Search, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { processAchatFile, AchatInvoice } from '../../lib/achatsParser';
import { generateEcrituresWithAI, verifyEcrituresWithAI, verifyEcrituresLocally, EcritureAchat, VerificationResult } from '../../lib/achatsAI';
import { PlanComptable, CompteComptable, searchComptes, formatPlanComptable, getPlanSummary } from '../../lib/achatsPlanComptable';

type Tab = 'import' | 'factures' | 'plan' | 'generate' | 'ecritures' | 'export';

const STORAGE_KEY_PLAN = 'achats_plan_comptable';
const STORAGE_KEY_DOSSIERS = 'achats_dossiers';

interface Dossier { id: string; societe_id: string; nom: string; mois: number; annee: number; statut: string; nb_factures: number; nb_ecritures: number; }

function loadPlan(): PlanComptable | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PLAN);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return {
      comptes: new Map(Object.entries(obj.comptes || {})),
      fournisseurs: new Map(Object.entries(obj.fournisseurs || {})),
      achats: obj.achats || [],
      tva: obj.tva || [],
      taxes: obj.taxes || [],
      allByCode: obj.allByCode || {},
    };
  } catch { return null; }
}

function loadDossier(id: string): Dossier | null {
  try {
    const dossiers: Dossier[] = JSON.parse(localStorage.getItem(STORAGE_KEY_DOSSIERS) || '[]');
    return dossiers.find(d => d.id === id) || null;
  } catch { return null; }
}

function updateDossier(id: string, updates: Partial<Dossier>) {
  try {
    const dossiers: Dossier[] = JSON.parse(localStorage.getItem(STORAGE_KEY_DOSSIERS) || '[]');
    const idx = dossiers.findIndex(d => d.id === id);
    if (idx >= 0) {
      dossiers[idx] = { ...dossiers[idx], ...updates };
      localStorage.setItem(STORAGE_KEY_DOSSIERS, JSON.stringify(dossiers));
    }
  } catch {}
}

export default function AchatsDossierPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [tab, setTab] = useState<Tab>('import');
  const [factures, setFactures] = useState<AchatInvoice[]>([]);
  const [ecritures, setEcritures] = useState<EcritureAchat[]>([]);
  const [plan, setPlan] = useState<PlanComptable | null>(null);
  const [msg, setMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerificationResult | null>(null);
  const [planSearch, setPlanSearch] = useState('');
  const [planSearchResults, setPlanSearchResults] = useState<CompteComptable[]>([]);

  useEffect(() => {
    if (id) {
      setDossier(loadDossier(id));
      setPlan(loadPlan());
    }
  }, [id]);

  const handleUploadFiles = async (files: FileList) => {
    if (!files.length) return;
    setUploading(true);
    setMsg('');
    const newFactures: AchatInvoice[] = [];
    for (const file of Array.from(files)) {
      try {
        const inv = await processAchatFile(file);
        newFactures.push(inv);
      } catch (e: any) {
        setMsg(`Erreur ${file.name}: ${e.message}`);
      }
    }
    setFactures(prev => [...prev, ...newFactures]);
    setMsg(`${newFactures.length} facture(s) extraite(s)`);
    setUploading(false);
  };

  const handleGenerateAll = async () => {
    if (factures.length === 0 || !plan) return;
    setGenerating(true);
    setMsg('');
    try {
      const allEcritures: EcritureAchat[] = [];
      for (const f of factures) {
        try {
          const ecritures = await generateEcrituresWithAI(f, plan);
          allEcritures.push(...ecritures);
        } catch {
          setMsg('Erreur AI pour ' + f.numero + ', fallback local utilisé');
          const { generateEcrituresWithAI: gen } = await import('../../lib/achatsAI');
          const fallback = await gen(f, plan);
          allEcritures.push(...fallback);
        }
      }
      setEcritures(allEcritures);
      if (id) updateDossier(id, { nb_ecritures: allEcritures.length, nb_factures: factures.length });
      setTab('ecritures');
      setMsg(`${allEcritures.length} écriture(s) générée(s)`);
    } catch (e: any) {
      setMsg('Erreur: ' + e.message);
    }
    setGenerating(false);
  };

  const handleVerifyAI = async () => {
    if (ecritures.length === 0 || !plan) return;
    setVerifying(true);
    try {
      const result = await verifyEcrituresWithAI(ecritures, plan);
      setVerifyResult(result);
    } catch {
      setVerifyResult(verifyEcrituresLocally(ecritures, plan));
    }
    setVerifying(false);
  };

  const handleExportCSV = () => {
    if (ecritures.length === 0) return;
    const header = 'N° pièce;Date pièce;Journal;Libellé;Compte;Sens;Montant;Trésorerie';
    const lines = ecritures.map(e => {
      const [y, m, d] = e.date_operation.split('-');
      const dateFormatted = `${d}/${m}/${y}`;
      return `${e.numero_doc};${dateFormatted};${e.journal_code};${e.libelle};${e.compte};${e.sens};${e.montant.toFixed(3)};`;
    });
    const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `achats_${dossier?.nom || 'export'}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const handleExportXLSX = () => {
    if (ecritures.length === 0) return;
    const header = ['N° pièce', 'Date pièce', 'Journal', 'Libellé', 'N° compte', 'Libellé trésorerie', 'Débit', 'Crédit'];
    const rows: any[][] = [header];
    for (const e of ecritures) {
      const [y, m, d] = e.date_operation.split('-');
      rows.push([e.numero_doc, `${d}/${m}/${y}`, e.journal_code, e.libelle, e.compte, '', e.sens === 'D' ? e.montant : 0, e.sens === 'C' ? e.montant : 0]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 40 }, { wch: 10 }, { wch: 20 }, { wch: 15 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ecritures');
    const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `achats_${dossier?.nom || 'export'}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
  };

  const handlePlanSearch = (q: string) => {
    setPlanSearch(q);
    if (!plan || q.length < 2) { setPlanSearchResults([]); return; }
    setPlanSearchResults(searchComptes(plan, q));
  };

  const updateFacture = (id: string, field: keyof AchatInvoice, value: any) => {
    setFactures(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f));
  };

  const deleteFacture = (id: string) => {
    setFactures(prev => prev.filter(f => f.id !== id));
  };

  const updateEcriture = (id: string, field: keyof EcritureAchat, value: any) => {
    setEcritures(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const deleteEcriture = (id: string) => {
    setEcritures(prev => prev.filter(e => e.id !== id));
  };

  const addEcriture = () => {
    const newE: EcritureAchat = {
      id: Math.random().toString(36).substring(2, 10),
      numero_doc: '', date_operation: dossier ? `${dossier.annee}-${String(dossier.mois).padStart(2, '0')}-01` : new Date().toISOString().split('T')[0],
      journal_code: 'AC', compte: '', libelle: '', sens: 'D', montant: 0,
    };
    setEcritures(prev => [...prev, newE]);
  };

  const totalD = ecritures.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
  const totalC = ecritures.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);

  const tabs: { key: Tab; label: string; icon: any; count: number }[] = [
    { key: 'import', label: 'Import', icon: Upload, count: factures.length },
    { key: 'factures', label: `Factures (${factures.length})`, icon: FileText, count: factures.length },
    { key: 'plan', label: 'Plan Comptable', icon: FileSpreadsheet, count: plan ? plan.comptes.size : 0 },
    { key: 'generate', label: 'Générer', icon: Zap, count: 0 },
    { key: 'ecritures', label: `Écritures (${ecritures.length})`, icon: Table2, count: ecritures.length },
    { key: 'export', label: 'Contrôle + Export', icon: ShieldCheck, count: 0 },
  ];

  if (!dossier) return <div className="text-gray-400 py-10">Chargement...</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/achats')} className="text-gray-400 hover:text-gray-700"><ArrowLeft size={20} /></button>
        <div>
          <h1 className="text-xl font-bold text-gray-800">{dossier.nom}</h1>
          <span className="text-xs text-gray-500">ACHATS — Journal AC</span>
        </div>
        <div className="ml-auto flex gap-2 items-center">
          {factures.length > 0 && <span className="text-xs text-gray-400">{factures.length} factures / {ecritures.length} écritures</span>}
          {ecritures.length > 0 && (
            <span className={`text-xs font-mono ${Math.abs(totalD - totalC) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
              D={totalD.toFixed(3)} C={totalC.toFixed(3)} écart={Math.abs(totalD - totalC).toFixed(3)}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1 px-3 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${tab === t.key ? 'border-orange-600 text-orange-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <Icon size={15} />{t.label}
            </button>
          );
        })}
      </div>

      {msg && <p className={`text-sm ${msg.includes('Erreur') ? 'text-red-600' : 'text-green-700'}`}>{msg}</p>}

      {/* TAB: IMPORT */}
      {tab === 'import' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <label className="bg-orange-600 text-white px-4 py-2 rounded text-sm hover:bg-orange-700 cursor-pointer flex items-center gap-1">
                <Upload size={15} />
                {uploading ? 'Extraction...' : 'Importer PDF(s) / Image(s)'}
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp" multiple className="hidden" onChange={e => e.target.files && handleUploadFiles(e.target.files)} />
              </label>
              <span className="text-xs text-gray-400">PDF typé (extraction texte) ou scanné/manuscrit (OCR fra+ara)</span>
            </div>
          </div>
          {!plan && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
              ⚠ Aucun plan comptable chargé. Retournez à la page sociétés pour importer le fichier Excel du plan.
            </div>
          )}
        </div>
      )}

      {/* TAB: FACTURES */}
      {tab === 'factures' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">N°</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Fournisseur</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-right">HT 0%</th>
                  <th className="px-3 py-2 text-right">HT 19%</th>
                  <th className="px-3 py-2 text-right">TVA</th>
                  <th className="px-3 py-2 text-right">Timbre</th>
                  <th className="px-3 py-2 text-right">TTC</th>
                  <th className="px-3 py-2 text-center">OCR</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {factures.map(f => (
                  <tr key={f.id} className="border-t hover:bg-gray-50">
                    <td className="px-2 py-1"><input value={f.numero} onChange={e => updateFacture(f.id, 'numero', e.target.value)} className="w-24 text-xs border rounded px-1 py-0.5" /></td>
                    <td className="px-2 py-1"><input type="date" value={f.date} onChange={e => updateFacture(f.id, 'date', e.target.value)} className="w-32 text-xs border rounded px-1 py-0.5" /></td>
                    <td className="px-2 py-1"><input value={f.fournisseur} onChange={e => updateFacture(f.id, 'fournisseur', e.target.value)} className="w-32 text-xs border rounded px-1 py-0.5" /></td>
                    <td className="px-2 py-1"><input value={f.description} onChange={e => updateFacture(f.id, 'description', e.target.value)} className="w-40 text-xs border rounded px-1 py-0.5" /></td>
                    <td className="px-2 py-1"><input type="number" step="0.001" value={f.ht0} onChange={e => updateFacture(f.id, 'ht0', parseFloat(e.target.value) || 0)} className="w-20 text-xs border rounded px-1 py-0.5 text-right" /></td>
                    <td className="px-2 py-1"><input type="number" step="0.001" value={f.ht19} onChange={e => updateFacture(f.id, 'ht19', parseFloat(e.target.value) || 0)} className="w-20 text-xs border rounded px-1 py-0.5 text-right" /></td>
                    <td className="px-2 py-1"><input type="number" step="0.001" value={f.tva19} onChange={e => updateFacture(f.id, 'tva19', parseFloat(e.target.value) || 0)} className="w-20 text-xs border rounded px-1 py-0.5 text-right" /></td>
                    <td className="px-2 py-1"><input type="number" step="0.001" value={f.timbre} onChange={e => updateFacture(f.id, 'timbre', parseFloat(e.target.value) || 0)} className="w-16 text-xs border rounded px-1 py-0.5 text-right" /></td>
                    <td className="px-2 py-1 font-mono text-xs font-semibold text-right">{f.ttc.toFixed(3)}</td>
                    <td className="px-2 py-1 text-center">
                      {f.is_handwritten ? <span className="text-amber-600 text-xs" title={f.raw_text}>OCR</span> : <span className="text-green-600 text-xs">TXT</span>}
                    </td>
                    <td className="px-1"><button onClick={() => deleteFacture(f.id)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button></td>
                  </tr>
                ))}
                {factures.length === 0 && <tr><td colSpan={11} className="text-center text-gray-400 py-6">Aucune facture. Importez des PDF(s) dans l'onglet Import.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: PLAN COMPTABLE */}
      {tab === 'plan' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-semibold text-gray-700 mb-3 text-sm">Recherche dans le plan comptable</h3>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                <input value={planSearch} onChange={e => handlePlanSearch(e.target.value)} placeholder="Rechercher un compte (code ou libellé)..." className="w-full border rounded pl-8 pr-3 py-2 text-sm" />
              </div>
            </div>
            {planSearchResults.length > 0 && (
              <div className="mt-2 bg-gray-50 rounded border max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-500 border-b"><th className="p-2 text-left">Code</th><th className="p-2 text-left">Libellé</th><th className="p-2 text-center">Sens</th></tr></thead>
                  <tbody>
                    {planSearchResults.map(c => (
                      <tr key={c.code} className="border-b hover:bg-white"><td className="p-2 font-mono">{c.code}</td><td className="p-2">{c.libelle}</td><td className="p-2 text-center">{c.sens}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {plan && (
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-semibold text-gray-700 mb-3 text-sm">Comptes d'achats (6xxx)</h3>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-500 border-b"><th className="p-2 text-left">Code</th><th className="p-2 text-left">Libellé</th><th className="p-2 text-center">Sens</th></tr></thead>
                  <tbody>
                    {plan.achats.map(c => (
                      <tr key={c.code} className="border-b hover:bg-gray-50"><td className="p-2 font-mono">{c.code}</td><td className="p-2">{c.libelle}</td><td className="p-2 text-center">{c.sens}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 text-xs text-gray-400">
                {getPlanSummary(plan).totalComptes} comptes total | {getPlanSummary(plan).totalFournisseurs} fournisseurs | {getPlanSummary(plan).totalAchats} comptes d'achats
              </div>
            </div>
          )}
          {!plan && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
              Aucun plan comptable chargé. Importez le fichier Excel depuis la page sociétés.
            </div>
          )}
        </div>
      )}

      {/* TAB: GENERATE */}
      {tab === 'generate' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Zap size={20} className="text-orange-600" />
              <div>
                <h3 className="font-medium text-sm">Génération des écritures comptables</h3>
                <p className="text-xs text-gray-400">AI analyse chaque facture et génère les écritures (Journal AC)</p>
              </div>
              <button onClick={handleGenerateAll} disabled={generating || factures.length === 0 || !plan}
                className="ml-auto px-4 py-2 bg-orange-600 text-white rounded text-sm hover:bg-orange-700 disabled:opacity-50 flex items-center gap-1">
                <Zap size={14} />{generating ? 'Génération AI...' : `Générer (${factures.length} factures)`}
              </button>
            </div>
            {!plan && <p className="text-xs text-amber-600">⚠ Plan comptable requis. Importez-le d'abord.</p>}
            {factures.length === 0 && <p className="text-xs text-gray-400">Aucune facture à traiter.</p>}
          </div>
          {ecritures.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
              ✓ {ecritures.length} écriture(s) générée(s). Passez à l'onglet "Écritures" pour vérifier.
            </div>
          )}
        </div>
      )}

      {/* TAB: ECRITURES */}
      {tab === 'ecritures' && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <button onClick={addEcriture} className="bg-orange-600 text-white px-3 py-1.5 rounded text-sm hover:bg-orange-700 flex items-center gap-1">
              + Ajouter ligne
            </button>
            <button onClick={handleExportCSV} disabled={ecritures.length === 0} className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 flex items-center gap-1">
              <Download size={14} /> CSV
            </button>
            <button onClick={handleExportXLSX} disabled={ecritures.length === 0} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 flex items-center gap-1">
              <Download size={14} /> XLSX
            </button>
            <button onClick={() => setEcritures([])} disabled={ecritures.length === 0} className="text-red-400 hover:text-red-600 text-sm border border-red-200 px-3 py-1.5 rounded">
              <Trash2 size={14} className="inline mr-1" /> Vider
            </button>
          </div>

          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-2 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Journal</th>
                  <th className="px-2 py-2 text-left">N° Pièce</th>
                  <th className="px-2 py-2 text-left">Compte</th>
                  <th className="px-2 py-2 text-left">Libellé</th>
                  <th className="px-2 py-2 text-center">D/C</th>
                  <th className="px-2 py-2 text-right">Débit</th>
                  <th className="px-2 py-2 text-right">Crédit</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {ecritures.map(e => (
                  <tr key={e.id} className="border-t hover:bg-gray-50">
                    <td className="px-1 py-1"><input type="date" value={e.date_operation} onChange={ev => updateEcriture(e.id, 'date_operation', ev.target.value)} className="w-28 text-xs border rounded px-1 py-0.5" /></td>
                    <td className="px-2 py-1 text-xs font-mono">{e.journal_code}</td>
                    <td className="px-1 py-1"><input value={e.numero_doc} onChange={ev => updateEcriture(e.id, 'numero_doc', ev.target.value)} className="w-24 text-xs border rounded px-1 py-0.5" /></td>
                    <td className="px-1 py-1"><input value={e.compte} onChange={ev => updateEcriture(e.id, 'compte', ev.target.value)} className="w-16 text-xs border rounded px-1 py-0.5 font-mono" /></td>
                    <td className="px-1 py-1"><input value={e.libelle} onChange={ev => updateEcriture(e.id, 'libelle', ev.target.value)} className="w-40 text-xs border rounded px-1 py-0.5" /></td>
                    <td className="px-2 py-1 text-center">
                      <select value={e.sens} onChange={ev => updateEcriture(e.id, 'sens', ev.target.value)} className="text-xs border rounded px-1 py-0.5">
                        <option value="D">D</option><option value="C">C</option>
                      </select>
                    </td>
                    <td className="px-1 py-1"><input type="number" step="0.001" value={e.sens === 'D' ? e.montant : ''} onChange={ev => { const v = parseFloat(ev.target.value) || 0; updateEcriture(e.id, 'montant', v); updateEcriture(e.id, 'sens', 'D'); }} className="w-24 text-xs border rounded px-1 py-0.5 text-right font-mono" placeholder="0.000" /></td>
                    <td className="px-1 py-1"><input type="number" step="0.001" value={e.sens === 'C' ? e.montant : ''} onChange={ev => { const v = parseFloat(ev.target.value) || 0; updateEcriture(e.id, 'montant', v); updateEcriture(e.id, 'sens', 'C'); }} className="w-24 text-xs border rounded px-1 py-0.5 text-right font-mono" placeholder="0.000" /></td>
                    <td className="px-1"><button onClick={() => deleteEcriture(e.id)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button></td>
                  </tr>
                ))}
                {ecritures.length === 0 && <tr><td colSpan={9} className="text-center text-gray-400 py-6">Aucune écriture. Générez depuis l'onglet "Générer".</td></tr>}
              </tbody>
              {ecritures.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 bg-gray-50 font-semibold">
                    <td colSpan={6} className="px-2 py-2 text-right text-xs">TOTAUX</td>
                    <td className="px-2 py-2 text-right text-xs font-mono text-blue-700">{totalD.toFixed(3)}</td>
                    <td className="px-2 py-2 text-right text-xs font-mono text-emerald-700">{totalC.toFixed(3)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* TAB: EXPORT (Contrôle + Export) */}
      {tab === 'export' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-3">
              <ShieldCheck size={20} className="text-blue-600" />
              <div>
                <h3 className="font-medium text-sm">Contrôle IA</h3>
                <p className="text-xs text-gray-400">Vérifie balance, TVA, comptes du plan</p>
              </div>
              <button onClick={handleVerifyAI} disabled={verifying || ecritures.length === 0}
                className="ml-auto px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                <ShieldCheck size={14} />{verifying ? 'Vérification...' : 'Vérifier avec IA'}
              </button>
            </div>
          </div>

          {verifyResult && (
            <div className={`rounded-lg border p-4 ${verifyResult.verdict === 'OK' ? 'bg-green-50 border-green-200' : verifyResult.verdict === 'ATTENTION' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                {verifyResult.verdict === 'OK' ? <CheckCircle size={18} className="text-green-600" /> : <span className="text-red-600 font-bold">!</span>}
                <span className={`font-semibold ${verifyResult.verdict === 'OK' ? 'text-green-700' : verifyResult.verdict === 'ATTENTION' ? 'text-amber-700' : 'text-red-700'}`}>
                  {verifyResult.verdict} — Score: {verifyResult.score}/100
                </span>
              </div>
              <p className="text-xs text-gray-600 mb-2">{verifyResult.summary}</p>
              {verifyResult.checks.length > 0 && (
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {verifyResult.checks.map((c, i) => (
                    <div key={i} className={`flex items-start gap-2 text-xs ${c.status === 'error' ? 'text-red-600' : c.status === 'warning' ? 'text-amber-600' : 'text-green-600'}`}>
                      <span>{c.status === 'ok' ? '✓' : c.status === 'warning' ? '⚠' : '✗'}</span>
                      <span><strong>{c.name}:</strong> {c.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="bg-white rounded-lg border p-4 space-y-3">
            <h3 className="font-semibold text-gray-700 text-sm">Export</h3>
            <div className="flex gap-3 items-center flex-wrap">
              <button onClick={handleExportCSV} disabled={ecritures.length === 0} className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-1">
                <Download size={15} /> Export CSV
              </button>
              <button onClick={handleExportXLSX} disabled={ecritures.length === 0} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                <Download size={15} /> Export XLSX
              </button>
              <span className="text-sm text-gray-500">{factures.length} factures / {ecritures.length} écritures</span>
            </div>
            <p className="text-xs text-gray-400">Format compatible Axeane: N° pièce | Date | Journal | Libellé | Compte | Débit | Crédit</p>
          </div>
        </div>
      )}
    </div>
  );
}
