import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { orgApi } from '../lib/orgApi';

type Item = {
  id: string;
  dossier_id: string | null;
  message: string;
  read: number;
  created_at: string;
};

function ago(s: string): string {
  try {
    const d = new Date(String(s).replace(' ', 'T') + 'Z');
    const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (sec < 60) return 'à l’instant';
    if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
    if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
    return `il y a ${Math.floor(sec / 86400)} j`;
  } catch { return ''; }
}

export default function OrgNotifications() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  const load = () => {
    orgApi.getNotifications()
      .then(r => { setItems(r.notifications || []); setUnread(r.unread || 0); })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const iv = setInterval(() => { if (!document.hidden) load(); }, 120000);
    return () => clearInterval(iv);
  }, []);

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

  const openItem = async (n: Item) => {
    setOpen(false);
    try { await orgApi.readNotification(n.id); } catch { /* ignore */ }
    load();
    if (n.dossier_id) navigate(`/cabinet/dossier/${n.dossier_id}`);
  };

  const markAll = async () => {
    try { await orgApi.readAllNotifications(); } catch { /* ignore */ }
    load();
  };

  return (
    <div ref={boxRef} className="relative mb-4 shrink-0">
      <button
        type="button"
        data-testid="notif-bell"
        title="Notifications et relances"
        aria-label={`Notifications${unread ? ` (${unread} non lues)` : ''}`}
        onClick={() => { setOpen(o => !o); if (!open) load(); }}
        className={`relative px-3 py-2.5 rounded-xl text-sm font-semibold border transition-all ${open
          ? 'bg-purple-600 border-purple-600 text-white shadow-lg shadow-purple-200'
          : 'bg-white border-gray-200 text-gray-600 hover:border-purple-300 hover:text-purple-700'}`}
      >
        🔔
        {unread > 0 && (
          <span
            data-testid="notif-unread"
            className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center"
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          data-testid="notif-list"
          className="absolute right-0 z-50 mt-1 w-80 max-h-96 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden flex flex-col"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                data-testid="notif-mark-all"
                onClick={markAll}
                className="text-xs font-semibold text-purple-600 hover:text-purple-800"
              >
                Tout marquer comme lu
              </button>
            )}
          </div>
          <div className="overflow-y-auto max-h-80">
            {items.length === 0 ? (
              <div className="px-3 py-5 text-sm text-gray-400 text-center">Aucune notification</div>
            ) : items.map(n => (
              <button
                key={n.id}
                type="button"
                data-testid="notif-item"
                onClick={() => openItem(n)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-50 last:border-0 transition-colors ${n.read ? 'bg-white hover:bg-purple-50' : 'bg-purple-50/60 hover:bg-purple-100'}`}
              >
                <span className="block text-sm text-gray-800 leading-snug">{n.message}</span>
                <span className="block text-[11px] text-gray-400 mt-0.5">{ago(n.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
