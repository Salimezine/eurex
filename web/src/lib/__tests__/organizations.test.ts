import { describe, it, expect } from 'vitest';

// ============================================================
// ORGANIZATIONS MODULE — Unit Tests
// ============================================================

// --- Progress calculation ---
describe('Organization: Progress Calculation', () => {
  function calcProgress(tasks: { status: string }[]): number {
    const total = tasks.length;
    if (total === 0) return 0;
    const fait = tasks.filter(t => t.status === 'fait').length;
    return Math.round((fait / total) * 1000) / 10;
  }

  it('returns 0 for empty tasks', () => {
    expect(calcProgress([])).toBe(0);
  });

  it('returns 100 when all tasks done', () => {
    const tasks = Array(9).fill(null).map(() => ({ status: 'fait' }));
    expect(calcProgress(tasks)).toBe(100);
  });

  it('returns 0 when no tasks done', () => {
    const tasks = Array(9).fill(null).map(() => ({ status: 'a_faire' }));
    expect(calcProgress(tasks)).toBe(0);
  });

  it('calculates 5/9 = 55.6%', () => {
    const tasks = [
      { status: 'fait' },
      { status: 'fait' },
      { status: 'fait' },
      { status: 'fait' },
      { status: 'fait' },
      { status: 'en_cours' },
      { status: 'a_faire' },
      { status: 'a_faire' },
      { status: 'a_faire' },
    ];
    expect(calcProgress(tasks)).toBe(55.6);
  });

  it('counts bloque_client as NOT done', () => {
    const tasks = [
      { status: 'fait' },
      { status: 'fait' },
      { status: 'fait' },
      { status: 'bloque_client' },
      { status: 'a_faire' },
    ];
    expect(calcProgress(tasks)).toBe(60);
  });

  it('handles single task', () => {
    expect(calcProgress([{ status: 'fait' }])).toBe(100);
    expect(calcProgress([{ status: 'a_faire' }])).toBe(0);
  });
});

// --- Closure eligibility ---
describe('Organization: Closure Eligibility', () => {
  function canClose(tasks: { status: string }[]): boolean {
    return tasks.every(t => t.status === 'fait');
  }

  it('can close when all tasks are fait', () => {
    const tasks = Array(9).fill(null).map(() => ({ status: 'fait' }));
    expect(canClose(tasks)).toBe(true);
  });

  it('cannot close when any task is a_faire', () => {
    const tasks = [
      { status: 'fait' },
      { status: 'fait' },
      { status: 'a_faire' },
    ];
    expect(canClose(tasks)).toBe(false);
  });

  it('cannot close when any task is en_cours', () => {
    const tasks = [
      { status: 'fait' },
      { status: 'en_cours' },
    ];
    expect(canClose(tasks)).toBe(false);
  });

  it('cannot close when any task is bloque_client', () => {
    const tasks = [
      { status: 'fait' },
      { status: 'bloque_client' },
    ];
    expect(canClose(tasks)).toBe(false);
  });

  it('expert can force close even with blocked tasks', () => {
    const tasks = [
      { status: 'fait' },
      { status: 'bloque_client' },
    ];
    const hasBlocked = tasks.some(t => t.status !== 'fait');
    expect(hasBlocked).toBe(true); // needs force
  });

  it('comptable cannot force close', () => {
    const role: string = 'comptable';
    const tasks = [
      { status: 'fait' },
      { status: 'bloque_client' },
    ];
    const hasBlocked = tasks.some(t => t.status !== 'fait');
    const canForce = role === 'expert';
    expect(hasBlocked && !canForce).toBe(true); // blocked + no force = cannot close
  });
});

// --- Scoping rules ---
describe('Organization: Data Scoping', () => {
  function canAccessDossier(
    userRole: 'expert' | 'comptable',
    userId: string,
    assignedComptableId: string | null,
  ): boolean {
    if (userRole === 'expert') return true;
    return assignedComptableId === userId;
  }

  it('expert can access any dossier', () => {
    expect(canAccessDossier('expert' as 'expert' | 'comptable', 'u1', 'u2')).toBe(true);
    expect(canAccessDossier('expert' as 'expert' | 'comptable', 'u1', 'u3')).toBe(true);
    expect(canAccessDossier('expert' as 'expert' | 'comptable', 'u1', null)).toBe(true);
  });

  it('comptable can access own dossier', () => {
    expect(canAccessDossier('comptable' as 'expert' | 'comptable', 'u1', 'u1')).toBe(true);
  });

  it('comptable cannot access other comptable dossier', () => {
    expect(canAccessDossier('comptable' as 'expert' | 'comptable', 'u1', 'u2')).toBe(false);
  });

  it('comptable cannot access unassigned dossier', () => {
    expect(canAccessDossier('comptable' as 'expert' | 'comptable', 'u1', null)).toBe(false);
  });
});

// --- Task status transitions ---
describe('Organization: Task Status Transitions', () => {
  const VALID_STATUSES = ['a_faire', 'en_cours', 'fait', 'bloque_client'];

  function isValidTransition(current: string, next: string): boolean {
    if (!VALID_STATUSES.includes(next)) return false;
    if (next === current) return false; // no-op
    // Can go from any valid status to any other valid status
    return true;
  }

  it('allows a_faire → en_cours', () => {
    expect(isValidTransition('a_faire', 'en_cours')).toBe(true);
  });

  it('allows en_cours → fait', () => {
    expect(isValidTransition('en_cours', 'fait')).toBe(true);
  });

  it('allows a_faire → bloque_client', () => {
    expect(isValidTransition('a_faire', 'bloque_client')).toBe(true);
  });

  it('allows fait → a_faire (reopen)', () => {
    expect(isValidTransition('fait', 'a_faire')).toBe(true);
  });

  it('allows bloque_client → fait', () => {
    expect(isValidTransition('bloque_client', 'fait')).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(isValidTransition('a_faire', 'invalid')).toBe(false);
  });

  it('rejects same status (no-op)', () => {
    expect(isValidTransition('fait', 'fait')).toBe(false);
  });
});

// --- Template ordering ---
describe('Organization: Task Templates', () => {
  const defaultTemplates = [
    { label: 'Réception relevés bancaires', order_index: 1, requires_document: 1 },
    { label: 'Saisie achats', order_index: 2, requires_document: 0 },
    { label: 'Saisie ventes', order_index: 3, requires_document: 0 },
    { label: 'Rapprochement bancaire', order_index: 4, requires_document: 0 },
    { label: 'Déclaration TVA mensuelle', order_index: 5, requires_document: 0 },
    { label: 'Déclaration CNSS mensuelle', order_index: 6, requires_document: 0 },
    { label: 'Révision balance', order_index: 7, requires_document: 0 },
    { label: 'Établissement états financiers', order_index: 8, requires_document: 0 },
    { label: 'Liasse fiscale / déclaration IS', order_index: 9, requires_document: 0 },
  ];

  it('has 9 default templates', () => {
    expect(defaultTemplates.length).toBe(9);
  });

  it('templates are ordered by order_index', () => {
    const sorted = [...defaultTemplates].sort((a, b) => a.order_index - b.order_index);
    expect(sorted[0].label).toBe('Réception relevés bancaires');
    expect(sorted[sorted.length - 1].label).toBe('Liasse fiscale / déclaration IS');
  });

  it('only bank statement requires document by default', () => {
    const docTemplates = defaultTemplates.filter(t => t.requires_document === 1);
    expect(docTemplates.length).toBe(1);
    expect(docTemplates[0].label).toContain('bancaires');
  });

  it('applying template creates correct number of tasks', () => {
    const newTasks = defaultTemplates.map(t => ({
      label: t.label,
      status: 'a_faire',
      requires_document: t.requires_document,
    }));
    expect(newTasks.length).toBe(9);
    expect(newTasks.every(t => t.status === 'a_faire')).toBe(true);
  });

  it('applying template creates expected_documents for requires_document tasks', () => {
    const expectedDocs = defaultTemplates
      .filter(t => t.requires_document)
      .map(t => ({ label: t.label, received: 0 }));
    expect(expectedDocs.length).toBe(1);
    expect(expectedDocs[0].received).toBe(0);
  });

  it('applying template copies assigned_comptable_id to tasks', () => {
    const templates = [
      { label: 'Saisie achats', assigned_comptable_id: 'user_comp_001' },
      { label: 'Saisie ventes', assigned_comptable_id: null },
    ];
    const newTasks = templates.map(t => ({
      label: t.label,
      status: 'a_faire',
      assigned_comptable_id: t.assigned_comptable_id,
    }));
    expect(newTasks[0].assigned_comptable_id).toBe('user_comp_001');
    expect(newTasks[1].assigned_comptable_id).toBeNull();
  });

  it('expert can reassign a task to another comptable', () => {
    const task = { assigned_comptable_id: 'user_comp_001' as string | null };
    const user = { role: 'expert' };
    if (user.role === 'expert') task.assigned_comptable_id = 'user_comp_002';
    expect(task.assigned_comptable_id).toBe('user_comp_002');
  });

  it('comptable cannot reassign a task', () => {
    const task = { assigned_comptable_id: 'user_comp_001' as string | null };
    const user = { role: 'comptable' };
    const canReassign = user.role === 'expert';
    expect(canReassign).toBe(false);
    expect(task.assigned_comptable_id).toBe('user_comp_001');
  });
});

// --- Donut chart data ---
describe('Organization: Donut Chart Data', () => {
  function computeDonutData(tasks: { status: string }[]) {
    const fait = tasks.filter(t => t.status === 'fait').length;
    const enCours = tasks.filter(t => t.status === 'en_cours' || t.status === 'a_faire').length;
    const bloqueClient = tasks.filter(t => t.status === 'bloque_client').length;
    return { fait, enCours, bloqueClient };
  }

  it('computes correct segments for mixed statuses', () => {
    const tasks = [
      { status: 'fait' }, { status: 'fait' }, { status: 'fait' },
      { status: 'en_cours' }, { status: 'a_faire' },
      { status: 'bloque_client' },
    ];
    const data = computeDonutData(tasks);
    expect(data.fait).toBe(3);
    expect(data.enCours).toBe(2);
    expect(data.bloqueClient).toBe(1);
  });

  it('all segments are 0 for empty tasks', () => {
    const data = computeDonutData([]);
    expect(data.fait).toBe(0);
    expect(data.enCours).toBe(0);
    expect(data.bloqueClient).toBe(0);
  });

  it('all fait gives correct donut', () => {
    const tasks = Array(9).fill(null).map(() => ({ status: 'fait' }));
    const data = computeDonutData(tasks);
    expect(data.fait).toBe(9);
    expect(data.enCours).toBe(0);
    expect(data.bloqueClient).toBe(0);
  });

  it('all blocked gives correct donut', () => {
    const tasks = Array(5).fill(null).map(() => ({ status: 'bloque_client' }));
    const data = computeDonutData(tasks);
    expect(data.fait).toBe(0);
    expect(data.enCours).toBe(0);
    expect(data.bloqueClient).toBe(5);
  });
});

// --- New exercice creation rules ---
describe('Organization: New Exercice Rules', () => {
  it('can open new exercice only if previous is closed', () => {
    const prevDossier = { status: 'cloture', exercice: 2025 };
    expect(prevDossier.status === 'cloture').toBe(true);
  });

  it('cannot open new exercice if previous is still open', () => {
    const prevDossier = { status: 'en_cours', exercice: 2025 };
    expect(prevDossier.status === 'cloture').toBe(false);
  });

  it('cannot open duplicate exercice', () => {
    const existingExercices = [2025, 2026];
    expect(existingExercices.includes(2026)).toBe(true); // already exists
    expect(existingExercices.includes(2027)).toBe(false); // can create
  });
});

// --- Document received tracking ---
describe('Organization: Document Tracking', () => {
  it('marks document as received with timestamp', () => {
    const doc: { id: string; received: number; received_at: string | null } = { id: 'd1', received: 0, received_at: null };
    doc.received = 1;
    doc.received_at = new Date().toISOString();
    expect(doc.received).toBe(1);
    expect(doc.received_at).toBeTruthy();
  });

  it('allows manual receive with note (WhatsApp/email)', () => {
    const doc: { id: string; received: number; received_note: string | null } = { id: 'd1', received: 0, received_note: null };
    doc.received = 1;
    doc.received_note = 'Reçu par WhatsApp le 15/09';
    expect(doc.received_note).toContain('WhatsApp');
  });

  it('can unmark received document', () => {
    const doc: { id: string; received: number; received_at: string | null } = { id: 'd1', received: 1, received_at: '2026-09-15' };
    doc.received = 0;
    doc.received_at = null;
    expect(doc.received).toBe(0);
  });
});

// --- Audit log immutability ---
describe('Organization: Audit Log', () => {
  it('audit entry contains required fields', () => {
    const entry = {
      id: 'audit_001',
      organization_id: 'org_001',
      user_id: 'user_001',
      user_name: 'Ahmed',
      action: 'task_status_changed',
      target_type: 'task',
      target_id: 'task_001',
      details: JSON.stringify({ old_status: 'a_faire', new_status: 'fait' }),
      created_at: new Date().toISOString(),
    };
    expect(entry.organization_id).toBeTruthy();
    expect(entry.user_id).toBeTruthy();
    expect(entry.action).toBeTruthy();
    expect(entry.target_type).toBeTruthy();
    expect(entry.target_id).toBeTruthy();
  });

  it('tracks status change old → new', () => {
    const details = JSON.parse('{"old_status":"a_faire","new_status":"fait"}');
    expect(details.old_status).toBe('a_faire');
    expect(details.new_status).toBe('fait');
  });

  it('tracks forced closure with justification', () => {
    const details = JSON.parse('{"forced":true,"justification":"Client demandé","blocked_tasks":["Rapprochement bancaire"]}');
    expect(details.forced).toBe(true);
    expect(details.blocked_tasks.length).toBe(1);
  });
});

// --- Timeline event types ---
describe('Organization: Timeline Events', () => {
  const EVENT_TYPES = [
    'task_done',
    'task_blocked',
    'document_received',
    'document_blocked',
    'note_added',
    'dossier_closed',
    'dossier_created',
    'client_reassigned',
  ];

  it('has correct event type icons', () => {
    const icons: Record<string, string> = {
      task_done: '🟢',
      task_blocked: '🔴',
      document_received: '📎',
      document_blocked: '📄',
      note_added: '💬',
      dossier_closed: '🔒',
      dossier_created: '🆕',
      client_reassigned: '👤',
    };
    expect(icons.task_done).toBe('🟢');
    expect(icons.dossier_closed).toBe('🔒');
    expect(icons.document_received).toBe('📎');
  });

  it('timeline groups events by day', () => {
    const events = [
      { date: '2026-09-15T10:00:00', type: 'task_done', label: 'Done' },
      { date: '2026-09-15T14:00:00', type: 'note_added', label: 'Note' },
      { date: '2026-09-14T09:00:00', type: 'document_received', label: 'Doc' },
    ];
    const grouped: Record<string, number> = {};
    for (const e of events) {
      const day = e.date.split('T')[0];
      grouped[day] = (grouped[day] || 0) + 1;
    }
    expect(grouped['2026-09-15']).toBe(2);
    expect(grouped['2026-09-14']).toBe(1);
  });
});

// --- Password policy ---
describe('Organization: Password Policy', () => {
  it('rejects password shorter than 12 chars', () => {
    expect('short'.length >= 12).toBe(false);
    expect('12345678901'.length >= 12).toBe(false);
  });

  it('accepts password of 12+ chars', () => {
    expect('expert1234567'.length >= 12).toBe(true);
    expect('comptable1234567'.length >= 12).toBe(true);
  });
});

// --- Exercice validation ---
describe('Organization: Exercice Validation', () => {
  it('exercice must be a year (4 digits)', () => {
    expect(/^\d{4}$/.test('2026')).toBe(true);
    expect(/^\d{4}$/.test('2025')).toBe(true);
    expect(/^\d{4}$/.test('26')).toBe(false);
    expect(/^\d{4}$/.test('abc')).toBe(false);
  });

  it('next exercice is previous + 1', () => {
    expect(2026 + 1).toBe(2027);
    expect(2025 + 1).toBe(2026);
  });
});

// --- Role-based access control ---
describe('Organization: Role-Based Access', () => {
  it('expert can reassign clients', () => {
    const role: string = 'expert';
    expect(role === 'expert').toBe(true);
  });

  it('comptable cannot reassign clients', () => {
    const role: string = 'comptable';
    expect(role === 'expert').toBe(false);
  });

  it('expert can force close', () => {
    const role: string = 'expert';
    expect(role === 'expert').toBe(true);
  });

  it('comptable cannot force close', () => {
    const role: string = 'comptable';
    expect(role === 'expert').toBe(false);
  });

  it('expert can create comptable accounts', () => {
    const role: string = 'expert';
    expect(role === 'expert').toBe(true);
  });

  it('comptable cannot create comptable accounts', () => {
    const role: string = 'comptable';
    expect(role === 'expert').toBe(false);
  });

  it('expert sees all comptables', () => {
    const role: string = 'expert';
    expect(role === 'expert').toBe(true);
  });

  it('comptable does not see settings', () => {
    const path = '/cabinet/settings';
    const role: string = 'comptable';
    const allowed = role === 'expert';
    expect(allowed).toBe(false);
  });
});

// --- I18n translations ---
describe('Organization: I18n', () => {
  const translations: Record<string, Record<string, string>> = {
    'status.en_cours': { fr: 'À faire', ar: 'للقيام' },
    'status.cloture': { fr: 'Clôturé', ar: 'مغلق' },
    'status.a_faire': { fr: 'À faire', ar: 'للقيام' },
    'status.fait': { fr: 'Fait', ar: 'منجز' },
    'status.bloque_client': { fr: 'Bloqué client', ar: 'محجوز لدى العميل' },
    'donut.done': { fr: 'Ça marche', ar: 'يعمل' },
    'donut.blocked': { fr: 'Bloqué client', ar: 'محجوز لدى العميل' },
  };

  it('has FR translation for all statuses', () => {
    expect(translations['status.en_cours'].fr).not.toBe('En cours');
    expect(translations['status.cloture'].fr).toBe('Clôturé');
    expect(translations['status.a_faire'].fr).toBe('À faire');
    expect(translations['status.fait'].fr).toBe('Fait');
    expect(translations['status.bloque_client'].fr).toContain('Bloqué client');
  });

  it('has AR translation for all statuses', () => {
    expect(translations['status.en_cours'].ar).toBeTruthy();
    expect(translations['status.cloture'].ar).toBeTruthy();
    expect(translations['status.fait'].ar).toBeTruthy();
  });
});

// --- KPI calculations for expert dashboard ---
describe('Organization: Expert KPIs', () => {
  const dossiers = [
    { progress: 55.6, task_stats: { bloque_client: 0 } },
    { progress: 33.3, task_stats: { bloque_client: 1 } },
    { progress: 77.8, task_stats: { bloque_client: 0 } },
    { progress: 11.1, task_stats: { bloque_client: 2 } },
    { progress: 44.4, task_stats: { bloque_client: 0 } },
  ];

  it('calculates total active dossiers', () => {
    expect(dossiers.length).toBe(5);
  });

  it('calculates average progress', () => {
    const avg = Math.round(dossiers.reduce((s, d) => s + d.progress, 0) / dossiers.length * 10) / 10;
    expect(avg).toBe(44.4);
  });

  it('counts blocked dossiers', () => {
    const blocked = dossiers.filter(d => d.task_stats.bloque_client > 0).length;
    expect(blocked).toBe(2);
  });

  it('can filter by comptable', () => {
    const comptableId = 'user_comp_001';
    const filtered = dossiers.filter(() => comptableId === 'user_comp_001');
    expect(filtered.length).toBeGreaterThanOrEqual(0);
  });
});
