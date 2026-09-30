import { useRef, useState } from 'react';
import { Scissors, Download, FileArchive, Loader2, X, FileText, AlertTriangle, Eye } from 'lucide-react';
import { splitPdfFile, rebuildSplitNames, type SplitResult } from '../lib/splitFactures';
import PdfViewer from './PdfViewer';

interface Props { onClose: () => void; }

export default function SplitPdfTool({ onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<SplitResult[]>([]);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<SplitResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async (file: File) => {
    setBusy(true); setError(''); setResults([]); setProgress('Chargement...');
    try {
      const res = await splitPdfFile(file, setProgress);
      setResults(res);
      setProgress('');
    } catch (e: any) {
      setError(e?.message || String(e));
      setProgress('');
    } finally {
      setBusy(false);
    }
  };

  const updateResult = (page: number, patch: Partial<SplitResult>) => {
    setResults(prev => rebuildSplitNames(prev.map(r => (r.page === page ? { ...r, ...patch } : r))));
  };

  const downloadOne = (r: SplitResult) => {
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement('a');
    a.href = url; a.download = r.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const downloadZip = async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const r of results) zip.file(r.name, r.blob);
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'factures_scindees.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <>
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => { if (!busy) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2.5">
            <span className="bg-indigo-100 text-indigo-700 rounded-lg p-2"><Scissors size={18} /></span>
            <div>
              <h2 className="text-base font-bold text-gray-900">Scinder un PDF en factures</h2>
              <p className="text-xs text-gray-500">Une page = un PDF nommé fournisseur_date (OCR automatique)</p>
            </div>
          </div>
          <button onClick={() => { if (!busy) onClose(); }} className="text-gray-400 hover:text-gray-600 p-1" disabled={busy}><X size={20} /></button>
        </div>

        <div className="p-6 overflow-y-auto">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }}
          />

          {!results.length && !busy && (
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl py-10 hover:border-indigo-400 hover:bg-indigo-50/50 transition-all flex flex-col items-center gap-2"
            >
              <FileText className="w-8 h-8 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">Choisir un PDF multi-pages</span>
              <span className="text-xs text-gray-400">Chaque page devient un PDF à part, nommé d'apres le fournisseur et la date</span>
            </button>
          )}

          {busy && (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-sm text-gray-600">{progress}</p>
              <p className="text-xs text-gray-400">L'OCR peut prendre quelques secondes par page</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {results.length > 0 && (
            <>
              <p className="text-sm font-semibold text-gray-800 mb-3">{results.length} PDF(s) genere(s) :</p>
              <div className="divide-y border rounded-lg max-h-[45vh] overflow-y-auto">
                {results.map(r => (
                  <div key={r.page} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="text-xs text-gray-400 w-6 shrink-0">{String(r.page).padStart(2, '0')}</span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <input
                        value={r.supplier === '(introuvable)' ? '' : r.supplier}
                        onChange={e => updateResult(r.page, { supplier: e.target.value })}
                        placeholder="Fournisseur introuvable"
                        title="Cliquer pour corriger le fournisseur"
                        className="w-full bg-transparent border border-transparent hover:border-gray-200 focus:border-indigo-400 rounded px-1.5 py-0.5 text-sm font-medium text-gray-800 focus:outline-none focus:bg-indigo-50/40"
                      />
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="date"
                          value={r.date === '(pas de date)' ? '' : r.date}
                          onChange={e => updateResult(r.page, { date: e.target.value })}
                          title="Cliquer pour corriger la date"
                          className="bg-transparent border border-transparent hover:border-gray-200 focus:border-indigo-400 rounded px-1.5 py-0.5 text-xs text-gray-500 focus:outline-none focus:bg-indigo-50/40 shrink-0"
                        />
                        <span className="text-[11px] font-mono text-gray-400 truncate" title={r.name}>{r.name}</span>
                      </div>
                    </div>
                    <button onClick={() => setPreview(r)} title="Apercu" className="text-gray-400 hover:text-indigo-600 p-1.5 shrink-0">
                      <Eye size={16} />
                    </button>
                    <button onClick={() => downloadOne(r)} title="Telecharger" className="text-indigo-600 hover:text-indigo-800 p-1.5 shrink-0">
                      <Download size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {results.length > 0 && (
          <div className="px-6 py-4 border-t flex items-center justify-between">
            <button onClick={() => { setResults([]); setError(''); }} className="text-sm text-gray-500 hover:text-gray-700">Nouveau PDF</button>
            <button onClick={downloadZip} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2">
              <FileArchive size={16} /> Tout telecharger (ZIP)
            </button>
          </div>
        )}
      </div>
    </div>

    {preview && (
      <PdfViewer
        blob={preview.blob}
        title={`${String(preview.page).padStart(2, '0')} - ${preview.supplier}`}
        filename={preview.name}
        onClose={() => setPreview(null)}
      />
    )}
    </>
  );
}
