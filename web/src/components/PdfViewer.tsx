import { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut, Loader2, FileText } from 'lucide-react';

interface Props {
  blob: Blob;
  title?: string;
  filename?: string;
  onClose: () => void;
}

export default function PdfViewer({ blob, title, filename, onClose }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setNumPages(0);
    setPage(1);
    (async () => {
      try {
        const pdfjs: any = await import('pdfjs-dist');
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        }
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (cancelled) return;
        docRef.current = doc;
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Lecture du PDF impossible');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [blob]);

  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !numPages) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await doc.getPage(Math.min(Math.max(page, 1), numPages));
        if (cancelled) return;
        const vp1 = p.getViewport({ scale: 1 });
        const fit = Math.min(1.3, 760 / vp1.width);
        const vp = p.getViewport({ scale: fit * zoom });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
        }
        const task = p.render({
          canvasContext: ctx,
          viewport: vp,
          canvas,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          background: '#ffffff',
        });
        renderTaskRef.current = task;
        await task.promise;
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException') console.warn('render:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [numPages, page, zoom, loading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage(p => Math.min(p + 1, numPages || 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage(p => Math.max(p - 1, 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages, onClose]);

  const download = () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'document.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white shrink-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={16} className="text-indigo-300 shrink-0" />
          <span className="text-sm font-medium truncate">{title || filename || 'Apercu PDF'}</span>
          {numPages > 0 && <span className="text-xs text-gray-400 shrink-0">{numPages} page(s)</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Reduire"
            className="p-2 rounded hover:bg-white/10"><ZoomOut size={16} /></button>
          <span className="text-xs text-gray-300 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))} title="Agrandir"
            className="p-2 rounded hover:bg-white/10"><ZoomIn size={16} /></button>
          <button onClick={download} title="Telecharger" className="p-2 rounded hover:bg-white/10"><Download size={16} /></button>
          <button onClick={onClose} title="Fermer" className="p-2 rounded hover:bg-white/10"><X size={16} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-auto flex items-start justify-center p-4" onClick={e => e.stopPropagation()}>
        {loading && (
          <div className="flex flex-col items-center gap-3 text-gray-300 py-20">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <p className="text-sm">Chargement du PDF...</p>
          </div>
        )}
        {error && <div className="bg-red-900/60 text-red-200 text-sm rounded-lg px-4 py-3 mt-10">{error}</div>}
        {!loading && !error && <canvas ref={canvasRef} className="shadow-2xl" />}
      </div>

      {numPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-3 bg-gray-900 shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={() => setPage(p => Math.max(p - 1, 1))} disabled={page <= 1}
            className="p-2 rounded text-white hover:bg-white/10 disabled:opacity-30"><ChevronLeft size={18} /></button>
          <span className="text-sm text-gray-200">Page {Math.min(page, numPages)} / {numPages}</span>
          <button onClick={() => setPage(p => Math.min(p + 1, numPages))} disabled={page >= numPages}
            className="p-2 rounded text-white hover:bg-white/10 disabled:opacity-30"><ChevronRight size={18} /></button>
        </div>
      )}
    </div>
  );
}
