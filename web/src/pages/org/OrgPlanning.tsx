import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { orgApi, OrgAlertFeed, OrgAlert, OrgAlertTask } from '../../lib/orgApi';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DOW = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const pad2 = (n: number) => String(n).padStart(2, '0');

const TASK_STATUS: Record<string, { label: string; cls: string }> = {
  a_faire: { label: 'à faire', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  en_cours: { label: 'en cours', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  a_verifier: { label: 'à vérifier', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  bloque_client: { label: 'bloqué client', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

type EventItem =
  | { kind: 'alert'; key: string; date: string; title: string; dossierId: string | null; dossierLabel: string | null; done: number; overdue: boolean }
  | { kind: 'task'; key: string; date: string; title: string; dossierId: string; dossierLabel: string; status: string; overdue: boolean };

// Planning mensuel : échéances fiscales (expand) + tâches à date butoir,
// alimenté par GET /org/alerts (même portée que les alertes des dashboards).
export default function OrgPlanning() {
  const now = new Date(Date.now() + 3600000);
  const [y, setY] = useState(now.getUTCFullYear());
  const [m, setM] = useState(now.getUTCMonth());
  const [feed, setFeed] = useState<OrgAlertFeed | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    orgApi.getAlerts().then(setFeed).catch(e => setError(e.message));
  }, []);

  const todayStr = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;

  const { cells, monthCounts } = useMemo(() => {
    const prefix = `${y}-${pad2(m + 1)}`;
    const byDate = new Map<string, EventItem[]>();
    const push = (e: EventItem) => {
      const arr = byDate.get(e.date) || [];
      arr.push(e);
      byDate.set(e.date, arr);
    };
    for (const a of (feed?.alerts || [])) {
      if (!a.due_date || !a.due_date.startsWith(prefix)) continue;
      push({
        kind: 'alert', key: `a-${a.id}-${a.due_date}`, date: a.due_date, title: a.title,
        dossierId: a.dossier_id, dossierLabel: a.dossier_label, done: a.done,
        overdue: a.due_date < todayStr && !a.done,
      });
    }
    for (const t of (feed?.tasks || [])) {
      if (!t.due_date || !t.due_date.startsWith(prefix)) continue;
      push({
        kind: 'task', key: `t-${t.id}`, date: t.due_date, title: t.label, dossierId: t.dossier_id,
        dossierLabel: t.dossier_label, status: t.status, overdue: t.due_date < todayStr,
      });
    }

    const first = new Date(Date.UTC(y, m, 1));
    const offset = (first.getUTCDay() + 6) % 7; // lundi = 0
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const total = Math.ceil((offset + daysInMonth) / 7) * 7;
    const out: { date: string; day: number; inMonth: boolean; events: EventItem[] }[] = [];
    for (let i = 0; i < total; i++) {
      const dayNum = i - offset + 1;
      if (dayNum < 1 || dayNum > daysInMonth) { out.push({ date: '', day: 0, inMonth: false, events: [] }); continue; }
      const date = `${prefix}-${pad2(dayNum)}`;
      out.push({ date, day: dayNum, inMonth: true, events: byDate.get(date) || [] });
    }
    const events = [...byDate.values()].flat();
    return {
      cells: out,
      monthCounts: {
        alerts: events.filter(e => e.kind === 'alert').length,
        tasks: events.filter(e => e.kind === 'task').length,
        overdue: events.filter(e => e.overdue).length,
      },
    };
  }, [feed, y, m, todayStr]);

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m + delta, 1));
    setY(d.getUTCFullYear());
    setM(d.getUTCMonth());
  };

  const goToday = () => { setY(now.getUTCFullYear()); setM(now.getUTCMonth()); };

  const open = (e: EventItem) => {
    if (e.dossierId) navigate(`/cabinet/dossier/${e.dossierId}`);
  };

  return (
    <div className="space-y-4" data-testid="planning-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">📅 Planning</h1>
          <p className="text-sm text-gray-500">
            {MONTHS[m]} {y} · <span className="text-amber-600 font-medium">{monthCounts.alerts} échéance(s)</span> ·{' '}
            <span className="text-blue-600 font-medium">{monthCounts.tasks} tâche(s)</span>
            {monthCounts.overdue > 0 && <span className="text-rose-600 font-medium"> · {monthCounts.overdue} en retard</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} data-testid="planning-prev" className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm">◀</button>
          <button onClick={goToday} data-testid="planning-today" className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium">Aujourd'hui</button>
          <button onClick={() => shift(1)} data-testid="planning-next" className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm">▶</button>
        </div>
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{error}</div>}

      <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden" data-testid="planning-grid">
        {DOW.map(d => (
          <div key={d} className="bg-gray-50 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400 text-center">{d}</div>
        ))}
        {cells.map((c, i) => (
          <div
            key={i}
            data-testid={c.inMonth ? `planning-day-${c.date}` : `planning-pad-${i}`}
            className={`bg-white min-h-[92px] p-1.5 ${c.inMonth ? '' : 'bg-gray-50/60'}`}
          >
            {c.inMonth && (
              <>
                <div className={`text-xs font-semibold mb-1 ${c.date === todayStr ? 'text-white bg-purple-600 w-5 h-5 rounded-full flex items-center justify-center' : 'text-gray-500'}`}>
                  {c.day}
                </div>
                <div className="space-y-1">
                  {c.events.slice(0, 3).map(e => (
                    <button
                      key={e.key}
                      onClick={() => open(e)}
                      title={`${e.title} — ${e.dossierLabel || 'Cabinet'}${e.overdue ? ' (en retard)' : ''}`}
                      data-testid="planning-event"
                      className={`w-full text-left text-[10px] leading-tight px-1.5 py-0.5 rounded border truncate ${e.kind === 'alert'
                        ? e.done ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : e.overdue ? 'bg-rose-50 text-rose-700 border-rose-200 font-semibold'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        : e.status === 'bloque_client' ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : e.overdue ? 'bg-rose-50 text-rose-700 border-rose-200 font-semibold'
                            : TASK_STATUS[e.status]?.cls || 'bg-gray-100 text-gray-600 border-gray-200'}`}
                    >
                      {e.kind === 'alert' ? (e.done ? '✓ ' : '⏰ ') : '☐ '}{e.title}
                    </button>
                  ))}
                  {c.events.length > 3 && (
                    <div className="text-[10px] text-gray-400 px-1.5">+{c.events.length - 3} de plus…</div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
        <span>⏰ échéance fiscale</span>
        <span className="text-emerald-600">✓ faite</span>
        <span className="text-rose-600 font-semibold">en retard (échéance ou tâche)</span>
        <span>☐ tâche à date butoir (couleur = statut)</span>
        <span className="text-gray-400">Cliquez un événement pour ouvrir son dossier.</span>
      </div>
    </div>
  );
}
