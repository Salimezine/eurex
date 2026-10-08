export interface Env {
  DB: D1Database;
  AI: Ai;
  ENVIRONMENT: string;
  AI_FALLBACK_URLS?: string;
  DOCS_KV?: any;
}

function genId(): string {
  return crypto.randomUUID();
}

// Rôles superviseurs : vérification des tâches + tous les privilèges expert.
function isSupervisor(role: string): boolean {
  return role === 'expert' || role === 'manager';
}

// Heures pointees d'un utilisateur : vues days (7 derniers) / month (1..aujourd'hui) / year (mois).
// Realise vs norme 8h30 lun-ven, repos sam-dim, depassement (+ heures du weekend = rattrapage
// du ghyeb) et solde net de periode (le depassement d'un jour compense le manque d'un autre).
async function buildHoursPayload(env: Env, userId: string, view: string, exercice?: number | null): Promise<any> {
  const exYear = exercice ? Number(exercice) : null;
  const nowMs = Date.now();
  const curYear = new Date(nowMs + 3600000).getUTCFullYear();
  // Exercice passe : on affiche l'annee complete des 12 mois (vues days/month sans objet)
  const effView = exYear && exYear !== curYear ? 'year' : view;
  // Heures pointees groupees par jour local TN (UTC+1) — fenetre 400j pour la vue annee
  // Exercice filtre : bornes explicites annee (les pointages d'un exercice passe sortent de la fenetre glissante)
  const { results: dayRows } = exYear
    ? await env.DB.prepare(`SELECT date(datetime(te.started_at, '+60 minutes')) as d, COALESCE(SUM(te.duration_seconds),0) AS secs FROM org_time_entries te JOIN org_dossiers d ON te.dossier_id = d.id WHERE te.user_id = ? AND te.stopped_at IS NOT NULL AND d.exercice = ? AND te.started_at >= ? AND te.started_at < datetime(?, '+1 year') GROUP BY d`).bind(userId, exYear, `${exYear}-01-01`, `${exYear}-01-01`).all()
    : await env.DB.prepare(`SELECT date(datetime(started_at, '+60 minutes')) as d, COALESCE(SUM(duration_seconds),0) AS secs FROM org_time_entries WHERE user_id = ? AND stopped_at IS NOT NULL AND started_at >= datetime('now', '-400 days') GROUP BY d`).bind(userId).all();
  const byDay = new Map((dayRows as any[]).map(r => [String(r.d), Number(r.secs) || 0]));
  // Chrono en cours : ajoute au jour TN courant
  const running = await env.DB.prepare('SELECT started_at FROM org_time_entries WHERE user_id = ? AND stopped_at IS NULL').bind(userId).first() as any;
  const me = await env.DB.prepare('SELECT last_seen_at FROM org_users WHERE id = ?').bind(userId).first() as any;
  const parseUtc = (s: any) => s ? Math.floor(Date.parse(String(s).replace(' ', 'T') + 'Z') / 1000) : 0;
  const runningSec = running ? Math.max(0, Math.floor(nowMs / 1000) - parseUtc(running.started_at)) : 0;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const tn = new Date(nowMs + 3600000);
  const tY = exYear || tn.getUTCFullYear();
  // Exercice passe : les 12 mois sont derrieres nous (vue annee complete)
  const tM = exYear && exYear < curYear ? 11 : tn.getUTCMonth();
  const tD = exYear && exYear < curYear ? 31 : tn.getUTCDate();
  const isPastExercice = !!exYear && exYear < curYear;
  const todayDow = tn.getUTCDay();
  const mkDay = (ds: string, y: number, m: number, d: number, isToday: boolean) => {
    const dow = new Date(Date.UTC(y, m, d)).getUTCDay();
    const rest = dow === 0 || dow === 6;
    const norm = rest ? 0 : 30600;
    let worked = byDay.get(ds) || 0;
    if (isToday && !isPastExercice) worked += runningSec;
    const missing = norm > 0 ? Math.max(0, norm - worked) : 0;
    const overtime = Math.max(0, worked - norm);
    return { date: ds, dow, worked_seconds: worked, norm_seconds: norm, missing_seconds: missing, overtime_seconds: overtime, rest, is_today: isToday && !isPastExercice };
  };
  let days: any[] = [];
  let months: any[] | null = null;
  if (effView === 'year') {
    // Annee en cours : un rang par mois (janv..mois courant), norme = jours ouvres x 8h30
    months = [];
    for (let m = 0; m <= tM; m++) {
      const lastD = m === tM ? tD : new Date(Date.UTC(tY, m + 1, 0)).getUTCDate();
      let w = 0, n = 0, mi = 0, ot = 0;
      for (let d = 1; d <= lastD; d++) {
        const row = mkDay(`${tY}-${pad2(m + 1)}-${pad2(d)}`, tY, m, d, m === tM && d === tD);
        w += row.worked_seconds; n += row.norm_seconds; mi += row.missing_seconds; ot += row.overtime_seconds;
      }
      months.push({ month: m + 1, worked_seconds: w, norm_seconds: n, missing_seconds: mi, overtime_seconds: ot, is_current: !isPastExercice && m === tM });
    }
  } else if (effView === 'month') {
    // Mois en cours : un rang par jour (1..aujourd'hui)
    for (let d = 1; d <= tD; d++) days.push(mkDay(`${tY}-${pad2(tM + 1)}-${pad2(d)}`, tY, tM, d, d === tD));
  } else {
    // 7 derniers jours glissants (jour courant en dernier)
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(new Date(nowMs + 3600000).setUTCHours(0, 0, 0, 0) - i * 86400000);
      days.push(mkDay(dt.toISOString().slice(0, 10), dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), i === 0));
    }
  }
  const rows: any[] = effView === 'year' ? (months as any[]) : days;
  const totals = rows.reduce((acc, r) => ({ worked_seconds: acc.worked_seconds + r.worked_seconds, norm_seconds: acc.norm_seconds + r.norm_seconds, missing_seconds: acc.missing_seconds + r.missing_seconds, overtime_seconds: acc.overtime_seconds + r.overtime_seconds }), { worked_seconds: 0, norm_seconds: 0, missing_seconds: 0, overtime_seconds: 0 });
  const net_missing = Math.max(0, totals.norm_seconds - totals.worked_seconds);
  const surplus = Math.max(0, totals.worked_seconds - totals.norm_seconds);
  const today = mkDay(`${tY}-${pad2(tM + 1)}-${pad2(tD)}`, tY, tM, tD, true);
  const online = parseUtc(me?.last_seen_at) >= Math.floor(nowMs / 1000) - 180;
  return { view: effView, exercice: exYear, days, months, today, totals: { ...totals, net_missing_seconds: net_missing, surplus_seconds: surplus }, online, today_dow: todayDow };
}

// Portee export d'une tache / d'une echeance (JSON array, NULL = toutes) vs statut export du client
// (vide/NULL = non_exportatrice ; portee NULL/vide = visible quel que soit le statut)
function exportScopeKeeps(scopeJson: any, exportStatus: any): boolean {
  if (!scopeJson) return true;
  let arr: any;
  try { arr = JSON.parse(String(scopeJson)); } catch { return true; }
  if (!Array.isArray(arr) || !arr.length) return true;
  return arr.includes(exportStatus || 'non_exportatrice');
}

// Avancement d'un dossier : seules les taches portees par le client entrent dans le cache
async function orgRecalcProgress(db: any, dossierId: string) {
  const { results } = await db.prepare('SELECT t.status, t.export_scope, c.export_status FROM org_tasks t JOIN org_dossiers d ON t.dossier_id = d.id JOIN org_clients c ON d.client_id = c.id WHERE t.dossier_id = ? AND t.hidden = 0').bind(dossierId).all();
  let total = 0, fait = 0;
  for (const t of results as any[]) {
    if (!exportScopeKeeps(t.export_scope, t.export_status)) continue;
    total++; if (t.status === 'fait') fait++;
  }
  const progress = total > 0 ? Math.round(fait / total * 1000) / 10 : 0;
  await db.prepare('UPDATE org_dossiers SET cached_progress = ? WHERE id = ?').bind(progress, dossierId).run();
  return progress;
}

// Pack d'echeances type — seed auto-correctif (id deterministe, upsert seulement si ecart)
// Variante dossier : chaque dossier recoit son propre pack (ids _d<id>, dossier_id rempli)
// export_scope : JSON array des statuts export concernes, NULL = toutes
async function ensureAlertPack(db: any, orgId: string, dossierId: string | null = null) {
  const y = new Date().getUTCFullYear();
  const pack = [
    { key: 'pm_mensuelle', title: 'Déclaration mensuelle d\'impôts (DMI) — TVA, retenues, TFP, FOPROLOS (PM télé-déclarante)', due_date: `${y}-12-20`, recurrence: 'mensuelle', months: null, category: 'morale', lead_days: 5, export_scope: null, note: 'Personnes morales soumises à la télé-déclaration : au plus tard le 20 du mois suivant (télé-déclaration DGI) — report au 1er jour ouvrable si férié/dimanche' },
    { key: 'cnss_tr', title: 'CNSS — déclaration trimestrielle des salaires & cotisations', due_date: `${y}-01-15`, recurrence: 'trimestrielle', months: '[1,4,7,10]', category: null, lead_days: 5, export_scope: '["semi_exportatrice","non_exportatrice"]', note: 'Régime général non agricole — droit commun : 15 du mois suivant le trimestre (15 janv/avr/juil/oct), BTP >50 salariés : 20 · entreprises totalement exportatrices : 25 (communiqué CNSS)' },
    { key: 'employeur', title: 'Déclaration annuelle de l\'employeur (retenues & salaires)', due_date: `${y}-02-28`, recurrence: 'annuelle', months: null, category: null, lead_days: 5, export_scope: null, note: 'Employeurs : retenues à la source et salaires versés — droit commun 28 février ; cas régime forfaitaire : jusqu\'au 30 avril (DGI) — vérifier le communiqué annuel DGI' },
    { key: 'acomptes_pm', title: 'Acomptes provisionnels IS — 3 × 30 % (personne morale)', due_date: `${y}-06-28`, recurrence: 'trimestrielle', months: '[6,9,12]', category: 'morale', lead_days: 5, export_scope: null, note: 'Art. 51 : 6e, 9e et 12e mois suivant la clôture, 28 premiers jours (exercice civil : 28 juin/sept/déc) — 3 × 30 % de l\'IS de l\'année précédente ; dus à compter de la 2e année ; hors agricole/pêche et forfait — formulaire officiel DGI/e-jibaya' },
    { key: 'is_annuelle', title: 'Déclaration annuelle & liquidation IS (personne morale)', due_date: `${y}-03-25`, recurrence: 'annuelle', months: null, category: 'morale', lead_days: 5, export_scope: '["semi_exportatrice","non_exportatrice"]', note: 'Art. 60 — droit commun : PM clôturant au 31/12 → au plus tard le 25 mars (déclaration provisoire) ; SA/audit légal : définitive 25 juin ; clôture ≠ 31/12 : 25e jour du 3e mois suivant · entreprises totalement exportatrices : 30 juin' },
    { key: 'is_definitive', title: 'Déclaration définitive IS (après approbation des comptes)', due_date: `${y}-06-25`, recurrence: 'annuelle', months: null, category: null, lead_days: 5, export_scope: null, note: 'SA et sociétés soumises à l\'audit légal : déclaration définitive au plus tard le 25 juin ou avant l\'AG (après la provisoire du 25 mars) — ETE : 30 juin' },
    { key: 'liasse_fiscale', title: 'Liasse fiscale — états comptables normalisés (F6001 à F6006)', due_date: `${y}-03-25`, recurrence: 'annuelle', months: null, category: null, lead_days: 5, export_scope: null, note: 'CCT (LF 2017 art. 41) : mêmes délais que la déclaration annuelle IS — 25 mars / définitive 25 juin (ETE) — télétransmission e-jibaya' },
    { key: 'tva_susp_ventes_pm', title: 'CA en suspension de TVA — ventes (listes trimestrielles, PM)', due_date: `${y}-01-28`, recurrence: 'trimestrielle', months: '[1,4,7,10]', category: 'morale', lead_days: 5, export_scope: '["exportatrice","semi_exportatrice"]', note: 'Personne morale : listes des factures de ventes en suspension, dépôt avant le 28 du mois suivant le trimestre civil — 28 janv/avr/juil/oct (art. 36 LF 2013)' },
    { key: 'tva_susp_achats_pm', title: 'CA en suspension de TVA — achats (listes trimestrielles, PM)', due_date: `${y}-01-28`, recurrence: 'trimestrielle', months: '[1,4,7,10]', category: 'morale', lead_days: 5, export_scope: '["exportatrice","semi_exportatrice"]', note: 'Personne morale : listes des factures d\'achats en suspension, dépôt avant le 28 du mois suivant le trimestre civil — 28 janv/avr/juil/oct (art. 35 LF 2013)' },
    { key: 'certificats_tej', title: 'Certificats de retenue à la source — plateforme TEJ', due_date: `${y}-01-31`, recurrence: 'mensuelle', months: null, category: null, lead_days: 5, export_scope: null, note: 'Élaboration et remise des certificats de RS via tej.finances.gov.tn au plus tard à la fin du mois suivant le mois de paiement (arrêté MF du 10/05/2024, art. 8)' },
    { key: 'ef_annuels', title: 'Préparation Etats financiers annuels', due_date: `${y}-03-15`, recurrence: 'annuelle', months: null, category: null, lead_days: 5, export_scope: null, note: 'États n-1 (bilan, compte de résultat, TAF) avant la liasse fiscale (25 mars) et l\'AGO — repère interne, à ajuster selon le calendrier du cabinet' },
    { key: 'pv_ago', title: 'Préparation PV AGO approbation EF n-1', due_date: `${y}-06-30`, recurrence: 'annuelle', months: null, category: null, lead_days: 5, export_scope: null, note: 'Approbation de l\'exercice n-1 en assemblée générale au plus tard 6 mois après clôture (exercice au 31/12 → 30 juin) — art. 403 loi 59-134 (SCF), à vérifier selon les statuts' },
    { key: 'depot_rne', title: 'Dépôt des EF n-1 et du PV AGO au RNE', due_date: `${y}-07-15`, recurrence: 'annuelle', months: null, category: null, lead_days: 5, export_scope: null, note: 'Dépôt des états financiers et du PV d\'AGO au Registre National des Entreprises dans les 15 jours de l\'AGO — au plus tard 15 juillet si AGO au 30 juin' },
    { key: 'renouv_autorisation_susp', title: "Renouvellement Autorisation d'achat en suspension de TVA", due_date: `${y}-01-15`, recurrence: 'annuelle', months: null, category: null, lead_days: 5, export_scope: null, note: "Renouvellement annuel de l'autorisation d'achat en suspension (art. 16 LF 2013) — date indicative, à aligner sur la date de délivrance portée sur l'autorisation" },
    { key: 'visa_bon_commande_susp', title: 'Visa bon de commande en suspension de TVA', due_date: `${y}-12-31`, recurrence: 'annuelle', months: null, category: null, lead_days: 5, export_scope: null, note: "Visa systématique de chaque bon de commande en suspension (contrôle continu) — point annuel de procédure" },
  ];
  const { results: existing } = await db.prepare('SELECT id, title, due_date, lead_days, recurrence, months, category, note, export_scope FROM org_fiscal_alerts WHERE organization_id = ?').bind(orgId).all();
  const byId = new Map((existing as any[]).map(r => [r.id, r]));
  const stmts: any[] = [];
  for (const p of pack) {
    const id = `pack_${p.key}_${dossierId ? `d${dossierId}` : orgId}`;
    const cur = byId.get(id);
    const same = cur && cur.title === p.title && cur.due_date === p.due_date && cur.lead_days === p.lead_days
      && cur.recurrence === p.recurrence && (cur.months || null) === p.months
      && (cur.category || null) === p.category && (cur.note || null) === p.note
      && (cur.export_scope || null) === p.export_scope;
    if (!same) {
      stmts.push(db.prepare('INSERT OR REPLACE INTO org_fiscal_alerts (id, organization_id, dossier_id, title, due_date, lead_days, recurrence, months, category, note, export_scope, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, orgId, dossierId || null, p.title, p.due_date, p.lead_days, p.recurrence, p.months, p.category, p.note, p.export_scope, 'Type EUREX'));
    }
  }
  if (stmts.length > 0) await db.batch(stmts);
}

// Creation d'un dossier + generation des taches depuis les modeles
// (mensuelle x12 mois, trimestrielle x4 (Janv/Avr/Juil/Oct), annuelle x1 — ou un seul exemplaire
// si le modele est rattache a un mois precis, ex: Depots AP 1/2/3)
async function createDossierWithTasks(env: Env, opts: { orgId: string; clientId: string; exercice: number; compId: string; actorId: string | null; actorName: string; details?: any }): Promise<string> {
  const { orgId, clientId, exercice, compId, actorId, actorName } = opts;
  const dossierId = genId();
  await env.DB.prepare("INSERT INTO org_dossiers (id, client_id, exercice, status) VALUES (?, ?, ?, 'en_cours')").bind(dossierId, clientId, exercice).run();
  const orgMonthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const { results: templates } = await env.DB.prepare('SELECT * FROM org_task_templates WHERE organization_id = ? ORDER BY order_index').bind(orgId).all();
  for (const tmpl of templates as any[]) {
    // Modele rattache a un mois precis (ex: Depots AP) : un seul exemplaire dans ce mois
    const months: (number | null)[] = tmpl.month ? [tmpl.month] :
      tmpl.frequency === 'mensuelle' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] :
      tmpl.frequency === 'trimestrielle' ? [1, 4, 7, 10] :
      [null];
    for (const m of months) {
      const taskId = genId();
      await env.DB.prepare('INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index, assigned_comptable_id, month, export_scope, created_at) VALUES (?, ?, ?, \'a_faire\', ?, ?, ?, ?, ?, datetime(\'now\'))').bind(taskId, dossierId, tmpl.label, tmpl.requires_document, tmpl.order_index, tmpl.assigned_comptable_id || null, m, tmpl.export_scope || null).run();
      if (tmpl.requires_document) {
        const docLabel = m ? `${tmpl.label} — ${orgMonthNames[m - 1]} ${exercice}` : tmpl.label;
        await env.DB.prepare('INSERT INTO org_expected_documents (id, dossier_id, task_id, label, received) VALUES (?, ?, ?, ?, 0)').bind(genId(), dossierId, taskId, docLabel).run();
      }
    }
  }
  await orgRecalcProgress(env.DB, dossierId);
  await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, \'dossier_created\', \'dossier\', ?, ?)')
    .bind(genId(), orgId, actorId, actorName, dossierId, JSON.stringify({ exercice, client_id: clientId, assigned_comptable_id: compId, ...(opts.details || {}) })).run();
  return dossierId;
}

// Passage automatique au nouvel exercice : cloture forcee du dossier encore ouvert (n-1)
// puis ouverture de l'exercice cible avec les memes modeles de taches.
// Idempotent : ne concerne que les clients sans dossier pour l'annee cible.
async function rolloverExercices(env: Env, opts: { orgId: string; source: string; targetYear?: number; clientId?: string; actorId?: string | null; actorName?: string }): Promise<{ year: number; created: any[]; closed: any[] }> {
  const y = opts.targetYear ? Number(opts.targetYear) : new Date().getUTCFullYear();
  const actorId = opts.actorId || null;
  const actorName = opts.actorName || 'Système';
  const created: any[] = [];
  const closed: any[] = [];
  const binds: any[] = [opts.orgId];
  let scopeSql = '';
  if (opts.clientId) { scopeSql += ' AND c.id = ?'; binds.push(opts.clientId); }
  // Clients a ouvrir : ont un dossier plus ancien, aucun pour l'annee cible, aucun plus recent
  const { results: rows } = await env.DB.prepare(
    `SELECT c.id, c.name, c.assigned_comptable_id FROM org_clients c
     WHERE c.organization_id = ?${scopeSql}
       AND EXISTS (SELECT 1 FROM org_dossiers d WHERE d.client_id = c.id AND d.exercice < ?)
       AND NOT EXISTS (SELECT 1 FROM org_dossiers d WHERE d.client_id = c.id AND d.exercice = ?)
       AND NOT EXISTS (SELECT 1 FROM org_dossiers d WHERE d.client_id = c.id AND d.exercice > ?)
     ORDER BY c.name`).bind(...binds, y, y, y).all();
  for (const c of rows as any[]) {
    // 1. Cloture forcee du dernier dossier encore ouvert (un seul exercice ouvert par client)
    const open = await env.DB.prepare("SELECT id, exercice FROM org_dossiers WHERE client_id = ? AND status != 'cloture' ORDER BY exercice DESC LIMIT 1").bind(c.id).first() as any;
    if (open && open.exercice < y) {
      await env.DB.prepare("UPDATE org_dossiers SET status = 'cloture', closed_at = datetime('now'), closed_by = ? WHERE id = ?").bind(actorId, open.id).run();
      await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, \'dossier_closed\', \'dossier\', ?, ?)')
        .bind(genId(), opts.orgId, actorId, actorName, open.id, JSON.stringify({ forced: true, auto: true, source: opts.source, exercice: open.exercice, justification: `Passage automatique à l'exercice ${y}` })).run();
      closed.push({ id: open.id, exercice: open.exercice });
    }
    // 2. Comptable : affectation du client, sinon 1er comptable actif
    let compId: string | null = c.assigned_comptable_id || null;
    if (!compId) {
      const f = await env.DB.prepare("SELECT id FROM org_users WHERE organization_id = ? AND role = 'comptable' AND is_active = 1 ORDER BY created_at LIMIT 1").bind(opts.orgId).first() as any;
      compId = f?.id || null;
    }
    if (!compId) continue; // aucun comptable : l'expert ouvrira le dossier a la main
    if (c.assigned_comptable_id !== compId) {
      await env.DB.prepare('UPDATE org_clients SET assigned_comptable_id = ? WHERE id = ?').bind(compId, c.id).run();
    }
    // 3. Ouverture de l'exercice + taches
    try {
      const dossierId = await createDossierWithTasks(env, { orgId: opts.orgId, clientId: c.id, exercice: y, compId, actorId, actorName, details: { auto: true, source: opts.source } });
      await ensureAlertPack(env.DB, opts.orgId, dossierId);
      created.push({ id: dossierId, client_id: c.id, client_name: c.name, exercice: y });
    } catch (e: any) {
      // Concurrence (index unique client_id + exercice) : un autre processus a deja cree le dossier
      if (!String(e?.message || e).includes('UNIQUE')) throw e;
    }
  }
  if (created.length > 0) await ensureAlertPack(env.DB, opts.orgId);
  // Garde-fou idempotent : une execution automatique par annee civile (un targetYear de test
  // ou un exercice passe/futur ne doit pas bloquer le passage reel)
  if (!opts.targetYear || opts.targetYear === new Date().getUTCFullYear()) {
    await env.DB.prepare('UPDATE organizations SET last_rollover_year = ? WHERE id = ?').bind(y, opts.orgId).run();
  }
  return { year: y, created, closed };
}

// Securite au chargement du dashboard : verification rapide (2 requetes) puis rollover si besoin.
// Le cron du 1er janvier fait le meme travail — cette passe rattrape un cron rate/impossible.
async function ensureCurrentExercice(env: Env, orgId: string): Promise<void> {
  try {
    const y = new Date().getUTCFullYear();
    const st = await env.DB.prepare('SELECT last_rollover_year FROM organizations WHERE id = ?').bind(orgId).first() as any;
    if (Number(st?.last_rollover_year || 0) >= y) return;
    const missing = await env.DB.prepare('SELECT COUNT(*) AS n FROM org_clients c WHERE c.organization_id = ? AND EXISTS (SELECT 1 FROM org_dossiers d WHERE d.client_id = c.id AND d.exercice < ?) AND NOT EXISTS (SELECT 1 FROM org_dossiers d WHERE d.client_id = c.id AND d.exercice = ?)').bind(orgId, y, y).first() as any;
    if (!missing || !Number(missing.n)) {
      await env.DB.prepare('UPDATE organizations SET last_rollover_year = ? WHERE id = ?').bind(y, orgId).run();
      return;
    }
    await rolloverExercices(env, { orgId, source: 'lazy' });
  } catch (e) {
    console.error('ensureCurrentExercice', e);
  }
}

// Cron 1er janvier : passage automatique pour toutes les organisations
async function rolloverAllOrganizations(env: Env): Promise<void> {
  const { results } = await env.DB.prepare('SELECT id FROM organizations').all();
  for (const o of results as any[]) {
    try {
      const res = await rolloverExercices(env, { orgId: o.id, source: 'cron' });
      console.log('rollover', o.id, res.year, 'created', res.created.length, 'closed', res.closed.length);
    } catch (e) {
      console.error('rollover failed', o.id, e);
    }
  }
}

// Quota Workers AI épuisé (tous les modèles partagent les 10 000 neurons/jour du compte).
function isQuotaExhausted(e: any): boolean {
  const msg = String((e && (e.message || e)) || '').toLowerCase();
  return /4006|3036|daily free allocation|out of.*allocation|neurons?/i.test(msg) || (e && (e.code === 4006 || e.code === 3036));
}

// Bascule vers un worker de secours (2e compte Cloudflare = 2e quota de 10 000 neurons/jour).
// AI_FALLBACK_URLS = liste d'URLs séparées par des virgules (ex. fallback.ezzinesalim21.workers.dev/api/achats/ai).
async function callFallbackWorkers(body: unknown, env: Env): Promise<string | null> {
  const urls = (env.AI_FALLBACK_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json() as any;
        const r = data?.response || data?.result?.response || (data?.ok ? JSON.stringify(data) : '');
        if (r) return r;
      }
    } catch { /* essaie l'URL suivante */ }
  }
  return null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
  });
}

function cors(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// --- EXCLUDED DAYS ---
const EXCLUDED_DAYS = new Set([
  '2026-06-05', '2026-06-07', '2026-06-09', '2026-06-13',
  '2026-06-14', '2026-06-23', '2026-06-27', '2026-06-29', '2026-06-30'
]);
const CLIENT_NAMES: Record<string, string> = { '99': 'CLTS PASSAGERS', '111': 'STE WEZIGN', '122': 'NESRINE BACCAR' };

function buildDayEcritures(date: string, dayFactures: any[], modes: any, defaultLibelle: string, journal: 'VT J.C' | 'VT C' = 'VT J.C') {
  const isJC = journal !== 'VT C';
  const COMPTE_VENTE0 = isJC ? '707200' : '707100';
  const COMPTE_VENTE19 = isJC ? '707219' : '707119';
  const COMPTE_TVA = isJC ? '436711' : '436710';
  if (EXCLUDED_DAYS.has(date)) {
    return { lines: [], ecart: 0, excluded: true, anomaly: { date, error: 'Exclu: ecart > 3DT' } };
  }
  const totalHT0 = Math.round(dayFactures.reduce((s: number, f: any) => s + (f.total_ht_0 || 0), 0) * 1000) / 1000;
  const totalHT19 = Math.round(dayFactures.reduce((s: number, f: any) => s + (f.total_ht_19 || 0), 0) * 1000) / 1000;
  const tva19 = Math.round(dayFactures.reduce((s: number, f: any) => s + (f.tva_19 || 0), 0) * 1000) / 1000;
  const timbres = dayFactures.reduce((s: number, f: any) => s + (f.timbre || 1), 0);
  const avoir709 = (modes.bonsAchat || 0) + (modes.avoir || 0);
  const debitSum = (modes.especes || 0) + (modes.tpe || 0) + (modes.cheques || 0) + avoir709;
  const creditSum = tva19 + timbres + totalHT0 + totalHT19;
  const ecart = Math.round((debitSum - creditSum) * 1000) / 1000;

  const lines: any[] = [];
  if ((modes.especes || 0) > 0) lines.push({ compte: '411004', montant: Math.round(modes.especes * 1000) / 1000, sens: 'D' });
  if ((modes.tpe || 0) > 0) lines.push({ compte: '411005', montant: Math.round(modes.tpe * 1000) / 1000, sens: 'D' });
  if ((modes.cheques || 0) > 0) lines.push({ compte: '411003', montant: Math.round(modes.cheques * 1000) / 1000, sens: 'D' });

  const byClient: Record<string, { ht0: number; ht19: number }> = {};
  for (const f of dayFactures) {
    const c = String(f.client || '99');
    if (!byClient[c]) byClient[c] = { ht0: 0, ht19: 0 };
    byClient[c].ht0 += (f.total_ht_0 || 0);
    byClient[c].ht19 += (f.total_ht_19 || 0);
  }
  const tierKeys = Object.keys(byClient);
  for (const [cc, amt] of Object.entries(byClient)) {
    const rht0 = Math.round(amt.ht0 * 1000) / 1000;
    const rht19 = Math.round(amt.ht19 * 1000) / 1000;
    const lib = tierKeys.length > 1 ? (CLIENT_NAMES[cc] || cc) : defaultLibelle;
    if (rht0 > 0) lines.push({ compte: COMPTE_VENTE0, montant: rht0, sens: 'C', libelle: lib });
    if (rht19 > 0) lines.push({ compte: COMPTE_VENTE19, montant: rht19, sens: 'C', libelle: lib });
  }
  if (tva19 > 0) lines.push({ compte: COMPTE_TVA, montant: tva19, sens: 'C' });
  lines.push({ compte: '437500', montant: timbres, sens: 'C' });
  if (avoir709 > 0) lines.push({ compte: '709500', montant: Math.round(avoir709 * 1000) / 1000, sens: 'D' });
  if (ecart !== 0) lines.push({ compte: '634500', montant: Math.abs(ecart), sens: ecart > 0 ? 'C' : 'D' });

  let anomaly = null;
  if (Math.abs(ecart) > 3) {
    anomaly = { date, error: 'ECART ' + ecart.toFixed(3) + 'DT > 3DT' };
  }
  return { lines, ecart, excluded: false, anomaly, totalHT0, totalHT19, tva19, timbres };
}

function parseVTCLines(text: string) {
  const DEBIT_ACCOUNTS = new Set(['411004', '411003', '411005', '709500']);
  const CREDIT_ACCOUNTS = new Set(['707100', '707119', '436710', '437500']);
  const allAccounts = [...DEBIT_ACCOUNTS, ...CREDIT_ACCOUNTS, '634500'];
  const entries: any[] = [];
  let currentFacNum: string | null = null;

  for (const line of text.split('\n')) {
    const facMatch = line.match(/FAC\s*(?:N[°o]?\s*)?(\d+[-\/]\d+)/i);
    if (facMatch) currentFacNum = facMatch[1].replace('-', '/');

    const dateMatch = line.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateMatch) {
      const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
      for (const acct of allAccounts) {
        const acctRegex = new RegExp('\\b' + acct + '\\b\\s+(.+?)\\s+([\\d][\\d\\s]*[,\\.]\\d{1,3})\\s*$');
        const acctMatch = line.match(acctRegex);
        if (acctMatch) {
          const montant = parseFloat(acctMatch[2].replace(/\s/g, '').replace(',', '.'));
          if (isNaN(montant) || montant === 0) continue;
          const libelle = acctMatch[1].trim();
          entries.push({
            date, facNum: currentFacNum ? 'FAC ' + currentFacNum : null,
            compte: acct, compteLibelle: acct + ' ' + libelle, montant,
            libelle: libelle || 'CLIENTS PASSAGERS',
            sens: acct === '634500' ? 'D' : DEBIT_ACCOUNTS.has(acct) ? 'D' : 'C',
          });
        }
      }
    }
  }
  return entries;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return cors();

    try {
      // --- SEED DATA ---
      if (path === '/api/seed' && method === 'POST') {
        const existing = await env.DB.prepare('SELECT id FROM societes LIMIT 1').first();
        if (existing) return json({ ok: true, msg: 'Already seeded' });

        const sid = 'default_soc';
        await env.DB.prepare('INSERT INTO societes (id, raison_sociale) VALUES (?, ?)').bind(sid, 'Cabinet').run();
        const journaux = [['VE','Ventes'],['AC','Achats'],['BQ','Banque'],['CA','Caisse'],['OD','Operations Diverses'],['FISC','Declarations Fiscales']];
        for (const [c, l] of journaux) {
          await env.DB.prepare('INSERT INTO journaux (id, societe_id, code, libelle) VALUES (?, ?, ?, ?)').bind(genId(), sid, c, l).run();
        }
        const did = 'dossier_animal';
        await env.DB.prepare('INSERT INTO dossiers (id, societe_id, nom) VALUES (?, ?, ?)').bind(did, sid, 'ANIMAL').run();
        return json({ ok: true, msg: 'Seeded' });
      }

      // --- DASHBOARD ---
      if (path === '/api/dashboard' && method === 'GET') {
        const recent = await env.DB.prepare('SELECT d.*, s.raison_sociale FROM dossiers d LEFT JOIN societes s ON d.societe_id = s.id ORDER BY d.created_at DESC LIMIT 10').all();
        const animal = await env.DB.prepare('SELECT id FROM dossiers WHERE id = ?').bind('dossier_animal').first() as any;
        // BAUD dossiers
        const baudSocs = await env.DB.prepare('SELECT * FROM societes_paie ORDER BY nom').all();
        const baudDossiers: any[] = [];
        for (const bs of baudSocs.results as any[]) {
          const ds = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE societe_id = ? ORDER BY created_at DESC').bind(bs.id).all();
          for (const dd of ds.results as any[]) baudDossiers.push({ ...dd, raison_sociale: bs.nom, type: 'baud' });
        }
        // SCANFLASH dossiers
        const scanSocs = await env.DB.prepare('SELECT * FROM societes_scan ORDER BY raison_sociale').all();
        const scanDossiers: any[] = [];
        for (const ss of scanSocs.results as any[]) {
          const ds = await env.DB.prepare('SELECT * FROM dossiers_scan WHERE societe_id = ? ORDER BY created_at DESC').bind(ss.id).all();
          for (const dd of ds.results as any[]) scanDossiers.push({ ...dd, raison_sociale: ss.raison_sociale, type: 'scanflash' });
        }
        return json({ recentDossiers: recent.results, animalDossierId: animal?.id || null, baudDossiers, scanDossiers });
      }

      // --- SOCIETES ---
      if (path === '/api/societes' && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM societes ORDER BY raison_sociale').all();
        return json(r.results);
      }
      if (path === '/api/societes' && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO societes (id, raison_sociale, matricule_fiscal) VALUES (?, ?, ?)').bind(id, b.raison_sociale, b.matricule_fiscal || null).run();
        return json({ id, ...b });
      }
      const delSocMatch = path.match(/^\/api\/societes\/([^/]+)$/);
      if (delSocMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM societes WHERE id = ?').bind(delSocMatch[1]).run();
        return json({ ok: true });
      }

      // --- JOURNAUX ---
      const journauxMatch = path.match(/^\/api\/societes\/([^/]+)\/journaux$/);
      if (journauxMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM journaux WHERE societe_id = ?').bind(journauxMatch[1]).all();
        return json(r.results);
      }

      // --- DOSSIERS ---
      const dossiersListMatch = path.match(/^\/api\/societes\/([^/]+)\/dossiers$/);
      if (dossiersListMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM dossiers WHERE societe_id = ? ORDER BY created_at DESC').bind(dossiersListMatch[1]).all();
        return json(r.results);
      }
      if (dossiersListMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO dossiers (id, societe_id, nom) VALUES (?, ?, ?)').bind(id, dossiersListMatch[1], b.nom).run();
        return json({ id, nom: b.nom, statut: 'brouillon' });
      }

      const dossierGetMatch = path.match(/^\/api\/dossiers\/([^/]+)$/);
      if (dossierGetMatch && method === 'GET') {
        const d = await env.DB.prepare('SELECT * FROM dossiers WHERE id = ?').bind(dossierGetMatch[1]).first();
        return d ? json(d) : json({ error: 'Non trouve' }, 404);
      }
      if (dossierGetMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM dossiers WHERE id = ?').bind(dossierGetMatch[1]).run();
        return json({ ok: true });
      }
      if (dossierGetMatch && method === 'PATCH') {
        const b = await request.json() as any;
        const nom = String(b.nom || '').trim();
        if (!nom) return json({ error: 'Nom vide' }, 400);
        const r = await env.DB.prepare('UPDATE dossiers SET nom = ? WHERE id = ?').bind(nom, dossierGetMatch[1]).run();
        if (!r.meta.changes) return json({ error: 'Non trouve' }, 404);
        return json({ ok: true, nom });
      }

      // --- PIECES ---
      const piecesMatch = path.match(/^\/api\/dossiers\/([^/]+)\/pieces$/);
      if (piecesMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM pieces WHERE dossier_id = ? ORDER BY created_at').bind(piecesMatch[1]).all();
        return json(r.results);
      }

      // --- FACTURES ---
      const facturesMatch = path.match(/^\/api\/dossiers\/([^/]+)\/factures$/);
      if (facturesMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM factures WHERE dossier_id = ? ORDER BY date_facture, numero_facture').bind(facturesMatch[1]).all();
        return json(r.results);
      }
      if (facturesMatch && method === 'POST') {
        const b = await request.json() as any;
        const did = facturesMatch[1];
        const d = await env.DB.prepare('SELECT societe_id FROM dossiers WHERE id = ?').bind(did).first() as any;
        if (!d) return json({ error: 'Dossier non trouve' }, 404);
        const id = genId();
        await env.DB.prepare('INSERT INTO factures (id, dossier_id, societe_id, date_facture, numero_facture, client, total_ht_0, total_ht_19, tva_19, timbre, total_ttc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, did, d.societe_id, b.date_facture, b.numero_facture, b.client || '', b.total_ht_0 || 0, b.total_ht_19 || 0, b.tva_19 || 0, b.timbre || 1, b.total_ttc || 0).run();
        return json({ id, ...b });
      }
      const delFactMatch = path.match(/^\/api\/factures\/([^/]+)$/);
      if (delFactMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM factures WHERE id = ?').bind(delFactMatch[1]).run();
        return json({ ok: true });
      }
      const delAllFactMatch = path.match(/^\/api\/dossiers\/([^/]+)\/factures$/);
      if (delAllFactMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM factures WHERE dossier_id = ?').bind(delAllFactMatch[1]).run();
        await env.DB.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'VT J.C'").bind(delAllFactMatch[1]).run();
        return json({ ok: true });
      }

      // --- RAPPORT ---
      const rapportMatch = path.match(/^\/api\/dossiers\/([^/]+)\/rapport$/);
      if (rapportMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM rapport_modes WHERE dossier_id = ? ORDER BY date_jour').bind(rapportMatch[1]).all();
        return json(r.results);
      }
      if (rapportMatch && method === 'POST') {
        const b = await request.json() as any;
        const did = rapportMatch[1];
        const d = await env.DB.prepare('SELECT societe_id FROM dossiers WHERE id = ?').bind(did).first() as any;
        if (!d) return json({ error: 'Dossier non trouve' }, 404);
        const rows = b.rows || b;
        if (!Array.isArray(rows) || !rows.length) return json({ error: 'rows[] requis' }, 400);
        for (const r of rows) {
          const date = r.date_jour || r.date;
          await env.DB.prepare('INSERT OR REPLACE INTO rapport_modes (id, dossier_id, date_jour, especes, cheques, tpe, bonsAchat, avoir, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, date, r.especes || 0, r.cheques || 0, r.tpe || 0, r.bonsAchat || 0, r.avoir || 0, r.credit || 0).run();
        }
        return json({ ok: true, count: rows.length });
      }
      if (rapportMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM rapport_modes WHERE dossier_id = ?').bind(rapportMatch[1]).run();
        return json({ ok: true });
      }

      // --- ECRITURES ---
      const ecrituresMatch = path.match(/^\/api\/dossiers\/([^/]+)\/ecritures$/);
      if (ecrituresMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? ORDER BY date_operation, journal_code').bind(ecrituresMatch[1]).all();
        return json(r.results);
      }
      if (ecrituresMatch && method === 'POST') {
        const b = await request.json() as any;
        const did = ecrituresMatch[1];
        const id = genId();
        await env.DB.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie, piece_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, did, b.societe_id, b.journal_code, b.date_operation, b.date_piece || null, b.numero_doc || null, b.libelle, b.compte, b.sens, b.montant, b.tresorerie || null, b.piece_id || null).run();
        return json({ id, ...b });
      }
      if (ecrituresMatch && method === 'DELETE') {
        const journal = url.searchParams.get('journal');
        if (journal) {
          await env.DB.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = ?").bind(ecrituresMatch[1], journal).run();
        } else {
          await env.DB.prepare('DELETE FROM ecritures WHERE dossier_id = ?').bind(ecrituresMatch[1]).run();
        }
        return json({ ok: true });
      }

      const delEcritMatch = path.match(/^\/api\/ecritures\/([^/]+)$/);
      if (delEcritMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM ecritures WHERE id = ?').bind(delEcritMatch[1]).run();
        return json({ ok: true });
      }

      // --- GENERATE VT J.C ---
      const genMatch = path.match(/^\/api\/dossiers\/([^/]+)\/generate-vtjc$/);
      if (genMatch && method === 'POST') {
        const did = genMatch[1];
        const d = await env.DB.prepare('SELECT * FROM dossiers WHERE id = ?').bind(did).first() as any;
        if (!d) return json({ error: 'Dossier non trouve' }, 404);

        let journal: 'VT J.C' | 'VT C' = 'VT J.C';
        try {
          const b = await request.json() as any;
          if (b && b.journal === 'VT C') journal = 'VT C';
        } catch { /* no body -> VT J.C */ }

        const facturesR = await env.DB.prepare('SELECT * FROM factures WHERE dossier_id = ? ORDER BY date_facture, numero_facture').bind(did).all();
        if (!facturesR.results.length) return json({ error: 'Aucune facture' }, 400);

        await env.DB.prepare('DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = ?').bind(did, journal).run();

        const byDay: Record<string, any[]> = {};
        for (const f of facturesR.results) {
          if (!byDay[f.date_facture as string]) byDay[f.date_facture as string] = [];
          byDay[f.date_facture as string].push(f);
        }

        const anomalies: any[] = [];
        const allEntries: any[] = [];

        for (const [date, dayFactures] of Object.entries(byDay)) {
          const nums = dayFactures.map((f: any) => f.numero_facture.replace(/[^0-9]/g, '')).sort((a: string, b: string) => a.localeCompare(b));
          const numPiece = nums.length === 1 ? 'FAC N' + nums[0] + '-26' : 'FAC N' + nums.join('-') + '-26';
          const clients = [...new Set(dayFactures.map((f: any) => f.client).filter(Boolean))];
          const defaultLibelle = clients.length > 0 ? 'CLTS PASSAGERS/' + clients.join('/') : 'CLTS PASSAGERS';

          const rapportR = await env.DB.prepare('SELECT especes, cheques, tpe, bonsAchat, avoir, credit FROM rapport_modes WHERE dossier_id = ? AND date_jour = ?').bind(did, date).first() as any;
          const modes = rapportR || { especes: 0, tpe: 0, cheques: 0, bonsAchat: 0, avoir: 0, credit: 0 };

          const result = buildDayEcritures(date, dayFactures, modes, defaultLibelle, journal);
          if (result.excluded) {
            anomalies.push(result.anomaly);
            allEntries.push({ date, numPiece, excluded: true });
            continue;
          }
          if (result.anomaly) anomalies.push(result.anomaly);

          for (const l of result.lines) {
            await env.DB.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, d.societe_id, journal, date, date, numPiece, l.libelle || defaultLibelle, l.compte, l.sens, l.montant, null).run();
          }
          allEntries.push({ date, numPiece, libelle: defaultLibelle, ecart: result.ecart, lignes: result.lines });
        }

        return json({ days: allEntries.length, entries: allEntries, anomalies });
      }

      // --- PROCESS VT C (text from browser) ---
      const vtcMatch = path.match(/^\/api\/dossiers\/([^/]+)\/process-vtc$/);
      if (vtcMatch && method === 'POST') {
        const did = vtcMatch[1];
        const d = await env.DB.prepare('SELECT * FROM dossiers WHERE id = ?').bind(did).first() as any;
        if (!d) return json({ error: 'Dossier non trouve' }, 404);

        const b = await request.json() as any;
        const text = b.text as string;
        if (!text) return json({ error: 'text requis' }, 400);

        await env.DB.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'VT C'").bind(did).run();

        const entries = parseVTCLines(text);
        for (const e of entries) {
          await env.DB.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, d.societe_id, 'VT C', e.date, e.date, e.facNum || '', e.compteLibelle || e.libelle, e.compte, e.sens, e.montant, null).run();
        }

        return json({ ok: true, totalEntries: entries.length });
      }

      // --- PROCESS FISC (text from browser) ---
      const fiscMatch = path.match(/^\/api\/dossiers\/([^/]+)\/process-fisc$/);
      if (fiscMatch && method === 'POST') {
        const did = fiscMatch[1];
        const d = await env.DB.prepare('SELECT * FROM dossiers WHERE id = ?').bind(did).first() as any;
        if (!d) return json({ error: 'Dossier non trouve' }, 404);

        const b = await request.json() as any;
        const dmi = b.dmi;
        if (!dmi) return json({ error: 'dmi requis' }, 400);

        // Delete existing FISC ecritures
        await env.DB.prepare("DELETE FROM ecritures WHERE dossier_id = ? AND journal_code = 'FISC'").bind(did).run();

        // Generate FISC ecritures from DMI data
        const fiscEntries = generateFISCecritures(dmi, did, d.societe_id);
        if (fiscEntries.error) return json({ error: fiscEntries.error }, 400);

        for (const e of fiscEntries.entries) {
          await env.DB.prepare('INSERT INTO ecritures (id, dossier_id, societe_id, journal_code, date_operation, date_piece, numero_doc, libelle, compte, sens, montant, tresorerie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), e.dossier_id, e.societe_id, e.journal_code, e.date_operation, e.date_piece, e.numero_doc, e.libelle, e.compte, e.sens, e.montant, e.tresorerie).run();
        }

        return json({ ok: true, entriesCount: fiscEntries.entries.length });
      }

      // --- EXPORT CSV ---
      const exportMatch = path.match(/^\/api\/dossiers\/([^/]+)\/export$/);
      if (exportMatch && method === 'GET') {
        const journal = url.searchParams.get('journal');
        let rows;
        if (journal) {
          rows = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? AND journal_code = ? ORDER BY date_operation, compte').bind(exportMatch[1], journal).all();
        } else {
          rows = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? ORDER BY date_operation, journal_code, compte').bind(exportMatch[1]).all();
        }
        const header = 'N° pièce;Date pièce;Journal;Libellé;N° compte;Libellé trésorerie;Débit;Crédit';
        const lines: string[] = [];
        let totalD = 0, totalC = 0;

        for (const e of rows.results) {
          const sens = e.sens || 'D';
          const montant = e.montant as number;
          if (!e.date_operation) continue;
          if (montant === 0) continue;
          if (sens === 'D') totalD += montant; else totalC += montant;

          const fmt = (d: string) => { if (d?.includes('-')) { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; } return d || ''; };
          lines.push([
            e.numero_doc || '', fmt(e.date_operation as string), e.journal_code || '', e.libelle || '',
            e.compte || '', e.tresorerie || '',
            e.sens === 'D' ? montant.toFixed(3) : '0.000',
            e.sens === 'C' ? montant.toFixed(3) : '0.000'
          ].join(';'));
        }

        return new Response([header, ...lines].join('\n'), {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ecritures_${exportMatch[1]}.csv"`, 'Access-Control-Allow-Origin': '*' },
        });
      }

      // --- EXCLUDED (analyse) ---
      const excludedMatch = path.match(/^\/api\/dossiers\/([^/]+)\/excluded$/);
      if (excludedMatch && method === 'GET') {
        const did = excludedMatch[1];
        const facturesR = await env.DB.prepare('SELECT * FROM factures WHERE dossier_id = ? ORDER BY date_facture').bind(did).all();
        const byDay: Record<string, any[]> = {};
        for (const f of facturesR.results) {
          if (!byDay[f.date_facture as string]) byDay[f.date_facture as string] = [];
          byDay[f.date_facture as string].push(f);
        }
        const results: any[] = [];
        for (const [date, dayFactures] of Object.entries(byDay)) {
          const rapportR = await env.DB.prepare('SELECT * FROM rapport_modes WHERE dossier_id = ? AND date_jour = ?').bind(did, date).first() as any;
          const modes = rapportR || { especes: 0, tpe: 0, cheques: 0, bonsAchat: 0, avoir: 0, credit: 0 };
          const r = buildDayEcritures(date, dayFactures, modes, 'CLTS PASSAGERS');
          const ht0 = dayFactures.reduce((s: number, f: any) => s + (f.total_ht_0 || 0), 0);
          const ht19 = dayFactures.reduce((s: number, f: any) => s + (f.total_ht_19 || 0), 0);
          const tva = dayFactures.reduce((s: number, f: any) => s + (f.tva_19 || 0), 0);
          const ttc = dayFactures.reduce((s: number, f: any) => s + (f.total_ttc || 0), 0);
          const timbres = dayFactures.reduce((s: number, f: any) => s + (f.timbre || 1), 0);
          const debitSum = (modes.especes || 0) + (modes.tpe || 0) + (modes.cheques || 0) + (modes.bonsAchat || 0) + (modes.avoir || 0);
          const creditSum = tva + timbres + ht0 + ht19;
          const ecart = Math.round((debitSum - creditSum) * 1000) / 1000;
          results.push({
            date, ecart, excluded: EXCLUDED_DAYS.has(date),
            totalFactures: ttc, totalModes: (modes.especes || 0) + (modes.tpe || 0) + (modes.cheques || 0) + (modes.bonsAchat || 0) + (modes.avoir || 0) + (modes.credit || 0),
            nbFactures: dayFactures.length,
            modes: { especes: modes.especes || 0, cheques: modes.cheques || 0, tpe: modes.tpe || 0, bonsAchat: modes.bonsAchat || 0, avoir: modes.avoir || 0, credit: modes.credit || 0 },
            factures: dayFactures.map((f: any) => ({ num: f.numero_facture, client: f.client, ht0: f.total_ht_0 || 0, ht19: f.total_ht_19 || 0, tva: f.tva_19 || 0, ttc: f.total_ttc || 0 })),
            proposedEcritures: r.excluded ? [] : r.lines.map((l: any) => ({ compte: l.compte, sens: l.sens, montant: l.montant, libelle: l.libelle })),
          });
        }
        return json(results);
      }

      // --- AI VERIFY ---
      const aiMatch = path.match(/^\/api\/dossiers\/([^/]+)\/verify-ai$/);
      if (aiMatch && method === 'POST') {
        const did = aiMatch[1];
        const ecrituresR = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? AND journal_code = ? ORDER BY numero_doc, compte').bind(did, 'FISC').all();
        if (!ecrituresR.results.length) return json({ error: 'Aucune ecriture FISC' }, 400);

        const ecrituresText = ecrituresR.results.map(e =>
          `${e.numero_doc} | ${e.date_piece} | ${e.journal_code} | ${e.libelle} | ${e.compte} | ${e.tresorerie || ''} | ${e.sens}=${e.montant}`
        ).join('\n');

        const prompt = `Tu es un expert-comptable tunisien. Verifie ces ecritures FISC.

REGLES:
- Piece A: 457100 D = total_general, tous autres = CREDIT
- Piece B: 661100 D = 437300 C
- Piece C: 661200 D = 437200 C
- Piece D: 661300 D = 437400 C
- Piece E: 436710 D = TVA collectee, 436660 C = TVA deductible, 436670 C = TVA report

ECRITURES:
${ecrituresText}

JSON: {"verdict":"OK/ERREUR","score":0-100,"checks":[{"name":"detail","status":"ok/error","detail":"..."}],"summary":"..."}`;

        let aiResponse: any;
        try {
          aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
            messages: [
              { role: 'system', content: 'Reponds toujours en JSON valide.' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 2000,
            temperature: 0.1,
          });
        } catch (aiErr: any) {
          return json({ error: 'Workers AI error: ' + aiErr.message }, 500);
        }

        // Handle different response formats from Workers AI
        let report;
        try {
          const raw = aiResponse?.response || aiResponse?.result?.response || aiResponse;
          if (typeof raw === 'object' && raw?.verdict) {
            report = raw;
          } else if (typeof raw === 'string') {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            report = jsonMatch ? JSON.parse(jsonMatch[0]) : { verdict: 'ATTENTION', score: 0, checks: [], summary: raw };
          } else {
            report = { verdict: 'ATTENTION', score: 0, checks: [], summary: JSON.stringify(raw) };
          }
        } catch {
          report = { verdict: 'ATTENTION', score: 0, checks: [], summary: 'Parse error' };
        }

        return json({ ok: true, report, ecrituresCount: ecrituresR.results.length });
      }

      // --- AI VERIFY TVA 19% ---
      if (path === '/api/ai/verify' && method === 'POST') {
        const b = await request.json() as any;
        const { prompt } = b;
        if (!prompt) return json({ error: 'prompt requis' }, 400);
        try {
          const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1500,
            temperature: 0.2,
          });
          const response = aiResponse?.response || aiResponse?.result?.response || JSON.stringify(aiResponse);
          return json({ ok: true, response });
        } catch (e: any) {
          return json({ error: 'AI error: ' + e.message }, 500);
        }
      }

      // --- EF AI VERIFICATION ---
      if (path === '/api/ef/verify' && method === 'POST') {
        return handleEFVerify(request, env);
      }
      if (path === '/api/ef/tab-amt' && method === 'POST') {
        return handleEFTabAmt(request, env);
      }

      // --- ACHATS AI PROXY (free Workers AI binding) ---
      if (path === '/api/achats/ai' && method === 'POST') {
        const b = await request.json() as any;
        const { model, prompt, systemPrompt, image, max_tokens } = b;
        if (!prompt) return json({ error: 'prompt requis' }, 400);
        const visionModels = [
          '@cf/meta/llama-4-scout-17b-16e-instruct',
          '@cf/meta/llama-3.2-11b-vision-instruct',
        ];
        const textModel = '@cf/meta/llama-3.1-8b-instruct-fast';
        const runVision = async (img: string) => {
          const dataUrl = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
          let lastErr: any = null;
          for (const m of visionModels) {
            try {
              // One-time license agreement for Meta models
              try { await env.AI.run(m, { prompt: 'agree' }); } catch {}
              return await env.AI.run(m, {
                messages: [
                  { role: 'system', content: systemPrompt || 'Reponds en JSON valide sans texte avant ou apres.' },
                  { role: 'user', content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: dataUrl } },
                  ]},
                ],
                max_tokens: max_tokens || 2000,
                temperature: 0.1,
              });
            } catch (e: any) { lastErr = e; }
          }
          throw lastErr;
        };
        try {
          let aiResponse: any;
          if (model === 'vision') {
            const img = image || (b.images && b.images[0]);
            if (!img) return json({ error: 'image requis pour le mode vision' }, 400);
            try {
              aiResponse = await runVision(img);
            } catch (e: any) {
              // Quota Cloudflare épuisé → bascule sur un worker de secours (2e compte, autre quota)
              if (isQuotaExhausted(e)) {
                const fb = await callFallbackWorkers({ model: 'vision', prompt, systemPrompt, image: img, max_tokens }, env);
                if (fb) return json({ ok: true, response: fb, fallback: true });
              }
              throw e;
            }
          } else {
            try {
              aiResponse = await env.AI.run(textModel, {
                messages: [
                  { role: 'system', content: systemPrompt || 'Reponds en JSON valide sans texte avant ou apres.' },
                  { role: 'user', content: prompt },
                ],
                max_tokens: max_tokens || 2000,
                temperature: 0.1,
              });
            } catch (e: any) {
              if (isQuotaExhausted(e)) {
                const fb = await callFallbackWorkers({ model: 'text', prompt, systemPrompt, max_tokens }, env);
                if (fb) return json({ ok: true, response: fb, fallback: true });
              }
              throw e;
            }
          }
          const response = aiResponse?.response || aiResponse?.result?.response || JSON.stringify(aiResponse);
          return json({ ok: true, response });
        } catch (e: any) {
          return json({ error: 'Workers AI error: ' + (e.message || e) }, 500);
        }
      }

      // --- FIX TVA 19% ---
      const fixTvaMatch = path.match(/^\/api\/dossiers\/([^/]+)\/fix-tva$/);
      if (fixTvaMatch && method === 'POST') {
        const did = fixTvaMatch[1];
        const b = await request.json() as any;
        const { numero_doc, journal_code, expected_tva } = b;
        if (!numero_doc || !journal_code || expected_tva === undefined) return json({ error: 'numero_doc, journal_code, expected_tva requis' }, 400);

        const tvaAccount = journal_code === 'VT J.C' ? '436711' : '436710';
        const ecrituresR = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? AND numero_doc = ? AND compte = ? AND sens = ?')
          .bind(did, numero_doc, tvaAccount, 'C').all();
        if (!ecrituresR.results.length) return json({ error: 'Aucune ecriture TVA trouvee' }, 404);

        // If multiple TVA lines, update proportionally; otherwise update the single one
        const lines = ecrituresR.results as any[];
        if (lines.length === 1) {
          const oldVal = lines[0].montant;
          await env.DB.prepare('UPDATE ecritures SET montant = ? WHERE id = ?').bind(expected_tva, lines[0].id).run();
          return json({ ok: true, updated: 1, old: oldVal, new: expected_tva });
        } else {
          // Multiple TVA lines: redistribute proportionally based on HT lines
          const htAccount = journal_code === 'VT J.C' ? '707219' : '707119';
          const htLines = await env.DB.prepare('SELECT * FROM ecritures WHERE dossier_id = ? AND numero_doc = ? AND compte = ? AND sens = ?')
            .bind(did, numero_doc, htAccount, 'C').all();
          const totalHT = (htLines.results as any[]).reduce((s, l) => s + (l.montant || 0), 0);
          const batch: D1PreparedStatement[] = [];
          let distributed = 0;
          for (let i = 0; i < lines.length; i++) {
            const htLine = (htLines.results as any[])[i];
            const ratio = htLine && totalHT > 0 ? htLine.montant / totalHT : 1 / lines.length;
            const newVal = i === lines.length - 1
              ? Math.round((expected_tva - distributed) * 1000) / 1000
              : Math.round(expected_tva * ratio * 1000) / 1000;
            distributed += newVal;
            batch.push(env.DB.prepare('UPDATE ecritures SET montant = ? WHERE id = ?').bind(newVal, lines[i].id));
          }
          for (const stmt of batch) { try { await stmt.run(); } catch {} }
          return json({ ok: true, updated: lines.length, new_total: expected_tva });
        }
      }

      // ============================================================
      // BAUD — PAYROLL AUTOMATION
      // ============================================================

      // --- BAUD: SOCIETES PAIE ---
      if (path === '/api/baud/societes' && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM societes_paie ORDER BY nom').all();
        return json(r.results);
      }
      if (path === '/api/baud/societes' && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO societes_paie (id, nom, matricule_fiscal, activite, forme_juridique) VALUES (?, ?, ?, ?, ?)').bind(id, b.nom, b.matricule_fiscal || null, b.activite || null, b.forme_juridique || null).run();
        return json({ id, ...b });
      }
      const delBaudSocMatch = path.match(/^\/api\/baud\/societes\/([^/]+)$/);
      if (delBaudSocMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM societes_paie WHERE id = ?').bind(delBaudSocMatch[1]).run();
        return json({ ok: true });
      }
      if (delBaudSocMatch && method === 'PUT') {
        const b = await request.json() as any;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [k, v] of Object.entries(b)) {
          if (['nom', 'matricule_fiscal', 'activite', 'forme_juridique', 'sage_code_dossier', 'navette_format_notes'].includes(k)) {
            fields.push(`${k} = ?`);
            values.push(v);
          }
        }
        if (fields.length === 0) return json({ error: 'Aucun champ' });
        values.push(delBaudSocMatch[1]);
        await env.DB.prepare(`UPDATE societes_paie SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...values).run();
        return await env.DB.prepare('SELECT * FROM societes_paie WHERE id = ?').bind(delBaudSocMatch[1]).first();
      }

      // --- BAUD: SALARIES ---
      const baudSalMatch = path.match(/^\/api\/baud\/societes\/([^/]+)\/salaries$/);
      if (baudSalMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM salaries_paie WHERE societe_id = ? ORDER BY matricule').bind(baudSalMatch[1]).all();
        return json(r.results);
      }
      if (baudSalMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO salaries_paie (id, societe_id, matricule, nom, prenom, civilite, date_naissance, date_embauche, poste, type_contrat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, baudSalMatch[1], b.matricule, b.nom, b.prenom || null, b.civilite || null, b.date_naissance || null, b.date_embauche || null, b.poste || null, b.type_contrat || null).run();
        return json({ id, ...b });
      }
      const baudSalUpdateMatch = path.match(/^\/api\/baud\/salaries\/([^/]+)$/);
      if (baudSalUpdateMatch && method === 'PUT') {
        const b = await request.json() as any;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [k, v] of Object.entries(b)) {
          if (['matricule', 'nom', 'prenom', 'civilite', 'date_naissance', 'date_embauche', 'poste', 'type_contrat', 'statut'].includes(k)) {
            fields.push(`${k} = ?`);
            values.push(v);
          }
        }
        if (fields.length === 0) return json({ error: 'Aucun champ' });
        values.push(baudSalUpdateMatch[1]);
        await env.DB.prepare(`UPDATE salaries_paie SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...values).run();
        return await env.DB.prepare('SELECT * FROM salaries_paie WHERE id = ?').bind(baudSalUpdateMatch[1]).first();
      }

      // --- BAUD: RUBRIQUES ---
      const baudRubMatch = path.match(/^\/api\/baud\/societes\/([^/]+)\/rubriques$/);
      if (baudRubMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM rubriques_paie WHERE societe_id = ? AND actif = 1 ORDER BY ordre, code').bind(baudRubMatch[1]).all();
        return json(r.results);
      }
      if (baudRubMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT OR REPLACE INTO rubriques_paie (id, societe_id, code, libelle, type, zone, navette_aliases, valeur_defaut, ordre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, baudRubMatch[1], b.code, b.libelle, b.type || 'rubrique', b.zone || '0', b.navette_aliases || null, b.valeur_defaut || null, b.ordre || 0).run();
        return json({ id, ...b });
      }

      // --- BAUD: DOSSIERS PAIE ---
      const baudDossiersListMatch = path.match(/^\/api\/baud\/societes\/([^/]+)\/dossiers$/);
      if (baudDossiersListMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE societe_id = ? ORDER BY annee DESC, mois DESC').bind(baudDossiersListMatch[1]).all();
        return json(r.results);
      }
      if (baudDossiersListMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO dossiers_paie (id, societe_id, mois, annee) VALUES (?, ?, ?, ?)').bind(id, baudDossiersListMatch[1], b.mois, b.annee).run();
        return json({ id, mois: b.mois, annee: b.annee, statut: 'brouillon' });
      }
      const baudDossierGetMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)$/);
      if (baudDossierGetMatch && method === 'GET') {
        const d = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE id = ?').bind(baudDossierGetMatch[1]).first();
        return d ? json(d) : json({ error: 'Non trouve' }, 404);
      }
      if (baudDossierGetMatch && method === 'DELETE') {
        const did = baudDossierGetMatch[1];
        await env.DB.prepare('DELETE FROM imports_ga WHERE dossier_id = ?').bind(did).run();
        await env.DB.prepare('DELETE FROM lignes_extraites WHERE dossier_id = ?').bind(did).run();
        await env.DB.prepare('DELETE FROM dossiers_paie WHERE id = ?').bind(did).run();
        return json({ ok: true });
      }
      if (baudDossierGetMatch && method === 'PATCH') {
        const b = await request.json() as any;
        const nom = String(b.nom || '').trim();
        if (!nom) return json({ error: 'Nom vide' }, 400);
        const r = await env.DB.prepare('UPDATE dossiers_paie SET nom = ? WHERE id = ?').bind(nom, baudDossierGetMatch[1]).run();
        if (!r.meta.changes) return json({ error: 'Non trouve' }, 404);
        return json({ ok: true, nom });
      }

      // --- BAUD: UPLOAD FICHE NAVETTE (auto-extract) ---
      const baudUploadMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/upload$/);
      if (baudUploadMatch && method === 'POST') {
        const did = baudUploadMatch[1];
        try {
          const dossier = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE id = ?').bind(did).first() as any;
          if (!dossier) return json({ error: 'Dossier non trouve' }, 404);
          const b = await request.json() as any;
          const { filename, lignes } = b;
          if (!filename || !Array.isArray(lignes)) return json({ error: 'filename et lignes requis' }, 400);

          // Store raw data
          await env.DB.prepare("UPDATE dossiers_paie SET fichier_navette_nom = ?, extraction_json = ?, updated_at = datetime('now') WHERE id = ?").bind(filename, JSON.stringify({ lignes }), did).run();

          // Auto-extract
          await env.DB.prepare('DELETE FROM lignes_extraites WHERE dossier_id = ?').bind(did).run();
          const correctionsR = await env.DB.prepare('SELECT * FROM corrections WHERE societe_id = ? ORDER BY hit_count DESC').bind(dossier.societe_id).all();
          const corrList = correctionsR.results as any[];

          // Pass 1: extract matricules + noms from all rows, apply corrections
          const seenMatricules = new Map<string, string>(); // matricule -> nom_prenom
          const seenRubriques = new Set<string>();
          const corrHits: string[] = [];
          const preprocessed: any[] = [];
          for (const raw of lignes) {
            try {
              const cells = Array.isArray(raw?.champs) ? raw.champs : [];
              let matricule = '';
              let nomPrenom = '';
              for (const cell of cells) {
                const trimmed = String(cell ?? '').trim();
                if (/^\d{2,6}$/.test(trimmed) && !matricule) { matricule = trimmed; continue; }
                if (trimmed.length > 3 && /[a-zA-Z]/.test(trimmed) && !nomPrenom && !matricule) { nomPrenom = trimmed; }
              }

              let rubrique_code: string | null = null;
              let zone: string | null = null;
              let valeur: number | null = null;
              const rowKey = cells.join('|');
              for (const corr of corrList) {
                try {
                  if (corr.source_pattern && rowKey.includes(corr.source_pattern)) {
                    if (corr.field === 'rubrique_code') { rubrique_code = corr.new_value; corrHits.push(corr.id); }
                    if (corr.field === 'zone') { zone = corr.new_value; corrHits.push(corr.id); }
                    if (corr.field === 'valeur') { const v = parseFloat(corr.new_value); if (!isNaN(v)) { valeur = v; corrHits.push(corr.id); } }
                  }
                  if (corr.field === 'matricule' && corr.old_value && matricule === corr.old_value) {
                    matricule = corr.new_value; corrHits.push(corr.id);
                  }
                } catch { /* skip bad correction */ }
              }
              if (matricule && !seenMatricules.has(matricule)) seenMatricules.set(matricule, nomPrenom);
              if (rubrique_code) seenRubriques.add(rubrique_code);
              preprocessed.push({ cells, matricule, nomPrenom, rubrique_code, zone, valeur, raw });
            } catch { /* skip bad row */ }
          }

          // Auto-create missing salaries
          const existingSalR = await env.DB.prepare('SELECT matricule FROM salaries_paie WHERE societe_id = ?').bind(dossier.societe_id).all();
          const existingMatricules = new Set((existingSalR.results as any[]).map(s => s.matricule));
          const newSalaryBatch: D1PreparedStatement[] = [];
          for (const [mat, nom] of seenMatricules) {
            if (!existingMatricules.has(mat)) {
              newSalaryBatch.push(env.DB.prepare('INSERT OR IGNORE INTO salaries_paie (id, societe_id, matricule, nom) VALUES (?, ?, ?, ?)').bind(genId(), dossier.societe_id, mat, nom || ''));
              existingMatricules.add(mat);
            }
          }
          if (newSalaryBatch.length) {
            for (let i = 0; i < newSalaryBatch.length; i += 50) {
              try { await env.DB.batch(newSalaryBatch.slice(i, i + 50)); } catch {}
            }
          }

          // Auto-create missing rubriques
          const existingRubR = await env.DB.prepare('SELECT code FROM rubriques_paie WHERE societe_id = ?').bind(dossier.societe_id).all();
          const existingCodes = new Set((existingRubR.results as any[]).map(r => r.code));
          const newRubBatch: D1PreparedStatement[] = [];
          for (const code of seenRubriques) {
            if (!existingCodes.has(code)) {
              newRubBatch.push(env.DB.prepare('INSERT OR IGNORE INTO rubriques_paie (id, societe_id, code, libelle, type, zone) VALUES (?, ?, ?, ?, ?, ?)').bind(genId(), dossier.societe_id, code, code, 'rubrique', '0'));
              existingCodes.add(code);
            }
          }
          if (newRubBatch.length) {
            for (let i = 0; i < newRubBatch.length; i += 50) {
              try { await env.DB.batch(newRubBatch.slice(i, i + 50)); } catch {}
            }
          }

          // Re-fetch salaries for linking
          const salariesR = await env.DB.prepare('SELECT * FROM salaries_paie WHERE societe_id = ?').bind(dossier.societe_id).all();
          const insertLigne = env.DB.prepare('INSERT INTO lignes_extraites (id, dossier_id, salary_id, matricule, nom_prenom, type_ligne, champs, rubrique_code, zone, valeur, source_feuille, source_plage, confiance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          const batch: D1PreparedStatement[] = [];

          for (const p of preprocessed) {
            const salaryMatch = p.matricule ? (salariesR.results as any[]).find(s => s.matricule === p.matricule) : null;
            batch.push(insertLigne.bind(genId(), did, salaryMatch?.id || null, p.matricule || null, p.nomPrenom || null, 'variable', JSON.stringify(p.cells), p.rubrique_code, p.zone, p.valeur, p.raw.source_feuille || null, p.raw.source_ligne ? String(p.raw.source_ligne) : null, null));
          }

          // Batch insert (chunks of 50)
          for (let i = 0; i < batch.length; i += 50) {
            try { await env.DB.batch(batch.slice(i, i + 50)); } catch { /* skip bad chunk */ }
          }

          // Update correction hit counts
          const uniqueHits = [...new Set(corrHits)];
          for (const cid of uniqueHits) {
            try { await env.DB.prepare('UPDATE corrections SET hit_count = hit_count + 1 WHERE id = ?').bind(cid).run(); } catch {}
          }

          await env.DB.prepare("UPDATE dossiers_paie SET statut = 'controle', extraction_confiance = 1, updated_at = datetime('now') WHERE id = ?").bind(did).run();
          return json({ ok: true, fichier_nom: filename, lignes_count: batch.length, corrections_applied: uniqueHits.length });
        } catch (e: any) {
          return json({ error: 'Upload echoue: ' + (e.message || e) }, 500);
        }
      }

      // --- BAUD: EXTRACT — stores raw uploaded rows as lignes ---
      const baudExtractMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/extract$/);
      if (baudExtractMatch && method === 'POST') {
        const did = baudExtractMatch[1];
        try {
          const dossier = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE id = ?').bind(did).first() as any;
          if (!dossier) return json({ error: 'Dossier non trouve' }, 404);
          const extractionJson = dossier.extraction_json ? JSON.parse(dossier.extraction_json) : null;
          if (!extractionJson?.lignes) return json({ error: 'Upload d\'abord' }, 400);

          await env.DB.prepare('DELETE FROM lignes_extraites WHERE dossier_id = ?').bind(did).run();
          const rawLignes = extractionJson.lignes as any[];
          const salariesR = await env.DB.prepare('SELECT * FROM salaries_paie WHERE societe_id = ?').bind(dossier.societe_id).all();
          const correctionsR = await env.DB.prepare('SELECT * FROM corrections WHERE societe_id = ? ORDER BY hit_count DESC').bind(dossier.societe_id).all();
          const corrList = correctionsR.results as any[];
          const insertLigne = env.DB.prepare('INSERT INTO lignes_extraites (id, dossier_id, salary_id, matricule, nom_prenom, type_ligne, champs, rubrique_code, zone, valeur, source_feuille, source_plage, confiance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          const batch: D1PreparedStatement[] = [];
          const corrHits: string[] = [];

          for (const raw of rawLignes) {
            try {
              const cells = Array.isArray(raw?.champs) ? raw.champs : [];
              let matricule = '';
              let nomPrenom = '';
              for (const cell of cells) {
                const trimmed = String(cell ?? '').trim();
                if (/^\d{2,6}$/.test(trimmed) && !matricule) { matricule = trimmed; continue; }
                if (trimmed.length > 3 && /[a-zA-Z]/.test(trimmed) && !nomPrenom && !matricule) { nomPrenom = trimmed; }
              }

              let rubrique_code: string | null = null;
              let zone: string | null = null;
              let valeur: number | null = null;
              const rowKey = cells.join('|');
              for (const corr of corrList) {
                try {
                  if (corr.source_pattern && rowKey.includes(corr.source_pattern)) {
                    if (corr.field === 'rubrique_code') { rubrique_code = corr.new_value; corrHits.push(corr.id); }
                    if (corr.field === 'zone') { zone = corr.new_value; corrHits.push(corr.id); }
                    if (corr.field === 'valeur') { const v = parseFloat(corr.new_value); if (!isNaN(v)) { valeur = v; corrHits.push(corr.id); } }
                  }
                  if (corr.field === 'matricule' && corr.old_value && matricule === corr.old_value) {
                    matricule = corr.new_value; corrHits.push(corr.id);
                  }
                } catch {}
              }

              const salaryMatch = matricule ? (salariesR.results as any[]).find(s => s.matricule === matricule) : null;
              batch.push(insertLigne.bind(genId(), did, salaryMatch?.id || null, matricule || null, nomPrenom || null, 'variable', JSON.stringify(cells), rubrique_code, zone, valeur, raw.source_feuille || null, raw.source_ligne ? String(raw.source_ligne) : null, null));
            } catch {}
          }

          for (let i = 0; i < batch.length; i += 50) {
            try { await env.DB.batch(batch.slice(i, i + 50)); } catch {}
          }

          const uniqueHits = [...new Set(corrHits)];
          for (const cid of uniqueHits) {
            try { await env.DB.prepare('UPDATE corrections SET hit_count = hit_count + 1 WHERE id = ?').bind(cid).run(); } catch {}
          }

          await env.DB.prepare("UPDATE dossiers_paie SET statut = 'controle', extraction_confiance = 1, updated_at = datetime('now') WHERE id = ?").bind(did).run();
          return json({ ok: true, lignes_count: batch.length, corrections_applied: uniqueHits.length });
        } catch (e: any) {
          return json({ error: 'Extract echoue: ' + (e.message || e) }, 500);
        }
      }

      // --- BAUD: PARSED DATA (store employees + pointage from intelligent parser) ---
      const baudParsedMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/parsed$/);
      if (baudParsedMatch && method === 'POST') {
        const did = baudParsedMatch[1];
        try {
          const b = await request.json() as any;
          await env.DB.prepare("UPDATE dossiers_paie SET extraction_json = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(b), did).run();
          return json({ ok: true });
        } catch (e: any) {
          return json({ error: 'Erreur: ' + (e.message || e) }, 500);
        }
      }

      // --- BAUD: AI VERIFICATION ---
      const baudAiMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/verify-ai$/);
      if (baudAiMatch && method === 'POST') {
        const did = baudAiMatch[1];
        try {
          const dossier = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE id = ?').bind(did).first() as any;
          if (!dossier) return json({ error: 'Dossier non trouve' }, 404);

          const b = await request.json() as any;
          const { employees, pointage, salaryResults } = b;

          // Build summary for AI
          const empSummary = employees.map((emp: any) => {
            const r = salaryResults?.[emp.matricule];
            return `${emp.matricule} ${emp.nom} ${emp.prenom} | SF:${emp.situation_fam} NE:${emp.nombre_enfants} | Brut:${emp.salaire_brut} NouvBrut:${emp.nouveau_salaire_brut} | ${emp.type_contrat} ${emp.fonction} | CNSS:${r?.cnss_salariale||0} IRPP:${r?.irpp||0} Net:${r?.net_a_payer||0}`;
          }).join('\n');

          const ptgSummary = pointage?.map((p: any) => `${p.matricule} ${p.nom}: Abs=${p.absences} Av=${p.avances} CP=${p.conges_payes} HS=${p.heures_supplementaires}`).join('\n') || 'Aucun pointage';

          const prompt = `Tu es un expert comptable specialise en paie tunisienne. Verifie cette liste de salaries pour le mois ${dossier.mois}/${dossier.annee}.

SALARIES (${employees.length}):
${empSummary}

POINTAGE:
${ptgSummary}

VERIFICATIONS REQUISES:
1. Tous les salaries sont-ils calcules? (Y a-t-il des manquants?)
2. Les calculs CNSS (9.68%), IRPP (bareme 8 tranches), CSS (0.5%) sont-ils corrects?
3. Y a-t-il des salaries avec Brut different du mois precedent (nouveau_salaire_brut vs salaire_brut)?
4. Les situations familiales et nombre d'enfants semblent-ils coherents?
5. Y a-t-il des anomalies (salaire tres bas/eleve, absences excessives, etc.)?

Reponds en JSON:
{
  "ok": boolean,
  "verdict": "OK" | "ATTENTION" | "ERREUR",
  "checks": [
    { "name": "string", "status": "ok" | "warning" | "error", "detail": "string" }
  ],
  "missing": ["matricule des salaries non calcules"],
  "changes": ["modifications detectees par rapport au mois precedent"],
  "anomalies": ["anomalies detectees"]
}`;

          const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1024,
          });

          const responseText = (aiResponse as any)?.response || '';
          let result;
          try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            result = jsonMatch ? JSON.parse(jsonMatch[0]) : { ok: false, verdict: 'ERREUR', checks: [], error: 'Reponse IA non parseable' };
          } catch {
            result = { ok: false, verdict: 'ERREUR', checks: [], error: 'Erreur parsing IA', raw: responseText };
          }

          return json(result);
        } catch (e: any) {
          return json({ error: 'Verification IA echouee: ' + (e.message || e) }, 500);
        }
      }

      // --- BAUD: LIGNES ---
      const baudLignesMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/lignes$/);
      if (baudLignesMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM lignes_extraites WHERE dossier_id = ? ORDER BY created_at').bind(baudLignesMatch[1]).all();
        return json(r.results);
      }
      const baudLigneUpdateMatch = path.match(/^\/api\/baud\/lignes\/([^/]+)$/);
      if (baudLigneUpdateMatch && method === 'PUT') {
        const ligneId = baudLigneUpdateMatch[1];
        const oldLigne = await env.DB.prepare('SELECT * FROM lignes_extraites WHERE id = ?').bind(ligneId).first() as any;
        if (!oldLigne) return json({ error: 'Ligne non trouvee' }, 404);

        const b = await request.json() as any;
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [k, v] of Object.entries(b)) {
          if (['statut', 'matricule', 'rubrique_code', 'zone', 'valeur', 'champs'].includes(k)) {
            fields.push(`${k} = ?`);
            values.push(k === 'champs' ? JSON.stringify(v) : v);
          }
        }
        if (fields.length === 0) return json({ error: 'Aucun champ' });
        values.push(ligneId);
        await env.DB.prepare(`UPDATE lignes_extraites SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

        // Store corrections for AI learning
        const learnFields = ['matricule', 'rubrique_code', 'zone', 'valeur'];
        const dossier = await env.DB.prepare('SELECT societe_id FROM dossiers_paie WHERE id = ?').bind(oldLigne.dossier_id).first() as any;
        if (dossier) {
          for (const f of learnFields) {
            if (b[f] !== undefined && b[f] !== oldLigne[f] && b[f] !== '' && b[f] !== null) {
              const oldVal = String(oldLigne[f] || '');
              const newVal = String(b[f]);
              const cells = JSON.parse(oldLigne.champs || '[]');
              const sourcePattern = cells.length > 2 ? cells.slice(0, 3).join('|') : null;
              await env.DB.prepare('INSERT INTO corrections (id, societe_id, field, old_value, new_value, source_pattern) VALUES (?, ?, ?, ?, ?, ?)').bind(genId(), dossier.societe_id, f, oldVal, newVal, sourcePattern).run();
            }
          }
        }

        return await env.DB.prepare('SELECT * FROM lignes_extraites WHERE id = ?').bind(ligneId).first();
      }

      // --- BAUD: VALIDER ---
      const baudValiderMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/valider$/);
      if (baudValiderMatch && method === 'POST') {
        await env.DB.prepare("UPDATE dossiers_paie SET statut = 'valide', updated_at = datetime('now') WHERE id = ?").bind(baudValiderMatch[1]).run();
        return json({ ok: true });
      }

      // --- BAUD: CORRECTIONS (AI learning) ---
      const baudCorrMatch = path.match(/^\/api\/baud\/societes\/([^/]+)\/corrections$/);
      if (baudCorrMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM corrections WHERE societe_id = ? ORDER BY hit_count DESC').bind(baudCorrMatch[1]).all();
        return json(r.results);
      }
      const baudCorrDelMatch = path.match(/^\/api\/baud\/corrections\/([^/]+)$/);
      if (baudCorrDelMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM corrections WHERE id = ?').bind(baudCorrDelMatch[1]).run();
        return json({ ok: true });
      }

      // --- BAUD: EXPORT GA (generate XLSX as base64) ---
      const baudExportMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/export$/);
      if (baudExportMatch && method === 'POST') {
        const did = baudExportMatch[1];
        const dossier = await env.DB.prepare('SELECT * FROM dossiers_paie WHERE id = ?').bind(did).first() as any;
        if (!dossier) return json({ error: 'Dossier non trouve' }, 404);

        const lignesR = await env.DB.prepare('SELECT * FROM lignes_extraites WHERE dossier_id = ? AND statut != ? ORDER BY matricule, rubrique_code').bind(did, 'ignore').all();
        if (!lignesR.results.length) return json({ error: 'Aucune ligne valide' }, 400);

        const salariesR = await env.DB.prepare('SELECT * FROM salaries_paie WHERE societe_id = ?').bind(dossier.societe_id).all();
        const rubriquesR = await env.DB.prepare('SELECT * FROM rubriques_paie WHERE societe_id = ? AND actif = 1').bind(dossier.societe_id).all();
        const rubMap: Record<string, any> = {};
        for (const r of rubriquesR.results) rubMap[r.code as string] = r;

        // Build Import Salariés rows
        const salRows: any[][] = [['Matricule', 'Nom', 'Prénom', 'Civilité', 'Date de naissance', 'Date d\'embauche', 'Poste', 'Type de contrat']];
        const seen = new Set<string>();
        for (const l of lignesR.results) {
          const mat = l.matricule as string;
          if (!mat || seen.has(mat)) continue;
          seen.add(mat);
          const sal = (salariesR.results as any[]).find(s => s.matricule === mat);
          salRows.push([
            mat, sal?.nom || '', sal?.prenom || '', sal?.civilite || '',
            sal?.date_naissance || '', sal?.date_embauche || '', sal?.poste || '', sal?.type_contrat || ''
          ]);
        }

        // Build Import Variables rows
        const varRows: any[][] = [['Matricule', 'Rubrique ou Constante', 'Zone', 'Valeur']];
        for (const l of lignesR.results) {
          const rub = rubMap[l.rubrique_code as string];
          const zone = l.zone || rub?.zone || '0';
          varRows.push([l.matricule || '', l.rubrique_code || '', String(zone), l.valeur != null ? String(l.valeur) : '']);
        }

        // Generate XLSX as base64 using dynamic import
        let salB64 = '', varB64 = '';
        try {
          const XLSXMod = await import('xlsx');
          const XLSX = XLSXMod.default || XLSXMod;

          const salWb = XLSX.utils.book_new();
          const salWs = XLSX.utils.aoa_to_sheet(salRows);
          XLSX.utils.book_append_sheet(salWb, salWs, 'Salariés');
          salB64 = XLSX.write(salWb, { type: 'base64', bookType: 'xlsx' });

          const varWb = XLSX.utils.book_new();
          const varWs = XLSX.utils.aoa_to_sheet(varRows);
          XLSX.utils.book_append_sheet(varWb, varWs, 'Variables');
          varB64 = XLSX.write(varWb, { type: 'base64', bookType: 'xlsx' });
        } catch {
          return json({ error: 'xlsx non disponible' }, 500);
        }

        const moisStr = String(dossier.mois).padStart(2, '0');
        const annStr = String(dossier.annee).slice(-2);
        const salName = `ImportSalariés_${moisStr}-${annStr}.xlsx`;
        const varName = `ImportVariables_${moisStr}-${annStr}.xlsx`;

        // Store exports
        const salId = genId(), varId = genId();
        await env.DB.prepare('INSERT INTO imports_ga (id, dossier_id, type_import, fichier_nom, fichier_base64, nb_lignes) VALUES (?, ?, ?, ?, ?, ?)').bind(salId, did, 'salaries', salName, salB64, salRows.length - 1).run();
        await env.DB.prepare('INSERT INTO imports_ga (id, dossier_id, type_import, fichier_nom, fichier_base64, nb_lignes) VALUES (?, ?, ?, ?, ?, ?)').bind(varId, did, 'variables', varName, varB64, varRows.length - 1).run();

        return json({ ok: true, exports: [
          { id: salId, type: 'salaries', fichier_nom: salName, nb_lignes: salRows.length - 1 },
          { id: varId, type: 'variables', fichier_nom: varName, nb_lignes: varRows.length - 1 },
        ]});
      }

      // --- BAUD: LIST EXPORTS ---
      const baudExportsListMatch = path.match(/^\/api\/baud\/dossiers\/([^/]+)\/exports$/);
      if (baudExportsListMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT id, type_import, fichier_nom, nb_lignes, statut, created_at FROM imports_ga WHERE dossier_id = ? ORDER BY created_at').bind(baudExportsListMatch[1]).all();
        return json(r.results);
      }

      // --- BAUD: DOWNLOAD EXPORT ---
      const baudDownloadMatch = path.match(/^\/api\/baud\/exports\/([^/]+)\/download$/);
      if (baudDownloadMatch && method === 'GET') {
        const exp = await env.DB.prepare('SELECT * FROM imports_ga WHERE id = ?').bind(baudDownloadMatch[1]).first() as any;
        if (!exp) return json({ error: 'Export non trouve' }, 404);
        const b64 = exp.fichier_base64 as string;
        const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return new Response(bin, {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${exp.fichier_nom}"`,
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // ============================================================
      // SCANFLASH — SCANNED INVOICE JOURNALS
      // ============================================================

      // --- SCANFLASH: SOCIETES ---
      if (path === '/api/scan/societes' && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM societes_scan ORDER BY raison_sociale').all();
        return json(r.results);
      }
      if (path === '/api/scan/societes' && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO societes_scan (id, raison_sociale, matricule_fiscal) VALUES (?, ?, ?)').bind(id, b.raison_sociale, b.matricule_fiscal || null).run();
        return json({ id, ...b });
      }
      const delScanSocMatch = path.match(/^\/api\/scan\/societes\/([^/]+)$/);
      if (delScanSocMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM societes_scan WHERE id = ?').bind(delScanSocMatch[1]).run();
        return json({ ok: true });
      }

      // --- SCANFLASH: DOSSIERS ---
      const scanDossiersListMatch = path.match(/^\/api\/scan\/societes\/([^/]+)\/dossiers$/);
      if (scanDossiersListMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM dossiers_scan WHERE societe_id = ? ORDER BY created_at DESC').bind(scanDossiersListMatch[1]).all();
        return json(r.results);
      }
      if (scanDossiersListMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO dossiers_scan (id, societe_id, nom, mois, annee) VALUES (?, ?, ?, ?, ?)').bind(id, scanDossiersListMatch[1], b.nom || `SCAN ${b.mois}/${b.annee}`, b.mois, b.annee).run();
        return json({ id, nom: b.nom || `SCAN ${b.mois}/${b.annee}`, mois: b.mois, annee: b.annee, statut: 'brouillon' });
      }
      const scanDossierGetMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)$/);
      if (scanDossierGetMatch && method === 'GET') {
        const d = await env.DB.prepare('SELECT * FROM dossiers_scan WHERE id = ?').bind(scanDossierGetMatch[1]).first();
        return d ? json(d) : json({ error: 'Non trouve' }, 404);
      }
      if (scanDossierGetMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM factures_scan WHERE dossier_id = ?').bind(scanDossierGetMatch[1]).run();
        await env.DB.prepare('DELETE FROM ecritures_scan WHERE dossier_id = ?').bind(scanDossierGetMatch[1]).run();
        await env.DB.prepare('DELETE FROM dossiers_scan WHERE id = ?').bind(scanDossierGetMatch[1]).run();
        return json({ ok: true });
      }
      if (scanDossierGetMatch && method === 'PATCH') {
        const b = await request.json() as any;
        const nom = String(b.nom || '').trim();
        if (!nom) return json({ error: 'Nom vide' }, 400);
        const r = await env.DB.prepare('UPDATE dossiers_scan SET nom = ? WHERE id = ?').bind(nom, scanDossierGetMatch[1]).run();
        if (!r.meta.changes) return json({ error: 'Non trouve' }, 404);
        return json({ ok: true, nom });
      }

      // --- SCANFLASH: FACTURES ---
      const scanFacturesMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/factures$/);
      if (scanFacturesMatch && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM factures_scan WHERE dossier_id = ? ORDER BY date_facture, numero').bind(scanFacturesMatch[1]).all();
        return json(r.results);
      }
      if (scanFacturesMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO factures_scan (id, dossier_id, numero, date_facture, client, code_client, compte_client, is_avoir, total_ht_0, total_ht_19, tva_19, fodec, timbre, total_ttc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, scanFacturesMatch[1], b.numero, b.date_facture, b.client, b.code_client || null, b.compte_client, b.is_avoir ? 1 : 0, b.total_ht_0 || 0, b.total_ht_19 || 0, b.tva_19 || 0, b.fodec || 0, b.timbre || 0, b.total_ttc || 0).run();
        return json({ id, ...b });
      }
      if (scanFacturesMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM factures_scan WHERE dossier_id = ?').bind(scanFacturesMatch[1]).run();
        return json({ ok: true });
      }

      // --- SCANFLASH: ECRITURES ---
      const scanEcrituresMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/ecritures$/);
      if (scanEcrituresMatch && method === 'GET') {
        const journal = new URL(url).searchParams.get('journal');
        let sql = 'SELECT * FROM ecritures_scan WHERE dossier_id = ?';
        const params: any[] = [scanEcrituresMatch[1]];
        if (journal) { sql += ' AND journal_code = ?'; params.push(journal); }
        sql += ' ORDER BY page, date_operation, numero_doc, compte';
        const r = await env.DB.prepare(sql).bind(...params).all();
        return json(r.results);
      }
      if (scanEcrituresMatch && method === 'POST') {
        const b = await request.json() as any;
        const id = genId();
        await env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, scanEcrituresMatch[1], b.numero_doc, b.date_operation, b.journal_code || 'VT', b.compte, b.libelle || null, b.sens, b.montant, b.page || null).run();
        return json({ id, ...b });
      }
      if (scanEcrituresMatch && method === 'DELETE') {
        const journal = new URL(url).searchParams.get('journal');
        let sql = 'DELETE FROM ecritures_scan WHERE dossier_id = ?';
        const params: any[] = [scanEcrituresMatch[1]];
        if (journal) { sql += ' AND journal_code = ?'; params.push(journal); }
        await env.DB.prepare(sql).bind(...params).run();
        return json({ ok: true });
      }
      const delScanEcrMatch = path.match(/^\/api\/scan\/ecritures\/([^/]+)$/);
      if (delScanEcrMatch && method === 'DELETE') {
        await env.DB.prepare('DELETE FROM ecritures_scan WHERE id = ?').bind(delScanEcrMatch[1]).run();
        return json({ ok: true });
      }

      // --- SCANFLASH: GENERATE VT from factures ---
      const scanGenerateMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/generate$/);
      if (scanGenerateMatch && method === 'POST') {
        const did = scanGenerateMatch[1];
        const dossier = await env.DB.prepare('SELECT * FROM dossiers_scan WHERE id = ?').bind(did).first() as any;
        if (!dossier) return json({ error: 'Dossier non trouve' }, 404);

        // Clear existing ecritures for this dossier
        await env.DB.prepare('DELETE FROM ecritures_scan WHERE dossier_id = ?').bind(did).run();

        const factures = await env.DB.prepare('SELECT * FROM factures_scan WHERE dossier_id = ? ORDER BY date_facture, numero').bind(did).all();
        const batch: D1PreparedStatement[] = [];
        let ecount = 0;

        for (const f of factures.results as any[]) {
          const date = f.date_facture;
          const facNum = f.numero || '';
          const clientName = f.client || '';
          const compteClient = f.compte_client || '411000';
          const ht0 = f.total_ht_0 || 0;
          const ht19 = f.total_ht_19 || 0;
          const tva = f.tva_19 || 0;
          const fodec = f.fodec || 0;
          const timbre = f.timbre || 0;
          const isAvoir = !!f.is_avoir;
          const prefix = isAvoir ? 'AVR' : 'FAC';
          const lib = `${prefix} ${facNum}/${clientName}`;
          const ttc = ht0 + ht19 + tva + fodec + timbre;

          if (isAvoir) {
            // AVR: Client CREDIT, Sales/TVa/FODEC DEBIT (inverse of FAC)
            if (ttc > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', compteClient, lib, 'C', Math.round(ttc * 1000) / 1000));
              ecount++;
            }
            if (ht19 > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '707000', lib, 'D', Math.round(ht19 * 1000) / 1000));
              ecount++;
            }
            if (ht0 > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '707003', lib, 'D', Math.round(ht0 * 1000) / 1000));
              ecount++;
            }
            if (tva > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '436719', lib, 'D', Math.round(tva * 1000) / 1000));
              ecount++;
            }
            if (fodec > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '436780', lib, 'D', Math.round(fodec * 1000) / 1000));
              ecount++;
            }
          } else {
            // FAC: Client DEBIT, Sales/TVa/FODEC/Timbre CREDIT
            if (ttc > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', compteClient, lib, 'D', Math.round(ttc * 1000) / 1000));
              ecount++;
            }
            if (ht19 > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '707000', lib, 'C', Math.round(ht19 * 1000) / 1000));
              ecount++;
            }
            if (ht0 > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '707003', lib, 'C', Math.round(ht0 * 1000) / 1000));
              ecount++;
            }
            if (tva > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '436719', lib, 'C', Math.round(tva * 1000) / 1000));
              ecount++;
            }
            if (fodec > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '436780', lib, 'C', Math.round(fodec * 1000) / 1000));
              ecount++;
            }
            if (timbre > 0) {
              batch.push(env.DB.prepare('INSERT INTO ecritures_scan (id, dossier_id, numero_doc, date_operation, journal_code, compte, libelle, sens, montant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), did, facNum, date, 'VT', '437600', lib, 'C', Math.round(timbre * 1000) / 1000));
              ecount++;
            }
          }
        }

        // Batch insert
        for (let i = 0; i < batch.length; i += 50) {
          await env.DB.batch(batch.slice(i, i + 50));
        }

        // Update dossier count
        await env.DB.prepare('UPDATE dossiers_scan SET nb_pieces = ?, nb_ecritures = ?, statut = ? WHERE id = ?').bind((factures.results as any[]).length, ecount, 'traite', did).run();

        return json({ ok: true, factures: (factures.results as any[]).length, ecritures: ecount });
      }

      // --- SCANFLASH: EXPORT CSV ---
      const scanExportMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/export$/);
      if (scanExportMatch && method === 'GET') {
        const did = scanExportMatch[1];
        const journal = new URL(url).searchParams.get('journal');
        let sql = 'SELECT * FROM ecritures_scan WHERE dossier_id = ?';
        const params: any[] = [did];
        if (journal) { sql += ' AND journal_code = ?'; params.push(journal); }
        sql += ' ORDER BY page, date_operation, numero_doc, compte';
        const r = await env.DB.prepare(sql).bind(...params).all();
        const lines: string[] = [];
        for (const e of r.results as any[]) {
          const date = e.date_operation; // YYYY-MM-DD
          const [y, m, d] = date.split('-');
          const dateFormatted = `${d}/${m}/${y}`;
          const montant = Math.round((e.montant || 0) * 1000) / 1000;
          const debit = e.sens === 'D' ? montant.toFixed(3) : '0.000';
          const credit = e.sens === 'C' ? montant.toFixed(3) : '0.000';
          lines.push(`${e.numero_doc || ''}\t${dateFormatted}\t${e.journal_code || 'VT'}\t${e.libelle || ''}\t${e.compte}\t\t${debit}\t${credit}`);
        }
        return new Response(lines.join('\n'), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="scan_export_${did}.csv"`,
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // --- SCANFLASH: EXPORT XLSX (Axeane template) ---
      const scanExportXlsxMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/export-xlsx$/);
      if (scanExportXlsxMatch && method === 'GET') {
        const did = scanExportXlsxMatch[1];
        const r = await env.DB.prepare('SELECT * FROM ecritures_scan WHERE dossier_id = ? ORDER BY page, date_operation, numero_doc, compte').bind(did).all();

        const XLSXMod = await import('xlsx');
        const XLSX = XLSXMod.default || XLSXMod;

        const header = ['N° pièce comptable', 'Date pièce comptable', 'Journal', 'Libellé', 'N° compte', 'Libellé trésorerie', 'Débit', 'Crédit'];
        const rows: any[][] = [header];

        for (const e of r.results as any[]) {
          const date = e.date_operation;
          const [y, m, d] = date.split('-');
          const dateFormatted = `${d}/${m}/${y}`;
          const montant = Math.round((e.montant || 0) * 1000) / 1000;
          const debit = e.sens === 'D' ? montant : 0;
          const credit = e.sens === 'C' ? montant : 0;
          rows.push([e.numero_doc || '', dateFormatted, e.journal_code || 'VT', e.libelle || '', e.compte, '', debit, credit]);
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);

        // Style headers: Arial Bold, centered
        const headerStyle = { font: { name: 'Arial', bold: true }, alignment: { horizontal: 'center' } };
        if (!ws['!cols']) ws['!cols'] = [];
        ws['!cols'] = [
          { wch: 30 }, // N° pièce
          { wch: 27 }, // Date
          { wch: 10 }, // Journal
          { wch: 40 }, // Libellé
          { wch: 12 }, // N° compte
          { wch: 28 }, // Libellé trésorerie
          { wch: 15 }, // Débit
          { wch: 15 }, // Crédit
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ecritures');
        const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

        return new Response(Uint8Array.from(atob(b64), c => c.charCodeAt(0)), {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="scan_ecritures_${did}.xlsx"`,
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // --- SCANFLASH: AUTO-CLEANUP after export ---
      const scanCleanupMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/cleanup$/);
      if (scanCleanupMatch && method === 'POST') {
        const did = scanCleanupMatch[1];
        await env.DB.prepare('DELETE FROM ecritures_scan WHERE dossier_id = ?').bind(did).run();
        await env.DB.prepare('DELETE FROM factures_scan WHERE dossier_id = ?').bind(did).run();
        return json({ ok: true });
      }

      // --- SCANFLASH: VERIFY TVA 19% ---
      const scanVerifyMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/verify-ai$/);
      if (scanVerifyMatch && method === 'POST') {
        const did = scanVerifyMatch[1];
        const factures = await env.DB.prepare('SELECT * FROM factures_scan WHERE dossier_id = ? ORDER BY date_facture, numero').bind(did).all();
        if (!factures.results.length) return json({ error: 'Aucune facture' }, 400);

        const checks: any[] = [];
        let errors = 0;
        let totalHT = 0, totalTVA = 0, totalFODEC = 0, totalTimbre = 0, totalTTC = 0;

        for (const f of factures.results as any[]) {
          const ht19 = f.total_ht_19 || 0;
          const tvaExpected = Math.round(ht19 * 19) / 100;
          const tvaActual = f.tva_19 || 0;
          const tvaDiff = Math.abs(tvaActual - tvaExpected);
          const fodecExpected = Math.round(ht19 * 1) / 100;
          const fodecActual = f.fodec || 0;
          const fodecDiff = Math.abs(fodecActual - fodecExpected);
          const ttcComputed = (f.total_ht_0 || 0) + ht19 + tvaActual + fodecActual + (f.timbre || 0);
          const ttcDiff = Math.abs(f.total_ttc || 0) - ttcComputed;

          totalHT += (f.total_ht_0 || 0) + ht19;
          totalTVA += tvaActual;
          totalFODEC += fodecActual;
          totalTimbre += f.timbre || 0;
          totalTTC += f.total_ttc || 0;

          const pieceChecks: any[] = [];
          if (tvaDiff > 0.01) {
            pieceChecks.push({ name: 'TVA', status: 'error', detail: `TVA ${tvaActual} ≠ HT×19% = ${tvaExpected} (ecart ${tvaDiff.toFixed(3)})`, expected: tvaExpected, actual: tvaActual });
            errors++;
          } else {
            pieceChecks.push({ name: 'TVA', status: 'ok', detail: `TVA ${tvaActual} = HT×19% = ${tvaExpected}` });
          }
          if (fodecDiff > 0.01) {
            pieceChecks.push({ name: 'FODEC', status: 'error', detail: `FODEC ${fodecActual} ≠ HT×1% = ${fodecExpected} (ecart ${fodecDiff.toFixed(3)})`, expected: fodecExpected, actual: fodecActual });
            errors++;
          } else {
            pieceChecks.push({ name: 'FODEC', status: 'ok', detail: `FODEC ${fodecActual} = HT×1% = ${fodecExpected}` });
          }
          if (Math.abs(ttcDiff) > 0.01) {
            pieceChecks.push({ name: 'TTC', status: 'error', detail: `TTC declare ${f.total_ttc} ≠ calcule ${ttcComputed} (ecart ${ttcDiff.toFixed(3)})`, expected: ttcComputed, actual: f.total_ttc });
            errors++;
          } else {
            pieceChecks.push({ name: 'TTC', status: 'ok', detail: `TTC ${f.total_ttc} = somme lignes` });
          }
          checks.push({ piece: f.numero, type: f.is_avoir ? 'AVR' : 'FAC', client: f.client, checks: pieceChecks });
        }

        // Build prompt for AI
        const facturesText = (factures.results as any[]).map(f => {
          const ht19 = f.total_ht_19 || 0;
          const tvaExpected = Math.round(ht19 * 19) / 100;
          return `${f.numero} ${f.is_avoir ? 'AVR' : 'FAC'} ${f.client}: HT19=${ht19} TVA=${f.tva_19} (expected=${tvaExpected}) FODEC=${f.fodec} Timbre=${f.timbre} TTC=${f.total_ttc}`;
        }).join('\n');

        const prompt = `Tu es un expert-comptable tunisien. Verifie ces factures SCANFLASH.

REGLES:
- TVA 19% = HT × 19%
- FODEC 1% = HT × 1%
- Timbre fiscal = 1.000 DT (fixe, toujours present sur FAC)
- TTC = HT + TVA + FODEC + Timbre
- FAC: client DOIT (D), ventes/tva/fodec/timbre = CREDIT
- AVR: client CREDITE (C), ventes/tva/fodec/timbre = DEBIT

FACTURES:
${facturesText}

TOTAL: HT=${totalHT.toFixed(3)} TVA=${totalTVA.toFixed(3)} FODEC=${totalFODEC.toFixed(3)} Timbre=${totalTimbre.toFixed(3)} TTC=${totalTTC.toFixed(3)}

JSON: {"verdict":"OK/ERREUR","score":0-100,"checks":[{"piece":"...","type":"FAC/AVR","status":"ok/error","detail":"..."}],"summary":"..."}`;

        let aiReport: any;
        try {
          const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
            messages: [
              { role: 'system', content: 'Reponds toujours en JSON valide.' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 2000,
            temperature: 0.1,
          });
          const raw = aiResponse?.response || aiResponse?.result?.response || aiResponse;
          if (typeof raw === 'string') {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            aiReport = jsonMatch ? JSON.parse(jsonMatch[0]) : { verdict: errors > 0 ? 'ERREUR' : 'OK', summary: raw };
          } else {
            aiReport = raw;
          }
        } catch (aiErr: any) {
          aiReport = { verdict: errors > 0 ? 'ERREUR' : 'OK', summary: 'AI error: ' + aiErr.message };
        }

        return json({
          ok: true,
          verdict: errors > 0 ? 'ERREUR' : 'OK',
          errors,
          totalFactures: factures.results.length,
          totals: { ht: totalHT, tva: totalTVA, fodec: totalFODEC, timbre: totalTimbre, ttc: totalTTC },
          checks,
          ai: aiReport,
        });
      }

      // --- SCANFLASH: FIX TVA ---
      const scanFixTvaMatch = path.match(/^\/api\/scan\/dossiers\/([^/]+)\/fix-tva$/);
      if (scanFixTvaMatch && method === 'POST') {
        const did = scanFixTvaMatch[1];
        const factures = await env.DB.prepare('SELECT * FROM factures_scan WHERE dossier_id = ? ORDER BY date_facture, numero').bind(did).all();
        if (!factures.results.length) return json({ error: 'Aucune facture' }, 400);

        let fixed = 0;
        const batch: D1PreparedStatement[] = [];

        for (const f of factures.results as any[]) {
          const ht19 = f.total_ht_19 || 0;
          const tvaExpected = Math.round(ht19 * 19) / 100;
          const tvaActual = f.tva_19 || 0;
          if (Math.abs(tvaActual - tvaExpected) > 0.01) {
            const diff = tvaExpected - tvaActual;
            const newTTC = (f.total_ttc || 0) + diff;
            batch.push(env.DB.prepare('UPDATE factures_scan SET tva_19 = ?, total_ttc = ? WHERE id = ?').bind(tvaExpected, newTTC, f.id));
            fixed++;
          }
        }

        if (batch.length > 0) {
          for (let i = 0; i < batch.length; i += 50) {
            await env.DB.batch(batch.slice(i, i + 50));
          }
        }

        // Also update ecritures: find 436719 lines and fix amounts
        const ecritures = await env.DB.prepare('SELECT * FROM ecritures_scan WHERE dossier_id = ? AND compte = ?').bind(did, '436719').all();
        const ecrBatch: D1PreparedStatement[] = [];
        for (const e of ecritures.results as any[]) {
          // Find the matching facture
          const fac = (factures.results as any[]).find(f => f.numero === e.numero_doc);
          if (fac) {
            const newTVA = Math.round((fac.total_ht_19 || 0) * 19) / 100;
            if (Math.abs(e.montant - newTVA) > 0.01) {
              ecrBatch.push(env.DB.prepare('UPDATE ecritures_scan SET montant = ? WHERE id = ?').bind(newTVA, e.id));
            }
          }
        }
        if (ecrBatch.length > 0) {
          for (let i = 0; i < ecrBatch.length; i += 50) {
            await env.DB.batch(ecrBatch.slice(i, i + 50));
          }
        }

        return json({ ok: true, fixed, ecrituresFixed: ecrBatch.length });
      }

      // ============================================================
      // ORGANIZATION MODULE — Cabinet d'Expertise Comptable
      // ============================================================

      // --- ORG: AUTH ---
      if (path === '/api/org/auth/login' && method === 'POST') {
        const { email, password } = await request.json() as any;
        if (!email || !password) return json({ error: 'Email et mot de passe requis' }, 400);
        const user = await env.DB.prepare('SELECT id, organization_id, full_name, email, password_hash, role, role_label, must_change_password, is_active FROM org_users WHERE email = ?').bind(email).first() as any;
        if (!user) return json({ error: 'Identifiants incorrects' }, 401);
        if (!user.is_active) return json({ error: 'Compte désactivé' }, 403);
        // Verify password (SHA-256 with salt)
        const [salt, expectedHash] = user.password_hash.split(':');
        if (!salt || !expectedHash) return json({ error: 'Identifiants incorrects' }, 401);
        const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + password));
        const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        if (hashHex !== expectedHash) return json({ error: 'Identifiants incorrects' }, 401);
        const org = await env.DB.prepare('SELECT name FROM organizations WHERE id = ?').bind(user.organization_id).first() as any;
        // Rôle affiché : role_label ('manager') prime sur le rôle stocké ('expert')
        const effRole = user.role_label || user.role;
        // Create token
        const tokenPayload = JSON.stringify({ user_id: user.id, organization_id: user.organization_id, role: effRole, exp: Date.now() + 86400000 });
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('eurex_org_secret_2026'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(tokenPayload));
        const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
        const token = btoa(tokenPayload).replace(/=/g, '') + '.' + sigHex;
        return json({ token, user: { id: user.id, full_name: user.full_name, email: user.email, role: effRole, must_change_password: user.must_change_password, organization: org?.name || '' } });
      }

      // --- ORG: Verify token helper (inline) ---
      async function verifyOrgToken(request: Request): Promise<any> {
        const auth = request.headers.get('Authorization');
        if (!auth?.startsWith('Bearer ')) return null;
        const token = auth.slice(7);
        try {
          const [dataB64, sigHex] = token.split('.');
          if (!dataB64 || !sigHex) return null;
          const data = atob(dataB64);
          const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('eurex_org_secret_2026'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
          const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
          const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
          if (!valid) return null;
          const payload = JSON.parse(data);
          if (payload.exp < Date.now()) return null;
          const user = await env.DB.prepare('SELECT id, organization_id, full_name, email, role, role_label, is_active, must_change_password FROM org_users WHERE id = ? AND organization_id = ?').bind(payload.user_id, payload.organization_id).first() as any;
          if (!user || !user.is_active) return null;
          if (user.role_label) user.role = user.role_label;
          // Presence : marque l'utilisateur comme "vu" (max 1 ecriture/60s)
          await env.DB.prepare("UPDATE org_users SET last_seen_at = datetime('now') WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now','-60 seconds'))").bind(user.id).run();
          return user;
        } catch { return null; }
      }

      // Grant (renfort) actif : acces temporaire ouvert par un expert/manager
      const ORG_GRANT_ACTIVE = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))`;

      async function orgCanAccessDossier(user: any, dossierId: string): Promise<boolean> {
        if (isSupervisor(user.role)) return true;
        const d = await env.DB.prepare(`SELECT c.assigned_comptable_id FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE d.id = ? AND c.organization_id = ?`).bind(dossierId, user.organization_id).first() as any;
        if (d?.assigned_comptable_id === user.id) return true;
        const g = await env.DB.prepare(`SELECT 1 AS x FROM org_dossier_grants WHERE dossier_id = ? AND granted_to = ? AND ${ORG_GRANT_ACTIVE}`).bind(dossierId, user.id).first();
        return !!g;
      }

      // Un comptable (cible d'assignation) a-t-il acces au dossier ? (assigne OU renfort actif)
      async function orgCompCanAccessDossier(compId: string, dossierId: string): Promise<boolean> {
        const d = await env.DB.prepare(`SELECT c.assigned_comptable_id FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE d.id = ?`).bind(dossierId).first() as any;
        if (d?.assigned_comptable_id === compId) return true;
        const g = await env.DB.prepare(`SELECT 1 AS x FROM org_dossier_grants WHERE dossier_id = ? AND granted_to = ? AND ${ORG_GRANT_ACTIVE}`).bind(dossierId, compId).first();
        return !!g;
      }

      async function orgCanAccessClient(user: any, clientId: string): Promise<boolean> {
        if (isSupervisor(user.role)) return true;
        const c = await env.DB.prepare('SELECT assigned_comptable_id FROM org_clients WHERE id = ? AND organization_id = ?').bind(clientId, user.organization_id).first() as any;
        return c?.assigned_comptable_id === user.id;
      }

      // Statuts export possibles d'un client + portée export d'une échéance (JSON array, NULL = toutes)
      const EXPORT_STATUSES = ['exportatrice', 'semi_exportatrice', 'non_exportatrice'];
      const parseExportScope = (v: any): string | null => {
        if (!Array.isArray(v)) return null;
        const valid = v.filter((s: any) => EXPORT_STATUSES.includes(s));
        return valid.length ? JSON.stringify(valid) : null;
      };
      // Filtre une tâche/échéance selon la portée export : voir exportScopeKeeps (portée module)

      // Avancement des cartes dashboard : seuls les MOIS ECOULES entrent dans le calcul
      // (mois en cours exclu — en février on ne compte que janvier, en mars janvier+février).
      // Les tâches annuelles (sans mois) ne sont comptées qu'à fin d'année (décembre).
      const currentMonthTn = new Date(Date.now() + 3600000).getUTCMonth() + 1;
      const inDashboardScope = (month: any): boolean =>
        month === null || month === undefined ? currentMonthTn === 12 : Number(month) < currentMonthTn;

      // --- ORG: ME ---
      if (path === '/api/org/auth/me' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const org = await env.DB.prepare('SELECT name FROM organizations WHERE id = ?').bind(user.organization_id).first() as any;
        return json({ ...user, organization: org?.name || '' });
      }

      // --- ORG: UPDATE MY PROFILE (nom / email) ---
      if (path === '/api/org/auth/me' && method === 'PATCH') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const { full_name, email } = await request.json() as any;
        const updates: string[] = [];
        const binds: any[] = [];
        if (full_name !== undefined) {
          const name = String(full_name).trim();
          if (!name) return json({ error: 'Nom requis' }, 400);
          updates.push('full_name = ?');
          binds.push(name);
        }
        if (email !== undefined) {
          const mail = String(email).trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return json({ error: 'Email invalide' }, 400);
          const existing = await env.DB.prepare('SELECT id FROM org_users WHERE email = ? AND id != ?').bind(mail, user.id).first();
          if (existing) return json({ error: 'Cet email est déjà utilisé' }, 409);
          updates.push('email = ?');
          binds.push(mail);
        }
        if (updates.length === 0) return json({ error: 'Aucun champ à mettre à jour' }, 400);
        await env.DB.prepare(`UPDATE org_users SET ${updates.join(', ')} WHERE id = ?`).bind(...binds, user.id).run();
        const updated = await env.DB.prepare('SELECT id, organization_id, full_name, email, role, role_label, must_change_password, is_active FROM org_users WHERE id = ?').bind(user.id).first() as any;
        const org = await env.DB.prepare('SELECT name FROM organizations WHERE id = ?').bind(user.organization_id).first() as any;
        return json({ ...updated, role: updated.role_label || updated.role, organization: org?.name || '' });
      }

      // --- ORG: CHANGE PASSWORD ---
      if (path === '/api/org/auth/change-password' && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const { current_password, new_password } = await request.json() as any;
        if (!current_password || !new_password) return json({ error: 'Mots de passe requis' }, 400);
        if (new_password.length < 12) return json({ error: 'Le mot de passe doit faire au moins 12 caractères' }, 400);
        const stored = await env.DB.prepare('SELECT password_hash FROM org_users WHERE id = ?').bind(user.id).first() as any;
        const [salt] = stored.password_hash.split(':');
        const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + current_password));
        const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        if (hashHex !== stored.password_hash.split(':')[1]) return json({ error: 'Mot de passe actuel incorrect' }, 401);
        const newSalt = crypto.randomUUID().slice(0, 16);
        const newHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(newSalt + ':' + new_password));
        const newHashHex = Array.from(new Uint8Array(newHashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        await env.DB.prepare('UPDATE org_users SET password_hash = ?, must_change_password = 0 WHERE id = ?').bind(newSalt + ':' + newHashHex, user.id).run();
        return json({ ok: true });
      }

      // --- ORG: CLIENTS ---
      if (path === '/api/org/clients' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        // Securite au chargement : ouverture du nouvel exercice si le cron du 1er janvier a rate
        await ensureCurrentExercice(env, user.organization_id);
        // ?exercice=YYYY : dossier de cet exercice (tous statuts) au lieu du dernier en_cours
        const exParam = new URL(request.url).searchParams.get('exercice');
        const exerciceSel = exParam ? Number(exParam) : null;
        let clients;
        if (isSupervisor(user.role)) {
          const r = await env.DB.prepare('SELECT c.*, u.full_name as comptable_name FROM org_clients c LEFT JOIN org_users u ON c.assigned_comptable_id = u.id WHERE c.organization_id = ? ORDER BY c.name').bind(user.organization_id).all();
          clients = r.results;
        } else {
          const r = await env.DB.prepare('SELECT c.*, u.full_name as comptable_name FROM org_clients c LEFT JOIN org_users u ON c.assigned_comptable_id = u.id WHERE c.organization_id = ? AND c.assigned_comptable_id = ? ORDER BY c.name').bind(user.organization_id, user.id).all();
          clients = r.results;
        }
        // Enrich with dossier + progress
        const enriched = await Promise.all(clients.map(async (c: any) => {
          const d = exerciceSel
            ? await env.DB.prepare('SELECT * FROM org_dossiers WHERE client_id = ? AND exercice = ?').bind(c.id, exerciceSel).first() as any
            : await env.DB.prepare("SELECT * FROM org_dossiers WHERE client_id = ? AND status = 'en_cours' ORDER BY exercice DESC LIMIT 1").bind(c.id).first() as any;
          // Exercice filtre : le client sans dossier cette annee disparait du dashboard
          if (exerciceSel && !d) return null;
          let taskStats = { total: 0, fait: 0, en_cours: 0, bloque_client: 0 };
          let docStats = { total: 0, received: 0 };
          if (d) {
            const { results: tasks } = await env.DB.prepare('SELECT status, export_scope, month FROM org_tasks WHERE dossier_id = ? AND hidden = 0').bind(d.id).all();
            for (const t of tasks as any[]) {
              if (!exportScopeKeeps(t.export_scope, c.export_status)) continue;
              if (!inDashboardScope(t.month)) continue;
              taskStats.total++; if (t.status === 'fait') taskStats.fait++; else if (t.status === 'en_cours' || t.status === 'a_faire' || t.status === 'a_verifier') taskStats.en_cours++; else if (t.status === 'bloque_client') taskStats.bloque_client++;
            }
            const ds = await env.DB.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN received = 1 THEN 1 ELSE 0 END) as received FROM org_expected_documents WHERE dossier_id = ?').bind(d.id).first() as any;
            if (ds) { docStats.total = ds.total || 0; docStats.received = ds.received || 0; }
          }
          return { ...c, dossier_actuel: d || null, task_stats: taskStats, doc_stats: docStats, progress: taskStats.total > 0 ? Math.round(taskStats.fait / taskStats.total * 100 * 10) / 10 : 0 };
        }));
        return json(enriched.filter(Boolean));
      }

      if (path === '/api/org/clients' && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!isSupervisor(user.role)) return json({ error: 'La création de clients est réservée à l\'expert' }, 403);
        const { name, matricule_fiscal, assigned_comptable_id, contact_email, contact_phone, person_type, export_status } = await request.json() as any;
        if (!name) return json({ error: 'Nom requis' }, 400);
        const pType = ['morale', 'physique'].includes(person_type) ? person_type : null;
        const eStatus = EXPORT_STATUSES.includes(export_status) ? export_status : null;
        const id = genId();
        const comptableId = assigned_comptable_id || null;
        await env.DB.prepare('INSERT INTO org_clients (id, organization_id, assigned_comptable_id, name, matricule_fiscal, contact_email, contact_phone, person_type, export_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, user.organization_id, comptableId, name, matricule_fiscal || null, contact_email || null, contact_phone || null, pType, eStatus).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'client_created', 'client', id, JSON.stringify({ name, person_type: pType, export_status: eStatus })).run();
        return json({ id, name, person_type: pType, export_status: eStatus }, 201);
      }

      const orgClientMatch = path.match(/^\/api\/org\/clients\/([^/]+)$/);
      if (orgClientMatch && method === 'PATCH') {
        const user = await verifyOrgToken(request);
        if (!user || (!isSupervisor(user.role) && user.role !== 'comptable')) return json({ error: 'Non autorisé' }, 403);
        const { person_type, export_status, name, matricule_fiscal, contact_email, contact_phone } = await request.json() as any;
        if (person_type !== null && person_type !== undefined && !['morale', 'physique'].includes(person_type)) return json({ error: 'Type invalide' }, 400);
        if (export_status !== null && export_status !== undefined && !EXPORT_STATUSES.includes(export_status)) return json({ error: 'Statut export invalide' }, 400);
        const client = await env.DB.prepare('SELECT * FROM org_clients WHERE id = ? AND organization_id = ?').bind(orgClientMatch[1], user.organization_id).first() as any;
        if (!client) return json({ error: 'Client non trouvé' }, 404);
        if (user.role === 'comptable' && client.assigned_comptable_id !== user.id) return json({ error: 'Réservé au comptable assigné' }, 403);
        // Nom / matricule / contacts : reserves aux superviseurs (expert + manager)
        const infoFields = { name, matricule_fiscal, contact_email, contact_phone };
        const hasInfoEdit = Object.values(infoFields).some(v => v !== undefined);
        if (hasInfoEdit && !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert (modification des informations)' }, 403);
        const updates: string[] = [];
        const binds: any[] = [];
        const changed: Record<string, { old: any; new: any }> = {};
        if (person_type !== undefined) { updates.push('person_type = ?'); binds.push(person_type || null); changed.person_type = { old: client.person_type || null, new: person_type || null }; }
        if (export_status !== undefined) { updates.push('export_status = ?'); binds.push(export_status || null); changed.export_status = { old: client.export_status || null, new: export_status || null }; }
        if (name !== undefined) {
          const v = String(name).trim();
          if (!v) return json({ error: 'Nom requis' }, 400);
          updates.push('name = ?'); binds.push(v); changed.name = { old: client.name, new: v };
        }
        if (matricule_fiscal !== undefined) { updates.push('matricule_fiscal = ?'); binds.push(matricule_fiscal || null); changed.matricule_fiscal = { old: client.matricule_fiscal || null, new: matricule_fiscal || null }; }
        if (contact_email !== undefined) {
          const v = contact_email ? String(contact_email).trim() : null;
          if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return json({ error: 'Email invalide' }, 400);
          updates.push('contact_email = ?'); binds.push(v); changed.contact_email = { old: client.contact_email || null, new: v };
        }
        if (contact_phone !== undefined) { updates.push('contact_phone = ?'); binds.push(contact_phone || null); changed.contact_phone = { old: client.contact_phone || null, new: contact_phone || null }; }
        if (updates.length === 0) return json({ error: 'Rien à modifier' }, 400);
        await env.DB.prepare(`UPDATE org_clients SET ${updates.join(', ')} WHERE id = ?`).bind(...binds, orgClientMatch[1]).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'client_updated', 'client', orgClientMatch[1], JSON.stringify(changed)).run();
        const after = await env.DB.prepare('SELECT name, matricule_fiscal, contact_email, contact_phone, person_type, export_status FROM org_clients WHERE id = ?').bind(orgClientMatch[1]).first() as any;
        return json({ ok: true, ...after });
      }

      // --- ORG: DELETE CLIENT (expert + manager) ---
      if (orgClientMatch && method === 'DELETE') {
        const user = await verifyOrgToken(request);
        if (!user || !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        const client = await env.DB.prepare('SELECT * FROM org_clients WHERE id = ? AND organization_id = ?').bind(orgClientMatch[1], user.organization_id).first() as any;
        if (!client) return json({ error: 'Client non trouvé' }, 404);
        const delId = orgClientMatch[1];
        // Cascade : documents -> alertes -> notes -> grants -> temps -> taches -> dossiers -> client
        await env.DB.prepare('DELETE FROM org_expected_documents WHERE dossier_id IN (SELECT id FROM org_dossiers WHERE client_id = ?)').bind(delId).run();
        await env.DB.prepare('DELETE FROM org_alert_dones WHERE alert_id IN (SELECT id FROM org_fiscal_alerts WHERE dossier_id IN (SELECT id FROM org_dossiers WHERE client_id = ?))').bind(delId).run();
        await env.DB.prepare('DELETE FROM org_fiscal_alerts WHERE dossier_id IN (SELECT id FROM org_dossiers WHERE client_id = ?)').bind(delId).run();
        await env.DB.prepare('DELETE FROM org_notes WHERE dossier_id IN (SELECT id FROM org_dossiers WHERE client_id = ?)').bind(delId).run();
        await env.DB.prepare('DELETE FROM org_dossier_grants WHERE dossier_id IN (SELECT id FROM org_dossiers WHERE client_id = ?)').bind(delId).run();
        await env.DB.prepare('DELETE FROM org_time_entries WHERE dossier_id IN (SELECT id FROM org_dossiers WHERE client_id = ?)').bind(delId).run();
        await env.DB.prepare('DELETE FROM org_task_collaborators WHERE task_id IN (SELECT id FROM org_tasks WHERE dossier_id IN (SELECT id FROM org_dossiers WHERE client_id = ?))').bind(delId).run();
        await env.DB.prepare('DELETE FROM org_tasks WHERE dossier_id IN (SELECT id FROM org_dossiers WHERE client_id = ?)').bind(delId).run();
        await env.DB.prepare('DELETE FROM org_audit_log WHERE target_id = ? OR target_id IN (SELECT id FROM org_dossiers WHERE client_id = ?)').bind(delId, delId).run();
        await env.DB.prepare('DELETE FROM org_dossiers WHERE client_id = ?').bind(delId).run();
        await env.DB.prepare('DELETE FROM org_clients WHERE id = ?').bind(delId).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'client_deleted', 'client', delId, JSON.stringify({ name: client.name })).run();
        return json({ ok: true, deleted: client.name });
      }

      const orgClientReassignMatch = path.match(/^\/api\/org\/clients\/([^/]+)\/reassign$/);
      if (orgClientReassignMatch && method === 'PATCH') {
        const user = await verifyOrgToken(request);
        if (!user || !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        const { assigned_comptable_id } = await request.json() as any;
        if (!assigned_comptable_id) return json({ error: 'assigned_comptable_id requis' }, 400);
        const client = await env.DB.prepare('SELECT * FROM org_clients WHERE id = ? AND organization_id = ?').bind(orgClientReassignMatch[1], user.organization_id).first() as any;
        if (!client) return json({ error: 'Client non trouvé' }, 404);
        await env.DB.prepare('UPDATE org_clients SET assigned_comptable_id = ? WHERE id = ?').bind(assigned_comptable_id, orgClientReassignMatch[1]).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, \'client_reassigned\', \'client\', ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, orgClientReassignMatch[1], JSON.stringify({ old: client.assigned_comptable_id, new: assigned_comptable_id })).run();
        return json({ ok: true });
      }

      const orgClientDossiersMatch = path.match(/^\/api\/org\/clients\/([^/]+)\/dossiers$/);
      if (orgClientDossiersMatch && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessClient(user, orgClientDossiersMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const { results } = await env.DB.prepare('SELECT * FROM org_dossiers WHERE client_id = ? ORDER BY exercice DESC').bind(orgClientDossiersMatch[1]).all();
        const enriched = await Promise.all(results.map(async (d: any) => {
          const { results: tasks } = await env.DB.prepare('SELECT t.status, t.export_scope, c.export_status FROM org_tasks t JOIN org_dossiers d2 ON t.dossier_id = d2.id JOIN org_clients c ON d2.client_id = c.id WHERE t.dossier_id = ? AND t.hidden = 0').bind(d.id).all();
          const s = { total: 0, fait: 0, en_cours: 0, bloque_client: 0 };
          for (const t of tasks as any[]) {
            if (!exportScopeKeeps(t.export_scope, t.export_status)) continue;
            s.total++; if (t.status === 'fait') s.fait++; else if (t.status === 'en_cours' || t.status === 'a_faire' || t.status === 'a_verifier') s.en_cours++; else if (t.status === 'bloque_client') s.bloque_client++;
          }
          return { ...d, task_stats: s, progress: s.total > 0 ? Math.round(s.fait / s.total * 1000) / 10 : 0 };
        }));
        return json(enriched);
      }

      if (orgClientDossiersMatch && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!isSupervisor(user.role)) return json({ error: 'La création de dossiers est réservée à l\'expert' }, 403);
        if (!await orgCanAccessClient(user, orgClientDossiersMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const { exercice, assigned_comptable_id } = await request.json() as any;
        if (!exercice) return json({ error: 'Exercice requis' }, 400);
        // Comptable : choisi à la création (affecte le client) ou hérité du client
        let compId: string | null = assigned_comptable_id || null;
        if (compId) {
          const comp = await env.DB.prepare("SELECT id FROM org_users WHERE id = ? AND organization_id = ? AND role = 'comptable' AND is_active = 1").bind(compId, user.organization_id).first();
          if (!comp) return json({ error: 'Comptable introuvable' }, 400);
          await env.DB.prepare('UPDATE org_clients SET assigned_comptable_id = ? WHERE id = ?').bind(compId, orgClientDossiersMatch[1]).run();
        } else {
          const client = await env.DB.prepare('SELECT assigned_comptable_id FROM org_clients WHERE id = ?').bind(orgClientDossiersMatch[1]).first() as any;
          compId = client?.assigned_comptable_id || null;
        }
        if (!compId) return json({ error: 'Comptable requis : assignez un comptable à ce dossier' }, 400);
        const existing = await env.DB.prepare('SELECT id FROM org_dossiers WHERE client_id = ? AND exercice = ?').bind(orgClientDossiersMatch[1], exercice).first();
        if (existing) return json({ error: 'Un dossier existe déjà pour cet exercice' }, 409);
        const prev = await env.DB.prepare('SELECT * FROM org_dossiers WHERE client_id = ? ORDER BY exercice DESC LIMIT 1').bind(orgClientDossiersMatch[1]).first() as any;
        if (prev && prev.status !== 'cloture') return json({ error: 'Le dossier précédent doit être clôturé' }, 400);
        const dossierId = await createDossierWithTasks(env, {
          orgId: user.organization_id,
          clientId: orgClientDossiersMatch[1],
          exercice: Number(exercice),
          compId: compId as string,
          actorId: user.id,
          actorName: user.full_name,
        });
        return json({ id: dossierId, exercice, status: 'en_cours' }, 201);
      }

      // --- ORG: DOSSIER DETAIL ---
      const orgDossierGetMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)$/);
      if (orgDossierGetMatch && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgDossierGetMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const dossier = await env.DB.prepare('SELECT d.*, c.name as client_name, c.matricule_fiscal, c.id as client_id, c.person_type, c.export_status, c.assigned_comptable_id as client_comptable_id FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE d.id = ?').bind(orgDossierGetMatch[1]).first() as any;
        if (!dossier) return json({ error: 'Dossier non trouvé' }, 404);
        const { results: rawTasks } = await env.DB.prepare('SELECT t.*, u.full_name as updated_by_name, vu.full_name as verified_by_name, COALESCE(vu.role_label, vu.role) as verified_by_role, au.full_name as assigned_comptable_name, du.full_name as done_by_name FROM org_tasks t LEFT JOIN org_users u ON t.updated_by = u.id LEFT JOIN org_users vu ON t.verified_by = vu.id LEFT JOIN org_users au ON t.assigned_comptable_id = au.id LEFT JOIN org_users du ON t.done_by = du.id WHERE t.dossier_id = ? AND t.hidden = 0 ORDER BY t.month IS NULL, t.month, t.order_index').bind(orgDossierGetMatch[1]).all();
        // Filtre export : les tâches à portée hors statut du client n'apparaissent pas
        const tasks = (rawTasks as any[]).filter(t => exportScopeKeeps(t.export_scope, dossier.export_status));
        // Tâche optionnelle « Reporting mensuel » : état masqué/restaurable de ce dossier
        const reportingRow = await env.DB.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN hidden = 1 THEN 1 ELSE 0 END) as hidden FROM org_tasks WHERE dossier_id = ? AND label = 'Reporting mensuel'").bind(orgDossierGetMatch[1]).first() as any;
        const reporting = { total: reportingRow?.total || 0, hidden: reportingRow?.hidden || 0 };
        const { results: documents } = await env.DB.prepare('SELECT * FROM org_expected_documents WHERE dossier_id = ? ORDER BY label').bind(orgDossierGetMatch[1]).all();
        const { results: notes } = await env.DB.prepare('SELECT n.*, u.full_name as author_name FROM org_notes n LEFT JOIN org_users u ON n.user_id = u.id WHERE n.dossier_id = ? ORDER BY n.created_at DESC').bind(orgDossierGetMatch[1]).all();
        // Time entries breakdown
        const { results: timeEntries } = await env.DB.prepare('SELECT te.*, t.label as task_label, u.full_name as user_name FROM org_time_entries te JOIN org_tasks t ON te.task_id = t.id JOIN org_users u ON te.user_id = u.id WHERE te.dossier_id = ? ORDER BY te.started_at DESC').bind(orgDossierGetMatch[1]).all();
        const timeByUser: Record<string, { user_name: string; seconds: number }> = {};
        for (const te of timeEntries as any[]) {
          if (!timeByUser[te.user_id]) timeByUser[te.user_id] = { user_name: te.user_name, seconds: 0 };
          timeByUser[te.user_id].seconds += te.duration_seconds || 0;
        }
        const stats = { total: tasks.length, fait: 0, en_cours: 0, bloque_client: 0 };
        for (const t of tasks as any[]) { if (t.status === 'fait') stats.fait++; else if (t.status === 'en_cours' || t.status === 'a_faire' || t.status === 'a_verifier') stats.en_cours++; else if (t.status === 'bloque_client') stats.bloque_client++; }
        const docStats = { total: documents.length, received: documents.filter((d: any) => d.received).length };
        const canClose = stats.bloque_client === 0 && stats.en_cours === 0;
        const blockReasons = (tasks as any[]).filter(t => t.status !== 'fait').map(t => t.label);
        // Renfort : grants actifs de ce dossier + flag pour le comptable concerne
        const { results: grantRows } = await env.DB.prepare(`SELECT g.*, u.full_name as granted_to_name FROM org_dossier_grants g LEFT JOIN org_users u ON g.granted_to = u.id WHERE g.dossier_id = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > datetime('now')) ORDER BY g.created_at DESC`).bind(orgDossierGetMatch[1]).all();
        const grants = grantRows as any[];
        const isGranted = !isSupervisor(user.role) && grants.some(g => g.granted_to === user.id);
        // Collaborateurs taguees sur les taches (partage inter-comptables)
        const { results: collabRows } = await env.DB.prepare('SELECT tc.task_id, tc.user_id, u.full_name FROM org_task_collaborators tc JOIN org_users u ON u.id = tc.user_id WHERE tc.task_id IN (SELECT id FROM org_tasks WHERE dossier_id = ?)').bind(orgDossierGetMatch[1]).all();
        const collabByTask: Record<string, any[]> = {};
        for (const c of collabRows as any[]) {
          if (!collabByTask[c.task_id]) collabByTask[c.task_id] = [];
          collabByTask[c.task_id].push({ user_id: c.user_id, full_name: c.full_name });
        }
        for (const t of tasks as any[]) t.collaborators = collabByTask[t.id] || [];
        // Chronos actifs de ce dossier : 1 par comptable, plusieurs en parallele sur la meme tache
        const { results: runningRows } = await env.DB.prepare('SELECT te.task_id, te.user_id, te.started_at, u.full_name as user_name FROM org_time_entries te JOIN org_users u ON u.id = te.user_id WHERE te.dossier_id = ? AND te.stopped_at IS NULL ORDER BY te.started_at').bind(orgDossierGetMatch[1]).all();
        return json({ ...dossier, tasks, documents, notes, time_entries: timeEntries, time_by_user: Object.values(timeByUser), task_stats: stats, doc_stats: docStats, can_close: canClose, can_force_close: isSupervisor(user.role), block_reasons: blockReasons, progress: stats.total > 0 ? Math.round(stats.fait / stats.total * 1000) / 10 : 0, is_granted: isGranted, grants: isSupervisor(user.role) ? grants : [], running_timers: runningRows, reporting });
      }

      // --- ORG: MASQUER / RESTAURER la tache optionnelle « Reporting mensuel » ---
      const orgReportingMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/reporting\/(hide|restore)$/);
      if (orgReportingMatch && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgReportingMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const dossierId = orgReportingMatch[1];
        const mode = orgReportingMatch[2];
        const LABEL = 'Reporting mensuel';
        const dRow = await env.DB.prepare('SELECT d.id, c.organization_id FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE d.id = ?').bind(dossierId).first() as any;
        if (!dRow) return json({ error: 'Dossier non trouvé' }, 404);
        let changes = 0, created = 0;
        if (mode === 'hide') {
          // Masquage : statuts + heures conservés, simplement exclus des compteurs
          const r = await env.DB.prepare('UPDATE org_tasks SET hidden = 1 WHERE dossier_id = ? AND label = ? AND hidden = 0').bind(dossierId, LABEL).run();
          changes = (r as any)?.meta?.changes || 0;
        } else {
          const r = await env.DB.prepare('UPDATE org_tasks SET hidden = 0 WHERE dossier_id = ? AND label = ? AND hidden = 1').bind(dossierId, LABEL).run();
          changes = (r as any)?.meta?.changes || 0;
          const { results: still } = await env.DB.prepare('SELECT 1 AS x FROM org_tasks WHERE dossier_id = ? AND label = ? LIMIT 1').bind(dossierId, LABEL).all();
          if (!still.length) {
            // Tâche totalement absente du dossier : on la (re)crée depuis le modèle, sur les 12 mois
            const tmpl = await env.DB.prepare('SELECT * FROM org_task_templates WHERE organization_id = ? AND label = ? ORDER BY order_index LIMIT 1').bind(dRow.organization_id, LABEL).first() as any;
            const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(order_index), 0) + 1 as mx FROM org_tasks WHERE dossier_id = ?').bind(dossierId).first() as any;
            const orderIdx = tmpl?.order_index || maxRow?.mx || 1;
            for (let m = 1; m <= 12; m++) {
              await env.DB.prepare('INSERT INTO org_tasks (id, dossier_id, label, status, order_index, month, export_scope, hidden, created_at) VALUES (?, ?, ?, \'a_faire\', ?, ?, ?, 0, datetime(\'now\'))').bind(genId(), dossierId, LABEL, orderIdx, m, tmpl?.export_scope || null).run();
              created++;
            }
            changes = created;
          }
        }
        await orgRecalcProgress(env.DB, dossierId);
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), dRow.organization_id, user.id, user.full_name, mode === 'hide' ? 'task_hidden' : 'task_restored', 'dossier', dossierId, JSON.stringify({ label: LABEL, count: changes, created })).run();
        const reporting2 = await env.DB.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN hidden = 1 THEN 1 ELSE 0 END) as hidden FROM org_tasks WHERE dossier_id = ? AND label = 'Reporting mensuel'").bind(dossierId).first() as any;
        return json({ ok: true, mode, count: changes, created, reporting: { total: reporting2?.total || 0, hidden: reporting2?.hidden || 0 } });
      }

      // --- ORG: RENFORT — ouvrir un acces temporaire a un dossier (expert/manager) ---
      const orgGrantsMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/grants$/);
      if (orgGrantsMatch && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!isSupervisor(user.role)) return json({ error: 'Seul un expert/manager peut ouvrir un renfort' }, 403);
        const dossierId = orgGrantsMatch[1];
        const dossier = await env.DB.prepare('SELECT d.id FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE d.id = ? AND c.organization_id = ?').bind(dossierId, user.organization_id).first();
        if (!dossier) return json({ error: 'Dossier non trouvé' }, 404);
        const { granted_to, days, reason } = await request.json() as any;
        const grantDays = days === undefined || days === null ? 7 : Number(days);
        if (![1, 7, 30].includes(grantDays)) return json({ error: 'Durée invalide (1, 7 ou 30 jours)' }, 400);
        if (!reason || !String(reason).trim()) return json({ error: 'Motif du renfort requis' }, 400);
        if (!granted_to) return json({ error: 'granted_to requis' }, 400);
        const target = await env.DB.prepare('SELECT id, full_name FROM org_users WHERE id = ? AND organization_id = ? AND role = ? AND is_active = 1').bind(granted_to, user.organization_id, 'comptable').first() as any;
        if (!target) return json({ error: 'Comptable introuvable' }, 400);
        const dup = await env.DB.prepare(`SELECT 1 AS x FROM org_dossier_grants WHERE dossier_id = ? AND granted_to = ? AND ${ORG_GRANT_ACTIVE}`).bind(dossierId, granted_to).first();
        if (dup) return json({ error: 'Accès déjà ouvert pour ce comptable' }, 400);
        const id = genId();
        await env.DB.prepare(`INSERT INTO org_dossier_grants (id, dossier_id, granted_to, granted_by, reason, days, expires_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`).bind(id, dossierId, granted_to, user.id, String(reason).trim(), grantDays, `+${grantDays} days`).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'grant_created', 'dossier', dossierId, JSON.stringify({ granted_to, granted_to_name: target.full_name, days: grantDays, reason: String(reason).trim() })).run();
        return json({ id, dossier_id: dossierId, granted_to, granted_to_name: target.full_name, days: grantDays, reason: String(reason).trim() }, 201);
      }
      if (orgGrantsMatch && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!isSupervisor(user.role)) return json({ error: 'Réservé à l\'expert/manager' }, 403);
        const { results } = await env.DB.prepare(`SELECT g.*, u.full_name as granted_to_name, ub.full_name as granted_by_name FROM org_dossier_grants g LEFT JOIN org_users u ON g.granted_to = u.id LEFT JOIN org_users ub ON g.granted_by = ub.id WHERE g.dossier_id = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > datetime('now')) ORDER BY g.created_at DESC`).bind(orgGrantsMatch[1]).all();
        return json(results);
      }

      // --- ORG: RENFORT — revoquer un acces ---
      const orgGrantRevokeMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/grants\/([^/]+)$/);
      if (orgGrantRevokeMatch && method === 'DELETE') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!isSupervisor(user.role)) return json({ error: 'Réservé à l\'expert/manager' }, 403);
        const g = await env.DB.prepare(`SELECT * FROM org_dossier_grants WHERE id = ? AND dossier_id = ? AND ${ORG_GRANT_ACTIVE}`).bind(orgGrantRevokeMatch[2], orgGrantRevokeMatch[1]).first() as any;
        if (!g) return json({ error: 'Grant introuvable ou déjà expiré' }, 404);
        await env.DB.prepare("UPDATE org_dossier_grants SET revoked_at = datetime('now') WHERE id = ?").bind(g.id).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'grant_revoked', 'dossier', g.dossier_id, JSON.stringify({ grant_id: g.id, granted_to: g.granted_to, reason: g.reason })).run();
        return json({ ok: true });
      }

      // --- ORG: RENFORT — mes dossiers en renfort (comptable) ---
      if (path === '/api/org/grants/mine' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const { results } = await env.DB.prepare(`SELECT g.id, g.dossier_id, g.reason, g.days, g.expires_at, g.created_at, d.exercice, d.status, c.name as client_name, ub.full_name as granted_by_name FROM org_dossier_grants g JOIN org_dossiers d ON g.dossier_id = d.id JOIN org_clients c ON d.client_id = c.id LEFT JOIN org_users ub ON g.granted_by = ub.id WHERE g.granted_to = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > datetime('now')) ORDER BY g.created_at DESC`).bind(user.id).all();
        return json(results);
      }

      // --- ORG: COLLABORATEURS — comptables taguables sur une tache ---
      const orgCollabEligibleMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/collaborators\/eligible$/);
      if (orgCollabEligibleMatch && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const dossierId = orgCollabEligibleMatch[1];
        if (!await orgCanAccessDossier(user, dossierId)) return json({ error: 'Accès refusé' }, 403);
        const dossier = await env.DB.prepare('SELECT d.id, c.assigned_comptable_id FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE d.id = ? AND c.organization_id = ?').bind(dossierId, user.organization_id).first() as any;
        if (!dossier) return json({ error: 'Dossier non trouvé' }, 404);
        const { results: comps } = await env.DB.prepare("SELECT id, full_name FROM org_users WHERE organization_id = ? AND role = 'comptable' AND is_active = 1 AND id != ? ORDER BY full_name").bind(user.organization_id, user.id).all();
        const { results: gr } = await env.DB.prepare(`SELECT granted_to FROM org_dossier_grants WHERE dossier_id = ? AND ${ORG_GRANT_ACTIVE}`).bind(dossierId).all();
        const granted = new Set((gr as any[]).map((r: any) => r.granted_to));
        return json((comps as any[]).map(c => ({ id: c.id, full_name: c.full_name, has_access: c.id === dossier.assigned_comptable_id || granted.has(c.id) })));
      }

      // --- ORG: COLLABORATEUR — taguer un comptable sur une tache (acces auto au dossier) ---
      const orgCollabAddMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/tasks\/([^/]+)\/collaborators$/);
      if (orgCollabAddMatch && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const [dossierId, taskId] = [orgCollabAddMatch[1], orgCollabAddMatch[2]];
        if (!await orgCanAccessDossier(user, dossierId)) return json({ error: 'Accès refusé' }, 403);
        const dossier = await env.DB.prepare('SELECT d.id, c.assigned_comptable_id FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE d.id = ? AND c.organization_id = ?').bind(dossierId, user.organization_id).first() as any;
        if (!dossier) return json({ error: 'Dossier non trouvé' }, 404);
        const task = await env.DB.prepare('SELECT id, label FROM org_tasks WHERE id = ? AND dossier_id = ?').bind(taskId, dossierId).first() as any;
        if (!task) return json({ error: 'Tâche non trouvée' }, 404);
        const body = await request.json() as any;
        const targetId = body?.user_id;
        const grantDays = body?.days === undefined || body?.days === null ? 7 : Number(body.days);
        if (!targetId) return json({ error: 'Comptable requis' }, 400);
        if (targetId === user.id) return json({ error: 'Vous êtes déjà sur cette tâche' }, 400);
        if (![1, 7, 30].includes(grantDays)) return json({ error: 'Durée invalide (1, 7 ou 30 jours)' }, 400);
        const target = await env.DB.prepare("SELECT id, full_name FROM org_users WHERE id = ? AND organization_id = ? AND role = 'comptable' AND is_active = 1").bind(targetId, user.organization_id).first() as any;
        if (!target) return json({ error: 'Comptable introuvable' }, 400);
        const dup = await env.DB.prepare('SELECT 1 AS x FROM org_task_collaborators WHERE task_id = ? AND user_id = ?').bind(taskId, targetId).first();
        if (dup) return json({ error: 'Déjà collaborateur sur cette tâche' }, 400);
        // Acces au dossier : assigne OU renfort deja actif ? sinon ouverture auto du renfort
        const { results: gr } = await env.DB.prepare(`SELECT id, expires_at FROM org_dossier_grants WHERE dossier_id = ? AND granted_to = ? AND ${ORG_GRANT_ACTIVE}`).bind(dossierId, targetId).all();
        const alreadyGranted = (gr as any[]).length > 0;
        const isAssigned = targetId === dossier.assigned_comptable_id;
        let grantCreated = false;
        let expiresAt: string | null = alreadyGranted ? (gr as any[])[0].expires_at || null : null;
        if (!isAssigned && !alreadyGranted) {
          const gid = genId();
          const reason = `Collaboration : ${String(task.label).slice(0, 150)}`;
          await env.DB.prepare(`INSERT INTO org_dossier_grants (id, dossier_id, granted_to, granted_by, reason, days, expires_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`).bind(gid, dossierId, targetId, user.id, reason, grantDays, `+${grantDays} days`).run();
          expiresAt = ((await env.DB.prepare('SELECT expires_at FROM org_dossier_grants WHERE id = ?').bind(gid).first()) as any)?.expires_at || null;
          grantCreated = true;
          await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'grant_created', 'dossier', dossierId, JSON.stringify({ granted_to: targetId, granted_to_name: target.full_name, days: grantDays, reason, source: 'task_collab' })).run();
        }
        await env.DB.prepare('INSERT INTO org_task_collaborators (task_id, user_id, added_by) VALUES (?, ?, ?)').bind(taskId, targetId, user.id).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'task_collab_added', 'task', taskId, JSON.stringify({ dossier_id: dossierId, user_id: targetId, user_name: target.full_name, grant_created: grantCreated, expires_at: expiresAt })).run();
        return json({ ok: true, collaborator: { user_id: targetId, full_name: target.full_name }, grant_created: grantCreated, expires_at: expiresAt }, 201);
      }

      // --- ORG: COLLABORATEUR — retirer le tag (et l'acces auto s'il n'en reste aucun) ---
      const orgCollabDelMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/tasks\/([^/]+)\/collaborators\/([^/]+)$/);
      if (orgCollabDelMatch && method === 'DELETE') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const [dossierId, taskId, targetId] = [orgCollabDelMatch[1], orgCollabDelMatch[2], orgCollabDelMatch[3]];
        if (!await orgCanAccessDossier(user, dossierId)) return json({ error: 'Accès refusé' }, 403);
        const row = await env.DB.prepare('SELECT 1 AS x FROM org_task_collaborators WHERE task_id = ? AND user_id = ? AND task_id IN (SELECT id FROM org_tasks WHERE dossier_id = ?)').bind(taskId, targetId, dossierId).first();
        if (!row) return json({ error: 'Collaborateur introuvable' }, 404);
        await env.DB.prepare('DELETE FROM org_task_collaborators WHERE task_id = ? AND user_id = ?').bind(taskId, targetId).run();
        // Plus aucun tag dans ce dossier ? On retire aussi l'acces auto ouvert par le tag
        let grantRevoked = false;
        const { results: others } = await env.DB.prepare('SELECT tc.task_id FROM org_task_collaborators tc JOIN org_tasks t ON t.id = tc.task_id WHERE tc.user_id = ? AND t.dossier_id = ?').bind(targetId, dossierId).all();
        if ((others as any[]).length === 0) {
          const g = await env.DB.prepare(`SELECT id FROM org_dossier_grants WHERE dossier_id = ? AND granted_to = ? AND granted_by = ? AND reason LIKE 'Collaboration%' AND ${ORG_GRANT_ACTIVE}`).bind(dossierId, targetId, user.id).first() as any;
          if (g) {
            await env.DB.prepare("UPDATE org_dossier_grants SET revoked_at = datetime('now') WHERE id = ?").bind(g.id).run();
            grantRevoked = true;
            await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'grant_revoked', 'dossier', dossierId, JSON.stringify({ grant_id: g.id, granted_to: targetId, source: 'task_collab_removed' })).run();
            // L'acces disparaissant : on arrete ses chronos actifs sur ce dossier (sinon entree orpheline)
            const { results: runnings } = await env.DB.prepare('SELECT id, task_id, started_at FROM org_time_entries WHERE dossier_id = ? AND user_id = ? AND stopped_at IS NULL').bind(dossierId, targetId).all();
            for (const rt of runnings as any[]) {
              const elapsed = Math.floor((Date.now() - new Date(rt.started_at + 'Z').getTime()) / 1000);
              await env.DB.prepare("UPDATE org_time_entries SET stopped_at = datetime('now'), duration_seconds = ? WHERE id = ?").bind(elapsed, rt.id).run();
              await env.DB.prepare("UPDATE org_tasks SET total_time_seconds = COALESCE(total_time_seconds, 0) + ? WHERE id = ?").bind(elapsed, rt.task_id).run();
              const still = await env.DB.prepare('SELECT 1 AS x FROM org_time_entries WHERE task_id = ? AND stopped_at IS NULL').bind(rt.task_id).first();
              if (!still) {
                await env.DB.prepare("UPDATE org_tasks SET timer_started_at = NULL, timer_user_id = NULL WHERE id = ?").bind(rt.task_id).run();
              } else {
                const nxt = await env.DB.prepare('SELECT user_id, started_at FROM org_time_entries WHERE task_id = ? AND stopped_at IS NULL ORDER BY started_at, id LIMIT 1').bind(rt.task_id).first() as any;
                if (nxt) await env.DB.prepare("UPDATE org_tasks SET timer_started_at = ?, timer_user_id = ? WHERE id = ?").bind(nxt.started_at, nxt.user_id, rt.task_id).run();
              }
            }
          }
        }
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'task_collab_removed', 'task', taskId, JSON.stringify({ dossier_id: dossierId, user_id: targetId, grant_revoked: grantRevoked })).run();
        return json({ ok: true, grant_revoked: grantRevoked });
      }

      // --- ORG: MES HEURES — vues days (7j) / month / year : realise vs norme 8h30 lun-ven ---
      if (path === '/api/org/me/hours' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const params = new URL(request.url).searchParams;
        const view = params.get('view') || 'days';
        const exParam = params.get('exercice');
        return json(await buildHoursPayload(env, user.id, view, exParam ? Number(exParam) : null));
      }

      // --- ORG: EXPORT DES HEURES (CSV « ; » + BOM, lisible par Excel FR) ---
      if (path === '/api/org/hours/export' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const sp = new URL(request.url).searchParams;
        const sup = isSupervisor(user.role);
        const yearF = sp.get('year') ? Number(sp.get('year')) : null;
        const monthF = sp.get('month') ? Number(sp.get('month')) : null;
        const exF = sp.get('exercice') ? Number(sp.get('exercice')) : null;
        const dossierF = sp.get('dossier_id');
        // Portee : expert/manager = tout le cabinet (ou un comptable via user_id) ; comptable = ses heures
        const targetUser = sup ? (sp.get('user_id') || null) : user.id;
        const binds: any[] = [user.organization_id];
        let where = 'WHERE c.organization_id = ? AND te.stopped_at IS NOT NULL';
        if (targetUser) { where += ' AND te.user_id = ?'; binds.push(targetUser); }
        if (dossierF) { where += ' AND te.dossier_id = ?'; binds.push(dossierF); }
        if (yearF) { where += " AND strftime('%Y', datetime(te.started_at, '+60 minutes')) = ?"; binds.push(String(yearF)); }
        if (monthF) { where += " AND strftime('%m', datetime(te.started_at, '+60 minutes')) = ?"; binds.push(String(monthF).padStart(2, '0')); }
        if (exF) { where += ' AND d.exercice = ?'; binds.push(exF); }
        const { results } = await env.DB.prepare(
          `SELECT te.started_at, te.stopped_at, te.duration_seconds, te.note, COALESCE(u.full_name, te.user_id) as user_name,
                  t.label as task_label, d.exercice, c.name as client_name, te.dossier_id
           FROM org_time_entries te
           JOIN org_dossiers d ON d.id = te.dossier_id
           JOIN org_clients c ON c.id = d.client_id
           LEFT JOIN org_users u ON u.id = te.user_id
           LEFT JOIN org_tasks t ON t.id = te.task_id
           ${where}
           ORDER BY te.started_at ASC
           LIMIT 10000`
        ).bind(...binds).all();
        const rows = results as any[];
        const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const pad2 = (n: number) => String(n).padStart(2, '0');
        // started_at/stopped_at sont en UTC : on convertit en heure Tunisie (UTC+1)
        const local = (s: any) => {
          if (!s) return '';
          const d = new Date(Date.parse(String(s).replace(' ', 'T') + 'Z') + 3600000);
          return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
        };
        const hm = (sec: number) => {
          const s = Math.max(0, Math.floor(sec || 0));
          return `${Math.floor(s / 3600)}h${pad2(Math.floor((s % 3600) / 60))}`;
        };
        const lines = [['date', 'debut', 'fin', 'duree', 'client', 'dossier', 'exercice', 'tache', 'collaborateur', 'note'].map(esc).join(';')];
        let totalSec = 0;
        for (const r of rows) {
          const secs = Number(r.duration_seconds) || 0;
          totalSec += secs;
          const deb = local(r.started_at);
          lines.push([deb.slice(0, 10), deb, local(r.stopped_at), hm(secs), r.client_name, r.dossier_id, r.exercice, r.task_label || '', r.user_name, r.note || ''].map(esc).join(';'));
        }
        lines.push(['', '', '', 'TOTAL', '', '', '', '', '', hm(totalSec)].map(esc).join(';'));
        const csv = '\uFEFF' + lines.join('\r\n');
        const fname = `heures_${exF || yearF || 'tout'}${monthF ? '-' + pad2(monthF) : ''}${targetUser ? '' : '_cabinet'}.csv`;
        return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fname}"`, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
      }

      // --- ORG: MES TACHES RECENTES (dashboard) — nouvelles tâches des dossiers accessibles ---
      if (path === '/api/org/me/tasks/recent' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const params = new URL(request.url).searchParams;
        const days = Math.max(1, Math.min(90, Number(params.get('days')) || 30));
        // ?exercice=YYYY : filtre cote SQL (avant le LIMIT, sinon la carte se vide)
        const exParam = params.get('exercice');
        const exSel = exParam ? Number(exParam) : null;
        const access = isSupervisor(user.role)
          ? 'c.organization_id = ?'
          : "(c.organization_id = ? AND (c.assigned_comptable_id = ? OR EXISTS (SELECT 1 FROM org_dossier_grants g WHERE g.dossier_id = d.id AND g.granted_to = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > datetime('now')))))";
        const binds: any[] = isSupervisor(user.role) ? [user.organization_id] : [user.organization_id, user.id, user.id];
        const { results } = await env.DB.prepare(`SELECT t.id, t.label, t.status, t.created_at, t.due_date, d.id as dossier_id, d.exercice, d.status as dossier_status, c.name as client_name FROM org_tasks t JOIN org_dossiers d ON t.dossier_id = d.id JOIN org_clients c ON d.client_id = c.id WHERE ${access} AND t.hidden = 0 AND t.created_by IS NOT NULL AND t.created_at >= datetime('now', '-' || ? || ' days') ${exSel ? 'AND d.exercice = ?' : ''} ORDER BY t.created_at DESC, t.id DESC LIMIT 10`).bind(...binds, days, ...(exSel ? [exSel] : [])).all();
        // J-x rapporté à la date en Tunisie (UTC+1)
        const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
        const tasks = (results as any[]).map(t => ({
          ...t,
          days_left: t.due_date ? Math.round((Date.parse(t.due_date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000) : null,
        }));
        return json({ tasks, days });
      }

      // --- ORG: TACHES EN ATTENTE DE VERIFICATION (expert/manager) ---
      if (path === '/api/org/tasks/verify' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert/manager' }, 403);
        const exParam = new URL(request.url).searchParams.get('exercice');
        const exSel = exParam ? Number(exParam) : null;
        const { results } = await env.DB.prepare(`SELECT t.id, t.label, t.status, t.verify_due_at, t.due_date, t.created_at, t.updated_at, t.dossier_id, d.exercice, c.name as client_name, t.done_by, du.full_name as done_by_name FROM org_tasks t JOIN org_dossiers d ON t.dossier_id = d.id JOIN org_clients c ON d.client_id = c.id LEFT JOIN org_users du ON t.done_by = du.id WHERE c.organization_id = ? AND t.status = 'a_verifier' AND t.hidden = 0${exSel ? ' AND d.exercice = ?' : ''} ORDER BY (t.verify_due_at IS NULL), t.verify_due_at ASC, t.updated_at DESC LIMIT 50`).bind(user.organization_id, ...(exSel ? [exSel] : [])).all();
        const tasks = (results as any[]).map(t => ({
          ...t,
          // heures restantes avant le delai de validation (negatif = delai depasse)
          verify_left_hours: t.verify_due_at ? Math.round(((Date.parse(String(t.verify_due_at).replace(' ', 'T') + 'Z') - Date.now()) / 3600000) * 10) / 10 : null,
        }));
        return json({ tasks });
      }

      // --- ORG: HEURES D'UN COMPTABLE (expert/manager) — fiche comptable, memes vues ---
      const orgCompHoursMatch = path.match(/^\/api\/org\/comptables\/([^/]+)\/hours$/);
      if (orgCompHoursMatch && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        const target = await env.DB.prepare('SELECT id FROM org_users WHERE id = ? AND organization_id = ?').bind(orgCompHoursMatch[1], user.organization_id).first();
        if (!target) return json({ error: 'Comptable introuvable' }, 404);
        const params = new URL(request.url).searchParams;
        const view = params.get('view') || 'days';
        const exParam = params.get('exercice');
        return json(await buildHoursPayload(env, target.id, view, exParam ? Number(exParam) : null));
      }

      // --- ORG: CLOSE DOSSIER ---
      const orgDossierCloseMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/close$/);
      if (orgDossierCloseMatch && method === 'PATCH') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgDossierCloseMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const dossier = await env.DB.prepare('SELECT * FROM org_dossiers WHERE id = ?').bind(orgDossierCloseMatch[1]).first() as any;
        if (!dossier) return json({ error: 'Dossier non trouvé' }, 404);
        if (dossier.status === 'cloture') return json({ error: 'Dossier déjà clôturé' }, 400);
        const { results: rawBlocked } = await env.DB.prepare('SELECT label, export_scope FROM org_tasks WHERE dossier_id = ? AND hidden = 0 AND status != \'fait\'').bind(orgDossierCloseMatch[1]).all();
        const clt = await env.DB.prepare('SELECT export_status FROM org_clients WHERE id = ?').bind(dossier.client_id).first() as any;
        const blockedTasks = (rawBlocked as any[]).filter(t => exportScopeKeeps(t.export_scope, clt?.export_status));
        const { force, justification } = await request.json() as any;
        if (blockedTasks.length > 0 && !force) return json({ error: `Clôture impossible — tâches restantes : ${blockedTasks.map((t: any) => t.label).join(', ')}` }, 400);
        if (blockedTasks.length > 0 && force && !isSupervisor(user.role)) return json({ error: 'Seul un expert peut forcer la clôture' }, 403);
        await env.DB.prepare("UPDATE org_dossiers SET status = 'cloture', closed_at = datetime('now'), closed_by = ? WHERE id = ?").bind(user.id, orgDossierCloseMatch[1]).run();
        const details: any = { forced: !!force };
        if (justification) details.justification = justification;
        if (blockedTasks.length > 0) details.blocked_tasks = blockedTasks.map((t: any) => t.label);
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, \'dossier_closed\', \'dossier\', ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, orgDossierCloseMatch[1], JSON.stringify(details)).run();
        return json({ ok: true });
      }

      // --- ORG: TIMER START ---
      const orgTimerStartMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/tasks\/([^/]+)\/timer\/start$/);
      if (orgTimerStartMatch && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgTimerStartMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const [dossierId, taskId] = [orgTimerStartMatch[1], orgTimerStartMatch[2]];
        // Check task exists
        const task = await env.DB.prepare('SELECT * FROM org_tasks WHERE id = ? AND dossier_id = ?').bind(taskId, dossierId).first() as any;
        if (!task) return json({ error: 'Tâche non trouvée' }, 404);
        // Chrono deja actif de CE comptable sur cette tache ? (le chrono est par comptable)
        const mineActive = await env.DB.prepare('SELECT 1 AS x FROM org_time_entries WHERE task_id = ? AND user_id = ? AND stopped_at IS NULL').bind(taskId, user.id).first();
        if (mineActive) return json({ error: 'Votre chrono est déjà en cours sur cette tâche', active: true }, 400);
        // Un seul chrono par comptable : on arrete les autres chronos de CE comptable
        const { results: activeTimers } = await env.DB.prepare('SELECT id, task_id, started_at FROM org_time_entries WHERE user_id = ? AND stopped_at IS NULL').bind(user.id).all();
        for (const at of activeTimers as any[]) {
          const elapsed = Math.floor((Date.now() - new Date(at.started_at + 'Z').getTime()) / 1000);
          await env.DB.prepare("UPDATE org_time_entries SET stopped_at = datetime('now'), duration_seconds = ? WHERE id = ?").bind(elapsed, at.id).run();
          await env.DB.prepare("UPDATE org_tasks SET total_time_seconds = COALESCE(total_time_seconds, 0) + ? WHERE id = ?").bind(elapsed, at.task_id).run();
          // Le timer de la tache ne se vide que si plus aucun chrono actif dessus
          const still = await env.DB.prepare('SELECT 1 AS x FROM org_time_entries WHERE task_id = ? AND stopped_at IS NULL').bind(at.task_id).first();
          if (!still) await env.DB.prepare("UPDATE org_tasks SET timer_started_at = NULL, timer_user_id = NULL WHERE id = ?").bind(at.task_id).run();
        }
        // Create time entry
        const entryId = genId();
        await env.DB.prepare("INSERT INTO org_time_entries (id, dossier_id, task_id, user_id, started_at) VALUES (?, ?, ?, ?, datetime('now'))").bind(entryId, dossierId, taskId, user.id).run();
        // Timer de la tache = 1er chrono actif : un autre comptable peut chronometrer en parallele
        const first = await env.DB.prepare('SELECT user_id, started_at FROM org_time_entries WHERE task_id = ? AND stopped_at IS NULL ORDER BY started_at, id LIMIT 1').bind(taskId).first() as any;
        await env.DB.prepare("UPDATE org_tasks SET timer_started_at = ?, timer_user_id = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").bind(first.started_at, first.user_id, user.id, taskId).run();
        // Audit log
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'timer_started', 'task', taskId, JSON.stringify({ dossier_id: dossierId })).run();
        return json({ ok: true, entry_id: entryId, started_at: new Date().toISOString() });
      }

      // --- ORG: TIMER STOP ---
      const orgTimerStopMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/tasks\/([^/]+)\/timer\/stop$/);
      if (orgTimerStopMatch && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgTimerStopMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const [dossierId, taskId] = [orgTimerStopMatch[1], orgTimerStopMatch[2]];
        const task = await env.DB.prepare('SELECT * FROM org_tasks WHERE id = ? AND dossier_id = ?').bind(taskId, dossierId).first() as any;
        if (!task) return json({ error: 'Tâche non trouvée' }, 404);
        // Le chrono est par comptable : on cherche celui de CE comptable
        const entry = await env.DB.prepare('SELECT * FROM org_time_entries WHERE task_id = ? AND user_id = ? AND stopped_at IS NULL ORDER BY started_at DESC LIMIT 1').bind(taskId, user.id).first() as any;
        if (!entry) return json({ error: 'Aucun chrono actif de votre côté' }, 400);
        const elapsed = Math.floor((Date.now() - new Date(entry.started_at + 'Z').getTime()) / 1000);
        // Stop entry
        await env.DB.prepare("UPDATE org_time_entries SET stopped_at = datetime('now'), duration_seconds = ? WHERE id = ?").bind(elapsed, entry.id).run();
        // Update task total
        const newTotal = (task.total_time_seconds || 0) + elapsed;
        // Un autre comptable chronometre encore ? le timer de la tache reste ouvert sur son chrono
        const remaining = await env.DB.prepare('SELECT user_id, started_at FROM org_time_entries WHERE task_id = ? AND stopped_at IS NULL ORDER BY started_at, id LIMIT 1').bind(taskId).first() as any;
        if (remaining) {
          await env.DB.prepare('UPDATE org_tasks SET total_time_seconds = ?, timer_started_at = ?, timer_user_id = ? WHERE id = ?').bind(newTotal, remaining.started_at, remaining.user_id, taskId).run();
        } else {
          await env.DB.prepare('UPDATE org_tasks SET total_time_seconds = ?, timer_started_at = NULL, timer_user_id = NULL WHERE id = ?').bind(newTotal, taskId).run();
        }
        // Audit log
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'timer_stopped', 'task', taskId, JSON.stringify({ dossier_id: dossierId, duration_seconds: elapsed, total_seconds: newTotal })).run();
        return json({ ok: true, duration_seconds: elapsed, total_seconds: newTotal });
      }

      // --- ORG: ADD TIME MANUELLEMENT ---
      const orgAddTimeMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/tasks\/([^/]+)\/time$/);
      if (orgAddTimeMatch && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgAddTimeMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const [dossierId, taskId] = [orgAddTimeMatch[1], orgAddTimeMatch[2]];
        const task = await env.DB.prepare('SELECT * FROM org_tasks WHERE id = ? AND dossier_id = ?').bind(taskId, dossierId).first() as any;
        if (!task) return json({ error: 'Tâche non trouvée' }, 404);
        // Le chrono est par comptable : seule la saisie pendant SON propre chrono est bloquee
        const myRunning = await env.DB.prepare('SELECT 1 AS x FROM org_time_entries WHERE task_id = ? AND user_id = ? AND stopped_at IS NULL').bind(taskId, user.id).first();
        if (myRunning) return json({ error: 'Arrêtez votre chrono d\'abord' }, 400);
        const { seconds, note } = await request.json() as any;
        const secs = Math.floor(Number(seconds));
        if (!Number.isFinite(secs) || secs <= 0) return json({ error: 'Durée invalide' }, 400);
        if (secs > 86400) return json({ error: 'Durée maximale : 24 h par saisie' }, 400);
        const noteTxt = note ? String(note).trim().slice(0, 500) : null;
        const newTotal = (task.total_time_seconds || 0) + secs;
        await env.DB.prepare("UPDATE org_tasks SET total_time_seconds = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").bind(newTotal, user.id, taskId).run();
        // Entrée de temps cohérente : time_by_user / time_by_dossier comptent aussi la saisie manuelle
        const entryId = genId();
        await env.DB.prepare("INSERT INTO org_time_entries (id, dossier_id, task_id, user_id, started_at, stopped_at, duration_seconds, note) VALUES (?, ?, ?, ?, datetime('now', ?), datetime('now'), ?, ?)").bind(entryId, dossierId, taskId, user.id, `-${secs} seconds`, secs, noteTxt).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'time_manual', 'task', taskId, JSON.stringify({ dossier_id: dossierId, duration_seconds: secs, total_seconds: newTotal, note: noteTxt })).run();
        return json({ ok: true, duration_seconds: secs, total_seconds: newTotal, note: noteTxt });
      }

      // --- ORG: GET TIMERS FOR DOSSIER ---
      const orgTimerListMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/timers$/);
      if (orgTimerListMatch && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgTimerListMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const { results: entries } = await env.DB.prepare('SELECT te.*, t.label as task_label, u.full_name as user_name FROM org_time_entries te JOIN org_tasks t ON te.task_id = t.id JOIN org_users u ON te.user_id = u.id WHERE te.dossier_id = ? ORDER BY te.started_at DESC').bind(orgTimerListMatch[1]).all();
        // Also get task timer states
        const { results: tasks } = await env.DB.prepare('SELECT id, total_time_seconds, timer_started_at, timer_user_id FROM org_tasks WHERE dossier_id = ?').bind(orgTimerListMatch[1]).all();
        return json({ entries, tasks });
      }

      // --- ORG: UPDATE TASK ---
      const orgTaskMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/tasks\/([^/]+)$/);
      if (orgTaskMatch && method === 'PATCH') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgTaskMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const body = await request.json() as any;
        const { status, blocked_reason, label, assigned_comptable_id, due_date, export_scope, verify_due_hours } = body;
        const task = await env.DB.prepare('SELECT * FROM org_tasks WHERE id = ? AND dossier_id = ?').bind(orgTaskMatch[2], orgTaskMatch[1]).first() as any;
        if (!task) return json({ error: 'Tâche non trouvée' }, 404);
        const updates: string[] = [];
        const binds: any[] = [];
        let effStatus: string | undefined;
        if (status !== undefined) {
          if (!['a_faire', 'en_cours', 'fait', 'a_verifier', 'bloque_client'].includes(status)) return json({ error: 'Status invalide' }, 400);
          // Un comptable qui marque "fait" envoie la tâche en vérification : seul un expert/manager la valide en "fait".
          effStatus = status === 'fait' && !isSupervisor(user.role) ? 'a_verifier' : status;
          updates.push('status = ?'); binds.push(effStatus);
          // Qui a travaille la tache : celui qui la passe en verification, ou l'expert/manager
          // qui la marque directement "fait" (un expert qui verifie une tache deja a_verifier
          // n'efface pas le travail du comptable)
          if (effStatus === 'a_verifier' || (effStatus === 'fait' && task.status !== 'a_verifier')) {
            updates.push('done_by = ?'); binds.push(user.id);
          }
          if (effStatus === 'fait') {
            updates.push('verified_by = ?', "verified_at = datetime('now')"); binds.push(user.id);
          } else if (task.status === 'fait') {
            updates.push('verified_by = NULL', 'verified_at = NULL');
          }
          // Delai de validation : 24h auto a l'entree en verification
          if (effStatus === 'a_verifier' && task.status !== 'a_verifier') {
            updates.push("verify_due_at = datetime('now','+24 hours')");
          }
        }
        // Delai pose/expert par l'expert ou le manager (en heures)
        if (verify_due_hours !== undefined) {
          if (!isSupervisor(user.role)) return json({ error: 'Seul un expert peut fixer le délai de validation' }, 403);
          const h = Number(verify_due_hours);
          if (!h || !isFinite(h) || h < 1 || h > 720) return json({ error: 'Délai invalide (1 à 720 heures)' }, 400);
          updates.push("verify_due_at = datetime('now', ?)"); binds.push(`+${Math.round(h)} hours`);
        }
        if (blocked_reason !== undefined) { updates.push('blocked_reason = ?'); binds.push(blocked_reason || null); }
        if (label !== undefined && label.trim()) { updates.push('label = ?'); binds.push(label.trim()); }
        if (due_date !== undefined) {
          const v = due_date === null ? '' : String(due_date).trim();
          if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v)))) return json({ error: 'Date butoir invalide (AAAA-MM-JJ)' }, 400);
          updates.push('due_date = ?'); binds.push(v || null);
        }
        if (assigned_comptable_id !== undefined) {
          if (!isSupervisor(user.role)) return json({ error: 'Seul un expert peut réassigner une tâche' }, 403);
          if (assigned_comptable_id !== null) {
            const comp = await env.DB.prepare('SELECT id FROM org_users WHERE id = ? AND organization_id = ? AND role = ?').bind(assigned_comptable_id, user.organization_id, 'comptable').first();
            if (!comp) return json({ error: 'Comptable introuvable' }, 400);
            if (!await orgCompCanAccessDossier(assigned_comptable_id, orgTaskMatch[1])) return json({ error: 'Ce comptable n\'a pas accès au dossier (assignez-le au client ou ouvrez un renfort)' }, 400);
          }
          updates.push('assigned_comptable_id = ?'); binds.push(assigned_comptable_id || null);
        }
        if (export_scope !== undefined) {
          if (export_scope !== null && !Array.isArray(export_scope)) return json({ error: 'Portée export invalide' }, 400);
          if (Array.isArray(export_scope) && export_scope.some((s: any) => !EXPORT_STATUSES.includes(s))) return json({ error: 'Portée export invalide' }, 400);
          updates.push('export_scope = ?'); binds.push(parseExportScope(export_scope));
        }
        if (updates.length === 0) return json({ error: 'Rien à modifier' }, 400);
        updates.push("updated_by = ?", "updated_at = datetime('now')");
        binds.push(user.id, orgTaskMatch[2]);
        await env.DB.prepare(`UPDATE org_tasks SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
        const progress = await orgRecalcProgress(env.DB, orgTaskMatch[1]);
        const oldStatus = task.status;
        const newStatus = effStatus || oldStatus;
        if (effStatus && effStatus !== oldStatus) {
          await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, \'task_status_changed\', \'task\', ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, orgTaskMatch[2], JSON.stringify({ old_status: oldStatus, new_status: effStatus, blocked_reason })).run();
          // Validation a_verifier -> fait : pointage automatique de la validation (5 min) + audit "qui a valide"
          if (effStatus === 'fait' && oldStatus === 'a_verifier') {
            await env.DB.prepare("INSERT INTO org_time_entries (id, dossier_id, task_id, user_id, started_at, stopped_at, duration_seconds) VALUES (?, ?, ?, ?, datetime('now','-300 seconds'), datetime('now'), 300)").bind(genId(), orgTaskMatch[1], orgTaskMatch[2], user.id).run();
            await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, \'task_verified\', \'task\', ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, orgTaskMatch[2], JSON.stringify({ label: task.label, verify_seconds: 300, verify_due_at: task.verify_due_at || null })).run();
          }
        }
        if (label !== undefined && label.trim() && label.trim() !== task.label) {
          await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'task_renamed', 'task', orgTaskMatch[2], JSON.stringify({ old_label: task.label, new_label: label.trim() })).run();
        }
        if (assigned_comptable_id !== undefined && (assigned_comptable_id || null) !== (task.assigned_comptable_id || null)) {
          await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'task_assigned', 'task', orgTaskMatch[2], JSON.stringify({ old: task.assigned_comptable_id || null, new: assigned_comptable_id || null })).run();
        }
        if (due_date !== undefined && (String(due_date || '').trim() || null) !== (task.due_date || null)) {
          await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'task_due_changed', 'task', orgTaskMatch[2], JSON.stringify({ old: task.due_date || null, new: String(due_date || '').trim() || null })).run();
        }
        return json({ ok: true, progress });
      }

      // --- ORG: DELETE TASK ---
      if (orgTaskMatch && method === 'DELETE') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgTaskMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const task = await env.DB.prepare('SELECT * FROM org_tasks WHERE id = ? AND dossier_id = ?').bind(orgTaskMatch[2], orgTaskMatch[1]).first() as any;
        if (!task) return json({ error: 'Tâche non trouvée' }, 404);
        if (task.timer_started_at) return json({ error: 'Arrêtez le chrono d\'abord' }, 400);
        // Delete time entries + tags de collaboration pour cette tache
        await env.DB.prepare('DELETE FROM org_time_entries WHERE task_id = ?').bind(orgTaskMatch[2]).run();
        await env.DB.prepare('DELETE FROM org_task_collaborators WHERE task_id = ?').bind(orgTaskMatch[2]).run();
        // Delete task
        await env.DB.prepare('DELETE FROM org_tasks WHERE id = ?').bind(orgTaskMatch[2]).run();
        const progress = await orgRecalcProgress(env.DB, orgTaskMatch[1]);
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'task_deleted', 'task', orgTaskMatch[2], JSON.stringify({ label: task.label, dossier_id: orgTaskMatch[1] })).run();
        return json({ ok: true, progress });
      }

      // --- ORG: ADD TASK ---
      if (path.match(/^\/api\/org\/dossiers\/([^/]+)\/tasks$/) && method === 'POST') {
        const dossierId = path.match(/^\/api\/org\/dossiers\/([^/]+)\/tasks$/)![1];
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, dossierId)) return json({ error: 'Accès refusé' }, 403);
        const { label, assigned_comptable_id, month, due_date, export_scope } = await request.json() as any;
        if (!label?.trim()) return json({ error: 'Libellé requis' }, 400);
        if (export_scope !== undefined && export_scope !== null && !Array.isArray(export_scope)) return json({ error: 'Portée export invalide' }, 400);
        if (Array.isArray(export_scope) && export_scope.some((s: any) => !EXPORT_STATUSES.includes(s))) return json({ error: 'Portée export invalide' }, 400);
        const taskMonth = month === null || month === undefined ? null : (Number(month) >= 1 && Number(month) <= 12 ? Number(month) : null);
        const taskDue = due_date === null || due_date === undefined ? null : String(due_date).trim();
        if (taskDue && (!/^\d{4}-\d{2}-\d{2}$/.test(taskDue) || isNaN(Date.parse(taskDue)))) return json({ error: 'Date butoir invalide (AAAA-MM-JJ)' }, 400);
        if (assigned_comptable_id) {
          if (!isSupervisor(user.role)) return json({ error: 'Seul un expert peut affecter une tâche' }, 403);
          const comp = await env.DB.prepare('SELECT id FROM org_users WHERE id = ? AND organization_id = ? AND role = ?').bind(assigned_comptable_id, user.organization_id, 'comptable').first();
          if (!comp) return json({ error: 'Comptable introuvable' }, 400);
        }
        const dossier = await env.DB.prepare('SELECT * FROM org_dossiers WHERE id = ?').bind(dossierId).first() as any;
        if (!dossier) return json({ error: 'Dossier non trouvé' }, 404);
        if (assigned_comptable_id && !await orgCompCanAccessDossier(assigned_comptable_id, dossierId)) return json({ error: 'Ce comptable n\'a pas accès au dossier (assignez-le au client ou ouvrez un renfort)' }, 400);
        // Get next order_index
        const last = await env.DB.prepare('SELECT MAX(order_index) as max_idx FROM org_tasks WHERE dossier_id = ?').bind(dossierId).first() as any;
        const nextIdx = (last?.max_idx || 0) + 1;
        const taskId = genId();
        await env.DB.prepare('INSERT INTO org_tasks (id, dossier_id, label, status, order_index, assigned_comptable_id, month, due_date, export_scope, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))').bind(taskId, dossierId, label.trim(), 'a_faire', nextIdx, assigned_comptable_id || null, taskMonth, taskDue, export_scope === undefined ? null : parseExportScope(export_scope), user.id).run();
        const progress = await orgRecalcProgress(env.DB, dossierId);
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'task_added', 'task', taskId, JSON.stringify({ label: label.trim(), dossier_id: dossierId, order_index: nextIdx, month: taskMonth, due_date: taskDue, assigned_comptable_id: assigned_comptable_id || null })).run();
        return json({ ok: true, id: taskId, order_index: nextIdx, progress }, 201);
      }

      // --- ORG: ADD DOCUMENT (attached to a task) ---
      const orgDocAddMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/documents$/);
      if (orgDocAddMatch && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgDocAddMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const { task_id, label, url, received } = await request.json() as any;
        if (!label?.trim()) return json({ error: 'Libellé requis' }, 400);
        const docUrl = (url || '').trim();
        if (docUrl && !/^https?:\/\//i.test(docUrl)) return json({ error: 'URL invalide — commencez par http:// ou https://' }, 400);
        if (task_id) {
          const task = await env.DB.prepare('SELECT id FROM org_tasks WHERE id = ? AND dossier_id = ?').bind(task_id, orgDocAddMatch[1]).first();
          if (!task) return json({ error: 'Tâche introuvable dans ce dossier' }, 404);
        }
        const docId = genId();
        await env.DB.prepare('INSERT INTO org_expected_documents (id, dossier_id, task_id, label, received, url) VALUES (?, ?, ?, ?, ?, ?)').bind(docId, orgDocAddMatch[1], task_id || null, label.trim(), received ? 1 : 0, docUrl || null).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, \'document\', ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'document_added', docId, JSON.stringify({ label: label.trim(), dossier_id: orgDocAddMatch[1], task_id: task_id || null, url: docUrl || null })).run();
        const doc = await env.DB.prepare('SELECT * FROM org_expected_documents WHERE id = ?').bind(docId).first();
        return json(doc, 201);
      }

      // --- ORG: UPLOAD DOCUMENT FILE (multipart: PDF/image → KV) ---
      const orgDocFileMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/documents\/file$/);
      if (orgDocFileMatch && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgDocFileMatch[1])) return json({ error: 'Accès refusé' }, 403);
        if (!env.DOCS_KV) return json({ error: 'Stockage fichier non configuré' }, 503);
        const ctHeader = request.headers.get('content-type') || '';
        if (!ctHeader.includes('multipart/form-data')) return json({ error: 'Form-data requis' }, 400);
        const form = await request.formData();
        const incoming = form.getAll('file').filter((f): f is File => f instanceof File);
        if (incoming.length === 0) return json({ error: 'Fichier requis' }, 400);
        const taskId = String(form.get('task_id') || '').trim() || null;
        const ALLOWED_MIME: Record<string, string> = {
          'application/pdf': 'pdf',
          'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
          'application/msword': 'doc',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
          'application/vnd.ms-excel': 'xls',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
          'text/csv': 'csv', 'text/plain': 'txt',
          'application/zip': 'zip', 'application/x-zip-compressed': 'zip',
          'application/vnd.rar': 'rar',
        };
        const ALLOWED_EXT: Record<string, string> = {
          pdf: 'pdf', jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif',
          doc: 'doc', docx: 'docx', xls: 'xls', xlsx: 'xlsx',
          csv: 'csv', txt: 'txt', zip: 'zip', rar: 'rar',
        };
        const EXT_MIME: Record<string, string> = {
          pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
          doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          csv: 'text/csv', txt: 'text/plain', zip: 'application/zip', rar: 'application/vnd.rar',
        };
        const pickExt = (file: File): string | null => {
          const byMime = ALLOWED_MIME[file.type];
          if (byMime) return byMime;
          const nameExt = (file.name.includes('.') ? file.name.split('.').pop() : '').toLowerCase();
          return ALLOWED_EXT[nameExt] || null;
        };
        if (taskId) {
          const task = await env.DB.prepare('SELECT id FROM org_tasks WHERE id = ? AND dossier_id = ?').bind(taskId, orgDocFileMatch[1]).first();
          if (!task) return json({ error: 'Tâche introuvable dans ce dossier' }, 404);
        }
        const created: any[] = [];
        for (const file of incoming) {
          if (file.size > 10 * 1024 * 1024) return json({ error: `${file.name} — trop volumineux (10 Mo max)` }, 400);
          const ext = pickExt(file);
          if (!ext) return json({ error: `Type non autorisé : ${file.name}` }, 400);
          const docId = genId();
          const key = `org/${user.organization_id}/${orgDocFileMatch[1]}/${docId}.${ext}`;
          await env.DOCS_KV.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: EXT_MIME[ext] } });
          await env.DB.prepare('INSERT INTO org_expected_documents (id, dossier_id, task_id, label, received, file_r2_key, file_name, file_type, file_size) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)').bind(docId, orgDocFileMatch[1], taskId, file.name, key, file.name, EXT_MIME[ext], file.size).run();
          await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, \'document\', ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'document_added', docId, JSON.stringify({ label: file.name, dossier_id: orgDocFileMatch[1], task_id: taskId, file: file.name, file_size: file.size })).run();
          created.push(await env.DB.prepare('SELECT * FROM org_expected_documents WHERE id = ?').bind(docId).first());
        }
        return json(created, 201);
      }

      // --- ORG: UPDATE DOCUMENT ---
      const orgDocMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/documents\/([^/]+)$/);
      if (orgDocMatch && method === 'PATCH') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgDocMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const doc = await env.DB.prepare('SELECT * FROM org_expected_documents WHERE id = ? AND dossier_id = ?').bind(orgDocMatch[2], orgDocMatch[1]).first() as any;
        if (!doc) return json({ error: 'Document non trouvé' }, 404);
        const { received, received_note, url } = await request.json() as any;
        if (url !== undefined && url && !/^https?:\/\//i.test(String(url).trim())) return json({ error: 'URL invalide — commencez par http:// ou https://' }, 400);
        const sets: string[] = [];
        const binds: any[] = [];
        if (received !== undefined) {
          sets.push('received = ?');
          binds.push(received ? 1 : 0);
          if (received) sets.push("received_at = datetime('now')");
        }
        if (received_note !== undefined) { sets.push('received_note = ?'); binds.push(received_note || null); }
        if (url !== undefined) { sets.push('url = ?'); binds.push(url ? String(url).trim() : null); }
        if (sets.length === 0) return json({ error: 'Aucun champ à mettre à jour' }, 400);
        sets.push('updated_by = ?');
        binds.push(user.id);
        await env.DB.prepare(`UPDATE org_expected_documents SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, orgDocMatch[2]).run();
        if (received !== undefined) {
          await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, \'document\', ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, received ? 'document_received' : 'document_unreceived', orgDocMatch[2], JSON.stringify({ label: doc.label, received, received_note })).run();
        }
        return json({ ok: true });
      }

      // --- ORG: DOWNLOAD DOCUMENT FILE (stream depuis KV) ---
      const orgDocFileGetMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/documents\/([^/]+)\/file$/);
      if (orgDocFileGetMatch && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgDocFileGetMatch[1])) return json({ error: 'Accès refusé' }, 403);
        if (!env.DOCS_KV) return json({ error: 'Stockage fichier non configuré' }, 503);
        const doc = await env.DB.prepare('SELECT * FROM org_expected_documents WHERE id = ? AND dossier_id = ?').bind(orgDocFileGetMatch[2], orgDocFileGetMatch[1]).first() as any;
        if (!doc?.file_r2_key) return json({ error: 'Fichier non trouvé' }, 404);
        const buf = await env.DOCS_KV.get(doc.file_r2_key, 'arrayBuffer');
        if (!buf) return json({ error: 'Fichier introuvable' }, 404);
        const fileName = String(doc.file_name || 'fichier').replace(/["\\]/g, '');
        const headers = new Headers({
          'Content-Type': doc.file_type || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${fileName}"`,
          'Cache-Control': 'private, max-age=3600',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Expose-Headers': 'Content-Disposition, Content-Type',
        });
        return new Response(buf, { headers });
      }

      // --- ORG: DELETE DOCUMENT ---
      if (orgDocMatch && method === 'DELETE') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgDocMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const doc = await env.DB.prepare('SELECT * FROM org_expected_documents WHERE id = ? AND dossier_id = ?').bind(orgDocMatch[2], orgDocMatch[1]).first() as any;
        if (!doc) return json({ error: 'Document non trouvé' }, 404);
        if (doc.file_r2_key && env.DOCS_KV) {
          try { await env.DOCS_KV.delete(doc.file_r2_key); } catch { /* best effort */ }
        }
        await env.DB.prepare('DELETE FROM org_expected_documents WHERE id = ?').bind(orgDocMatch[2]).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, \'dossier\', ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'document_deleted', orgDocMatch[1], JSON.stringify({ label: doc.label, doc_id: orgDocMatch[2], task_id: doc.task_id })).run();
        return json({ ok: true });
      }

      // --- ORG: ADD NOTE ---
      const orgNoteMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/notes$/);
      if (orgNoteMatch && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgNoteMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const { content } = await request.json() as any;
        if (!content?.trim()) return json({ error: 'Contenu requis' }, 400);
        const noteId = genId();
        await env.DB.prepare('INSERT INTO org_notes (id, dossier_id, user_id, user_name, content) VALUES (?, ?, ?, ?, ?)').bind(noteId, orgNoteMatch[1], user.id, user.full_name, content.trim()).run();
        // Also log to audit for timeline
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'note_added', 'note', noteId, JSON.stringify({ dossier_id: orgNoteMatch[1], preview: content.trim().slice(0, 100) })).run();
        return json({ id: noteId }, 201);
      }

      // --- ORG: TIMELINE ---
      const orgTimelineMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/timeline$/);
      if (orgTimelineMatch && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgTimelineMatch[1])) return json({ error: 'Accès refusé' }, 403);
        function formatDur(sec: number): string { if (!sec) return ''; const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; if (h > 0) return `${h}h${String(m).padStart(2,'0')}min`; if (m > 0) return `${m}min${String(s).padStart(2,'0')}s`; return `${s}s`; }
        const { results } = await env.DB.prepare(`SELECT * FROM org_audit_log WHERE target_id IN (SELECT id FROM org_tasks WHERE dossier_id = ?) OR target_id IN (SELECT id FROM org_expected_documents WHERE dossier_id = ?) OR target_id IN (SELECT id FROM org_notes WHERE dossier_id = ?) OR (target_type = 'dossier' AND target_id = ?) OR (target_type = 'task' AND action LIKE 'timer%' AND target_id IN (SELECT id FROM org_tasks WHERE dossier_id = ?)) ORDER BY created_at DESC LIMIT 100`).bind(orgTimelineMatch[1], orgTimelineMatch[1], orgTimelineMatch[1], orgTimelineMatch[1], orgTimelineMatch[1]).all();
        const timeline = results.map((r: any) => {
          let icon = '📋', label = r.action;
          const details = r.details ? JSON.parse(r.details) : null;
          if (r.action === 'task_status_changed') { if (details?.new_status === 'fait') { icon = '🟢'; label = 'Tâche terminée'; } else if (details?.new_status === 'bloque_client') { icon = '🔴'; label = `Tâche bloquée — ${details.blocked_reason || ''}`; } else { icon = '🔵'; label = `Statut → ${details?.new_status}`; } }
          else if (r.action === 'document_received') { icon = '📎'; label = 'Document reçu'; }
          else if (r.action === 'document_unreceived') { icon = '📄'; label = 'Document non reçu'; }
          else if (r.action === 'document_added') { icon = '📎'; label = 'Document ajouté'; }
          else if (r.action === 'document_deleted') { icon = '🗑️'; label = 'Document supprimé'; }
          else if (r.action === 'dossier_closed') { icon = '🔒'; label = 'Clôture exercice'; }
          else if (r.action === 'dossier_created') { icon = '🆕'; label = 'Nouvel exercice'; }
          else if (r.action === 'note_added') { icon = '💬'; label = 'Note interne'; }
          else if (r.action === 'timer_started') { icon = '▶️'; label = 'Chrono démarré'; }
          else if (r.action === 'timer_stopped') { icon = '⏹️'; label = `Chrono arrêté — ${details ? formatDur(details.duration_seconds) : ''}`; }
          else if (r.action === 'time_manual') { icon = '⏱️'; label = `Temps ajouté — ${details ? formatDur(details.duration_seconds) : ''}`; }
          else if (r.action === 'task_added') { icon = '➕'; label = `Tâche ajoutée — ${details?.label || ''}`; }
          else if (r.action === 'task_renamed') { icon = '✏️'; label = `Tâche renommée — ${details?.new_label || ''}`; }
          else if (r.action === 'task_deleted') { icon = '🗑️'; label = `Tâche supprimée — ${details?.label || ''}`; }
          else if (r.action === 'task_hidden') { icon = '🙈'; label = `Tâche masquée — ${details?.label || ''} (${details?.count || 0})`; }
          else if (r.action === 'task_restored') { icon = '↩️'; label = `Tâche restaurée — ${details?.label || ''} (${details?.count || 0})`; }
          else if (r.action === 'task_due_changed') { icon = '📅'; label = `Date butoir modifiée — ${details?.new || 'aucune'}`; }
          else if (r.action === 'client_reassigned') { icon = '👤'; label = 'Client réassigné'; }
          else if (r.action === 'task_assigned') { icon = '👤'; label = 'Tâche réassignée'; }
          else if (r.action === 'template_updated') { icon = '📝'; label = 'Modèle de tâche modifié'; }
          return { date: r.created_at, type: r.action, icon, label, actor: r.user_name || 'Système', details };
        });
        return json(timeline);
      }

      // --- ORG: AUDIT LOG ---
      const orgAuditMatch = path.match(/^\/api\/org\/dossiers\/([^/]+)\/audit$/);
      if (orgAuditMatch && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!await orgCanAccessDossier(user, orgAuditMatch[1])) return json({ error: 'Accès refusé' }, 403);
        const { results } = await env.DB.prepare('SELECT * FROM org_audit_log WHERE target_id IN (SELECT id FROM org_tasks WHERE dossier_id = ?) OR target_id IN (SELECT id FROM org_expected_documents WHERE dossier_id = ?) OR target_id IN (SELECT id FROM org_notes WHERE dossier_id = ?) OR (target_type = \'dossier\' AND target_id = ?) ORDER BY created_at DESC LIMIT 200').bind(orgAuditMatch[1], orgAuditMatch[1], orgAuditMatch[1], orgAuditMatch[1]).all();
        return json(results);
      }

      // --- ORG: FISCAL ALERTS (échéances fiscales + tâches à date butoir) ---
      const orgAlertMatch = path.match(/^\/api\/org\/alerts\/([^/]+)$/);

      // Occurrences visibles : du 1er du mois courant à today+60j
      const expandAlertOccurrence = (row: any, dones: Set<string>, today: Date): any[] => {
        const base = { id: row.id, title: row.title, lead_days: row.lead_days, note: row.note, dossier_id: row.dossier_id, dossier_label: row.dossier_label, created_by_name: row.created_by_name, recurrence: row.recurrence || null, category: row.category || null, export_scope: row.export_scope || null };
        if (!row.recurrence) return [{ ...base, due_date: row.due_date, done: !!row.done }];
        const [, am, ad] = String(row.due_date).split('-').map(Number);
        let months: number[];
        if (row.months) {
          try { months = JSON.parse(row.months); } catch { months = []; }
        } else if (row.recurrence === 'mensuelle') {
          months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        } else if (row.recurrence === 'trimestrielle') {
          months = [am, (am + 2) % 12 + 1, (am + 5) % 12 + 1, (am + 8) % 12 + 1];
        } else {
          months = [am];
        }
        if (months.length === 0) return [];
        const y = today.getUTCFullYear();
        const start = `${y}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;
        const endD = new Date(today); endD.setUTCDate(endD.getUTCDate() + 60);
        const end = endD.toISOString().slice(0, 10);
        const out: any[] = [];
        for (const yy of [y, y + 1]) {
          for (const m of months) {
            const dim = new Date(Date.UTC(yy, m, 0)).getUTCDate();
            const iso = `${yy}-${String(m).padStart(2, '0')}-${String(Math.min(ad, dim)).padStart(2, '0')}`;
            if (iso < start || iso > end) continue;
            out.push({ ...base, due_date: iso, done: dones.has(`${row.id}|${iso}`) });
          }
        }
        return out;
      };

      if (path === '/api/org/alerts' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        await ensureAlertPack(env.DB, user.organization_id);
        const dossierId = new URL(request.url).searchParams.get('dossier_id');
        if (dossierId) {
          const dOk = await env.DB.prepare('SELECT 1 AS x FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE d.id = ? AND c.organization_id = ?').bind(dossierId, user.organization_id).first();
          if (dOk) await ensureAlertPack(env.DB, user.organization_id, dossierId);
        } else if (!isSupervisor(user.role)) {
          // Le comptable n'a pas de pack global : pack propre à chacun de ses dossiers en cours (assignes + renforts actifs)
          const { results: myDossiers } = await env.DB.prepare(`SELECT d.id FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE c.organization_id = ? AND d.status = 'en_cours' AND (c.assigned_comptable_id = ? OR EXISTS (SELECT 1 FROM org_dossier_grants g WHERE g.dossier_id = d.id AND g.granted_to = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > datetime('now')))) ORDER BY d.exercice DESC LIMIT 100`).bind(user.organization_id, user.id, user.id).all();
          for (const d of myDossiers as any[]) await ensureAlertPack(env.DB, user.organization_id, d.id);
        }

        let aSql = `SELECT a.id, a.title, a.due_date, a.lead_days, a.done, a.note, a.recurrence, a.months, a.category, a.export_scope, a.dossier_id, a.created_by_name, a.created_at,
          CASE WHEN a.dossier_id IS NOT NULL THEN (SELECT c.name || ' (' || d.exercice || ')' FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE d.id = a.dossier_id) ELSE NULL END AS dossier_label
          FROM org_fiscal_alerts a WHERE a.organization_id = ?`;
        const aBinds: any[] = [user.organization_id];
        if (!isSupervisor(user.role)) {
          // Échéances du comptable = SES dossiers assignés + dossiers en renfort actif (pas le pack global)
          aSql += ` AND a.dossier_id IS NOT NULL AND EXISTS (SELECT 1 FROM org_dossiers d2 JOIN org_clients c2 ON d2.client_id = c2.id WHERE d2.id = a.dossier_id AND d2.status = 'en_cours' AND (c2.assigned_comptable_id = ? OR EXISTS (SELECT 1 FROM org_dossier_grants g WHERE g.dossier_id = d2.id AND g.granted_to = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > datetime('now')))))`;
          aBinds.push(user.id, user.id);
        }
        if (dossierId) { aSql += ' AND a.dossier_id = ?'; aBinds.push(dossierId); }
        aSql += ' ORDER BY a.due_date ASC';
        const { results: rawRows } = await env.DB.prepare(aSql).bind(...aBinds).all();

        // Filtre export : échéance liée à un dossier visible uniquement si le statut
        // export du client est dans export_scope (NULL/non renseigné = non_exportatrice).
        // Les échéances globales (vue expert) ne sont pas filtrées : la puce affiche la portée.
        const rows = rawRows as any[];
        let expMap: Map<string, string> | null = null;
        if (rows.some(r => r.export_scope && r.dossier_id)) {
          const { results: expRows } = await env.DB.prepare('SELECT d.id AS did, c.export_status FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE c.organization_id = ?').bind(user.organization_id).all();
          expMap = new Map((expRows as any[]).map(r => [r.did, r.export_status || 'non_exportatrice']));
        }
        const kept: any[] = [];
        for (const r of rows) {
          let scope: string[] | null = null;
          if (r.export_scope) {
            try { const p = JSON.parse(r.export_scope); if (Array.isArray(p)) scope = p; } catch { scope = null; }
          }
          if (scope && r.dossier_id && expMap) {
            const st = expMap.get(r.dossier_id) || 'non_exportatrice';
            if (!scope.includes(st)) continue;
          }
          kept.push({ ...r, export_scope: scope });
        }

        const dones = new Set<string>();
        // D1 : max 100 variables par requête → découpage par paquets de 50
        const keptIds = kept.map((r: any) => String(r.id));
        for (let i = 0; i < keptIds.length; i += 50) {
          const chunk = keptIds.slice(i, i + 50);
          const { results: dres } = await env.DB.prepare(`SELECT alert_id, due_date FROM org_alert_dones WHERE alert_id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
          for (const d of dres as any[]) dones.add(`${d.alert_id}|${d.due_date}`);
        }
        const today = new Date();
        const alerts = kept.flatMap(r => expandAlertOccurrence(r, dones, today));
        alerts.sort((a, b) => a.due_date.localeCompare(b.due_date));

        let tSql = `SELECT t.id, t.label, t.due_date, t.status, t.dossier_id, t.assigned_comptable_id, t.export_scope, c.export_status,
          c.name || ' (' || d.exercice || ')' AS dossier_label
          FROM org_tasks t JOIN org_dossiers d ON t.dossier_id = d.id JOIN org_clients c ON d.client_id = c.id
          WHERE c.organization_id = ? AND t.due_date IS NOT NULL AND t.status != 'fait' AND t.hidden = 0`;
        const tBinds: any[] = [user.organization_id];
        if (!isSupervisor(user.role)) { tSql += ` AND (c.assigned_comptable_id = ? OR EXISTS (SELECT 1 FROM org_dossier_grants g WHERE g.dossier_id = t.dossier_id AND g.granted_to = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > datetime('now'))))`; tBinds.push(user.id, user.id); }
        if (dossierId) { tSql += ' AND t.dossier_id = ?'; tBinds.push(dossierId); }
        tSql += ' ORDER BY t.due_date ASC';
        const { results: rawFeedTasks } = await env.DB.prepare(tSql).bind(...tBinds).all();
        // Filtre export : tâche à portée visible uniquement si le statut du client est dedans
        const tasks = (rawFeedTasks as any[])
          .filter(t => exportScopeKeeps(t.export_scope, t.export_status))
          .map(t => {
            let scope: string[] | null = null;
            if (t.export_scope) { try { const p = JSON.parse(t.export_scope); if (Array.isArray(p)) scope = p; } catch { scope = null; } }
            return { id: t.id, label: t.label, due_date: t.due_date, status: t.status, dossier_id: t.dossier_id, assigned_comptable_id: t.assigned_comptable_id, dossier_label: t.dossier_label, export_scope: scope };
          });

        return json({ alerts, tasks });
      }

      if (path === '/api/org/alerts' && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const body = await request.json() as any;
        const title = (body.title || '').trim();
        const dueDate = (body.due_date || '').trim();
        if (!title) return json({ error: 'Libellé requis' }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || isNaN(Date.parse(dueDate))) return json({ error: 'Date invalide (AAAA-MM-JJ)' }, 400);
        const recurrence = ['once', 'mensuelle', 'trimestrielle', 'annuelle'].includes(body.recurrence) ? body.recurrence : 'once';
        const category = ['morale', 'physique'].includes(body.category) ? body.category : null;
        let lead = Number(body.lead_days);
        if (!Number.isFinite(lead)) lead = 7;
        lead = Math.max(0, Math.min(60, Math.round(lead)));
        let dossierId: string | null = null;
        if (body.dossier_id) {
          const d = await env.DB.prepare('SELECT d.id FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE d.id = ? AND c.organization_id = ?').bind(body.dossier_id, user.organization_id).first();
          if (!d) return json({ error: 'Dossier introuvable' }, 404);
          dossierId = String(body.dossier_id);
          if (!await orgCanAccessDossier(user, dossierId)) return json({ error: 'Accès refusé' }, 403);
        } else if (!isSupervisor(user.role)) {
          // Échéances du comptable = liées à ses dossiers (le pack global n'est pas visible pour lui)
          return json({ error: 'Échéance globale réservée à l\'expert — liez votre échéance à un dossier' }, 403);
        }
        const exportScope = parseExportScope(body.export_scope);
        const id = genId();
        await env.DB.prepare('INSERT INTO org_fiscal_alerts (id, organization_id, title, due_date, lead_days, recurrence, category, dossier_id, note, export_scope, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(id, user.organization_id, title, dueDate, lead, recurrence === 'once' ? null : recurrence, category, dossierId, (body.note || '').trim() || null, exportScope, user.id, user.full_name).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, \'alert_added\', \'alert\', ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, id, JSON.stringify({ title, due_date: dueDate, lead_days: lead, recurrence, category, dossier_id: dossierId })).run();
        const row = await env.DB.prepare('SELECT * FROM org_fiscal_alerts WHERE id = ?').bind(id).first();
        return json(row, 201);
      }

      if (orgAlertMatch && method === 'PATCH') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const row = await env.DB.prepare('SELECT * FROM org_fiscal_alerts WHERE id = ? AND organization_id = ?').bind(orgAlertMatch[1], user.organization_id).first() as any;
        if (!row) return json({ error: 'Échéance introuvable' }, 404);
        // Comptable : uniquement les échéances liées à ses dossiers (les globales sont réservées à l'expert)
        if (!isSupervisor(user.role) && (!row.dossier_id || !await orgCanAccessDossier(user, row.dossier_id))) return json({ error: 'Accès refusé' }, 403);
        const body = await request.json() as any;
        const occ = body.occurrence ? String(body.occurrence).trim() : null;
        if (occ && (!/^\d{4}-\d{2}-\d{2}$/.test(occ) || isNaN(Date.parse(occ)))) return json({ error: 'Occurrence invalide' }, 400);
        const updates: string[] = [];
        const binds: any[] = [];
        let toggleDone: boolean | undefined;
        if (body.title !== undefined) {
          const v = (body.title || '').trim();
          if (!v) return json({ error: 'Libellé requis' }, 400);
          updates.push('title = ?'); binds.push(v);
        }
        if (body.due_date !== undefined) {
          const v = (body.due_date || '').trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) return json({ error: 'Date invalide (AAAA-MM-JJ)' }, 400);
          updates.push('due_date = ?'); binds.push(v);
        }
        if (body.lead_days !== undefined) {
          const l = Math.max(0, Math.min(60, Math.round(Number(body.lead_days) || 0)));
          updates.push('lead_days = ?'); binds.push(l);
        }
        if (body.note !== undefined) { updates.push('note = ?'); binds.push((body.note || '').trim() || null); }
        if (body.recurrence !== undefined) {
          if (!['once', 'mensuelle', 'trimestrielle', 'annuelle'].includes(body.recurrence)) return json({ error: 'Récurrence invalide' }, 400);
          updates.push('recurrence = ?'); binds.push(body.recurrence === 'once' ? null : body.recurrence);
        }
        if (body.category !== undefined) {
          if (body.category !== null && !['morale', 'physique'].includes(body.category)) return json({ error: 'Catégorie invalide' }, 400);
          updates.push('category = ?'); binds.push(body.category || null);
        }
        if (body.export_scope !== undefined) {
          if (body.export_scope !== null && !Array.isArray(body.export_scope)) return json({ error: 'Portée export invalide' }, 400);
          if (Array.isArray(body.export_scope) && body.export_scope.some((s: any) => !EXPORT_STATUSES.includes(s))) return json({ error: 'Portée export invalide' }, 400);
          updates.push('export_scope = ?'); binds.push(parseExportScope(body.export_scope));
        }
        if (body.done !== undefined) toggleDone = !!body.done;

        if (toggleDone !== undefined) {
          if (row.recurrence) {
            if (!occ) return json({ error: 'Date d\'occurrence requise pour une échéance récurrente' }, 400);
            if (toggleDone) {
              await env.DB.prepare('INSERT OR REPLACE INTO org_alert_dones (alert_id, due_date, organization_id) VALUES (?, ?, ?)').bind(row.id, occ, user.organization_id).run();
            } else {
              await env.DB.prepare('DELETE FROM org_alert_dones WHERE alert_id = ? AND due_date = ?').bind(row.id, occ).run();
            }
          } else {
            updates.push('done = ?'); binds.push(toggleDone ? 1 : 0);
          }
        }

        if (updates.length > 0) {
          await env.DB.prepare(`UPDATE org_fiscal_alerts SET ${updates.join(', ')} WHERE id = ?`).bind(...binds, orgAlertMatch[1]).run();
        } else if (toggleDone === undefined) {
          return json({ error: 'Rien à modifier' }, 400);
        }

        if (toggleDone !== undefined) {
          await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, \'alert_toggled\', \'alert\', ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, orgAlertMatch[1], JSON.stringify({ title: row.title, done: toggleDone ? 1 : 0, occurrence: row.recurrence ? occ : null })).run();
        }
        const fresh = await env.DB.prepare('SELECT * FROM org_fiscal_alerts WHERE id = ?').bind(orgAlertMatch[1]).first();
        return json(fresh);
      }

      if (orgAlertMatch && method === 'DELETE') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const row = await env.DB.prepare('SELECT * FROM org_fiscal_alerts WHERE id = ? AND organization_id = ?').bind(orgAlertMatch[1], user.organization_id).first() as any;
        if (!row) return json({ error: 'Échéance introuvable' }, 404);
        if (!isSupervisor(user.role) && (!row.dossier_id || !await orgCanAccessDossier(user, row.dossier_id))) return json({ error: 'Accès refusé' }, 403);
        await env.DB.prepare('DELETE FROM org_alert_dones WHERE alert_id = ?').bind(orgAlertMatch[1]).run();
        await env.DB.prepare('DELETE FROM org_fiscal_alerts WHERE id = ?').bind(orgAlertMatch[1]).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, \'alert_deleted\', \'alert\', ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, orgAlertMatch[1], JSON.stringify({ title: row.title, due_date: row.due_date })).run();
        return json({ ok: true });
      }

      // --- ORG: EXPERT — COMPTABLES ---
      if (path === '/api/org/comptables' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user || !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        const { results } = await env.DB.prepare("SELECT id, full_name, email, is_active, created_at, last_seen_at, role, role_label FROM org_users WHERE organization_id = ? AND role IN ('comptable','expert') ORDER BY full_name").bind(user.organization_id).all();
        // Presence : derniere activite (< 3 min = connecte) + heures pointees du jour (journée locale TN = UTC+1)
        const { results: dayRows } = await env.DB.prepare("SELECT user_id, COALESCE(SUM(duration_seconds),0) AS secs FROM org_time_entries WHERE stopped_at IS NOT NULL AND started_at >= datetime('now','start of day','-60 minutes') GROUP BY user_id").all();
        const dayByUser = new Map((dayRows as any[]).map(r => [r.user_id, r.secs]));
        const { results: running } = await env.DB.prepare('SELECT user_id, started_at FROM org_time_entries WHERE stopped_at IS NULL').all();
        const runByUser = new Map((running as any[]).map(r => [r.user_id, r.started_at]));
        const nowS = Math.floor(Date.now() / 1000);
        const parseUtc = (s: any) => s ? Math.floor(Date.parse(String(s).replace(' ', 'T') + 'Z') / 1000) : 0;
        // Norme 8h30 uniquement lun-ven (heure locale TN = UTC+1) ; sam/dim = repos
        const dowTn = new Date(Date.now() + 3600000).getUTCDay();
        const normSec = (dowTn !== 0 && dowTn !== 6) ? 30600 : 0;
        const enriched = await Promise.all(results.map(async (c: any) => {
          const { results: clients } = await env.DB.prepare('SELECT c.id, d.cached_progress FROM org_clients c LEFT JOIN org_dossiers d ON d.client_id = c.id AND d.status = \'en_cours\' WHERE c.organization_id = ? AND c.assigned_comptable_id = ?').bind(user.organization_id, c.id).all();
          const { results: taskStats } = await env.DB.prepare('SELECT t.status, t.export_scope, t.month, c.export_status FROM org_tasks t JOIN org_dossiers d ON t.dossier_id = d.id JOIN org_clients c ON d.client_id = c.id WHERE c.assigned_comptable_id = ? AND c.organization_id = ? AND d.status = \'en_cours\' AND t.hidden = 0').bind(c.id, user.organization_id).all();
          const s = { total: 0, fait: 0, en_cours: 0, bloque_client: 0 };
          for (const t of taskStats as any[]) {
            if (!exportScopeKeeps(t.export_scope, t.export_status)) continue;
            if (!inDashboardScope(t.month)) continue;
            s.total++; if (t.status === 'fait') s.fait++; else if (t.status === 'en_cours' || t.status === 'a_faire' || t.status === 'a_verifier') s.en_cours++; else if (t.status === 'bloque_client') s.bloque_client++;
          }
          const runStart = parseUtc(runByUser.get(c.id));
          return { ...c, role: c.role_label || c.role, client_count: clients.length, avg_progress: clients.length > 0 ? Math.round(clients.reduce((sum: number, cl: any) => sum + (cl.cached_progress || 0), 0) / clients.length * 10) / 10 : 0, task_stats: s,
            online: parseUtc(c.last_seen_at) >= nowS - 180,
            worked_today_seconds: (Number(dayByUser.get(c.id)) || 0) + Math.max(0, runStart ? nowS - runStart : 0),
            norm_seconds: normSec };
        }));
        return json(enriched);
      }

      if (path === '/api/org/comptables' && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user || !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        const { full_name, email, password, role } = await request.json() as any;
        if (!full_name || !email || !password) return json({ error: 'Nom, email et mot de passe requis' }, 400);
        if (password.length < 12) return json({ error: 'Le mot de passe doit faire au moins 12 caractères' }, 400);
        if (role !== undefined && !['comptable', 'manager', 'expert'].includes(role)) return json({ error: 'Rôle invalide (comptable, manager ou expert)' }, 400);
        const existing = await env.DB.prepare('SELECT id FROM org_users WHERE email = ?').bind(email).first();
        if (existing) return json({ error: 'Cet email est déjà utilisé' }, 409);
        const effRole: string = ['manager', 'expert'].includes(role) ? role : 'comptable';
        const id = genId();
        const salt = crypto.randomUUID().slice(0, 16);
        const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + password));
        const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        await env.DB.prepare('INSERT INTO org_users (id, organization_id, full_name, email, password_hash, role, role_label, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1)').bind(id, user.organization_id, full_name, email, salt + ':' + hashHex, effRole === 'comptable' ? 'comptable' : 'expert', effRole === 'manager' ? 'manager' : null).run();
        if (effRole !== 'comptable') {
          await env.DB.prepare("INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, 'user_role_changed', 'user', ?, ?)").bind(genId(), user.organization_id, user.id, user.full_name, id, JSON.stringify({ old: 'comptable', new: effRole, created: true })).run();
        }
        return json({ id, full_name, email, role: effRole }, 201);
      }

      const orgCompToggleMatch = path.match(/^\/api\/org\/comptables\/([^/]+)$/);
      if (orgCompToggleMatch && method === 'PATCH') {
        const user = await verifyOrgToken(request);
        if (!user || !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        const { is_active, full_name, email, password, role } = await request.json() as any;
        const target = await env.DB.prepare("SELECT id, role, role_label, is_active FROM org_users WHERE id = ? AND organization_id = ? AND role IN ('comptable','expert')").bind(orgCompToggleMatch[1], user.organization_id).first() as any;
        if (!target) return json({ error: 'Comptable non trouvé' }, 404);
        if (target.id === user.id) return json({ error: 'Impossible de modifier son propre compte' }, 400);
        const curEff: string = target.role_label || target.role;
        let newEff: string | null = null;
        if (role !== undefined) {
          if (!['comptable', 'manager', 'expert'].includes(role)) return json({ error: 'Rôle invalide (comptable, manager ou expert)' }, 400);
          newEff = role;
        }
        // Garde-fou : il doit rester au moins un superviseur actif (expert/manager)
        const willBeSupervisor = newEff !== null ? newEff !== 'comptable' : target.role === 'expert';
        const willBeActive = is_active !== undefined ? !!is_active : !!target.is_active;
        if (target.role === 'expert' && !(willBeSupervisor && willBeActive)) {
          const { results: sups } = await env.DB.prepare("SELECT id FROM org_users WHERE organization_id = ? AND role = 'expert' AND is_active = 1 AND id != ?").bind(user.organization_id, target.id).all();
          if (sups.length === 0) return json({ error: 'Impossible : au moins un superviseur (expert/manager) doit rester actif' }, 400);
        }
        const sets: string[] = [];
        const binds: any[] = [];
        if (is_active !== undefined) { sets.push('is_active = ?'); binds.push(is_active ? 1 : 0); }
        if (newEff !== null) {
          sets.push('role = ?', 'role_label = ?');
          binds.push(newEff === 'comptable' ? 'comptable' : 'expert', newEff === 'manager' ? 'manager' : null);
        }
        if (full_name !== undefined) {
          const name = String(full_name).trim();
          if (!name) return json({ error: 'Nom requis' }, 400);
          sets.push('full_name = ?');
          binds.push(name);
        }
        if (email !== undefined) {
          const mail = String(email).trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return json({ error: 'Email invalide' }, 400);
          const existing = await env.DB.prepare('SELECT id FROM org_users WHERE email = ? AND id != ?').bind(mail, orgCompToggleMatch[1]).first();
          if (existing) return json({ error: 'Cet email est déjà utilisé' }, 409);
          sets.push('email = ?');
          binds.push(mail);
        }
        if (password !== undefined && password !== null && password !== '') {
          if (password.length < 12) return json({ error: 'Le mot de passe doit faire au moins 12 caractères' }, 400);
          const salt = crypto.randomUUID().slice(0, 16);
          const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + password));
          const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
          sets.push('password_hash = ?', 'must_change_password = 1');
          binds.push(salt + ':' + hashHex);
        }
        if (sets.length === 0) return json({ error: 'Aucun champ à mettre à jour' }, 400);
        await env.DB.prepare(`UPDATE org_users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, orgCompToggleMatch[1]).run();
        if (newEff !== null && newEff !== curEff) {
          await env.DB.prepare("INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, 'user_role_changed', 'user', ?, ?)").bind(genId(), user.organization_id, user.id, user.full_name, target.id, JSON.stringify({ old: curEff, new: newEff })).run();
        }
        return json({ ok: true, role: newEff ?? curEff });
      }

      // --- ORG: DELETE USER (expert + manager) — pour supprimer un compte de test/jetable ---
      if (orgCompToggleMatch && method === 'DELETE') {
        const user = await verifyOrgToken(request);
        if (!user || !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        if (orgCompToggleMatch[1] === user.id) return json({ error: 'Impossible de supprimer son propre compte' }, 400);
        const target = await env.DB.prepare("SELECT id, role, full_name, email FROM org_users WHERE id = ? AND organization_id = ?").bind(orgCompToggleMatch[1], user.organization_id).first() as any;
        if (!target) return json({ error: 'Compte non trouvé' }, 404);
        // Garde-fou : il doit rester au moins un superviseur actif
        if (target.role === 'expert') {
          const { results: sups } = await env.DB.prepare("SELECT id FROM org_users WHERE organization_id = ? AND role = 'expert' AND is_active = 1 AND id != ?").bind(user.organization_id, target.id).all();
          if (sups.length === 0) return json({ error: 'Impossible : au moins un superviseur doit rester actif' }, 400);
        }
        const { n: assigned } = await env.DB.prepare('SELECT COUNT(*) as n FROM org_clients WHERE assigned_comptable_id = ?').bind(target.id).first() as any;
        if (assigned > 0) return json({ error: `Impossible : ${assigned} client(s) sont assignés à ce compte` }, 409);
        await env.DB.prepare('DELETE FROM org_time_entries WHERE user_id = ?').bind(target.id).run();
        await env.DB.prepare('DELETE FROM org_audit_log WHERE target_id = ? AND target_type = ?').bind(target.id, 'user').run();
        await env.DB.prepare('DELETE FROM org_users WHERE id = ?').bind(target.id).run();
        await env.DB.prepare("INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, 'user_deleted', 'user', ?, ?)").bind(genId(), user.organization_id, user.id, user.full_name, target.id, JSON.stringify({ email: target.email, full_name: target.full_name })).run();
        return json({ ok: true, deleted: target.email });
      }

      // --- ORG: EXPERT — COMPTABLE DETAIL ---
      if (path.match(/^\/api\/org\/comptables\/([^/]+)\/detail$/) && method === 'GET') {
        const compId = path.match(/^\/api\/org\/comptables\/([^/]+)\/detail$/)![1];
        const user = await verifyOrgToken(request);
        if (!user || !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        // Comptable info
        const comptable = await env.DB.prepare('SELECT id, full_name, email, is_active, created_at FROM org_users WHERE id = ? AND organization_id = ?').bind(compId, user.organization_id).first() as any;
        if (!comptable) return json({ error: 'Comptable non trouvé' }, 404);
        // All dossiers assigned to this comptable
        const { results: dossiers } = await env.DB.prepare('SELECT d.*, c.name as client_name FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE c.assigned_comptable_id = ? AND c.organization_id = ? ORDER BY d.exercice DESC, c.name').bind(compId, user.organization_id).all();
        // Enrich dossiers with task stats
        const enrichedDossiers = await Promise.all(dossiers.map(async (d: any) => {
          const { results: tasks } = await env.DB.prepare('SELECT t.status, t.export_scope, c.export_status, COALESCE(t.total_time_seconds, 0) as total_time FROM org_tasks t JOIN org_dossiers d2 ON t.dossier_id = d2.id JOIN org_clients c ON d2.client_id = c.id WHERE t.dossier_id = ? AND t.hidden = 0').bind(d.id).all();
          const s = { total: 0, fait: 0, en_cours: 0, bloque_client: 0 };
          let totalTime = 0;
          for (const t of tasks as any[]) {
            if (!exportScopeKeeps(t.export_scope, t.export_status)) continue;
            s.total++; totalTime += t.total_time || 0; if (t.status === 'fait') s.fait++; else if (t.status === 'en_cours' || t.status === 'a_faire' || t.status === 'a_verifier') s.en_cours++; else if (t.status === 'bloque_client') s.bloque_client++;
          }
          return { ...d, task_stats: s, progress: s.total > 0 ? Math.round(s.fait / s.total * 1000) / 10 : 0, total_time_seconds: totalTime };
        }));
        // All tasks modified by this comptable
        const { results: myTasks } = await env.DB.prepare('SELECT t.*, d.exercice, c.name as client_name FROM org_tasks t JOIN org_dossiers d ON t.dossier_id = d.id JOIN org_clients c ON d.client_id = c.id WHERE t.updated_by = ? AND t.hidden = 0 ORDER BY t.updated_at DESC LIMIT 50').bind(compId).all();
        // All notes written by this comptable
        const { results: myNotes } = await env.DB.prepare('SELECT n.*, d.exercice, c.name as client_name FROM org_notes n JOIN org_dossiers d ON n.dossier_id = d.id JOIN org_clients c ON d.client_id = c.id WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50').bind(compId).all();
        // Time entries breakdown
        const { results: timeEntries } = await env.DB.prepare('SELECT te.*, t.label as task_label, d.exercice, c.name as client_name FROM org_time_entries te JOIN org_tasks t ON te.task_id = t.id JOIN org_dossiers d ON t.dossier_id = d.id JOIN org_clients c ON d.client_id = c.id WHERE te.user_id = ? ORDER BY te.started_at DESC').bind(compId).all();
        const totalTimeEntries = timeEntries.reduce((sum: number, te: any) => sum + (te.duration_seconds || 0), 0);
        // Time by dossier : temps TOTAL cumulé sur chaque dossier (toutes personnes — chrono, auto-stop, saisie manuelle)
        const timeByDossier: Record<string, { client_name: string; exercice: number; seconds: number }> = {};
        const { results: taskTimes } = await env.DB.prepare('SELECT t.dossier_id, COALESCE(SUM(t.total_time_seconds), 0) as seconds, d.exercice, c.name as client_name FROM org_tasks t JOIN org_dossiers d ON t.dossier_id = d.id JOIN org_clients c ON d.client_id = c.id WHERE c.assigned_comptable_id = ? AND c.organization_id = ? GROUP BY t.dossier_id HAVING COALESCE(SUM(t.total_time_seconds), 0) > 0').bind(compId, user.organization_id).all();
        for (const tt of taskTimes as any[]) {
          timeByDossier[tt.dossier_id] = { client_name: tt.client_name, exercice: tt.exercice, seconds: tt.seconds };
        }
        // Audit log (last 50 actions)
        const { results: auditLog } = await env.DB.prepare('SELECT * FROM org_audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(compId).all();
        // Active timer
        const activeTimer = timeEntries.find((te: any) => !te.stopped_at);
        // KPIs
        const totalDossiers = enrichedDossiers.length;
        const enCoursDossiers = enrichedDossiers.filter(d => d.status === 'en_cours').length;
        const avgProgress = totalDossiers > 0 ? Math.round(enrichedDossiers.reduce((s, d) => s + (d.progress || 0), 0) / totalDossiers * 10) / 10 : 0;
        const tasksDone = myTasks.filter(t => t.status === 'fait').length;
        const totalNotes = myNotes.length;
        const blockedTasks = enrichedDossiers.reduce((s, d) => s + (d.task_stats?.bloque_client || 0), 0);
        return json({
          comptable,
          dossiers: enrichedDossiers,
          recent_tasks: myTasks,
          recent_notes: myNotes,
          time_entries: timeEntries,
          time_by_dossier: Object.values(timeByDossier),
          total_time_seconds: totalTimeEntries,
          audit_log: auditLog,
          active_timer: activeTimer || null,
          kpis: { total_dossiers: totalDossiers, en_cours: enCoursDossiers, avg_progress: avgProgress, tasks_done: tasksDone, total_notes: totalNotes, blocked_tasks: blockedTasks },
        });
      }

      // --- ORG: EXPERT — ALL DOSSIERS ---
      if (path === '/api/org/dossiers' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user || !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        // Securite au chargement : ouverture du nouvel exercice si le cron du 1er janvier a rate
        await ensureCurrentExercice(env, user.organization_id);
        const exParam = new URL(request.url).searchParams.get('exercice');
        const exSel = exParam ? Number(exParam) : null;
        const { results } = await env.DB.prepare(`SELECT d.*, c.name as client_name, c.export_status, u.full_name as comptable_name, u.id as comptable_id FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id LEFT JOIN org_users u ON c.assigned_comptable_id = u.id WHERE c.organization_id = ?${exSel ? ' AND d.exercice = ?' : ''} ORDER BY d.exercice DESC, c.name`).bind(user.organization_id, ...(exSel ? [exSel] : [])).all();
        const enriched = await Promise.all(results.map(async (d: any) => {
          const { results: tasks } = await env.DB.prepare('SELECT t.status, t.export_scope, COALESCE(t.total_time_seconds, 0) as total_time FROM org_tasks t WHERE t.dossier_id = ? AND t.hidden = 0').bind(d.id).all();
          const s = { total: 0, fait: 0, en_cours: 0, bloque_client: 0 };
          let totalTime = 0;
          for (const t of tasks as any[]) {
            if (!exportScopeKeeps(t.export_scope, d.export_status)) continue;
            s.total++; totalTime += t.total_time || 0; if (t.status === 'fait') s.fait++; else if (t.status === 'en_cours' || t.status === 'a_faire' || t.status === 'a_verifier') s.en_cours++; else if (t.status === 'bloque_client') s.bloque_client++;
          }
          return { ...d, task_stats: s, progress: s.total > 0 ? Math.round(s.fait / s.total * 1000) / 10 : 0, total_time_seconds: totalTime };
        }));
        return json(enriched);
      }

      // --- ORG: RECHERCHE GLOBALE (clients, dossiers, taches, documents, notes) ---
      if (path === '/api/org/search' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const q = (new URL(request.url).searchParams.get('q') || '').trim();
        const empty = { q, clients: [], dossiers: [], tasks: [], documents: [], notes: [] };
        if (q.length < 2) return json(empty);
        const like = `%${q}%`;
        const sup = isSupervisor(user.role);
        // Portee : expert/manager = tout le cabinet ; comptable = clients assignes + renforts actifs
        const scopeCli = sup ? '' : ' AND (c.assigned_comptable_id = ? OR EXISTS (SELECT 1 FROM org_dossiers dd JOIN org_dossier_grants g ON g.dossier_id = dd.id WHERE dd.client_id = c.id AND g.granted_to = ? AND ' + ORG_GRANT_ACTIVE + '))';
        const scopeDos = sup ? '' : ' AND (c.assigned_comptable_id = ? OR EXISTS (SELECT 1 FROM org_dossier_grants g WHERE g.dossier_id = d.id AND g.granted_to = ? AND ' + ORG_GRANT_ACTIVE + '))';

        const bC: any[] = [user.organization_id, like, like, ...(sup ? [] : [user.id, user.id])];
        const { results: clients } = await env.DB.prepare(
          `SELECT c.id, c.name, c.matricule_fiscal,
             (SELECT d.id FROM org_dossiers d WHERE d.client_id = c.id ORDER BY (d.status = 'en_cours') DESC, d.exercice DESC LIMIT 1) as dossier_id,
             (SELECT d.exercice FROM org_dossiers d WHERE d.client_id = c.id ORDER BY (d.status = 'en_cours') DESC, d.exercice DESC LIMIT 1) as exercice
           FROM org_clients c WHERE c.organization_id = ? AND (c.name LIKE ? OR c.matricule_fiscal LIKE ?)${scopeCli}
           ORDER BY c.name LIMIT 6`
        ).bind(...bC).all();

        const bD: any[] = [user.organization_id, like, like, ...(sup ? [] : [user.id, user.id])];
        const { results: dossiers } = await env.DB.prepare(
          `SELECT d.id, d.exercice, d.status, d.cached_progress, c.name as client_name
           FROM org_dossiers d JOIN org_clients c ON c.id = d.client_id
           WHERE c.organization_id = ? AND (c.name LIKE ? OR d.id LIKE ?)${scopeDos}
           ORDER BY (d.status = 'en_cours') DESC, d.exercice DESC, c.name LIMIT 6`
        ).bind(...bD).all();

        const bT: any[] = [user.organization_id, like, ...(sup ? [] : [user.id, user.id, user.id])];
        const { results: tasks } = await env.DB.prepare(
          `SELECT t.id, t.label, t.status, t.month, t.due_date, t.dossier_id, c.name as client_name, d.exercice
           FROM org_tasks t JOIN org_dossiers d ON d.id = t.dossier_id JOIN org_clients c ON c.id = d.client_id
           WHERE c.organization_id = ? AND t.label LIKE ? AND t.hidden = 0
           ${sup ? '' : 'AND (c.assigned_comptable_id = ? OR EXISTS (SELECT 1 FROM org_task_collaborators tc WHERE tc.task_id = t.id AND tc.user_id = ?) OR EXISTS (SELECT 1 FROM org_dossier_grants g WHERE g.dossier_id = d.id AND g.granted_to = ? AND ' + ORG_GRANT_ACTIVE + '))'}
           ORDER BY (d.status = 'en_cours') DESC, d.exercice DESC, t.order_index LIMIT 6`
        ).bind(...bT).all();

        const bO: any[] = [user.organization_id, like, ...(sup ? [] : [user.id, user.id])];
        const { results: documents } = await env.DB.prepare(
          `SELECT o.id, o.label, o.task_id, o.dossier_id, o.received, c.name as client_name, d.exercice
           FROM org_expected_documents o JOIN org_dossiers d ON d.id = o.dossier_id JOIN org_clients c ON c.id = d.client_id
           WHERE c.organization_id = ? AND o.label LIKE ?${scopeDos}
           ORDER BY (d.status = 'en_cours') DESC, o.label LIMIT 6`
        ).bind(...bO).all();

        const bN: any[] = [user.organization_id, like, ...(sup ? [] : [user.id, user.id])];
        const { results: notes } = await env.DB.prepare(
          `SELECT n.id, substr(n.content, 1, 90) as content, n.dossier_id, n.created_at, c.name as client_name, d.exercice
           FROM org_notes n JOIN org_dossiers d ON d.id = n.dossier_id JOIN org_clients c ON c.id = d.client_id
           WHERE c.organization_id = ? AND n.content LIKE ?${scopeDos}
           ORDER BY n.created_at DESC LIMIT 6`
        ).bind(...bN).all();

        return json({ q, clients, dossiers, tasks, documents, notes });
      }

      // --- ORG: EXERCICES DISPONIBLES (selecteur du dashboard) ---
      if (path === '/api/org/exercices' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        await ensureCurrentExercice(env, user.organization_id);
        const access = isSupervisor(user.role)
          ? 'c.organization_id = ?'
          : "(c.organization_id = ? AND (c.assigned_comptable_id = ? OR EXISTS (SELECT 1 FROM org_dossier_grants g WHERE g.dossier_id = d.id AND g.granted_to = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > datetime('now')))))";
        const binds: any[] = isSupervisor(user.role) ? [user.organization_id] : [user.organization_id, user.id, user.id];
        const { results } = await env.DB.prepare(`SELECT DISTINCT d.exercice FROM org_dossiers d JOIN org_clients c ON d.client_id = c.id WHERE ${access} ORDER BY d.exercice DESC`).bind(...binds).all();
        const exercices: number[] = (results as any[]).map(r => Number(r.exercice)).filter(n => Number.isInteger(n));
        const y = new Date(Date.now() + 3600000).getUTCFullYear();
        if (!exercices.includes(y)) exercices.unshift(y);
        return json({ exercices });
      }

      // --- ORG: ROLLOVER EXERCICE (expert/manager) — manuel + tests ---
      // Corps optionnel : { year?: number, client_id?: string }
      // sans year : annee courante (meme logique que le cron / la securite au chargement)
      if (path === '/api/org/exercices/rollover' && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        if (!isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        const body = (await request.json().catch(() => ({}))) as any;
        const year = body?.year ? Number(body.year) : null;
        if (year && (!Number.isInteger(year) || year < 2000 || year > 2100)) return json({ error: 'Année invalide' }, 400);
        const res = await rolloverExercices(env, {
          orgId: user.organization_id,
          source: 'manual',
          targetYear: year || undefined,
          clientId: body?.client_id || undefined,
          actorId: user.id,
          actorName: user.full_name,
        });
        return json(res);
      }

      // --- ORG: TEMPLATES ---
      if (path === '/api/org/templates' && method === 'GET') {
        const user = await verifyOrgToken(request);
        if (!user) return json({ error: 'Non autorisé' }, 401);
        const { results } = await env.DB.prepare('SELECT t.*, u.full_name as assigned_comptable_name FROM org_task_templates t LEFT JOIN org_users u ON t.assigned_comptable_id = u.id WHERE t.organization_id = ? ORDER BY t.order_index').bind(user.organization_id).all();
        return json(results);
      }
      if (path === '/api/org/templates' && method === 'POST') {
        const user = await verifyOrgToken(request);
        if (!user || !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        const { label, requires_document, assigned_comptable_id, frequency, export_scope, month } = await request.json() as any;
        if (!label) return json({ error: 'Libellé requis' }, 400);
        if (export_scope !== undefined && export_scope !== null && !Array.isArray(export_scope)) return json({ error: 'Portée export invalide' }, 400);
        if (Array.isArray(export_scope) && export_scope.some((s: any) => !EXPORT_STATUSES.includes(s))) return json({ error: 'Portée export invalide' }, 400);
        if (month !== undefined && month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return json({ error: 'Mois invalide (1 à 12)' }, 400);
        if (frequency !== undefined && frequency !== 'mensuelle' && frequency !== 'trimestrielle' && frequency !== 'annuelle') {
          return json({ error: 'Fréquence invalide' }, 400);
        }
        const tmplFreq = frequency === 'mensuelle' || frequency === 'trimestrielle' ? frequency : 'annuelle';
        if (assigned_comptable_id) {
          const comp = await env.DB.prepare('SELECT id FROM org_users WHERE id = ? AND organization_id = ? AND role = ?').bind(assigned_comptable_id, user.organization_id, 'comptable').first();
          if (!comp) return json({ error: 'Comptable introuvable' }, 400);
        }
        const { results: maxOrder } = await env.DB.prepare('SELECT MAX(order_index) as mx FROM org_task_templates WHERE organization_id = ?').bind(user.organization_id).all() as any[];
        const id = genId();
        await env.DB.prepare('INSERT INTO org_task_templates (id, organization_id, label, order_index, requires_document, assigned_comptable_id, frequency, export_scope, month) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, user.organization_id, label, (maxOrder[0]?.mx || 0) + 1, requires_document ? 1 : 0, assigned_comptable_id || null, tmplFreq, export_scope === undefined ? null : parseExportScope(export_scope), month ?? null).run();
        return json({ id, label, assigned_comptable_id: assigned_comptable_id || null, frequency: tmplFreq, export_scope: export_scope === undefined ? null : parseExportScope(export_scope), month: month ?? null }, 201);
      }
      const orgTmplMatch = path.match(/^\/api\/org\/templates\/([^/]+)$/);
      if (orgTmplMatch && method === 'PATCH') {
        const user = await verifyOrgToken(request);
        if (!user || !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        const { assigned_comptable_id, label, requires_document, frequency, export_scope, month } = await request.json() as any;
        const tmpl = await env.DB.prepare('SELECT * FROM org_task_templates WHERE id = ? AND organization_id = ?').bind(orgTmplMatch[1], user.organization_id).first() as any;
        if (!tmpl) return json({ error: 'Modèle non trouvé' }, 404);
        if (month !== undefined && month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return json({ error: 'Mois invalide (1 à 12)' }, 400);
        if (export_scope !== undefined && export_scope !== null && !Array.isArray(export_scope)) return json({ error: 'Portée export invalide' }, 400);
        if (Array.isArray(export_scope) && export_scope.some((s: any) => !EXPORT_STATUSES.includes(s))) return json({ error: 'Portée export invalide' }, 400);
        if (assigned_comptable_id !== undefined && assigned_comptable_id !== null) {
          const comp = await env.DB.prepare('SELECT id FROM org_users WHERE id = ? AND organization_id = ? AND role = ?').bind(assigned_comptable_id, user.organization_id, 'comptable').first();
          if (!comp) return json({ error: 'Comptable introuvable' }, 400);
        }
        const updates: string[] = [];
        const binds: any[] = [];
        if (assigned_comptable_id !== undefined) { updates.push('assigned_comptable_id = ?'); binds.push(assigned_comptable_id || null); }
        if (label !== undefined && label.trim()) { updates.push('label = ?'); binds.push(label.trim()); }
        if (requires_document !== undefined) { updates.push('requires_document = ?'); binds.push(requires_document ? 1 : 0); }
        if (frequency !== undefined) {
          if (frequency !== 'mensuelle' && frequency !== 'trimestrielle' && frequency !== 'annuelle') return json({ error: 'Fréquence invalide' }, 400);
          updates.push('frequency = ?'); binds.push(frequency);
          // Une tache mensuelle/trimestrielle ne reste pas rattachee a un mois unique
          if (month === undefined && frequency !== 'annuelle') { updates.push('month = ?'); binds.push(null); }
        }
        if (export_scope !== undefined) { updates.push('export_scope = ?'); binds.push(parseExportScope(export_scope)); }
        if (month !== undefined) { updates.push('month = ?'); binds.push(month || null); }
        if (updates.length === 0) return json({ error: 'Rien à modifier' }, 400);
        binds.push(orgTmplMatch[1], user.organization_id);
        await env.DB.prepare(`UPDATE org_task_templates SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`).bind(...binds).run();
        await env.DB.prepare('INSERT INTO org_audit_log (id, organization_id, user_id, user_name, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), user.organization_id, user.id, user.full_name, 'template_updated', 'template', orgTmplMatch[1], JSON.stringify({ assigned_comptable_id: assigned_comptable_id !== undefined ? (assigned_comptable_id || null) : undefined, label, requires_document, frequency, month })).run();
        return json({ ok: true });
      }
      if (orgTmplMatch && method === 'DELETE') {
        const user = await verifyOrgToken(request);
        if (!user || !isSupervisor(user.role)) return json({ error: 'Réservé au rôle expert' }, 403);
        await env.DB.prepare('DELETE FROM org_task_templates WHERE id = ? AND organization_id = ?').bind(orgTmplMatch[1], user.organization_id).run();
        return json({ ok: true });
      }

      // --- ORG: SEED DATA ---
      if (path === '/api/org/seed' && method === 'POST') {
        // Check if already seeded
        const existing = await env.DB.prepare('SELECT id FROM organizations LIMIT 1').first();
        if (existing) return json({ ok: true, msg: 'Already seeded' });

        // Create organization
        const orgId = 'org_cabinet_001';
        await env.DB.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)').bind(orgId, 'EUREX').run();

        // Helper to create password hash
        const makeHash = async (pwd: string) => {
          const salt = crypto.randomUUID().slice(0, 16);
          const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pwd));
          const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
          return salt + ':' + hashHex;
        };

        // Users
        const expertHash = await makeHash('expert1234567');
        const managerHash = await makeHash('manager1234567');
        const comp1Hash = await makeHash('comptable1234567');
        const comp2Hash = await makeHash('comptable1234567');

        await env.DB.prepare('INSERT INTO org_users (id, organization_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)').bind('user_expert_001', orgId, 'Omar', 'expert@eurex.tn', expertHash, 'expert').run();
        // Manager : rôle expert stocké (CHECK DB) + role_label 'manager' pour l'affichage
        await env.DB.prepare('INSERT INTO org_users (id, organization_id, full_name, email, password_hash, role, role_label) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('user_manager_001', orgId, 'Abla', 'manager@eurex.tn', managerHash, 'expert', 'manager').run();
        await env.DB.prepare('INSERT INTO org_users (id, organization_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)').bind('user_comp_001', orgId, 'Ahmed Ben Ali', 'ahmed@eurex.tn', comp1Hash, 'comptable').run();
        await env.DB.prepare('INSERT INTO org_users (id, organization_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)').bind('user_comp_002', orgId, 'Fatma Trabelsi', 'fatma@eurex.tn', comp2Hash, 'comptable').run();

        // Task templates (order, requiresDoc, frequency, exportScope, month force)
        const templates: [string, number, number, string, string | null, number | null][] = [
          ['SAISIE Comptable et ERB', 1, 1, 'mensuelle', null, null],
          ['Dépôt DMI', 2, 0, 'mensuelle', null, null],
          ['Reporting mensuel', 3, 0, 'mensuelle', null, null],
          ['Préparation paie du mois', 4, 0, 'mensuelle', null, null],
          ['Préparation des certificats TEJ', 5, 0, 'mensuelle', null, null],
          ['Préparation déclaration CNSS trimestrielle', 6, 0, 'trimestrielle', null, null],
          ['Préparation et dépôt déclaration chiffre d\'affaire en suspension de TVA', 7, 0, 'trimestrielle', '["exportatrice","semi_exportatrice"]', null],
          ['Préparation et dépôt déclaration des achats en suspension de TVA', 8, 0, 'trimestrielle', '["exportatrice","semi_exportatrice"]', null],
          ['Préparation Etats financiers annuels', 9, 0, 'annuelle', null, null],
          ['Dépôt AP 1', 10, 0, 'annuelle', null, 6],
          ['Dépôt AP 2', 11, 0, 'annuelle', null, 9],
          ['Dépôt AP 3', 12, 0, 'annuelle', null, 12],
          ['Dépôt IS provisoire', 13, 0, 'annuelle', null, null],
          ['Dépôt IS définitive', 14, 0, 'annuelle', null, null],
          ['Dépôt de la déclaration employeur', 15, 0, 'annuelle', null, null],
          ['Préparation et dépôt de la liasse fiscale', 16, 0, 'annuelle', null, null],
          ['Renouvellement Autorisation d\'achat en suspension de TVA', 17, 0, 'annuelle', '["exportatrice","semi_exportatrice"]', null],
          ['Visa bon de commande en suspension de TVA', 18, 0, 'annuelle', '["exportatrice","semi_exportatrice"]', null],
          ['Préparation PV AGO approbation EF n-1', 19, 0, 'annuelle', null, null],
          ['Dépôt des EF n-1 et du PV AGO au RNE', 20, 0, 'annuelle', null, null],
        ];
        for (const [label, order, requiresDoc, freq, scope, month] of templates) {
          await env.DB.prepare('INSERT INTO org_task_templates (id, organization_id, label, order_index, requires_document, frequency, export_scope, month) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(genId(), orgId, label, order, requiresDoc, freq, scope, month).run();
        }

        // Clients
        const clients = [
          ['client_001', 'ANIMAL CITY', '1234567/H', 'user_comp_001', 'contact@animalcity.tn'],
          ['client_002', 'PROYASH METROPOLI', '2345678/A', 'user_comp_001', 'proyash@metropoli.tn'],
          ['client_003', 'TECH SOLUTIONS SARL', '3456789/B', 'user_comp_001', 'tech@solutions.tn'],
          ['client_004', 'CONSTRUCTION DELTA', '4567890/C', 'user_comp_002', 'delta@construction.tn'],
          ['client_005', 'RESTAURANT LE PALAIS', '5678901/D', 'user_comp_002', 'palais@restaurant.tn'],
        ] as const;
        for (const [id, name, mf, compId, email] of clients) {
          await env.DB.prepare('INSERT INTO org_clients (id, organization_id, assigned_comptable_id, name, matricule_fiscal, contact_email) VALUES (?, ?, ?, ?, ?, ?)').bind(id, orgId, compId, name, mf, email).run();
        }

        // Dossiers + tasks
        const dossierData = [
          { id: 'doss_001', clientId: 'client_001', status: 'en_cours', tasks: ['fait','fait','fait','fait','fait','a_faire','a_faire','a_faire','a_faire'] },
          { id: 'doss_002', clientId: 'client_002', status: 'en_cours', tasks: ['fait','fait','fait','bloque_client','a_faire','a_faire','a_faire','a_faire','a_faire'], blocked: [3] },
          { id: 'doss_003', clientId: 'client_003', status: 'en_cours', tasks: ['fait','fait','fait','fait','fait','fait','fait','a_faire','a_faire'] },
          { id: 'doss_004', clientId: 'client_004', status: 'en_cours', tasks: ['fait','bloque_client','bloque_client','a_faire','a_faire','a_faire','a_faire','a_faire','a_faire'], blocked: [1,2] },
          { id: 'doss_005', clientId: 'client_005', status: 'en_cours', tasks: ['fait','fait','fait','fait','a_faire','a_faire','a_faire','a_faire','a_faire'] },
        ];
        for (const dd of dossierData) {
          await env.DB.prepare('INSERT INTO org_dossiers (id, client_id, exercice, status) VALUES (?, ?, 2026, ?)').bind(dd.id, dd.clientId, dd.status).run();
          for (let i = 0; i < templates.length; i++) {
            const status = dd.tasks[i] || 'a_faire';
            const reason = (dd.blocked && dd.blocked.includes(i)) ? 'Document manquant — en attente client' : null;
            const freq = templates[i][3];
            if (freq === 'mensuelle') {
              // Tâche mensuelle : le statut du seed se place sur le mois courant (Septembre),
              // les 11 autres mois restent à faire.
              await env.DB.prepare('INSERT INTO org_tasks (id, dossier_id, label, status, blocked_reason, order_index, month, export_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, 9, ?, datetime(\'now\'))').bind(genId(), dd.id, templates[i][0], status, reason, i + 1, templates[i][4]).run();
              for (let m = 1; m <= 12; m++) {
                if (m === 9) continue;
                await env.DB.prepare('INSERT INTO org_tasks (id, dossier_id, label, status, order_index, month, export_scope, created_at) VALUES (?, ?, ?, \'a_faire\', ?, ?, ?, datetime(\'now\'))').bind(genId(), dd.id, templates[i][0], i + 1, m, templates[i][4]).run();
              }
            } else if (freq === 'trimestrielle') {
              // Tâche trimestrielle : Janv, Avr, Juil, Oct
              for (const m of [1, 4, 7, 10]) {
                await env.DB.prepare('INSERT INTO org_tasks (id, dossier_id, label, status, blocked_reason, order_index, month, export_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))').bind(genId(), dd.id, templates[i][0], status, reason, i + 1, m, templates[i][4]).run();
              }
            } else {
              const forcedMonth = templates[i][5];
              if (forcedMonth) {
                // Modele rattache a un mois precis (ex: Depots AP 1/2/3)
                await env.DB.prepare('INSERT INTO org_tasks (id, dossier_id, label, status, blocked_reason, order_index, month, export_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))').bind(genId(), dd.id, templates[i][0], status, reason, i + 1, forcedMonth, templates[i][4]).run();
              } else {
                await env.DB.prepare('INSERT INTO org_tasks (id, dossier_id, label, status, blocked_reason, order_index, export_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))').bind(genId(), dd.id, templates[i][0], status, reason, i + 1, templates[i][4]).run();
              }
            }
          }
        }
        // Portée export des tâches suspension TVA (seed) : exportatrices + semi-exportatrices
        const seedScope = '["exportatrice","semi_exportatrice"]';
        await env.DB.prepare('UPDATE org_task_templates SET export_scope = ? WHERE organization_id = ? AND label LIKE \'%suspension%\' AND label LIKE \'%TVA%\'').bind(seedScope, orgId).run();
        await env.DB.prepare('UPDATE org_tasks SET export_scope = ? WHERE label LIKE \'%suspension%\' AND label LIKE \'%TVA%\'').bind(seedScope).run();
        // Update cached progress
        for (const dd of dossierData) {
          await orgRecalcProgress(env.DB, dd.id);
        }

        return json({ ok: true, msg: 'Seeded', credentials: { expert: 'expert@eurex.tn / expert1234567', manager: 'manager@eurex.tn / manager1234567', comptable1: 'ahmed@eurex.tn / comptable1234567', comptable2: 'fatma@eurex.tn / comptable1234567' } });
      }

      return json({ error: 'Not found: ' + path }, 404);
    } catch (e: any) {
      return json({ error: e.message || 'Internal error' }, 500);
    }
  },
  // Cron 1er janvier (00:15 UTC) : passage automatique au nouvel exercice
  // cloture forcee du dossier n-1 + ouverture de l'exercice courant pour chaque client.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(rolloverAllOrganizations(env));
  },
};

// --- FISC ECRITURES GENERATOR ---
function generateFISCecritures(dmi: any, dossierId: string, societeId: string) {
  const { retenue_salaires, css, retenue_loyers, retenue_marches, tfp_du, foprolos_du, timbre_fiscal, tcl_du, total_general, tva_collectee, tva_deductible, tva_report_precedent, tva_resultat, tva_signe, mois, annee } = dmi;

  if (!total_general || total_general <= 0) return { error: 'total_general invalide' };

  const formatDate = (m: number, y: number) => `${y}-${String(m).padStart(2, '0')}-21`;
  const datePiece = formatDate(mois, annee);
  const numeroDoc = `DMI ${String(mois).padStart(2, '0')}-${String(annee).slice(-2)}`;

  const entries: any[] = [];
  const add = (compte: string, sens: string, montant: number, libelle: string, tresorerie?: string) => {
    if (Math.abs(montant) > 0.001) {
      entries.push({ dossier_id: dossierId, societe_id: societeId, journal_code: 'FISC', date_operation: datePiece, date_piece: datePiece, numero_doc: numeroDoc, libelle, compte, sens, montant: Math.round(montant * 1000) / 1000, tresorerie: tresorerie || null });
    }
  };

  // Piece A
  add('457100', 'D', total_general, 'Constatation oblig fiscales');
  if ((retenue_salaires || 0) > 0) add('432100', 'C', retenue_salaires, 'retenue salaires');
  if ((css || 0) > 0) add('432101', 'C', css, 'CSS');
  if ((retenue_loyers || 0) > 0) add('432300', 'C', retenue_loyers, 'retenue loyers');
  if ((retenue_marches || 0) > 0) add('432400', 'C', retenue_marches, 'retenue marches');
  if ((tfp_du || 0) > 0) add('437300', 'C', tfp_du, 'TFP');
  if ((foprolos_du || 0) > 0) add('437200', 'C', foprolos_du, 'FOPROLOS');
  if ((timbre_fiscal || 0) > 0) add('437500', 'C', timbre_fiscal, 'timbre fiscal');
  if ((tcl_du || 0) > 0) add('437400', 'C', tcl_du, 'TCL');
  if ((tva_resultat || 0) > 0) add('436510', 'C', tva_resultat, 'TVA resultat');

  // Piece B - TFP
  if ((tfp_du || 0) > 0) { add('661100', 'D', tfp_du, 'TFP'); add('437300', 'C', tfp_du, 'TFP'); }

  // Piece C - FOPROLOS
  if ((foprolos_du || 0) > 0) { add('661200', 'D', foprolos_du, 'FOPROLOS'); add('437200', 'C', foprolos_du, 'FOPROLOS'); }

  // Piece D - TCL
  if ((tcl_du || 0) > 0) { add('661300', 'D', tcl_du, 'TCL'); add('437400', 'C', tcl_du, 'TCL'); }

  // Piece E - RECLASS TVA
  if ((tva_collectee || 0) > 0) add('436710', 'D', tva_collectee, 'TVA collectee');
  if ((tva_deductible || 0) > 0) add('436660', 'C', tva_deductible, 'TVA deductible');
  if ((tva_report_precedent || 0) > 0) {
    if (tva_signe === 'ف') {
      add('436670', 'D', tva_report_precedent, 'TVA report precedent');
    } else {
      add('436670', 'C', tva_report_precedent, 'TVA report precedent');
    }
  }
  if ((tva_resultat || 0) > 0) {
    if (tva_signe === 'ب') {
      add('436510', 'C', tva_resultat, 'TVA resultat');
    } else {
      add('436510', 'D', tva_resultat, 'TVA resultat');
    }
  }

  return { entries, dmi };
}

// ===== EF AI VERIFICATION =====
async function handleEFVerify(request: Request, env: Env): Promise<Response> {
  const b = await request.json() as any;
  const { actif, passif, resultat, sig, flux, nomSociete, anneeN, balanceN, balanceN1 } = b;

  const actifTotal = ((actif?.immoIncorpBrut || 0) - (actif?.immoIncorpAmort || 0)) +
    ((actif?.immoCorpBrut || 0) - (actif?.immoCorpAmort || 0)) +
    ((actif?.immoFinancBrut || 0) - (actif?.immoFinancProv || 0)) +
    (actif?.autresActifsNonCourants || 0) +
    ((actif?.stocks || 0) - (actif?.stocksProv || 0)) +
    ((actif?.clients || 0) - (actif?.clientsProv || 0)) +
    (actif?.autresActifsCourants || 0) + (actif?.tresorerie || 0);

  const passifTotal = (passif?.capitalSocial || 0) + (passif?.reserves || 0) +
    (passif?.resultatsReportes || 0) + (passif?.resultatExercice || 0) +
    (passif?.emprunts || 0) + (passif?.autresPassifsFinanciers || 0) +
    (passif?.provisions || 0) + (passif?.fournisseurs || 0) +
    (passif?.autresPassifsCourants || 0) + (passif?.concoursBancaires || 0);

  // Fix sign convention: products (70x) are negative in balance (credit), charges (60x) are positive (debit)
  // AI expects: products positive, charges positive, result = products - charges
  const totalProdAbs = Math.abs((resultat?.revenus || 0)) + Math.abs((resultat?.autresProduitsExploit || 0));
  const totalChargesAbs = Math.abs((resultat?.achatsConsommes || 0)) + Math.abs((resultat?.chargesPersonnel || 0)) +
    Math.abs((resultat?.dotationsAmort || 0)) + Math.abs((resultat?.autresChargesExploit || 0));
  const totalProd = totalProdAbs;
  const totalCharges = totalChargesAbs;
  const resExploit = totalProd - totalCharges;
  const chargesFinNettes = Math.abs((resultat?.chargesFinancieres || 0)) - Math.abs((resultat?.produitsPlacements || 0));
  const resAvantImpot = resExploit - chargesFinNettes + Math.abs((resultat?.autresGainsOrdinaires || 0)) - Math.abs((resultat?.autresPertesOrdinaires || 0));
  const resNet = resAvantImpot - Math.abs((resultat?.impotBenefices || 0)) + (resultat?.elementsExtraordinaires || 0);

  const margeComm = Math.abs((sig?.ventesMarchandises || 0)) - Math.abs((sig?.cAchatMarchandises || 0));
  const prodExercice = Math.abs((sig?.revenus || 0)) + Math.abs((sig?.productionStockee || 0));
  const margeBrute = margeComm + prodExercice - Math.abs((sig?.achatsConsommes || 0));
  const VABrute = margeBrute + Math.abs((sig?.subventionExploit || 0)) + Math.abs((sig?.autresChargesExternes || 0));
  const EBE = VABrute - Math.abs((sig?.impotsTaxes || 0)) - Math.abs((sig?.chargesPersonnel || 0));

  // Build balance summary for AI context
  const buildBalanceSummary = (bal: any[], label: string) => {
    if (!bal || bal.length === 0) return '';
    const top = bal.filter((l: any) => Math.abs(l.solde || 0) > 100)
      .sort((a: any, b: any) => Math.abs(b.solde || 0) - Math.abs(a.solde || 0))
      .slice(0, 40);
    return `\nBALANCE ${label} (top comptes):\n${top.map((l: any) => `  ${l.compte} ${l.libelle || ''}: D=${l.debit || 0} C=${l.credit || 0} solde=${l.solde || 0}`).join('\n')}`;
  };

  const prompt = `Expert comptable tunisien PCG. Verifie ces EF de "${nomSociete || '?'}" exercice ${anneeN || 2025}.

BILAN: Actif=${Math.round(actifTotal*1000)/1000}, Passif+CP=${Math.round(passifTotal*1000)/1000}, Ecart=${Math.round((actifTotal - passifTotal)*1000)/1000}
PASSIF: Capital=${passif?.capitalSocial||0}, Reserves=${passif?.reserves||0}, ResExercice=${passif?.resultatExercice||0}
RESULTAT: Produits=${totalProd}, Charges=${totalCharges}, ResExploit=${resExploit}, ResNet=${resNet}
SIG: MargeComm=${margeComm}, MargeBrute=${margeBrute}, VA=${VABrute}, EBE=${EBE}
${buildBalanceSummary(balanceN, `${anneeN}`)}
${buildBalanceSummary(balanceN1, `${(anneeN || 2025) - 1}`)}

Verifie UNIQUEMENT ces regles:
1) Actif ≈ Passif+CP (ecart max 1 dinar)
2) Non-compensation: pas de compensation charges/produits
3) Classification: immo 2x=non-courant, stocks 3x/clients 41/fournisseurs 40=courant
4) Verifie que les totaux des bilans correspondent aux comptes de la balance
5) Verifie que les produits et charges correspondent aux comptes 70x/60x de la balance

IMPORTANT: Ne verifie PAS les formules de calcul (MargeComm, MargeBrute, etc). Verifie UNIQUEMENT la coherence interne avec la balance. Si tout est OK, mets errors=[].
Reponds JSON: {"ok":bool,"errors":[],"summary":"2-3 lignes"} UNIQUEMENT JSON.`;

  try {
    const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [
        { role: 'system', content: 'Tu es un expert comptable tunisien PCG. Tu réponds UNIQUEMENT en JSON valide, jamais de texte ni de code.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    });
    const rawResponse = aiResponse?.response || aiResponse?.result?.response || '';
    let responseStr = typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse);
    let parsed;
    try {
      parsed = JSON.parse(responseStr);
      if (!parsed.errors) throw new Error('no errors');
    } catch {
      try {
        const jsonMatch = responseStr.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { ok: false, summary: responseStr.substring(0, 200), errors: [], suggestions: [] };
      } catch {
        parsed = { ok: false, summary: responseStr.substring(0, 200), errors: [], suggestions: [] };
      }
    }
    return json({ ok: true, ...parsed });
  } catch (e: any) {
    return json({ error: 'AI error: ' + e.message }, 500);
  }
}

// ============================================================
// EF — AI TAB AMT GENERATION
// ============================================================
async function handleEFTabAmt(request: Request, env: Env): Promise<Response> {
  const b = await request.json() as any;
  const { balanceN, balanceN1, immob, nomSociete, anneeN } = b;

  const immoLines = (balanceN || []).filter((l: any) => l.compte?.startsWith('22') && Math.abs(l.solde || 0) > 0);
  const amortLines = (balanceN || []).filter((l: any) => l.compte?.startsWith('28') && Math.abs(l.solde || 0) > 0);
  const immoIncorp = (balanceN || []).filter((l: any) => l.compte?.startsWith('21') && Math.abs(l.solde || 0) > 0);
  const amortIncorp = (balanceN || []).filter((l: any) => l.compte?.startsWith('281') && Math.abs(l.solde || 0) > 0);

  const immoLinesN1 = (balanceN1 || []).filter((l: any) => l.compte?.startsWith('22') && Math.abs(l.solde || 0) > 0);
  const amortLinesN1 = (balanceN1 || []).filter((l: any) => l.compte?.startsWith('28') && Math.abs(l.solde || 0) > 0);

  const immoDetail = immoLines.map((l: any) => {
    const code = l.compte;
    const trySwap = '28' + code.slice(2);
    const amort = amortLines.find((a: any) => a.compte === trySwap);
    const n1 = immoLinesN1.find((n: any) => n.compte === code);
    const amortN1 = amortLinesN1.find((a: any) => a.compte === trySwap);
    return {
      code, libelle: l.libelle || l.compte, vbN: Math.abs(l.solde),
      amortN: amort ? Math.abs(amort.solde) : 0,
      vbN1: n1 ? Math.abs(n1.solde) : 0,
      amortN1: amortN1 ? Math.abs(amortN1.solde) : 0,
    };
  });

  const immoIncorpDetail = immoIncorp.map((l: any) => {
    const amort = amortIncorp.find((a: any) => a.compte === '28' + l.compte.slice(2));
    const n1 = (balanceN1 || []).find((n: any) => n.compte === l.compte);
    const amortN1 = (balanceN1 || []).filter((a: any) => a.compte?.startsWith('281')).find((a: any) => a.compte === '28' + l.compte.slice(2));
    return {
      code: l.compte, libelle: l.libelle || l.compte, vbN: Math.abs(l.solde),
      amortN: amort ? Math.abs(amort.solde) : 0,
      vbN1: n1 ? Math.abs(n1.solde) : 0,
      amortN1: amortN1 ? Math.abs(amortN1.solde) : 0,
    };
  });

  const prompt = `Tu es un expert comptable tunisien PCG. Genere le TABLEAU DES IMMOBILISATIONS ET AMORTISSEMENTS pour "${nomSociete || '?'}" exercice ${anneeN || 2025}.

DONNEES EXACTES DE LA BALANCE (applique les regles PCG):
${immoIncorpDetail.length > 0 ? immoIncorpDetail.map((l: any) => `Compte ${l.code} "${l.libelle}": VBouverture_N1=${l.vbN1}, Amort_N1=${l.amortN1}, VBcloture_N=${l.vbN}, Amort_N=${l.amortN}`).join('\n') : 'Aucune immo incorporelle'}
${immoDetail.length > 0 ? immoDetail.map((l: any) => `Compte ${l.code} "${l.libelle}": VBouverture_N1=${l.vbN1}, Amort_N1=${l.amortN1}, VBcloture_N=${l.vbN}, Amort_N=${l.amortN}`).join('\n') : 'Aucune immo corporelle'}
${(balanceN || []).filter((l: any) => l.compte?.startsWith('25') && Math.abs(l.solde || 0) > 0).map((l: any) => `Compte ${l.compte} "${l.libelle}": VBcloture_N=${Math.abs(l.solde)}`).join('\n') || 'Aucune immo financiere'}

REGLES PCG ( applique exactement):
- VB_N (cloture) = valeur brute a la fin de l'exercice (compte 22x debit)
- VB_N1 (ouverture) = valeur brute N-1 (compte 22x N-1)
- Amort_N (cloture) = amortissements cumules fin N (compte 28x credit)
- Amort_N1 (ouverture) = amortissements cumules N-1 (compte 28x N-1)
- Acquisitions = VB_N - VB_N1 + Cessions (si pas de cessions, acq = VB_N - VB_N1)
- Dotations = Amort_N - Amort_N1 + Regul (si pas de regul, dot = Amort_N - Amort_N1)
- VCN = VB_N - Amort_N
- Les immobilisations incorporelles (21x): vbN1, amortN1, vbN, amortN viennent des comptes 21x et 281x
- Les immobilisations corporelles (22x): vbN1, amortN1, vbN, amortN viennent des comptes 22x et 282x/284x/292x/293x/294x
- Les immobilisations financieres (25x-26x): vbN des comptes 25x/26x, amort des 295x/296x/297x

IMPORTANT: Utilise les MONTANTS EXACTS donnes ci-dessus. Ne calcule pas, ne cherche pas, ne guess pas. Copie les valeurs exactes de la balance.

Reponds UNIQUEMENT en JSON. Format:
{"lignes":[{"cat":"nom du compte","vbN":montant,"acq":0,"ces":0,"dot":0,"reg":0,"vbN1":montant,"amortN1":montant}],"summary":"description"}
Chaque ligne = 1 compte 22x individuel. Ajoute les lignes totaux: "Immobilisations incorporelles", "Immobilisations corporelles (total)", "Immobilisations financieres", "GRAND TOTAL".
Pour les totaux: somme les lignes individuelles.
Reponds UNIQUEMENT avec le JSON, rien d'autre.`;

  try {
    const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [
        { role: 'system', content: 'Tu es un expert comptable. Tu réponds UNIQUEMENT en JSON valide, jamais de texte ni de code.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    });
    const rawResponse = aiResponse?.response || aiResponse?.result?.response || '';
    let responseStr = typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse);
    let parsed;
    try {
      parsed = JSON.parse(responseStr);
      if (!parsed.lignes) throw new Error('no lignes');
    } catch {
      try {
        const jsonMatch = responseStr.match(/\{[\s\S]*"lignes"[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { lignes: [], summary: responseStr.substring(0, 200) };
      } catch {
        parsed = { lignes: [], summary: responseStr.substring(0, 200) };
      }
    }
    return json({ ok: true, ...parsed });
  } catch (e: any) {
    return json({ error: 'AI error: ' + e.message }, 500);
  }
}
