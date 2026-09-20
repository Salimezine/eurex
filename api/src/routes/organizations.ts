import { Env } from '../types';
import { json, error, generateId } from '../utils';
import { getOrgUser, canAccessClient, canAccessDossier, hashPassword } from './orgAuth';

// ============================================================
// CLIENTS
// GET /api/org/clients — list clients scoped by role
// ============================================================
export async function handleOrgClients(request: Request, env: Env): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);

  let clients;
  if (user.role === 'expert') {
    const { results } = await env.DB.prepare(
      `SELECT c.*, u.full_name as comptable_name
       FROM org_clients c
       LEFT JOIN org_users u ON c.assigned_comptable_id = u.id
       WHERE c.organization_id = ?
       ORDER BY c.name`
    ).bind(user.organization_id).all();
    clients = results;
  } else {
    const { results } = await env.DB.prepare(
      `SELECT c.*, u.full_name as comptable_name
       FROM org_clients c
       LEFT JOIN org_users u ON c.assigned_comptable_id = u.id
       WHERE c.organization_id = ? AND c.assigned_comptable_id = ?
       ORDER BY c.name`
    ).bind(user.organization_id, user.id).all();
    clients = results;
  }

  // Enrich with dossier + progress info
  const enriched = await Promise.all(clients.map(async (c: any) => {
    const dossier = await env.DB.prepare(
      `SELECT * FROM org_dossiers WHERE client_id = ? AND status = 'en_cours' ORDER BY exercice DESC LIMIT 1`
    ).bind(c.id).first() as any;

    let taskStats = { total: 0, fait: 0, en_cours: 0, bloque_client: 0 };
    let docStats = { total: 0, received: 0 };

    if (dossier) {
      const { results: tasks } = await env.DB.prepare(
        `SELECT status, COUNT(*) as cnt FROM org_tasks WHERE dossier_id = ? GROUP BY status`
      ).bind(dossier.id).all();
      for (const t of tasks as any[]) {
        taskStats.total += t.cnt;
        if (t.status === 'fait') taskStats.fait += t.cnt;
        else if (t.status === 'en_cours' || t.status === 'a_faire') taskStats.en_cours += t.cnt;
        else if (t.status === 'bloque_client') taskStats.bloque_client += t.cnt;
      }

      const { results: docs } = await env.DB.prepare(
        `SELECT COUNT(*) as total, SUM(CASE WHEN received = 1 THEN 1 ELSE 0 END) as received
         FROM org_expected_documents WHERE dossier_id = ?`
      ).bind(dossier.id).all() as any[];
      if (docs[0]) {
        docStats.total = docs[0].total || 0;
        docStats.received = docs[0].received || 0;
      }
    }

    const progress = taskStats.total > 0
      ? Math.round((taskStats.fait / taskStats.total) * 100 * 10) / 10
      : 0;

    return {
      ...c,
      dossier_actuel: dossier || null,
      task_stats: taskStats,
      doc_stats: docStats,
      progress,
    };
  }));

  return json(enriched);
}

// POST /api/org/clients — create a new client (expert only)
export async function handleOrgCreateClient(request: Request, env: Env): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (user.role !== 'expert') return error('Réservé au rôle expert', 403);

  const { name, matricule_fiscal, assigned_comptable_id, contact_email, contact_phone } = await request.json() as any;
  if (!name) return error('Nom du client requis');

  const id = generateId();
  await env.DB.prepare(
    `INSERT INTO org_clients (id, organization_id, assigned_comptable_id, name, matricule_fiscal, contact_email, contact_phone)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.organization_id, assigned_comptable_id || null, name, matricule_fiscal || null, contact_email || null, contact_phone || null).run();

  // Audit
  await env.DB.prepare(
    `INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details)
     VALUES (?, ?, ?, ?, 'client_created', 'client', ?, ?)`
  ).bind(generateId(), user.organization_id, user.id, user.full_name, id, JSON.stringify({ name })).run();

  return json({ id, name }, 201);
}

// PATCH /api/org/clients/:id/reassign — expert reassigns client
export async function handleOrgReassignClient(request: Request, env: Env, clientId: string): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (user.role !== 'expert') return error('Réservé au rôle expert', 403);

  const { assigned_comptable_id } = await request.json() as any;
  if (!assigned_comptable_id) return error('assigned_comptable_id requis');

  const client = await env.DB.prepare('SELECT * FROM org_clients WHERE id = ? AND organization_id = ?')
    .bind(clientId, user.organization_id).first() as any;
  if (!client) return error('Client non trouvé', 404);

  const oldComptable = client.assigned_comptable_id;
  await env.DB.prepare('UPDATE org_clients SET assigned_comptable_id = ? WHERE id = ?')
    .bind(assigned_comptable_id, clientId).run();

  await env.DB.prepare(
    `INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details)
     VALUES (?, ?, ?, ?, 'client_reassigned', 'client', ?, ?)`
  ).bind(generateId(), user.organization_id, user.id, user.full_name, clientId,
    JSON.stringify({ old_comptable: oldComptable, new_comptable: assigned_comptable_id })).run();

  return json({ ok: true });
}

// ============================================================
// DOSSIERS
// GET /api/org/clients/:id/dossiers — list dossiers for a client
// ============================================================
export async function handleOrgClientDossiers(request: Request, env: Env, clientId: string): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (!await canAccessClient(user, clientId, env)) return error('Accès refusé', 403);

  const { results } = await env.DB.prepare(
    `SELECT * FROM org_dossiers WHERE client_id = ? ORDER BY exercice DESC`
  ).bind(clientId).all();

  // Enrich with task stats
  const enriched = await Promise.all(results.map(async (d: any) => {
    const { results: tasks } = await env.DB.prepare(
      `SELECT status, COUNT(*) as cnt FROM org_tasks WHERE dossier_id = ? GROUP BY status`
    ).bind(d.id).all();
    const stats = { total: 0, fait: 0, en_cours: 0, bloque_client: 0 };
    for (const t of tasks as any[]) {
      stats.total += t.cnt;
      if (t.status === 'fait') stats.fait += t.cnt;
      else if (t.status === 'en_cours' || t.status === 'a_faire') stats.en_cours += t.cnt;
      else if (t.status === 'bloque_client') stats.bloque_client += t.cnt;
    }
    return { ...d, task_stats: stats, progress: stats.total > 0 ? Math.round(stats.fait / stats.total * 1000) / 10 : 0 };
  }));

  return json(enriched);
}

// GET /api/org/dossiers/:id — get dossier detail with tasks + documents
export async function handleOrgGetDossier(request: Request, env: Env, dossierId: string): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (!await canAccessDossier(user, dossierId, env)) return error('Accès refusé', 403);

  const dossier = await env.DB.prepare(
    `SELECT d.*, c.name as client_name, c.matricule_fiscal, c.id as client_id
     FROM org_dossiers d
     JOIN org_clients c ON d.client_id = c.id
     WHERE d.id = ?`
  ).bind(dossierId).first() as any;
  if (!dossier) return error('Dossier non trouvé', 404);

  const { results: tasks } = await env.DB.prepare(
    `SELECT * FROM org_tasks WHERE dossier_id = ? ORDER BY order_index`
  ).bind(dossierId).all();

  const { results: documents } = await env.DB.prepare(
    `SELECT * FROM org_expected_documents WHERE dossier_id = ? ORDER BY label`
  ).bind(dossierId).all();

  const { results: notes } = await env.DB.prepare(
    `SELECT n.*, u.full_name as author_name FROM org_notes n
     LEFT JOIN org_users u ON n.user_id = u.id
     WHERE n.dossier_id = ? ORDER BY n.created_at DESC`
  ).bind(dossierId).all();

  // Task stats
  const stats = { total: tasks.length, fait: 0, en_cours: 0, bloque_client: 0 };
  for (const t of tasks as any[]) {
    if (t.status === 'fait') stats.fait++;
    else if (t.status === 'en_cours' || t.status === 'a_faire') stats.en_cours++;
    else if (t.status === 'bloque_client') stats.bloque_client++;
  }

  // Doc stats
  const docStats = { total: documents.length, received: documents.filter((d: any) => d.received).length };

  // Can close?
  const canClose = user.role === 'expert'
    ? stats.bloque_client === 0 && stats.en_cours === 0
    : false;
  const canForceClose = user.role === 'expert';
  const blockReasons = (tasks as any[]).filter(t => t.status !== 'fait').map(t => t.label);

  return json({
    ...dossier,
    tasks,
    documents,
    notes,
    task_stats: stats,
    doc_stats: docStats,
    can_close: stats.bloque_client === 0 && stats.en_cours === 0,
    can_force_close: canForceClose,
    block_reasons: blockReasons,
    progress: stats.total > 0 ? Math.round(stats.fait / stats.total * 1000) / 10 : 0,
  });
}

// POST /api/org/clients/:id/dossiers — open new exercice
export async function handleOrgCreateDossier(request: Request, env: Env, clientId: string): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (!await canAccessClient(user, clientId, env)) return error('Accès refusé', 403);

  const { exercice } = await request.json() as any;
  if (!exercice) return error('Exercice requis');

  // Check previous dossier is closed
  const prevDossier = await env.DB.prepare(
    `SELECT * FROM org_dossiers WHERE client_id = ? ORDER BY exercice DESC LIMIT 1`
  ).bind(clientId).first() as any;

  if (prevDossier && prevDossier.status !== 'cloture') {
    return error('Le dossier de l\'exercice précédent doit être clôturé');
  }

  // Check exercice doesn't exist
  const existing = await env.DB.prepare(
    `SELECT id FROM org_dossiers WHERE client_id = ? AND exercice = ?`
  ).bind(clientId, exercice).first();
  if (existing) return error('Un dossier existe déjà pour cet exercice');

  const dossierId = generateId();
  await env.DB.prepare(
    `INSERT INTO org_dossiers (id, client_id, exercice, status) VALUES (?, ?, ?, 'en_cours')`
  ).bind(dossierId, clientId, exercice).run();

  // Apply task template
  const { results: templates } = await env.DB.prepare(
    `SELECT * FROM org_task_templates WHERE organization_id = ? ORDER BY order_index`
  ).bind(user.organization_id).all();

  for (const tmpl of templates as any[]) {
    const taskId = generateId();
    await env.DB.prepare(
      `INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index) VALUES (?, ?, ?, 'a_faire', ?, ?)`
    ).bind(taskId, dossierId, tmpl.label, tmpl.requires_document, tmpl.order_index).run();

    // Auto-create expected document if requires_document
    if (tmpl.requires_document) {
      await env.DB.prepare(
        `INSERT INTO org_expected_documents (id, dossier_id, task_id, label, received) VALUES (?, ?, ?, ?, 0)`
      ).bind(generateId(), dossierId, taskId, tmpl.label).run();
    }
  }

  // Audit
  await env.DB.prepare(
    `INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details)
     VALUES (?, ?, ?, ?, 'dossier_created', 'dossier', ?, ?)`
  ).bind(generateId(), user.organization_id, user.id, user.full_name, dossierId,
    JSON.stringify({ exercice, client_id: clientId })).run();

  return json({ id: dossierId, exercice, status: 'en_cours' }, 201);
}

// ============================================================
// TASKS
// PATCH /api/org/dossiers/:id/tasks/:taskId
// ============================================================
export async function handleOrgUpdateTask(
  request: Request, env: Env, dossierId: string, taskId: string
): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (!await canAccessDossier(user, dossierId, env)) return error('Accès refusé', 403);

  const { status, blocked_reason } = await request.json() as any;
  if (!status) return error('Status requis');
  if (!['a_faire', 'en_cours', 'fait', 'bloque_client'].includes(status)) {
    return error('Status invalide');
  }

  const task = await env.DB.prepare('SELECT * FROM org_tasks WHERE id = ? AND dossier_id = ?')
    .bind(taskId, dossierId).first() as any;
  if (!task) return error('Tâche non trouvée', 404);

  const oldStatus = task.status;
  await env.DB.prepare(
    `UPDATE org_tasks SET status = ?, blocked_reason = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(status, blocked_reason || null, user.id, taskId).run();

  // Recalculate cached progress
  const { results: allTasks } = await env.DB.prepare(
    `SELECT status, COUNT(*) as cnt FROM org_tasks WHERE dossier_id = ? GROUP BY status`
  ).bind(dossierId).all();
  let total = 0, fait = 0;
  for (const t of allTasks as any[]) {
    total += t.cnt;
    if (t.status === 'fait') fait += t.cnt;
  }
  const progress = total > 0 ? Math.round(fait / total * 1000) / 10 : 0;
  await env.DB.prepare('UPDATE org_dossiers SET cached_progress = ? WHERE id = ?').bind(progress, dossierId).run();

  // Audit
  await env.DB.prepare(
    `INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details)
     VALUES (?, ?, ?, ?, 'task_status_changed', 'task', ?, ?)`
  ).bind(generateId(), user.organization_id, user.id, user.full_name, taskId,
    JSON.stringify({ old_status: oldStatus, new_status: status, blocked_reason })).run();

  return json({ ok: true, progress });
}

// ============================================================
// DOCUMENTS
// PATCH /api/org/dossiers/:id/documents/:docId — mark received / upload
// ============================================================
export async function handleOrgUpdateDocument(
  request: Request, env: Env, dossierId: string, docId: string
): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (!await canAccessDossier(user, dossierId, env)) return error('Accès refusé', 403);

  const doc = await env.DB.prepare('SELECT * FROM org_expected_documents WHERE id = ? AND dossier_id = ?')
    .bind(docId, dossierId).first() as any;
  if (!doc) return error('Document non trouvé', 404);

  const { received, received_note, file_r2_key } = await request.json() as any;

  await env.DB.prepare(
    `UPDATE org_expected_documents SET received = ?, received_at = datetime('now'), received_note = ?, file_r2_key = ?, updated_by = ? WHERE id = ?`
  ).bind(received ? 1 : 0, received_note || null, file_r2_key || null, user.id, docId).run();

  // Audit
  await env.DB.prepare(
    `INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details)
     VALUES (?, ?, ?, ?, ?, 'document', ?, ?)`
  ).bind(generateId(), user.organization_id, user.id, user.full_name,
    received ? 'document_received' : 'document_unreceived', docId,
    JSON.stringify({ label: doc.label, received, received_note })).run();

  return json({ ok: true });
}

// ============================================================
// CLOSE DOSSIER
// PATCH /api/org/dossiers/:id/close
// ============================================================
export async function handleOrgCloseDossier(request: Request, env: Env, dossierId: string): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (!await canAccessDossier(user, dossierId, env)) return error('Accès refusé', 403);

  const dossier = await env.DB.prepare('SELECT * FROM org_dossiers WHERE id = ?').bind(dossierId).first() as any;
  if (!dossier) return error('Dossier non trouvé', 404);
  if (dossier.status === 'cloture') return error('Dossier déjà clôturé');

  // Check tasks
  const { results: blockedTasks } = await env.DB.prepare(
    `SELECT label FROM org_tasks WHERE dossier_id = ? AND status != 'fait'`
  ).bind(dossierId).all();

  const { force, justification } = await request.json() as any;

  if (blockedTasks.length > 0 && !force) {
    return error(`Clôture impossible — tâches restantes : ${blockedTasks.map((t: any) => t.label).join(', ')}`);
  }

  if (blockedTasks.length > 0 && force && user.role !== 'expert') {
    return error('Seul un expert peut forcer la clôture');
  }

  await env.DB.prepare(
    `UPDATE org_dossiers SET status = 'cloture', closed_at = datetime('now'), closed_by = ? WHERE id = ?`
  ).bind(user.id, dossierId).run();

  // Audit
  const details: any = { forced: !!force };
  if (justification) details.justification = justification;
  if (blockedTasks.length > 0) details.blocked_tasks = blockedTasks.map((t: any) => t.label);

  await env.DB.prepare(
    `INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details)
     VALUES (?, ?, ?, ?, 'dossier_closed', 'dossier', ?, ?)`
  ).bind(generateId(), user.organization_id, user.id, user.full_name, dossierId,
    JSON.stringify(details)).run();

  return json({ ok: true });
}

// ============================================================
// NOTES
// POST /api/org/dossiers/:id/notes
// ============================================================
export async function handleOrgAddNote(request: Request, env: Env, dossierId: string): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (!await canAccessDossier(user, dossierId, env)) return error('Accès refusé', 403);

  const { content } = await request.json() as any;
  if (!content?.trim()) return error('Contenu requis');

  const noteId = generateId();
  await env.DB.prepare(
    `INSERT INTO org_notes (id, dossier_id, user_id, user_name, content) VALUES (?, ?, ?, ?, ?)`
  ).bind(noteId, dossierId, user.id, user.full_name, content.trim()).run();

  await env.DB.prepare(
    `INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details)
     VALUES (?, ?, ?, ?, 'note_added', 'note', ?, ?)`
  ).bind(generateId(), user.organization_id, user.id, user.full_name, noteId,
    JSON.stringify({ preview: content.trim().slice(0, 100) })).run();

  return json({ id: noteId }, 201);
}

// ============================================================
// TIMELINE
// GET /api/org/dossiers/:id/timeline
// ============================================================
export async function handleOrgTimeline(request: Request, env: Env, dossierId: string): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (!await canAccessDossier(user, dossierId, env)) return error('Accès refusé', 403);

  const { results } = await env.DB.prepare(
    `SELECT * FROM org_audit_log WHERE target_id = ? OR target_id IN (
       SELECT id FROM org_tasks WHERE dossier_id = ?
     ) OR target_id IN (
       SELECT id FROM org_expected_documents WHERE dossier_id = ?
     ) OR target_id IN (
       SELECT id FROM org_notes WHERE dossier_id = ?
     )
     ORDER BY created_at DESC LIMIT 100`
  ).bind(dossierId, dossierId, dossierId, dossierId).all();

  // Map audit events to timeline items
  const timeline = results.map((r: any) => {
    let type = r.action;
    let label = '';
    let icon = '📋';

    switch (r.action) {
      case 'task_status_changed':
        const details = JSON.parse(r.details || '{}');
        if (details.new_status === 'fait') { icon = '🟢'; label = `Tâche terminée`; }
        else if (details.new_status === 'bloque_client') { icon = '🔴'; label = `Tâche bloquée — ${details.blocked_reason || ''}`; }
        else { icon = '🔵'; label = `Statut changé → ${details.new_status}`; }
        break;
      case 'document_received':
        icon = '📎'; label = 'Document reçu du client';
        break;
      case 'document_unreceived':
        icon = '📄'; label = 'Document marqué non reçu';
        break;
      case 'dossier_closed':
        icon = '🔒'; label = 'Clôture de l\'exercice';
        break;
      case 'dossier_created':
        icon = '🆕'; label = 'Ouverture d\'un nouvel exercice';
        break;
      case 'note_added':
        icon = '💬'; label = 'Note interne ajoutée';
        break;
      case 'client_reassigned':
        icon = '👤'; label = 'Client réassigné';
        break;
      default:
        label = r.action;
    }

    return {
      date: r.created_at,
      type,
      icon,
      label,
      actor: r.user_name || 'Système',
      details: r.details ? JSON.parse(r.details) : null,
    };
  });

  return json(timeline);
}

// ============================================================
// EXPERT-ONLY ENDPOINTS
// ============================================================

// GET /api/org/comptables — list comptables (expert only)
export async function handleOrgComptables(request: Request, env: Env): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (user.role !== 'expert') return error('Réservé au rôle expert', 403);

  const { results } = await env.DB.prepare(
    `SELECT id, full_name, email, is_active, created_at FROM org_users WHERE organization_id = ? AND role = 'comptable' ORDER BY full_name`
  ).bind(user.organization_id).all();

  // Enrich with client count + avg progress
  const enriched = await Promise.all(results.map(async (c: any) => {
    const { results: clients } = await env.DB.prepare(
      `SELECT c.id, d.cached_progress FROM org_clients c
       LEFT JOIN org_dossiers d ON d.client_id = c.id AND d.status = 'en_cours'
       WHERE c.organization_id = ? AND c.assigned_comptable_id = ?`
    ).bind(user.organization_id, c.id).all();

    const clientCount = clients.length;
    const avgProgress = clients.length > 0
      ? Math.round(clients.reduce((sum: number, cl: any) => sum + (cl.cached_progress || 0), 0) / clients.length * 10) / 10
      : 0;
    const blockedCount = clients.filter((cl: any) => {
      // Check if any task is bloque_client
      return cl.cached_progress !== null && cl.cached_progress < 100;
    }).length;

    // Task stats for aggregated donut
    const { results: taskStats } = await env.DB.prepare(
      `SELECT t.status, COUNT(*) as cnt FROM org_tasks t
       JOIN org_dossiers d ON t.dossier_id = d.id
       JOIN org_clients c ON d.client_id = c.id
       WHERE c.assigned_comptable_id = ? AND c.organization_id = ? AND d.status = 'en_cours'
       GROUP BY t.status`
    ).bind(c.id, user.organization_id).all();

    const stats = { total: 0, fait: 0, en_cours: 0, bloque_client: 0 };
    for (const t of taskStats as any[]) {
      stats.total += t.cnt;
      if (t.status === 'fait') stats.fait += t.cnt;
      else if (t.status === 'en_cours' || t.status === 'a_faire') stats.en_cours += t.cnt;
      else if (t.status === 'bloque_client') stats.bloque_client += t.cnt;
    }

    return { ...c, client_count: clientCount, avg_progress: avgProgress, blocked_count: blockedCount, task_stats: stats };
  }));

  return json(enriched);
}

// GET /api/org/dossiers — global view (expert only)
export async function handleOrgAllDossiers(request: Request, env: Env): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (user.role !== 'expert') return error('Réservé au rôle expert', 403);

  const { results } = await env.DB.prepare(
    `SELECT d.*, c.name as client_name, u.full_name as comptable_name, u.id as comptable_id
     FROM org_dossiers d
     JOIN org_clients c ON d.client_id = c.id
     LEFT JOIN org_users u ON c.assigned_comptable_id = u.id
     WHERE c.organization_id = ?
     ORDER BY d.exercice DESC, c.name`
  ).bind(user.organization_id).all();

  const enriched = await Promise.all(results.map(async (d: any) => {
    const { results: tasks } = await env.DB.prepare(
      `SELECT status, COUNT(*) as cnt FROM org_tasks WHERE dossier_id = ? GROUP BY status`
    ).bind(d.id).all();
    const stats = { total: 0, fait: 0, en_cours: 0, bloque_client: 0 };
    for (const t of tasks as any[]) {
      stats.total += t.cnt;
      if (t.status === 'fait') stats.fait += t.cnt;
      else if (t.status === 'en_cours' || t.status === 'a_faire') stats.en_cours += t.cnt;
      else if (t.status === 'bloque_client') stats.bloque_client += t.cnt;
    }
    return { ...d, task_stats: stats, progress: stats.total > 0 ? Math.round(stats.fait / stats.total * 1000) / 10 : 0 };
  }));

  return json(enriched);
}

// POST /api/org/comptables — create comptable (expert only)
export async function handleOrgCreateComptable(request: Request, env: Env): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (user.role !== 'expert') return error('Réservé au rôle expert', 403);

  const { full_name, email, password } = await request.json() as any;
  if (!full_name || !email || !password) return error('Nom, email et mot de passe requis');
  if (password.length < 12) return error('Le mot de passe doit faire au moins 12 caractères');

  // Check email unique
  const existing = await env.DB.prepare('SELECT id FROM org_users WHERE email = ?').bind(email).first();
  if (existing) return error('Cet email est déjà utilisé', 409);

  const id = generateId();
  const hash = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO org_users (id, organization_id, full_name, email, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?, ?, 'comptable', 1)`
  ).bind(id, user.organization_id, full_name, email, hash).run();

  return json({ id, full_name, email, role: 'comptable' }, 201);
}

// PATCH /api/org/comptables/:id — toggle active
export async function handleOrgToggleComptable(request: Request, env: Env, comptableId: string): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (user.role !== 'expert') return error('Réservé au rôle expert', 403);

  const { is_active } = await request.json() as any;
  await env.DB.prepare('UPDATE org_users SET is_active = ? WHERE id = ? AND organization_id = ?')
    .bind(is_active ? 1 : 0, comptableId, user.organization_id).run();

  return json({ ok: true });
}

// ============================================================
// TASK TEMPLATES
// GET /api/org/templates
// POST /api/org/templates
// DELETE /api/org/templates/:id
// ============================================================
export async function handleOrgTemplates(request: Request, env: Env): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT * FROM org_task_templates WHERE organization_id = ? ORDER BY order_index`
    ).bind(user.organization_id).all();
    return json(results);
  }

  if (request.method === 'POST') {
    if (user.role !== 'expert') return error('Réservé au rôle expert', 403);
    const { label, requires_document } = await request.json() as any;
    if (!label) return error('Libellé requis');

    const { results: maxOrder } = await env.DB.prepare(
      `SELECT MAX(order_index) as mx FROM org_task_templates WHERE organization_id = ?`
    ).bind(user.organization_id).all() as any[];

    const id = generateId();
    await env.DB.prepare(
      `INSERT INTO org_task_templates (id, organization_id, label, order_index, requires_document) VALUES (?, ?, ?, ?, ?)`
    ).bind(id, user.organization_id, label, (maxOrder[0]?.mx || 0) + 1, requires_document ? 1 : 0).run();

    return json({ id, label }, 201);
  }

  return error('Méthode non supportée', 405);
}

export async function handleOrgDeleteTemplate(request: Request, env: Env, templateId: string): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (user.role !== 'expert') return error('Réservé au rôle expert', 403);

  await env.DB.prepare('DELETE FROM org_task_templates WHERE id = ? AND organization_id = ?')
    .bind(templateId, user.organization_id).run();
  return json({ ok: true });
}

// ============================================================
// AUDIT LOG
// GET /api/org/dossiers/:id/audit
// ============================================================
export async function handleOrgAuditLog(request: Request, env: Env, dossierId: string): Promise<Response> {
  const user = await getOrgUser(request, env);
  if (!user) return error('Non autorisé', 401);
  if (!await canAccessDossier(user, dossierId, env)) return error('Accès refusé', 403);

  const { results } = await env.DB.prepare(
    `SELECT * FROM org_audit_log
     WHERE target_id IN (SELECT id FROM org_tasks WHERE dossier_id = ?)
        OR target_id IN (SELECT id FROM org_expected_documents WHERE dossier_id = ?)
        OR target_id IN (SELECT id FROM org_notes WHERE dossier_id = ?)
        OR (target_type = 'dossier' AND target_id = ?)
     ORDER BY created_at DESC LIMIT 200`
  ).bind(dossierId, dossierId, dossierId, dossierId).all();

  return json(results);
}

// ============================================================
// PROGRESS RECALCULATION HELPER
// ============================================================
export async function recalcProgress(env: Env, dossierId: string): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT status, COUNT(*) as cnt FROM org_tasks WHERE dossier_id = ? GROUP BY status`
  ).bind(dossierId).all();
  let total = 0, fait = 0;
  for (const t of results as any[]) {
    total += t.cnt;
    if (t.status === 'fait') fait += t.cnt;
  }
  const progress = total > 0 ? Math.round(fait / total * 1000) / 10 : 0;
  await env.DB.prepare('UPDATE org_dossiers SET cached_progress = ? WHERE id = ?').bind(progress, dossierId).run();
  return progress;
}
