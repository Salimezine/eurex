// test29 — Tâche optionnelle « Reporting mensuel » (masquer / restaurer par dossier)
//           + liste des saisies temps (durée, auteur, date, note) sous chaque tâche
const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const EXP = { email: 'expert@eurex.tn', pwd: 'expert1234567' };
const SAL = { email: 'salim@eurex.tn', pwd: 'salim1234567' };
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
const JSON_ = { 'Content-Type': 'application/json' };
const auth = tok => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok });
async function j(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(url + ' -> ' + r.status + ' : ' + (await r.text().catch(() => '')));
  return r.json();
}
const raw = (url, opt) => fetch(url, opt).then(r => r.json().catch(() => ({})).then(b => ({ s: r.status, b })));
const post = (url, headers, body) => j(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
const get = (url, headers) => j(url, { headers });
async function loginAs(p, email, pwd) {
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => { localStorage.clear(); sessionStorage.setItem('eurex_authorized', '1'); });
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[name="email"]', { timeout: 20000 });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', pwd);
  await p.click('button[type="submit"]');
  await p.waitForTimeout(1500);
}
const REPORTING = 'Reporting mensuel';
const repSig = d => (d.tasks || []).filter(t => t.label === REPORTING).map(t => `${t.month}:${t.status}`).sort().join(',');
const repRows = p => p.locator('[data-testid="task-row"]', { hasText: REPORTING });
const addTime = async (p, mm, note) => {
  await repRows(p).first().locator('button', { hasText: 'Temps' }).first().click();
  await p.waitForTimeout(300);
  const r = repRows(p).first();
  await r.locator('input[placeholder="hh"]').fill('0');
  await r.locator('input[placeholder="mm"]').fill(mm);
  await r.locator('input[placeholder="Note : sur quoi porte ce temps ?"]').fill(note);
  await r.locator('button', { hasText: '✓ Ajouter' }).click();
  await p.waitForTimeout(2500);
};

(async () => {
  const te = await post(API + '/api/org/auth/login', JSON_, { email: EXP.email, password: EXP.pwd });
  const HE = auth(te.token);
  const zz = 'ZZ-REP-' + Date.now().toString().slice(-6);
  let client = null;
  try {
    // ================= A) API =================
    const d0 = await get(API + '/api/org/dossiers/doss_001', HE);
    const rep0 = (d0.tasks || []).filter(t => t.label === REPORTING);
    ok(rep0.length === 12, 'A1: 12 tâches « ' + REPORTING + ' » visibles (' + rep0.length + ')');
    ok(d0.reporting && d0.reporting.total === 12 && d0.reporting.hidden === 0, 'A2: reporting = {total:' + (d0.reporting && d0.reporting.total) + ', hidden:' + (d0.reporting && d0.reporting.hidden) + '}');
    const st0 = d0.task_stats.total, sig0 = repSig(d0);

    const h1 = await post(API + '/api/org/dossiers/doss_001/reporting/hide', HE);
    ok(h1.ok && h1.count === 12 && h1.reporting.hidden === 12, 'A3: masquage = 12 tâches (count ' + h1.count + ', hidden ' + h1.reporting.hidden + ')');
    const d1 = await get(API + '/api/org/dossiers/doss_001', HE);
    ok((d1.tasks || []).filter(t => t.label === REPORTING).length === 0, 'A4: plus aucune tâche visible');
    ok(d1.task_stats.total === st0 - 12, 'A5: KPI dossier ' + st0 + ' → ' + d1.task_stats.total + ' (-12)');
    const h2 = await post(API + '/api/org/dossiers/doss_001/reporting/hide', HE);
    ok(h2.ok && h2.count === 0, 'A6: 2e masquage idempotent (count ' + h2.count + ')');
    const list = await get(API + '/api/org/dossiers', HE);
    const row0 = (list || []).find(x => x.id === 'doss_001');
    ok(row0 && row0.task_stats.total === st0 - 12, 'A7: liste « tous les dossiers » exclut les masquées (' + (row0 && row0.task_stats.total) + ')');

    const r1 = await post(API + '/api/org/dossiers/doss_001/reporting/restore', HE);
    ok(r1.ok && r1.count === 12 && r1.created === 0, 'A8: restauration = 12 (création ' + r1.created + ')');
    const d2 = await get(API + '/api/org/dossiers/doss_001', HE);
    ok((d2.tasks || []).filter(t => t.label === REPORTING).length === 12, 'A9: 12 tâches de retour');
    ok(d2.task_stats.total === st0, 'A10: KPI rétabli (' + d2.task_stats.total + ')');
    ok(repSig(d2) === sig0, 'A11: statuts/mois identiques avant/après');

    // Droits : le comptable a aussi le droit (choix explicite)
    const tS = await post(API + '/api/org/auth/login', JSON_, { email: SAL.email, password: SAL.pwd });
    const HS = auth(tS.token);
    const ch = await post(API + '/api/org/dossiers/doss_001/reporting/hide', HS);
    ok(ch.ok && ch.count === 12, 'A12: comptable peut masquer (' + ch.count + ')');
    const cr = await post(API + '/api/org/dossiers/doss_001/reporting/restore', HS);
    ok(cr.ok && cr.count === 12, 'A13: comptable peut restaurer (' + cr.count + ')');

    // Tâche totalement absente du dossier → la restauration la (re)crée sur les 12 mois
    const comps = await get(API + '/api/org/comptables', HE);
    const comp = comps.find(c => c.id === 'user_comp_001') || comps.find(c => c.role === 'comptable' && c.is_active);
    client = await post(API + '/api/org/clients', HE, { name: zz, assigned_comptable_id: comp.id });
    const dd = await post(API + `/api/org/clients/${client.id}/dossiers`, HE, { exercice: 2026, assigned_comptable_id: comp.id });
    const full = await get(API + `/api/org/dossiers/${dd.id}`, HE);
    for (const t of (full.tasks || []).filter(t => t.label === REPORTING)) {
      await raw(API + `/api/org/dossiers/${dd.id}/tasks/${t.id}`, { method: 'DELETE', headers: HE });
    }
    const e0 = await get(API + `/api/org/dossiers/${dd.id}`, HE);
    ok(e0.reporting.total === 0, 'A14: tâche absente du dossier de test (total ' + e0.reporting.total + ')');
    const rc = await post(API + `/api/org/dossiers/${dd.id}/reporting/restore`, HE);
    ok(rc.ok && rc.created === 12 && rc.reporting.total === 12, 'A15: restauration → recréation des 12 mois (created ' + rc.created + ')');
    const e1 = await get(API + `/api/org/dossiers/${dd.id}`, HE);
    const rec = (e1.tasks || []).filter(t => t.label === REPORTING);
    ok(rec.length === 12 && rec.every(t => t.status === 'a_faire'), 'A16: 12 tâches recréées à "à faire"');

    // ================= B) UI (expert) =================
    const b = await chromium.launch();
    const p = await b.newPage();
    let dialogs = 0;
    p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
    p.on('dialog', async d => { dialogs++; console.log('!! DIALOG: ' + d.message()); await d.accept(); });
    try {
      await loginAs(p, EXP.email, EXP.pwd);
      await p.goto(BASE + '/cabinet/dossier/doss_001', { waitUntil: 'domcontentloaded' });
      const tog = p.locator('[data-testid="reporting-toggle"]');
      ok(await tog.waitFor({ timeout: 30000 }).then(() => true).catch(() => false), 'B1: bouton masquer/restaurer présent');
      ok(/Masquer/.test(await tog.textContent() || ''), 'B2: état initial = « Masquer »');
      await repRows(p).first().waitFor({ timeout: 20000 });
      ok(await repRows(p).count() >= 1, 'B3: tâche « ' + REPORTING + ' » visible (' + await repRows(p).count() + ' ligne(s) ce mois)');

      // --- 1ère saisie temps (avec note) inscrite sous la tâche ---
      await repRows(p).first().click();
      await p.waitForTimeout(400);
      ok(await repRows(p).first().locator('button', { hasText: 'Temps' }).count() > 0, 'B4: bouton « ➕ Temps » disponible (tâche non terminée)');
      await addTime(p, '5', 'ZZ-REP-NOTE-1 saisie du matin');
      const entries1 = repRows(p).first().locator('[data-testid="task-time-entry"]');
      ok(await entries1.count() === 1, 'B5: 1ère saisie inscrite sous la tâche (' + await entries1.count() + ')');
      ok(/ZZ-REP-NOTE-1/.test(await entries1.first().textContent() || ''), 'B6: la note de la saisie est affichée');

      // --- 2ème saisie : une autre note, elle aussi enregistrée sous la tâche ---
      await addTime(p, '3', 'ZZ-REP-NOTE-2 saisie de l apres-midi');
      const entries2 = repRows(p).first().locator('[data-testid="task-time-entry"]');
      ok(await entries2.count() === 2, 'B7: 2 saisies cumulées sous la tâche (' + await entries2.count() + ')');
      const allTxt = (await entries2.allTextContents()).join('|');
      ok(/ZZ-REP-NOTE-1/.test(allTxt) && /ZZ-REP-NOTE-2/.test(allTxt), 'B8: les 2 notes sont visibles');

      // --- Masquage via l'UI ---
      await tog.click();
      await p.waitForTimeout(3000);
      ok(dialogs >= 1, 'B9: confirmation demandée (' + dialogs + ')');
      ok(/Restaurer/.test(await tog.textContent() || ''), 'B10: état après masquage = « Restaurer »');
      ok(await repRows(p).count() === 0, 'B11: la tâche a disparu de la checklist (' + await repRows(p).count() + ')');

      // --- Restauration via l'UI ---
      await tog.click();
      await p.waitForTimeout(3000);
      ok(/Masquer/.test(await tog.textContent() || ''), 'B12: état après restauration = « Masquer »');
      await repRows(p).first().waitFor({ timeout: 20000 });
      ok(await repRows(p).count() >= 1, 'B13: tâche de retour dans la checklist');

      // Les heures saisies ont survécu au masquage/restauration
      await repRows(p).first().click();
      await p.waitForTimeout(600);
      const entries3 = repRows(p).first().locator('[data-testid="task-time-entry"]');
      ok(await entries3.count() === 2, 'B14: les 2 saisies sont toujours là après restauration (' + await entries3.count() + ')');
    } finally {
      await b.close();
    }
  } finally {
    if (client) {
      const dc = await fetch(API + `/api/org/clients/${client.id}`, { method: 'DELETE', headers: HE });
      ok(dc.status === 200, 'Z1: nettoyage dossier de test (' + dc.status + ')');
    }
    const fin = await get(API + '/api/org/dossiers/doss_001', HE);
    if (fin.reporting && fin.reporting.hidden > 0) {
      await post(API + '/api/org/dossiers/doss_001/reporting/restore', HE);
      console.log('Z2: doss_001 restauré (était masqué)');
    } else {
      console.log('Z2: doss_001 déjà visible');
    }
  }
  console.log(fails === 0 ? '\nALL PASS' : '\nFAILURES: ' + fails);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
