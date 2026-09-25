import { describe, it, expect } from 'vitest';
import { daysUntil, alertState, mergeFeed, urgentCount, formatDueDate } from '../orgAlerts';
import { OrgAlertFeed } from '../orgApi';

const TODAY = new Date('2026-09-25T12:00:00');

describe('orgAlerts: daysUntil', () => {
  it('same day → 0', () => {
    expect(daysUntil('2026-09-25', TODAY)).toBe(0);
  });
  it('future date → positive', () => {
    expect(daysUntil('2026-09-30', TODAY)).toBe(5);
  });
  it('past date → negative', () => {
    expect(daysUntil('2026-09-20', TODAY)).toBe(-5);
  });
  it('cross month boundary', () => {
    expect(daysUntil('2026-10-02', TODAY)).toBe(7);
  });
  it('invalid date → 0', () => {
    expect(daysUntil('nimporte', TODAY)).toBe(0);
  });
});

describe('orgAlerts: alertState', () => {
  it('done always wins', () => {
    expect(alertState('2026-01-01', 7, true, TODAY)).toBe('done');
  });
  it('overdue when past', () => {
    expect(alertState('2026-09-24', 7, false, TODAY)).toBe('overdue');
  });
  it('soon when within lead days', () => {
    expect(alertState('2026-09-27', 7, false, TODAY)).toBe('soon');
  });
  it('soon exactly at lead boundary', () => {
    expect(alertState('2026-10-02', 7, false, TODAY)).toBe('soon');
  });
  it('later when beyond lead', () => {
    expect(alertState('2026-10-03', 7, false, TODAY)).toBe('later');
  });
  it('lead 0 → only today is soon', () => {
    expect(alertState('2026-09-25', 0, false, TODAY)).toBe('soon');
    expect(alertState('2026-09-26', 0, false, TODAY)).toBe('later');
  });
});

describe('orgAlerts: mergeFeed', () => {
  const feed: OrgAlertFeed = {
    alerts: [
      { id: 'a1', title: 'TVA octobre', due_date: '2026-11-10', lead_days: 7, done: 0, note: null, dossier_id: null, dossier_label: null, created_by_name: 'EUREX', created_at: '2026-09-01' },
      { id: 'a2', title: 'IS trimestre', due_date: '2026-09-20', lead_days: 7, done: 0, note: null, dossier_id: null, dossier_label: null, created_by_name: 'EUREX', created_at: '2026-09-01' },
      { id: 'a3', title: 'Ancienne échéance', due_date: '2026-09-30', lead_days: 7, done: 1, note: null, dossier_id: null, dossier_label: null, created_by_name: 'EUREX', created_at: '2026-09-01' },
      { id: 'a4', title: 'TVA septembre', due_date: '2026-10-01', lead_days: 7, done: 0, note: null, dossier_id: null, dossier_label: null, created_by_name: 'EUREX', created_at: '2026-09-01' },
    ],
    tasks: [
      { id: 't1', label: 'Bilan annuel', due_date: '2026-09-22', status: 'a_faire', dossier_id: 'd1', dossier_label: 'ACME (2026)', assigned_comptable_id: null },
      { id: 't2', label: 'Social déclaratif', due_date: '2026-10-05', status: 'a_faire', dossier_id: 'd1', dossier_label: 'ACME (2026)', assigned_comptable_id: null },
    ],
  };

  it('orders overdue → soon → later → done', () => {
    const merged = mergeFeed(feed, TODAY);
    const states = merged.map(i => alertState(i.due_date, i.lead_days, i.done, TODAY));
    expect(states[0]).toBe('overdue');
    expect(states[states.length - 1]).toBe('done');
    const order = ['overdue', 'soon', 'later', 'done'];
    expect([...states].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(states);
  });

  it('overdue items sorted by date ascending', () => {
    const merged = mergeFeed(feed, TODAY).filter(i => alertState(i.due_date, i.lead_days, i.done, TODAY) === 'overdue');
    expect(merged.map(i => i.id)).toEqual(['a2', 't1']); // 20/09 avant 22/09
  });

  it('merges tasks and alerts with kind labels', () => {
    const merged = mergeFeed(feed, TODAY);
    expect(merged.some(i => i.kind === 'task')).toBe(true);
    expect(merged.some(i => i.kind === 'echeance')).toBe(true);
  });

  it('urgentCount = overdue + soon (done excluded)', () => {
    // overdue: a2, t1 — soon: a4 — later: t2, a1 — done: a3
    expect(urgentCount(feed, TODAY)).toBe(3);
  });
});

describe('orgAlerts: formatDueDate', () => {
  it('formats YYYY-MM-DD → DD/MM/YYYY', () => {
    expect(formatDueDate('2026-09-25')).toBe('25/09/2026');
  });
  it('returns input when malformed', () => {
    expect(formatDueDate('abc')).toBe('abc');
  });
});
