import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Plus, Check, Trash2, RotateCcw } from 'lucide-react';
import { orgApi, OrgAlertFeed } from '../lib/orgApi';
import { mergeFeed, urgentCount, alertState, formatDueDate, daysUntil, FeedItem, AlertState } from '../lib/orgAlerts';
import { t } from '../lib/orgI18n';
import { useOrgAuth } from '../lib/orgAuth';

interface Props {
  dossierId?: string;
}

const STATE_STYLE: Record<AlertState, { row: string; chip: string; icon: string }> = {
  overdue: { row: 'bg-red-50 border-red-200', chip: 'bg-red-100 text-red-700', icon: '🔴' },
  soon: { row: 'bg-orange-50 border-orange-200', chip: 'bg-orange-100 text-orange-700', icon: '🟠' },
  later: { row: 'bg-white border-gray-200', chip: 'bg-gray-100 text-gray-600', icon: '📅' },
  done: { row: 'bg-gray-50 border-gray-200 opacity-70', chip: 'bg-emerald-50 text-emerald-700', icon: '✅' },
};

export default function OrgAlerts({ dossierId }: Props) {
  const { state } = useOrgAuth();
  const isExpert = state.user?.role === 'expert';
  const [feed, setFeed] = useState<OrgAlertFeed | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [lead, setLead] = useState(7);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setFeed(await orgApi.getAlerts(dossierId));
    } catch {
      setFeed({ alerts: [], tasks: [] });
    }
  }, [dossierId]);

  useEffect(() => { load(); }, [load]);

  const items = feed ? mergeFeed(feed) : [];
  const urgent = feed ? urgentCount(feed) : 0;

  const openModal = () => {
    setTitle(''); setDueDate(''); setLead(7); setNote(''); setErr('');
    setOpen(true);
  };

  const create = async () => {
    setErr('');
    if (!title.trim()) { setErr('Libellé requis'); return; }
    if (!dueDate) { setErr(t('alerts.due_date')); return; }
    setBusy(true);
    try {
      await orgApi.createAlert({ title: title.trim(), due_date: dueDate, lead_days: lead, dossier_id: dossierId || null, note: note.trim() || undefined });
      setOpen(false);
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const toggleDone = async (item: FeedItem) => {
    try {
      await orgApi.updateAlert(item.id, { done: !item.done });
      await load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const remove = async (item: FeedItem) => {
    if (!confirm(t('alerts.delete_confirm'))) return;
    try {
      await orgApi.deleteAlert(item.id);
      await load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const dayInfo = (item: FeedItem) => {
    const n = daysUntil(item.due_date);
    if (n < 0) return t('alerts.days_late').replace('{n}', String(Math.abs(n)));
    return t('alerts.days_left').replace('{n}', String(n));
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Bell size={14} className="text-amber-500" />
          {dossierId ? t('alerts.for_dossier') : t('alerts.title')}
          {urgent > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
              {urgent}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 hidden sm:inline">{t('alerts.legend')}</span>
          {isExpert && (
            <button
              onClick={openModal}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-all"
            >
              <Plus size={12} />
              {t('alerts.add')}
            </button>
          )}
        </div>
      </div>

      {feed === null ? (
        <div className="h-8 bg-gray-100 rounded-lg animate-pulse" />
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-3 bg-gray-50 border border-dashed border-gray-200 rounded-lg">
          {t('alerts.empty')}
        </p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {items.map(item => {
            const st = alertState(item.due_date, item.lead_days, item.done);
            const style = STATE_STYLE[st];
            return (
              <div key={`${item.kind}-${item.id}`} className={`flex items-center gap-2 border rounded-lg px-2.5 py-2 ${style.row}`}>
                <span className="text-sm" title={st}>{style.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-sm font-medium text-gray-800 truncate ${st === 'done' ? 'line-through text-gray-400' : ''}`}>
                      {item.title}
                    </span>
                    {item.kind === 'task' && (
                      <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full uppercase">
                        {t('alerts.task_badge')}
                      </span>
                    )}
                    {item.dossier_label && (
                      item.kind === 'task' && item.dossier_id ? (
                        <Link to={`/cabinet/dossier/${item.dossier_id}`} className="text-[10px] text-blue-600 hover:underline truncate max-w-[160px]">
                          {item.dossier_label}
                        </Link>
                      ) : (
                        <span className="text-[10px] text-gray-400 truncate max-w-[160px]">{item.dossier_label}</span>
                      )
                    )}
                    {!item.dossier_label && <span className="text-[10px] text-gray-400">{t('alerts.global')}</span>}
                  </div>
                  {item.note && <p className="text-[11px] text-gray-500 truncate">{item.note}</p>}
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${style.chip}`}>
                  {formatDueDate(item.due_date)} · {dayInfo(item)}
                </span>
                {item.kind === 'echeance' && (
                  <button
                    onClick={() => toggleDone(item)}
                    title={item.done ? t('alerts.reopen') : t('alerts.mark_done')}
                    className="p-1 rounded hover:bg-white/80 text-gray-500 hover:text-emerald-600 transition-colors"
                  >
                    {item.done ? <RotateCcw size={13} /> : <Check size={13} />}
                  </button>
                )}
                {item.kind === 'echeance' && isExpert && (
                  <button
                    onClick={() => remove(item)}
                    title="Supprimer"
                    className="p-1 rounded hover:bg-white/80 text-gray-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">⏰ {t('alerts.new_title')}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="space-y-2">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Ex : Déclaration TVA, Avis d'imposition IS…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                autoFocus
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('alerts.due_date')}</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('alerts.lead_days')}</label>
                  <select
                    value={lead}
                    onChange={e => setLead(Number(e.target.value))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    {[0, 1, 3, 7, 14, 30].map(n => (
                      <option key={n} value={n}>{n} {t('alerts.days_before')}</option>
                    ))}
                  </select>
                </div>
              </div>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t('alerts.note')}
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none resize-none"
              />
              {dossierId && (
                <p className="text-[11px] text-gray-400">📎 {t('alerts.for_dossier')}</p>
              )}
              <button
                onClick={create}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {t('alerts.save')}
              </button>
              {err && <p className="text-sm text-red-600">{err}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
