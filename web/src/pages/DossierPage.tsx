import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Upload, Plus, Trash2, Download, ArrowLeft, FileText, Zap, Loader2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { api } from '../lib/api';
import { extractTextFromPDF, extractTextItemsFromPDF } from '../lib/pdf';
import { parseDMIItems, validateFISC } from '../lib/fisc';

let XLSXModule: typeof import('xlsx') | null = null;
async function loadXLSX() {
  if (!XLSXModule) XLSXModule = await import('xlsx');
  return XLSXModule;
}

function parseInvoice(rawText: string) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  let numero = '';
  let date = '';
  let client = '';
  let ht0 = 0, ht19 = 0, tva19 = 0, ttc = 0, timbre = 1.0;
  const p = (s: string) => { try { return parseFloat(s.replace(/ /g, '').replace(',', '.')); } catch { return 0; } };

  for (const line of lines) {
    if (!numero) {
      const m = line.match(/FACTURE\s*N[°o∞.]\s*:\s*(\d{4})\s*\/\s*(\d+)/);
      if (m) numero = m[1] + '/' + m[2];
    }
    if (!date) {
      const m = line.match(/LE\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) date = m[3] + '-' + m[2] + '-' + m[1];
    }
    if (!client) {
      const m = line.match(/^Client\s*:\s*(.+)/);
      if (m) {
        const c = m[1].trim();
        client = c.toUpperCase().includes('PASSAGERS') ? 'CLIENTS PASSAGERS' : c;
      }
    }
    // HT 0%: "AMOUNT  0%  NET H.TVA  :  TOTAL"
    if (!ht0) {
      const m = line.match(/([\d][\d ]*,\d+)\s+0%\s+NET\s+H\.TVA\s*:\s*([\d ][\d ]*,\d+)/);
      if (m) { ht0 = p(m[1]); }
    }
    // HT 19%: "AMOUNT  19%  TVA_AMOUNT"
    if (!ht19) {
      const m = line.match(/([\d][\d ]*,\d+)\s+19%\s+([\d ]*,\d+)/);
      if (m) { ht19 = p(m[1]); tva19 = p(m[2]); }
    }
    // Timbre
    if (timbre === 1.0) {
      const m = line.match(/TIMBRE\s+FIS\.?\s*:\s*([\d ]*,\d+)/);
      if (m) timbre = p(m[1]);
    }
    // TTC
    if (!ttc) {
      const m = line.match(/NET\s+T\.T\.C\.?\s+([\d ]*,\d+)/);
      if (m) ttc = p(m[1]);
    }
  }

  return { date, numero, client, ht0, ht19, tva19, timbre, ttc };
}

function VerificationTVA({ ecritures, journal, dossierId, reload }: { ecritures: any[]; journal: string | null; dossierId: string; reload: () => void }) {
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [fixLoading, setFixLoading] = useState<string | null>(null);

  const htAccount = journal === 'VT J.C' ? '707219' : '707119';
  const tvaAccount = journal === 'VT J.C' ? '436711' : '436710';
  const htSens = 'C'; // HT is always credit in VT J.C and VT C
  const tvaSens = 'C'; // TVA is always credit

  const pieces = new Map<string, any[]>();
  for (const e of ecritures) {
    const key = e.numero_doc || e.piece || 'sans_ref';
    if (!pieces.has(key)) pieces.set(key, []);
    pieces.get(key)!.push(e);
  }

  const checks: any[] = [];
  for (const [pieceRef, lines] of pieces) {
    const htLines = lines.filter((l: any) => l.compte === htAccount && l.sens === htSens);
    const tvaLines = lines.filter((l: any) => l.compte === tvaAccount && l.sens === tvaSens);
    if (htLines.length === 0 || tvaLines.length === 0) continue;
    const ht = htLines.reduce((sum: number, l: any) => sum + (l.montant || 0), 0);
    const tva = tvaLines.reduce((sum: number, l: any) => sum + (l.montant || 0), 0);
    const expected = Math.round(ht * 0.19 * 1000) / 1000;
    const ecart = Math.round((tva - expected) * 1000) / 1000;
    const ok = Math.abs(ecart) < 0.01;
    checks.push({ pieceRef, ht, tva, expected, ecart, ok, date: lines[0].date_operation, libelle: lines[0].libelle, lines });
  }

  const allOk = checks.every(c => c.ok);
  const mismatches = checks.filter(c => !c.ok);

  const launchAI = async (check: any) => {
    setAiLoading(check.pieceRef);
    setAiResult(null);
    try {
      const htLines = check.lines.filter((l: any) => l.compte === htAccount);
      const tvaLines = check.lines.filter((l: any) => l.compte === tvaAccount);
      const htDetail = htLines.map((l: any) => `  ${l.libelle || '-'}: ${(l.montant || 0).toFixed(3)}`).join('\n');
      const tvaDetail = tvaLines.map((l: any) => `  ${l.libelle || '-'}: ${(l.montant || 0).toFixed(3)}`).join('\n');
      const prompt = `EXPERT COMPTABLE - Verification TVA piece ${check.pieceRef}

ECRITURES:
${check.lines.map((l: any) => `${l.compte} ${l.sens} ${(l.montant||0).toFixed(3)} | ${l.libelle||''}`).join('\n')}

VERIFICATION:
- Total HT 19% (${htAccount}): ${check.ht.toFixed(3)} DT
  Detail:\n${htDetail}
- Total TVA 19% (${tvaAccount}): ${check.tva.toFixed(3)} DT
  Detail:\n${tvaDetail}
- HT x 19% = ${check.expected.toFixed(3)} DT
- Ecart = ${check.ecart.toFixed(3)} DT

QUESTION: Est-ce que ${check.tva.toFixed(3)} = ${check.expected.toFixed(3)}?
Reponds en 3 lignes max: cause de l'ecart (oui/non) et correction si necessaire.`;
      const r = await fetch('https://eurex-api.ezzinesalim21.workers.dev/api/ai/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await r.json();
      setAiResult({ pieceRef: check.pieceRef, response: data.response || data.error });
    } catch (e: any) {
      setAiResult({ pieceRef: check.pieceRef, response: 'Erreur: ' + e.message });
    } finally {
      setAiLoading(null);
    }
  };

  const fixTVA = async (check: any) => {
    if (!confirm(`Corriger la TVA de la piece ${check.pieceRef}?\nHT: ${check.ht.toFixed(3)} x 19% = ${check.expected.toFixed(3)}\nActuel: ${check.tva.toFixed(3)}`)) return;
    setFixLoading(check.pieceRef);
    try {
      const r = await fetch(`https://eurex-api.ezzinesalim21.workers.dev/api/dossiers/${dossierId}/fix-tva`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero_doc: check.pieceRef, journal_code: journal, expected_tva: check.expected })
      });
      const data = await r.json();
      if (data.ok) {
        setAiResult({ pieceRef: check.pieceRef, response: `Corrige! TVA mise a jour: ${check.expected.toFixed(3)} DT (ecart de ${check.ecart.toFixed(3)} DT corrige).` });
        reload();
      } else {
        setAiResult({ pieceRef: check.pieceRef, response: 'Erreur: ' + (data.error || 'inconnue') });
      }
    } catch (e: any) {
      setAiResult({ pieceRef: check.pieceRef, response: 'Erreur: ' + e.message });
    } finally {
      setFixLoading(null);
    }
  };

  if (ecritures.length === 0) {
    return <div className="bg-white rounded-xl border p-8 text-center text-gray-400 text-sm">Aucune ecriture {journal}. Generez d'abord les ecritures.</div>;
  }

  return (
    <div className="space-y-3">
      {checks.length === 0 && (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-400 text-sm">
          Aucune piece avec TVA 19% trouvee (comptes {htAccount} / {tvaAccount}).
        </div>
      )}

      {checks.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b">
            <h3 className="font-semibold text-sm">Verification TVA 19% — {journal}</h3>
            <p className="text-xs text-gray-500 mt-1">Calcul: HT ({htAccount}) × 19% = TVA ({tvaAccount})</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase">
                <th className="px-4 py-2">Piece</th><th className="px-4 py-2">Date</th><th className="px-4 py-2 text-right">HT 19%</th><th className="px-4 py-2 text-right">TVA Calculee</th><th className="px-4 py-2 text-right">TVA Ecrite</th><th className="px-4 py-2 text-right">Ecart</th><th className="px-4 py-2 text-center">Statut</th><th className="px-4 py-2"></th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {checks.map(c => (
                  <tr key={c.pieceRef} className={c.ok ? 'hover:bg-gray-50' : 'bg-red-50'}>
                    <td className="px-4 py-2 font-mono text-xs">{c.pieceRef}</td>
                    <td className="px-4 py-2 text-xs">{c.date}</td>
                    <td className="px-4 py-2 text-right font-mono">{c.ht.toFixed(3)}</td>
                    <td className="px-4 py-2 text-right font-mono">{c.expected.toFixed(3)}</td>
                    <td className="px-4 py-2 text-right font-mono">{c.tva.toFixed(3)}</td>
                    <td className={`px-4 py-2 text-right font-mono font-bold ${c.ok ? 'text-emerald-600' : 'text-red-600'}`}>{c.ecart.toFixed(3)}</td>
                    <td className="px-4 py-2 text-center">{c.ok ? <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded">OK</span> : <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded">ERREUR</span>}</td>
                    <td className="px-4 py-2">
                      {!c.ok && (
                        <div className="flex gap-1">
                          <button onClick={() => launchAI(c)} disabled={aiLoading === c.pieceRef || fixLoading === c.pieceRef}
                            className="px-3 py-1 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1">
                            {aiLoading === c.pieceRef ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                            {aiLoading === c.pieceRef ? 'Analyse...' : 'Verifier IA'}
                          </button>
                          <button onClick={() => fixTVA(c)} disabled={fixLoading === c.pieceRef || aiLoading === c.pieceRef}
                            className="px-3 py-1 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1">
                            {fixLoading === c.pieceRef ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Corriger'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aiResult && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h4 className="font-semibold text-sm text-amber-700 mb-2 flex items-center gap-2">
            <Zap className="w-4 h-4" /> Resultat IA — Piece {aiResult.pieceRef}
          </h4>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{typeof aiResult.response === 'object' ? JSON.stringify(aiResult.response, null, 2) : aiResult.response}</p>
          <button onClick={() => setAiResult(null)} className="mt-3 text-xs text-amber-600 hover:underline">Fermer</button>
        </div>
      )}
    </div>
  );
}

export default function DossierPage() {
  const { id } = useParams<{ id: string }>();
  const [dossier, setDossier] = useState<any>(null);
  const [pieces, setPieces] = useState<any[]>([]);
  const [ecritures, setEcritures] = useState<any[]>([]);
  const [factures, setFactures] = useState<any[]>([]);
  const [journal, setJournal] = useState<'VT J.C' | 'VT C' | 'FISC' | null>(null);
  const [tab, setTab] = useState<'factures' | 'rapport' | 'ecritures' | 'analyse' | 'verification'>('factures');
  const [rapport, setRapport] = useState<any[]>([]);
  const [analyse, setAnalyse] = useState<any[]>([]);
  const [analyseLoading, setAnalyseLoading] = useState(false);
  const rapportRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState('');
  const [generating, setGenerating] = useState(false);
  const [vtjcResult, setVtjcResult] = useState<any>(null);
  const [aiReport, setAiReport] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [fDate, setFDate] = useState(new Date().toISOString().split('T')[0]);
  const [fNum, setFNum] = useState('');
  const [fClient, setFClient] = useState('');
  const [fHt0, setFHt0] = useState('');
  const [fHt19, setFHt19] = useState('');
  const [fTva, setFTva] = useState('');
  const [fTtc, setFTtc] = useState('');

  const reload = async (loadEcritures = false) => {
    if (!id) return;
    const [d, p, f, r] = await Promise.all([api.getDossier(id), api.getPieces(id), api.getFactures(id), api.getRapport(id)]);
    setDossier(d); setPieces(p); setFactures(f); setRapport(r);
    if (loadEcritures) {
      const e = await api.getEcritures(id);
      setEcritures(e);
    }
    setLoading(false);
  };

  useEffect(() => { reload(); }, [id]);

  const ecrituresFiltered = journal ? ecritures.filter(e => e.journal_code === journal) : ecritures;

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || !id) return;
    setUploading(true);
    setOcrProgress('Extraction PDF côté navigateur...');
    try {
      if (journal === 'VT J.C') {
        // Client-side: extract factures from each PDF
        let ok = 0;
        for (const file of Array.from(files)) {
          const text = await extractTextFromPDF(file);
          // Parse invoice from text (client-side)
          const inv = parseInvoice(text);
          if (!inv.numero) inv.numero = file.name.replace(/[^0-9]/g, '');
          await api.addFacture(id, { date_facture: inv.date, numero_facture: inv.numero, client: inv.client, total_ht_0: inv.ht0, total_ht_19: inv.ht19, tva_19: inv.tva19, timbre: inv.timbre, total_ttc: inv.ttc });
          ok++;
        }
        setOcrProgress(ok + ' facture(s) extraite(s). Generation VT J.C...');
        await api.generateVTJC(id);
        setOcrProgress('Termine! ' + ok + ' facture(s) + ecritures generees');
      } else if (journal === 'VT C') {
        // Client-side: extract text, send to Worker
        let allText = '';
        for (const file of Array.from(files)) {
          const text = await extractTextFromPDF(file);
          allText += text + '\n';
        }
        setOcrProgress('Envoi au serveur pour traitement...');
        const r = await api.processVTC(id, allText);
        setOcrProgress('Termine! ' + r.totalEntries + ' ecriture(s) VT C extraite(s)');
      } else if (journal === 'FISC') {
        // Client-side: extract items, parse DMI, validate, send to Worker
        setOcrProgress('Extraction DMI...');
        const items = await extractTextItemsFromPDF(files[0]);
        const dmi = parseDMIItems(items);
        const validation = validateFISC(dmi);
        if (!validation.ok) {
          setOcrProgress('Attention: ' + validation.errors.join(', '));
        }
        setOcrProgress('Envoi DMI au serveur...');
        const r = await api.processFISC(id, dmi);
        setOcrProgress('Termine! ' + r.entriesCount + ' ecriture(s) FISC generee(s)');
      }
      await reload(true);
    } catch (e: any) { alert('Erreur: ' + e.message); console.error('Error:', e); }
    finally { setUploading(false); setTimeout(() => setOcrProgress(''), 3000); }
  };

  const verifyAI = async () => {
    if (!id) return;
    setAiLoading(true);
    setAiReport(null);
    try {
      const r = await api.verifyAI(id);
      setAiReport(r.report);
    } catch (e: any) {
      setAiReport({ verdict: 'ERREUR', score: 0, checks: [], summary: 'Erreur: ' + e.message });
    } finally {
      setAiLoading(false);
    }
  };

  const addFacture = async () => {
    if (!id || !fNum || !fDate) return;
    const ht0 = parseFloat(fHt0) || 0;
    const ht19 = parseFloat(fHt19) || 0;
    const tva = parseFloat(fTva) || 0;
    const ttc = parseFloat(fTtc) || (ht0 + ht19 + tva + 1);
    await api.addFacture(id, { date_facture: fDate, numero_facture: fNum, client: fClient, total_ht_0: ht0, total_ht_19: ht19, tva_19: tva, timbre: 1, total_ttc: ttc });
    setFNum(''); setFHt0(''); setFHt19(''); setFTva(''); setFTtc(''); setFClient('');
    reload();
  };

  const delFacture = async (fid: string) => { await api.deleteFacture(fid); reload(); };
  const delAllFactures = async () => {
    if (!id || !confirm('Supprimer TOUT : factures + ecritures + rapport ?')) return;
    await api.deleteAllFactures(id);
    await api.deleteRapport(id);
    reload();
  };

  const generate = async () => {
    if (!id || journal !== 'VT J.C') return;
    setGenerating(true);
    setVtjcResult(null);
    try {
      const result = await api.generateVTJC(id);
      setVtjcResult(result);
      reload(true);
    } catch (e: any) { alert('Erreur: ' + e.message); }
    finally { setGenerating(false); }
  };

  const delEcriture = async (eid: string) => { await api.deleteEcriture(eid); reload(true); };

  const handleRapport = async (files: FileList | null) => {
    if (!files?.[0] || !id) return;
    try {
      setOcrProgress('Extraction rapport...');
      const text = await extractTextFromPDF(files[0]);
      const modes = parseRapport(text);
      if (!Object.keys(modes).length) { alert('Aucune ligne detectee'); return; }
      const rows = Object.entries(modes).map(([date, v]) => ({ date_jour: date, ...v }));
      const r = await api.uploadRapport(id, rows);
      alert('Rapport importe: ' + r.count + ' jour(s)');
      reload();
    } catch (e: any) { alert('Erreur rapport: ' + e.message); }
    if (rapportRef.current) rapportRef.current.value = '';
    setTimeout(() => setOcrProgress(''), 3000);
  };

  function parseRapport(text: string) {
    const modes: Record<string, any> = {};
    const p = (s: string) => parseFloat(s.replace(/ /g, '').replace(',', '.')) || 0;
    const num = '\\d[\\d ]*\\d,\\d+|\\d,\\d+';
    const sep = '\\s*[|]?\\s*';
    const re = new RegExp('(\\d{2})\\/(\\d{2})\\/(\\d{4})' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')' + sep + '(' + num + ')');
    for (const line of text.split('\n')) {
      const m = line.match(re);
      if (!m) continue;
      const date = m[3] + '-' + m[2] + '-' + m[1];
      modes[date] = { especes: p(m[4]), cheques: p(m[5]), tpe: p(m[6]), bonsAchat: p(m[7]), avoir: p(m[8]), credit: p(m[9]) };
    }
    return modes;
  }
  const delRapport = async () => { if (!id || !confirm('Supprimer rapport?')) return; await api.deleteRapport(id); reload(); };

  const loadAnalyse = async () => {
    if (!id) return;
    setAnalyseLoading(true);
    try { const r = await api.getExcluded(id); setAnalyse(r); } catch (e: any) { alert('Erreur: ' + e.message); }
    finally { setAnalyseLoading(false); }
  };
  useEffect(() => { if (tab === 'analyse' && id) loadAnalyse(); }, [tab, id]);

  const exportCSV = async () => {
    if (!id) return;
    const csv = await api.exportCSV(id);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'ecritures_' + (journal || 'ALL') + '_' + (dossier?.nom || id) + '.csv'; a.click();
    URL.revokeObjectURL(url);
    await api.deleteAllEcritures(id); await api.deleteAllFactures(id); reload(true);
  };

  const exportXLSX = async () => {
    if (!id) return;
    const XLSX = await loadXLSX();
    const data = ecrituresFiltered.sort((a, b) => (a.date_operation || '').localeCompare(b.date_operation || ''));

    const ACCOUNT_LABELS: Record<string, string> = {
      '411004': 'CLIENTS PASSAGERS ESPECES', '411003': 'CLIENTS PASSAGERS CHEQUES',
      '411005': 'CLIENTS PASSAGERS TPE', '709500': 'AVOIRS FINACIERS',
      '707200': 'VENTES MARCHANDISES J.C 0%', '707219': 'VENTES MARCHANDISES J.C 19%',
      '707100': 'VENTES MARCHANDISES C 0%', '707119': 'VENTES MARCHANDISES C 19%',
      '436711': 'TVA COLLECTEE 19% J.C', '436710': 'TVA COLLECTEE 19% C',
      '437500': 'TIMBRE FISCAL', '634500': 'ECARTS DE REGLEMENT',
      '457100': 'RF IMPOTS ET TAXE A PAYER', '432100': 'RETENUE A LA SOURCE SUR SALAIRES',
      '432101': 'CSS', '432300': 'RETENUE A LA SOURCE SUR LOYERS',
      '432400': 'RETENUE A LA SOURCE SUR MARCHES', '437300': 'TFP',
      '437200': 'FOPROLOS', '436510': 'TVA A PAYER',
      '436660': 'TVA DEDUCTIBLE', '436670': 'CREDIT DE TVA A REPORTER',
      '437400': 'TCL', '661100': 'TFP', '661200': 'FOPROLOS', '661300': 'TCL',
    };

    const fmt = (d: string) => { if (d?.includes('-')) { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; } return d || ''; };

    const xlsxHeaders = ['N° pièce comptable', 'Date pièce comptable', 'Journal', 'Libellé', 'N° compte', 'Libellé trésorerie', 'Débit', 'Crédit'];
    const xlsxRows = [xlsxHeaders];

    for (const e of data) {
      xlsxRows.push([
        e.numero_doc || '', fmt(e.date_operation || ''), e.journal_code || '', e.libelle || '',
        e.compte || '', e.tresorerie || '',
        e.sens === 'D' ? (e.montant || 0).toFixed(3) : '0.000',
        e.sens === 'C' ? (e.montant || 0).toFixed(3) : '0.000'
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(xlsxRows);
    ws['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 8 }, { wch: 35 }, { wch: 10 }, { wch: 30 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ecritures');
    XLSX.writeFile(wb, 'ecritures_' + (journal || 'ALL').replace(' ', '') + '_' + (dossier?.nom || id) + '.xlsx');
    await api.deleteAllEcritures(id); await api.deleteAllFactures(id); reload(true);
  };

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" /></div>;

  const ecrituresVTJC = ecritures.filter(e => e.journal_code === 'VT J.C');
  const ecrituresVTC = ecritures.filter(e => e.journal_code === 'VT C');
  const ecrituresFISC = ecritures.filter(e => e.journal_code === 'FISC');

  if (!journal) {
    return (
      <div className="space-y-6">
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Retour</Link>
        <div className="max-w-lg mx-auto mt-8 space-y-4">
          <div className="bg-white rounded-xl border p-6 text-center">
            <h1 className="text-xl font-bold mb-1">{dossier?.nom}</h1>
            <p className="text-sm text-gray-500 mb-6">Choisir le journal :</p>
            <div className="grid grid-cols-3 gap-4">
              <button onClick={() => { setJournal('VT J.C'); setTab('factures'); }} className="border-2 border-violet-200 rounded-xl p-6 hover:border-violet-500 hover:bg-violet-50 transition-all group">
                <Zap className="w-10 h-10 mx-auto text-violet-500 mb-3 group-hover:scale-110 transition-transform" />
                <h3 className="font-semibold text-violet-700">VT J.C</h3>
                <p className="text-xs text-gray-500 mt-1">Factures → Calcul des ecritures</p>
                <p className="text-xs text-gray-400 mt-2">{ecrituresVTJC.length} ecriture(s)</p>
              </button>
              <button onClick={() => { setJournal('VT C'); setTab('factures'); }} className="border-2 border-teal-200 rounded-xl p-6 hover:border-teal-500 hover:bg-teal-50 transition-all group">
                <FileText className="w-10 h-10 mx-auto text-teal-500 mb-3 group-hover:scale-110 transition-transform" />
                <h3 className="font-semibold text-teal-700">VT C</h3>
                <p className="text-xs text-gray-500 mt-1">Factures → Extraction PDF</p>
                <p className="text-xs text-gray-400 mt-2">{ecrituresVTC.length} ecriture(s)</p>
              </button>
              <button onClick={() => { setJournal('FISC'); setTab('ecritures'); }} className="border-2 border-amber-200 rounded-xl p-6 hover:border-amber-500 hover:bg-amber-50 transition-all group">
                <FileText className="w-10 h-10 mx-auto text-amber-500 mb-3 group-hover:scale-110 transition-transform" />
                <h3 className="font-semibold text-amber-700">FISC</h3>
                <p className="text-xs text-gray-500 mt-1">DMI → Extraction PDF</p>
                <p className="text-xs text-gray-400 mt-2">{ecrituresFISC.length} ecriture(s)</p>
              </button>
            </div>
          </div>
          <div className="flex gap-2 justify-center">
            {ecrituresVTJC.length > 0 && <button onClick={() => { setJournal('VT J.C'); exportXLSX(); }} className="bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 flex items-center gap-1.5"><FileSpreadsheet className="w-4 h-4" /> XLSX VT J.C</button>}
            {ecrituresVTC.length > 0 && <button onClick={() => { setJournal('VT C'); exportXLSX(); }} className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 flex items-center gap-1.5"><FileSpreadsheet className="w-4 h-4" /> XLSX VT C</button>}
            {ecrituresFISC.length > 0 && <button onClick={() => { setJournal('FISC'); exportXLSX(); }} className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 flex items-center gap-1.5"><FileSpreadsheet className="w-4 h-4" /> XLSX FISC</button>}
          </div>
        </div>
      </div>
    );
  }

  const isVTJC = journal === 'VT J.C';
  const isVTC = journal === 'VT C';
  const isFISC = journal === 'FISC';

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <button onClick={() => { setJournal(null); setTab('factures'); }} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Retour</button>
          <span className="text-gray-300">|</span>
          <span className="text-sm text-gray-400">{dossier?.nom}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-lg text-sm font-bold ${isFISC ? 'bg-amber-100 text-amber-700' : isVTJC ? 'bg-violet-100 text-violet-700' : 'bg-teal-100 text-teal-700'}`}>
              {isFISC ? <FileText className="w-4 h-4 inline mr-1" /> : isVTJC ? <Zap className="w-4 h-4 inline mr-1" /> : <FileText className="w-4 h-4 inline mr-1" />} {journal}
            </span>
            <span className="text-sm text-gray-500">{isFISC ? `${ecrituresFiltered.length} ecriture(s)` : `${ecrituresFiltered.length} ecriture(s) | ${factures.length} facture(s) | ${rapport.length} jour(s) rapport`}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCSV} disabled={!ecrituresFiltered.length} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"><Download className="w-3 h-3" /> CSV</button>
            <button onClick={exportXLSX} disabled={!ecrituresFiltered.length} className={`${isFISC ? 'bg-amber-600 hover:bg-amber-700' : isVTJC ? 'bg-violet-600 hover:bg-violet-700' : 'bg-teal-600 hover:bg-teal-700'} text-white px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50 flex items-center gap-1`}><FileSpreadsheet className="w-3 h-3" /> XLSX</button>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {(isFISC ? ['ecritures'] as const : (['factures', 'rapport', 'ecritures', 'analyse', 'verification'] as const)).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${tab === t ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
            {t === 'analyse' ? <><AlertTriangle className="w-3 h-3 inline mr-1" />Analyse</> : t === 'verification' ? <>Verification TVA</> : t} {t === 'factures' ? `(${factures.length})` : t === 'ecritures' ? `(${ecrituresFiltered.length})` : t === 'rapport' ? `(${rapport.length})` : ''}
          </button>
        ))}
      </div>

      {isFISC && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold text-amber-800">Declarations fiscales — DMI</h2>
                <p className="text-xs text-amber-600 mt-1">Uploadez le PDF DMI du mois. Les ecritures sont generees automatiquement (5 pieces A-E).</p>
              </div>
              <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => handleUpload(e.target.files)} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5">
                <Upload className="w-4 h-4" /> {uploading ? 'Extraction...' : 'Uploadez le DMI PDF'}
              </button>
            </div>
            {ocrProgress && <p className="text-xs text-amber-700 mb-2">{ocrProgress}</p>}
          </div>
          <div className="flex gap-2 justify-end items-center">
            <button onClick={exportCSV} disabled={!ecrituresFiltered.length} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"><Download className="w-3 h-3" /> CSV</button>
            <button onClick={exportXLSX} disabled={!ecrituresFiltered.length} className="bg-amber-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1"><FileSpreadsheet className="w-3 h-3" /> XLSX</button>
            <button onClick={verifyAI} disabled={aiLoading} className="bg-purple-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
              {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} {aiLoading ? 'Analyse IA...' : 'Verifier IA'}
            </button>
          </div>
          {aiReport && (
            <div className={`rounded-xl border p-4 ${aiReport.verdict === 'OK' ? 'bg-green-50 border-green-200' : aiReport.verdict === 'ERREUR' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className={`font-semibold ${aiReport.verdict === 'OK' ? 'text-green-700' : aiReport.verdict === 'ERREUR' ? 'text-red-700' : 'text-yellow-700'}`}>
                  {aiReport.verdict === 'OK' ? 'Verification IA: OK' : aiReport.verdict === 'ERREUR' ? 'Verification IA: Erreur' : 'Verification IA: Attention'}
                </h3>
                <span className={`text-2xl font-bold ${aiReport.verdict === 'OK' ? 'text-green-600' : aiReport.verdict === 'ERREUR' ? 'text-red-600' : 'text-yellow-600'}`}>
                  {aiReport.score}/100
                </span>
              </div>
              <p className="text-sm mb-3">{aiReport.summary}</p>
              {aiReport.checks?.length > 0 && (
                <div className="space-y-1">
                  {aiReport.checks.map((c: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span>{c.status === 'ok' ? '✅' : c.status === 'error' ? '❌' : '⚠️'}</span>
                      <span className="font-medium">{c.name}:</span>
                      <span>{c.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {ecrituresFiltered.length > 0 && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase">
                    <th className="px-4 py-3">Date</th><th className="px-4 py-3">N Doc</th><th className="px-4 py-3">Libelle</th><th className="px-4 py-3">Compte</th><th className="px-4 py-3">Sens</th><th className="px-4 py-3 text-right">Montant</th><th className="px-4 py-3"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {ecrituresFiltered.map(e => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2">{e.date_operation}</td>
                        <td className="px-4 py-2 font-mono text-xs">{e.numero_doc || '-'}</td>
                        <td className="px-4 py-2">{e.libelle}</td>
                        <td className="px-4 py-2 font-mono text-xs">{e.compte}</td>
                        <td className="px-4 py-2"><span className={e.sens === 'D' ? 'text-emerald-600 font-bold' : 'text-blue-600 font-bold'}>{e.sens}</span></td>
                        <td className="px-4 py-2 text-right font-mono">{(e.montant || 0).toFixed(3)}</td>
                        <td className="px-4 py-2"><button onClick={() => delEcriture(e.id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {ecrituresFiltered.length > 0 && (
            <div className="flex gap-2 justify-end">
              <button onClick={async () => { if (!id || !confirm('Supprimer ecritures FISC ?')) return; await api.deleteAllEcritures(id); reload(true); }} className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center gap-1">
                <Trash2 className="w-4 h-4" /> Supprimer FISC
              </button>
            </div>
          )}
          {ecrituresFiltered.length === 0 && !uploading && (
            <div className="bg-white rounded-xl border p-8 text-center text-gray-400 text-sm">
              Aucune ecriture FISC. Uploadez le DMI PDF pour generer les ecritures.
            </div>
          )}
        </div>
      )}

      {tab === 'factures' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Ajouter une facture</h2>
              <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => handleUpload(e.target.files)} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                <Upload className="w-3 h-3" /> {uploading ? 'Extraction...' : 'Upload PDF(s)'}
              </button>
            </div>
            {ocrProgress && <p className="text-xs text-blue-600 mb-2">{ocrProgress}</p>}
            <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
              <div><label className="block text-xs text-gray-500 mb-1">Date</label><input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={fDate} onChange={e => setFDate(e.target.value)} /></div>
              <div><label className="block text-xs text-gray-500 mb-1">N Facture</label><input className="w-full border rounded-lg px-3 py-2 text-sm" value={fNum} onChange={e => setFNum(e.target.value)} placeholder="2026/408" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">Client</label><input className="w-full border rounded-lg px-3 py-2 text-sm" value={fClient} onChange={e => setFClient(e.target.value)} placeholder="HBMI CONSULTING" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">HT 0%</label><input type="number" step="0.001" className="w-full border rounded-lg px-3 py-2 text-sm" value={fHt0} onChange={e => setFHt0(e.target.value)} placeholder="0.000" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">HT 19%</label><input type="number" step="0.001" className="w-full border rounded-lg px-3 py-2 text-sm" value={fHt19} onChange={e => setFHt19(e.target.value)} placeholder="0.000" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">TVA 19%</label><input type="number" step="0.001" className="w-full border rounded-lg px-3 py-2 text-sm" value={fTva} onChange={e => setFTva(e.target.value)} placeholder="0.000" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">Net TTC</label><input type="number" step="0.001" className="w-full border rounded-lg px-3 py-2 text-sm" value={fTtc} onChange={e => setFTtc(e.target.value)} placeholder="0.000" /></div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button onClick={addFacture} disabled={!fNum || !fDate} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1">
                <Plus className="w-4 h-4" /> Ajouter
              </button>
              {factures.length > 0 && <button onClick={delAllFactures} className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center gap-1"><Trash2 className="w-4 h-4" /> Supprimer tout</button>}
            </div>
          </div>

          {factures.length > 0 && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-4 py-3">Date</th><th className="px-4 py-3">N Facture</th><th className="px-4 py-3">Client</th><th className="px-4 py-3 text-right">HT 0%</th><th className="px-4 py-3 text-right">HT 19%</th><th className="px-4 py-3 text-right">TVA</th><th className="px-4 py-3 text-right">TTC</th><th className="px-4 py-3"></th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {factures.map(f => (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2">{f.date_facture}</td>
                      <td className="px-4 py-2 font-mono text-xs">{f.numero_facture}</td>
                      <td className="px-4 py-2">{f.client || '-'}</td>
                      <td className="px-4 py-2 text-right font-mono">{(f.total_ht_0 || 0).toFixed(3)}</td>
                      <td className="px-4 py-2 text-right font-mono">{(f.total_ht_19 || 0).toFixed(3)}</td>
                      <td className="px-4 py-2 text-right font-mono">{(f.tva_19 || 0).toFixed(3)}</td>
                      <td className="px-4 py-2 text-right font-mono font-medium">{(f.total_ttc || 0).toFixed(3)}</td>
                      <td className="px-4 py-2"><button onClick={() => delFacture(f.id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {vtjcResult && (
            <div className={`${isVTJC ? 'bg-violet-50 border-violet-200' : 'bg-teal-50 border-teal-200'} border rounded-xl p-4`}>
              <div className="flex justify-between items-center mb-2">
                <h3 className={`font-semibold ${isVTJC ? 'text-violet-800' : 'text-teal-800'}`}>Resultat — {journal}</h3>
                <button onClick={() => setVtjcResult(null)} className="text-gray-400 hover:text-gray-600 text-sm">Fermer</button>
              </div>
              {isVTJC ? (
                <>
                  <p className="text-sm text-violet-700">{vtjcResult.days} jour(s) traite(s), {vtjcResult.entries?.filter((e: any) => !e.excluded).length || 0} ecriture(s)</p>
                  {vtjcResult.anomalies?.length > 0 && (
                    <div className="mt-3">
                      <p className="text-sm font-semibold text-red-700 mb-1">Jours excludes (ecart &gt; 3DT) :</p>
                      {vtjcResult.anomalies.map((a: any, i: number) => (
                        <div key={i} className="bg-white border border-red-200 rounded-lg p-2 mb-2">
                          <p className="text-sm font-mono font-bold text-red-700">{a.date} — {a.error}</p>
                          {a.factures && <pre className="text-xs text-gray-600 mt-1 whitespace-pre-wrap font-mono">{a.factures}</pre>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-teal-700">{vtjcResult.vtcCount || 0} ecriture(s) extraite(s) du PDF</p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'rapport' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-2">Rapport Vente par jour</h2>
            <p className="text-xs text-gray-500 mb-3">Upload le PDF "Vente par jour". Ventilation: Espece→411004 / Cheque→411003 / Carte→411005 / Bons→709500.</p>
            <input ref={rapportRef} type="file" accept=".pdf" className="hidden" onChange={e => handleRapport(e.target.files)} />
            <div className="flex gap-2">
              <button onClick={() => rapportRef.current?.click()} className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 flex items-center gap-1.5"><Upload className="w-4 h-4" /> Choisir rapport PDF</button>
              {rapport.length > 0 && <button onClick={delRapport} className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center gap-1.5"><Trash2 className="w-4 h-4" /> Supprimer</button>}
            </div>
            {rapport.length > 0 && <p className="text-xs text-emerald-600 mt-2">{rapport.length} jour(s) charges</p>}
          </div>
          {rapport.length > 0 && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Espece</th><th className="px-3 py-2 text-right">Cheque</th><th className="px-3 py-2 text-right">Carte</th><th className="px-3 py-2 text-right">Bons+Avoir</th><th className="px-3 py-2 text-right">Credit</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">{rapport.map((r: any) => (
                  <tr key={r.date_jour} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs">{r.date_jour}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.especes.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.cheques.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.tpe.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{((r.bonsAchat||0)+(r.avoir||0)).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{(r.credit||0).toFixed(2)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {isVTJC && (
            <div className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold mb-3">Generer les ecritures VT J.C</h2>
              <p className="text-xs text-gray-500 mb-3">Calcule les ecritures a partir des factures + rapport.</p>
              <button onClick={generate} disabled={generating || !factures.length} className="bg-violet-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5">
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {generating ? 'Generation...' : 'Generer VT J.C'}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'ecritures' && (
        <div className="space-y-3">
          {ecrituresFiltered.length > 0 ? (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase">
                    <th className="px-4 py-3">Date</th><th className="px-4 py-3">N Doc</th><th className="px-4 py-3">Libelle</th><th className="px-4 py-3">Compte</th><th className="px-4 py-3">Sens</th><th className="px-4 py-3 text-right">Montant</th><th className="px-4 py-3"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {ecrituresFiltered.map(e => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2">{e.date_operation}</td>
                        <td className="px-4 py-2 font-mono text-xs">{e.numero_doc || '-'}</td>
                        <td className="px-4 py-2">{e.libelle}</td>
                        <td className="px-4 py-2 font-mono text-xs">{e.compte}</td>
                        <td className="px-4 py-2"><span className={e.sens === 'D' ? 'text-emerald-600 font-bold' : 'text-blue-600 font-bold'}>{e.sens}</span></td>
                        <td className="px-4 py-2 text-right font-mono">{(e.montant || 0).toFixed(3)}</td>
                        <td className="px-4 py-2"><button onClick={() => delEcriture(e.id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border p-8 text-center text-gray-400 text-sm">
              Aucune ecriture {journal}. Ajoutez des factures, uploadez le rapport puis cliquez "Generer".
            </div>
          )}
          {ecrituresFiltered.length > 0 && (
            <div className="flex gap-2 justify-end">
              <button onClick={async () => { if (!id || !confirm('Supprimer ecritures ' + journal + '?')) return; await api.deleteAllEcritures(id); reload(true); }} className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center gap-1">
                <Trash2 className="w-4 h-4" /> Supprimer {journal}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'analyse' && (
        <div className="space-y-4">
          {analyseLoading ? (
            <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" /></div>
          ) : analyse.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Aucune donnee. Ajoutez des factures d'abord.</p>
          ) : (
            <>
              <div className="bg-white rounded-xl border p-5">
                <h2 className="font-semibold mb-2 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> Analyse des ecarts par jour</h2>
                <p className="text-xs text-gray-500">Comparaison Rapport vs Factures — jours avec ecart &gt; 3DT = excludes</p>
              </div>
              {analyse.filter(a => Math.abs(a.ecart) > 3).length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <h3 className="font-semibold text-red-700 text-sm mb-2">Jours excludes :</h3>
                  {analyse.filter(a => Math.abs(a.ecart) > 3).map((a: any) => (
                    <details key={a.date} className="mb-3 bg-white border border-red-200 rounded-lg overflow-hidden">
                      <summary className="px-4 py-3 cursor-pointer hover:bg-red-50 flex items-center justify-between">
                        <span className="font-mono font-bold text-red-700">{a.date}</span>
                        <span className="text-sm">
                          <span className="text-red-600 font-mono font-bold">ecart = {a.ecart.toFixed(3)} DT</span>
                          <span className="text-gray-400 ml-2">| {a.nbFactures} facture(s)</span>
                        </span>
                      </summary>
                      <div className="px-4 pb-3 space-y-3">
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Modes de paiement :</h4>
                          <div className="grid grid-cols-3 gap-1 text-xs font-mono">
                            <span>Espece: {a.modes.especes.toFixed(2)}</span>
                            <span>Cheque: {a.modes.cheques.toFixed(2)}</span>
                            <span>Carte: {a.modes.tpe.toFixed(2)}</span>
                            <span>Bons: {a.modes.bonsAchat.toFixed(2)}</span>
                            <span>Avoir: {a.modes.avoir.toFixed(2)}</span>
                            <span>Credit: {a.modes.credit.toFixed(2)}</span>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Factures :</h4>
                          <table className="w-full text-xs">
                            <thead><tr className="text-gray-400"><th className="text-left">Num</th><th className="text-left">Client</th><th className="text-right">HT0</th><th className="text-right">HT19</th><th className="text-right">TVA</th><th className="text-right">TTC</th></tr></thead>
                            <tbody className="divide-y divide-gray-100">{a.factures.map((f: any, i: number) => <tr key={i}><td className="font-mono">{f.num}</td><td>{f.client}</td><td className="text-right font-mono">{f.ht0.toFixed(3)}</td><td className="text-right font-mono">{f.ht19.toFixed(3)}</td><td className="text-right font-mono">{f.tva.toFixed(3)}</td><td className="text-right font-mono font-medium">{f.ttc.toFixed(3)}</td></tr>)}</tbody>
                          </table>
                        </div>
                        {a.proposedEcritures.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Ecritures proposees :</h4>
                            <table className="w-full text-xs">
                              <thead><tr className="text-gray-400"><th className="text-left">Compte</th><th className="text-left">Sens</th><th className="text-right">Montant</th><th className="text-left">Libelle</th></tr></thead>
                              <tbody className="divide-y divide-gray-100">{a.proposedEcritures.map((l: any, i: number) => <tr key={i}><td className="font-mono">{l.compte}</td><td className={l.sens === 'D' ? 'text-emerald-600 font-bold' : 'text-blue-600 font-bold'}>{l.sens}</td><td className="text-right font-mono">{l.montant.toFixed(3)}</td><td>{l.libelle || '-'}</td></tr>)}</tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              )}
              <div className="bg-white rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase">
                    <th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Factures TTC</th><th className="px-3 py-2 text-right">Rapport Total</th><th className="px-3 py-2 text-right">Ecart</th><th className="px-3 py-2 text-center">Statut</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {analyse.map((a: any) => (
                      <tr key={a.date} className={Math.abs(a.ecart) > 3 ? 'bg-red-50' : 'hover:bg-gray-50'}>
                        <td className="px-3 py-2 font-mono text-xs">{a.date}</td>
                        <td className="px-3 py-2 text-right font-mono">{a.totalFactures.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono">{a.totalModes.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-bold ${Math.abs(a.ecart) > 3 ? 'text-red-600' : Math.abs(a.ecart) > 1 ? 'text-amber-600' : 'text-emerald-600'}`}>{a.ecart.toFixed(3)}</td>
                        <td className="px-3 py-2 text-center">{a.excluded ? <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded">EXCLU</span> : <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded">OK</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
      {tab === 'verification' && (
        <VerificationTVA ecritures={ecrituresFiltered} journal={journal} dossierId={id!} reload={() => reload(true)} />
      )}
    </div>
  );
}
