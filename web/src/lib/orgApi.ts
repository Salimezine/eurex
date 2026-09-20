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
  updated_at: string;
  total_time_seconds: number;
  timer_started_at: string | null;
  timer_user_id: string | null;
  updated_by_name: string | null;
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

export interface OrgTemplate {
  id: string;
  label: string;
  order_index: number;
  requires_document: number;
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
  renameTask: (dossierId: string, taskId: string, label: string) =>
    req<any>(`/org/dossiers/${dossierId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
  deleteTask: (dossierId: string, taskId: string) =>
    req<any>(`/org/dossiers/${dossierId}/tasks/${taskId}`, { method: 'DELETE' }),
  addTask: (dossierId: string, label: string) =>
    req<any>(`/org/dossiers/${dossierId}/tasks`, { method: 'POST', body: JSON.stringify({ label }) }),

  // Documents
  updateDocument: (dossierId: string, docId: string, received: boolean, note?: string) =>
    req<any>(`/org/dossiers/${dossierId}/documents/${docId}`, { method: 'PATCH', body: JSON.stringify({ received, received_note: note }) }),

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
  createComptable: (d: any) => req<any>('/org/comptables', { method: 'POST', body: JSON.stringify(d) }),
  toggleComptable: (id: string, isActive: boolean) =>
    req<any>(`/org/comptables/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }),
  getAllDossiers: () => req<any[]>('/org/dossiers'),

  // Templates
  getTemplates: () => req<OrgTemplate[]>('/org/templates'),
  createTemplate: (label: string, requiresDocument: boolean) =>
    req<any>('/org/templates', { method: 'POST', body: JSON.stringify({ label, requires_document: requiresDocument }) }),
  deleteTemplate: (id: string) => req<any>(`/org/templates/${id}`, { method: 'DELETE' }),
};
