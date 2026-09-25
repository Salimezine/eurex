import { OrgAlertFeed } from './orgApi';

export type AlertState = 'done' | 'overdue' | 'soon' | 'later';

export interface FeedItem {
  kind: 'echeance' | 'task';
  id: string;
  title: string;
  due_date: string;
  lead_days: number;
  done: boolean;
  dossier_id: string | null;
  dossier_label: string | null;
  note?: string | null;
  recurrence?: string | null;
  task_status?: string;
}

export function daysUntil(dueDate: string, today: Date = new Date()): number {
  const [y, m, d] = dueDate.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const target = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - now) / 86400000);
}

/** done → 'done' | dépassé → 'overdue' | ≤ lead_days → 'soon' | sinon 'later' */
export function alertState(dueDate: string, leadDays = 7, done = false, today: Date = new Date()): AlertState {
  if (done) return 'done';
  const d = daysUntil(dueDate, today);
  if (d < 0) return 'overdue';
  if (d <= leadDays) return 'soon';
  return 'later';
}

const STATE_RANK: Record<AlertState, number> = { overdue: 0, soon: 1, later: 2, done: 3 };

/** Fusionne échéances + tâches à date butoir, triées : urgent d'abord, puis par date. */
export function mergeFeed(feed: OrgAlertFeed, today: Date = new Date()): FeedItem[] {
  const items: FeedItem[] = [
    ...(feed.alerts || []).map(a => ({
      kind: 'echeance' as const,
      id: a.id,
      title: a.title,
      due_date: a.due_date,
      lead_days: a.lead_days ?? 7,
      done: !!a.done,
      dossier_id: a.dossier_id,
      dossier_label: a.dossier_label,
      note: a.note,
      recurrence: a.recurrence ?? null,
    })),
    ...(feed.tasks || []).map(t => ({
      kind: 'task' as const,
      id: t.id,
      title: t.label,
      due_date: t.due_date,
      lead_days: 7,
      done: false,
      dossier_id: t.dossier_id,
      dossier_label: t.dossier_label,
      task_status: t.status,
    })),
  ];
  return items.sort((a, b) => {
    const ra = STATE_RANK[alertState(a.due_date, a.lead_days, a.done, today)];
    const rb = STATE_RANK[alertState(b.due_date, b.lead_days, b.done, today)];
    return ra - rb || a.due_date.localeCompare(b.due_date);
  });
}

/** Nombre d'alertes urgentes (retard ou bientôt, non traitées). */
export function urgentCount(feed: OrgAlertFeed, today: Date = new Date()): number {
  return mergeFeed(feed, today).filter(i => {
    const s = alertState(i.due_date, i.lead_days, i.done, today);
    return s === 'overdue' || s === 'soon';
  }).length;
}

/** "25/09/2026" depuis "2026-09-25" */
export function formatDueDate(dueDate: string): string {
  const [y, m, d] = dueDate.split('-');
  if (!y || !m || !d) return dueDate;
  return `${d}/${m}/${y}`;
}
