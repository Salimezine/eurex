import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { orgApi } from '../lib/orgApi';

type Results = {
  clients: any[];
  dossiers: any[];
  tasks: any[];
  documents: any[];
  notes: any[];
};

const EMPTY: Results = { clients: [], dossiers: [], tasks: [], documents: [], notes: [] };

const fmtMonth = (m: number | null) => {
  if (!m) return '';
  const labels = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  return labels[(m || 1) - 1];
};

export default function OrgSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(null); setOpen(false); setBusy(false); return; }
    setBusy(true);
    const timer = setTimeout(() => {
      orgApi.search(term)
        .then(r => { setRes(r); setOpen(true); })
        .catch(() => { setRes(EMPTY); setOpen(true); })
        .finally(() => setBusy(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const go = (kind: 'client' | 'dossier' | 'task' | 'doc' | 'note', item: any) => {
    setOpen(false);
    setQ('');
    if (kind === 'client') navigate(item.dossier_id ? `/cabinet/dossier/${item.dossier_id}` : '/cabinet');
    else if (kind === 'dossier') navigate(`/cabinet/dossier/${item.id}`);
    else if (kind === 'task') navigate(`/cabinet/dossier/${item.dossier_id}?task=${item.id}`);
    else if (kind === 'doc') navigate(`/cabinet/dossier/${item.dossier_id}?tab=documents`);
    else if (kind === 'note') navigate(`/cabinet/dossier/${item.dossier_id}?tab=notes`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && res && open) {
      if (res.clients.length) go('client', res.clients[0]);
      else if (res.dossiers.length) go('dossier', res.dossiers[0]);
      else if (res.tasks.length) go('task', res.tasks[0]);
      else if (res.documents.length) go('doc', res.documents[0]);
      else if (res.notes.length) go('note', res.notes[0]);
    }
  };

  const r = res || EMPTY;
  const total = r.clients.length + r.dossiers.length + r.tasks.length + r.documents.length + r.notes.length;

  const section = (title: string, icon: string, items: any[], kind: 'client' | 'dossier' | 'task' | 'doc' | 'note', render: (item: any) => React.ReactNode) => (
    items.length > 0 && (
      <div key={kind}>
        <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{icon} {title} ({items.length})</div>
        {items.map((item: any) => (
          <button
            key={`${kind}-${item.id}`}
            type="button"
            data-testid="search-result"
            onClick={() => go(kind, item)}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-800 transition-colors flex items-start gap-2"
          >
            {render(item)}
          </button>
        ))}
      </div>
    )
  );

  return (
    <div ref={boxRef} className="relative mb-4" data-testid="search-box">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">🔍</span>
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          onFocus={() => { if (res) setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder="Rechercher un client, dossier, tâche, document ou note…"
          aria-label="Recherche globale"
          data-testid="search-input"
          className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl bg-gray-50 text-sm focus:bg-white focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none"
        />
        {busy && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</span>}
      </div>
      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-y-auto max-h-96" data-testid="search-results">
          {total === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">Aucun résultat pour « {q.trim()} »</div>
          ) : (
            <>
              {section('Clients', '👤', r.clients, 'client', (c: any) => (
                <>
                  <span className="font-medium">{c.name}</span>
                  {c.matricule_fiscal && <span className="text-xs text-gray-400">· {c.matricule_fiscal}</span>}
                  {c.exercice && <span className="text-xs text-gray-400">· {c.exercice}</span>}
                </>
              ))}
              {section('Dossiers', '📁', r.dossiers, 'dossier', (d: any) => (
                <>
                  <span className="font-medium">{d.client_name}</span>
                  <span className="text-xs text-gray-400">· {d.exercice}</span>
                  {typeof d.cached_progress === 'number' && <span className="text-xs text-gray-400">· {d.cached_progress}%</span>}
                </>
              ))}
              {section('Tâches', '☐', r.tasks, 'task', (tk: any) => (
                <>
                  <span className="font-medium">{tk.label}</span>
                  <span className="text-xs text-gray-400">· {tk.client_name} · {tk.exercice}{tk.month ? ` · ${fmtMonth(tk.month)}` : ''}</span>
                </>
              ))}
              {section('Documents', '📄', r.documents, 'doc', (dc: any) => (
                <>
                  <span className="font-medium">{dc.label}{dc.received ? ' ✓' : ''}</span>
                  <span className="text-xs text-gray-400">· {dc.client_name} · {dc.exercice}</span>
                </>
              ))}
              {section('Notes', '📝', r.notes, 'note', (nt: any) => (
                <>
                  <span className="truncate">{nt.content}</span>
                  <span className="text-xs text-gray-400">· {nt.client_name}</span>
                </>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
