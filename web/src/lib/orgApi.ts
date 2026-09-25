const BASE = import.meta.env.VITE_API_URL || 'https://eurex-api.ezzinesalim21.workers.dev/api';

function getToken(): string | null {
  return localStorage.getItem('eurex_org_token');
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts?.headers as any };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${r.status}`);
  }
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/csv')) return r.text() as any;
  return r.json();
}

export interface OrgClient {
  id: string;
  name: string;
  matricule_fiscal: string | null;
  person_type?: string | null;
  assigned_comptable_id: string | null;
  comptable_name: string | null;
  contact_email: string | null;
  dossier_actuel: OrgDossier | null;
  task_stats: { total: number; fait: number; en_cours: number; bloque_client: number };
  doc_stats: { total: number; received: number };
  progress: number;
}

export interface OrgDossier {
  id: string;
  client_id: string;
  client_name: string;
  matricule_fiscal: string | null;
  person_type?: string | null;
  exercice: number;
  status: string;
  cached_progress: number;
  opened_at: string;
  closed_at: string | null;
  tasks: OrgTask[];
  documents: OrgDocument[];
  notes: OrgNote[];
  task_stats: { total: number; fait: number; en_cours: number; bloque_client: number };
  doc_stats: { total: number; received: number };
  can_close: boolean;
  can_force_close: boolean;
  block_reasons: string[];
  progress: number;
  time_entries: any[];
  time_by_user: { user_name: string; seconds: number }[];
}

export interface OrgTask {
  id: string;
  dossier_id: string;
  label: string;
  status: 'a_faire' | 'en_cours' | 'fait' | 'bloque_client';
  blocked_reason: string | null;
  requires_document: number;
  order_index: number;
  month: number | null;
  updated_at: string;
  total_time_seconds: number;
  timer_started_at: string | null;
  timer_user_id: string | null;
  updated_by_name: string | null;
  assigned_comptable_id: string | null;
  assigned_comptable_name: string | null;
  due_date: string | null;
}

export interface OrgAlert {
  id: string;
  title: string;
  due_date: string;
  lead_days: number;
  done: number;
  note: string | null;
  recurrence?: string | null;
  category?: string | null;
  dossier_id: string | null;
  dossier_label: string | null;
  created_by_name: string | null;
  created_at?: string;
}

export interface OrgAlertTask {
  id: string;
  label: string;
  due_date: string;
  status: string;
  dossier_id: string;
  dossier_label: string;
  assigned_comptable_id: string | null;
}

export interface OrgAlertFeed {
  alerts: OrgAlert[];
  tasks: OrgAlertTask[];
}

export interface OrgDocument {
  id: string;
  dossier_id: string;
  task_id: string | null;
  label: string;
  received: number;
  received_at: string | null;
  received_note: string | null;
  file_r2_key: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  url: string | null;
}

export interface OrgNote {
  id: string;
  dossier_id: string;
  user_id: string;
  user_name: string;
  content: string;
  created_at: string;
}

export interface OrgComptable {
  id: string;
  full_name: string;
  email: string;
  is_active: number;
  client_count: number;
  avg_progress: number;
  task_stats: { total: number; fait: number; en_cours: number; bloque_client: number };
}

export type OrgFrequency = 'mensuelle' | 'trimestrielle' | 'annuelle';

export interface OrgTemplate {
  id: string;
  label: string;
  order_index: number;
  requires_document: number;
  frequency: OrgFrequency;
  assigned_comptable_id: string | null;
  assigned_comptable_name: string | null;
}

export interface TimelineEvent {
  date: string;
  type: string;
  icon: string;
  label: string;
  actor: string;
  details: any;
}

export const orgApi = {
  // Clients
  getClients: () => req<OrgClient[]>('/org/clients'),
  createClient: (d: any) => req<any>('/org/clients', { method: 'POST', body: JSON.stringify(d) }),
    reassignClient: (id: string, comptableId: string) =>
      req<any>(`/org/clients/${id}/reassign`, { method: 'PATCH', body: JSON.stringify({ assigned_comptable_id: comptableId }) }),
    updateClient: (id: string, patch: { person_type?: string | null }) =>
      req<any>(`/org/clients/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // Dossiers
  getClientDossiers: (clientId: string) => req<OrgDossier[]>(`/org/clients/${clientId}/dossiers`),
  getDossier: (id: string) => req<OrgDossier>(`/org/dossiers/${id}`),
  createDossier: (clientId: string, exercice: number) =>
    req<any>(`/org/clients/${clientId}/dossiers`, { method: 'POST', body: JSON.stringify({ exercice }) }),
  closeDossier: (id: string, force?: boolean, justification?: string) =>
    req<any>(`/org/dossiers/${id}/close`, { method: 'PATCH', body: JSON.stringify({ force, justification }) }),

  // Tasks
  updateTask: (dossierId: string, taskId: string, status: string, blocked_reason?: string) =>
    req<any>(`/org/dossiers/${dossierId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status, blocked_reason }) }),
  assignTask: (dossierId: string, taskId: string, assignedComptableId: string | null) =>
    req<any>(`/org/dossiers/${dossierId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ assigned_comptable_id: assignedComptableId }) }),
  renameTask: (dossierId: string, taskId: string, label: string) =>
    req<any>(`/org/dossiers/${dossierId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
  deleteTask: (dossierId: string, taskId: string) =>
    req<any>(`/org/dossiers/${dossierId}/tasks/${taskId}`, { method: 'DELETE' }),
  addTask: (dossierId: string, label: string, assignedComptableId?: string | null, month?: number | null) =>
    req<any>(`/org/dossiers/${dossierId}/tasks`, { method: 'POST', body: JSON.stringify({ label, assigned_comptable_id: assignedComptableId || null, month: month ?? null }) }),
  setTaskDue: (dossierId: string, taskId: string, dueDate: string | null) =>
    req<any>(`/org/dossiers/${dossierId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ due_date: dueDate }) }),

  // Fiscal alerts (échéances)
  getAlerts: (dossierId?: string) =>
    req<OrgAlertFeed>(`/org/alerts${dossierId ? `?dossier_id=${dossierId}` : ''}`),
  createAlert: (data: { title: string; due_date: string; lead_days?: number; recurrence?: string; category?: string | null; dossier_id?: string | null; note?: string }) =>
    req<OrgAlert>('/org/alerts', { method: 'POST', body: JSON.stringify(data) }),
  updateAlert: (id: string, patch: { title?: string; due_date?: string; lead_days?: number; done?: boolean; note?: string; recurrence?: string; category?: string | null; occurrence?: string }) =>
    req<OrgAlert>(`/org/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteAlert: (id: string) =>
    req<{ ok: boolean }>(`/org/alerts/${id}`, { method: 'DELETE' }),

  // Documents
  updateDocument: (dossierId: string, docId: string, received: boolean, note?: string) =>
    req<any>(`/org/dossiers/${dossierId}/documents/${docId}`, { method: 'PATCH', body: JSON.stringify({ received, received_note: note ?? null }) }),
  setDocumentUrl: (dossierId: string, docId: string, url: string | null) =>
    req<any>(`/org/dossiers/${dossierId}/documents/${docId}`, { method: 'PATCH', body: JSON.stringify({ url }) }),
  addDocument: (dossierId: string, data: { task_id?: string | null; label: string; url?: string | null; received?: boolean }) =>
    req<OrgDocument>(`/org/dossiers/${dossierId}/documents`, { method: 'POST', body: JSON.stringify(data) }),
  uploadDocument: async (dossierId: string, taskId: string | null, files: File[]): Promise<OrgDocument[]> => {
    const fd = new FormData();
    for (const f of files) fd.append('file', f);
    if (taskId) fd.append('task_id', taskId);
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetch(`${BASE}/org/dossiers/${dossierId}/documents/file`, { method: 'POST', headers, body: fd });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Erreur ${r.status}`);
    }
    return r.json();
  },
  fetchDocumentBlob: async (dossierId: string, docId: string): Promise<Blob> => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // KV : propagation possible après écriture → 2 nouvelles tentatives sur 404
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`${BASE}/org/dossiers/${dossierId}/documents/${docId}/file`, { headers });
      if (r.ok) return r.blob();
      if (r.status !== 404 || attempt === 2) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Erreur ${r.status}`);
      }
      await new Promise(res => setTimeout(res, 1200 * (attempt + 1)));
    }
    throw new Error('Fichier introuvable');
  },
  deleteDocument: (dossierId: string, docId: string) =>
    req<any>(`/org/dossiers/${dossierId}/documents/${docId}`, { method: 'DELETE' }),

  // Notes
  addNote: (dossierId: string, content: string) =>
    req<any>(`/org/dossiers/${dossierId}/notes`, { method: 'POST', body: JSON.stringify({ content }) }),

  // Timer
  startTimer: (dossierId: string, taskId: string) =>
    req<any>(`/org/dossiers/${dossierId}/tasks/${taskId}/timer/start`, { method: 'POST' }),
  stopTimer: (dossierId: string, taskId: string) =>
    req<any>(`/org/dossiers/${dossierId}/tasks/${taskId}/timer/stop`, { method: 'POST' }),
  getTimers: (dossierId: string) =>
    req<{ entries: any[]; tasks: any[] }>(`/org/dossiers/${dossierId}/timers`),

  // Timeline
  getTimeline: (dossierId: string) => req<TimelineEvent[]>(`/org/dossiers/${dossierId}/timeline`),
  getAuditLog: (dossierId: string) => req<any[]>(`/org/dossiers/${dossierId}/audit`),

  // Expert-only
  getComptables: () => req<OrgComptable[]>('/org/comptables'),
  getComptableDetail: (id: string) => req<any>(`/org/comptables/${id}/detail`),
  createComptable: (d: any) => req<any>('/org/comptables', { method: 'POST', body: JSON.stringify(d) }),
  toggleComptable: (id: string, isActive: boolean) =>
    req<any>(`/org/comptables/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }),
  updateComptable: (id: string, patch: { full_name?: string; email?: string; password?: string }) =>
    req<any>(`/org/comptables/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  updateProfile: (patch: { full_name?: string; email?: string }) =>
    req<any>('/org/auth/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  getAllDossiers: () => req<any[]>('/org/dossiers'),

  // Templates
  getTemplates: () => req<OrgTemplate[]>('/org/templates'),
  createTemplate: (label: string, requiresDocument: boolean, assignedComptableId?: string | null, frequency?: OrgFrequency) =>
    req<any>('/org/templates', { method: 'POST', body: JSON.stringify({ label, requires_document: requiresDocument, assigned_comptable_id: assignedComptableId || null, frequency: frequency || 'annuelle' }) }),
  updateTemplate: (id: string, patch: { assigned_comptable_id?: string | null; frequency?: OrgFrequency }) =>
    req<any>(`/org/templates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTemplate: (id: string) => req<any>(`/org/templates/${id}`, { method: 'DELETE' }),
};
