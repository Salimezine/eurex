const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const EXP = { email: 'expert@eurex.tn', pwd: 'expert1234567' };
const SAL = { email: 'salim@eurex.tn', pwd: 'salim1234567' };
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
async function j(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok && (!opt || !opt.allowFail)) throw new Error(url + ' -> ' + r.status + ' : ' + (await r.text().catch(() => '')));
  return r.json();
}
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
const pad2 = n => String(n).padStart(2, '0');
const now = new Date(Date.now() + 3600000);
const Y = now.getUTCFullYear(), M = now.getUTCMonth() + 1;
const dayCell = d => `${Y}-${pad2(M)}-${pad2(d)}`;
// mois suivant / précédent pour la navigation
const nextM = new Date(Date.UTC(Y, M, 1));
const nextPrefix = `${nextM.getUTCFullYear()}-${pad2(nextM.getUTCMonth() + 1)}`;

(async () => {
  const lh = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EXP.email, password: EXP.pwd }) });
  const HE = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lh.token };
  const ls = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAL.email, password: SAL.pwd }) });
  const HS = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ls.token };

  const ts = Date.now().toString().slice(-6);
  const zz = 'ZZ-PLAN-' + ts;
  const alertGlobal = 'PLANNING-ALERT-' + ts;
  const alertDossier = 'PLANNING-DOSS-' + ts;
  const taskLabel = 'PLANNING-TASK-' + ts;
  const alertIds = [];
  const cleanup = async () => {
    for (const id of alertIds) {
      try { await j(API + '/api/org/alerts/' + id, { method: 'DELETE', headers: HE }); }
      catch (e) { console.log('!! cleanup alert ' + id + ': ' + e.message); fails++; }
    }
    try { await j(API + '/api/org/clients/' + clientId, { method: 'DELETE', headers: HE }); console.log('CLEANUP: ' + zz + ' supprimé (cascade) + ' + alertIds.length + ' échéance(s)'); }
    catch (e) { console.log('!! CLEANUP FAILED: ' + e.message); fails++; }
  };

  let clientId = null, dossierId = null;
  try {
    // --- Setup API ---
    const c = await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz, assigned_comptable_id: 'user_comp_001' }) });
    clientId = c.id;
    const d = await j(API + '/api/org/clients/' + c.id + '/dossiers', { method: 'POST', headers: HE, body: JSON.stringify({ exercice: 2026 }) });
    dossierId = d.id;
    const a1 = await j(API + '/api/org/alerts', { method: 'POST', headers: HE, body: JSON.stringify({ title: alertGlobal, due_date: dayCell(20), lead_days: 5 }) });
    alertIds.push(a1.id);
    const a2 = await j(API + '/api/org/alerts', { method: 'POST', headers: HE, body: JSON.stringify({ title: alertDossier, due_date: dayCell(25), lead_days: 3, dossier_id: dossierId }) });
    alertIds.push(a2.id);
    const t1 = await j(API + '/api/org/dossiers/' + dossierId + '/tasks', { method: 'POST', headers: HS, body: JSON.stringify({ label: taskLabel, due_date: dayCell(12) }) });
    console.log('SETUP client=' + clientId + ' dossier=' + dossierId + ' alerts=' + alertIds.join(',') + ' task=' + t1.id);

    // A. Le feed contient bien les 3 événements sur le mois courant
    const feed = await j(API + '/api/org/alerts', { headers: HE });
    ok(feed.alerts.some(a => a.title === alertGlobal && a.due_date === dayCell(20)), 'A1: échéance globale dans le feed (' + dayCell(20) + ')');
    ok(feed.alerts.some(a => a.title === alertDossier && a.due_date === dayCell(25)), 'A2: échéance dossier dans le feed');
    ok(feed.tasks.some(t => t.label === taskLabel && t.due_date === dayCell(12)), 'A3: tâche à date butoir dans le feed');

    const browser = await chromium.launch();
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    try {
      // --- B. UI expert ---
      await loginAs(page, EXP.email, EXP.pwd);
      await page.waitForSelector('[data-testid="planning-nav"]', { timeout: 20000 });
      ok(await page.locator('[data-testid="planning-nav"]').isVisible(), 'B1: bouton « 📅 Planning » visible');
      await page.click('[data-testid="planning-nav"]');
      await page.waitForSelector('[data-testid="planning-grid"]', { timeout: 15000 });
      ok(page.url().includes('/cabinet/planning'), 'B1b: navigation vers /cabinet/planning');
      ok(await page.locator('[data-testid="planning-page"]').count() === 1, 'B1c: page planning rendue');

      const cell20 = page.locator(`[data-testid="planning-day-${dayCell(20)}"]`);
      const cell12 = page.locator(`[data-testid="planning-day-${dayCell(12)}"]`);
      const cell25 = page.locator(`[data-testid="planning-day-${dayCell(25)}"]`);
      // la grille rend avant le feed : on attend les événements eux-mêmes
      await cell20.locator('[data-testid="planning-event"]').first().waitFor({ timeout: 20000 }).catch(() => {});
      await cell12.locator('[data-testid="planning-event"]').first().waitFor({ timeout: 20000 }).catch(() => {});
      await cell25.locator('[data-testid="planning-event"]').first().waitFor({ timeout: 20000 }).catch(() => {});
      ok(await cell20.count() === 1 && (await cell20.innerText()).includes(alertGlobal), 'B2: échéance globale le ' + dayCell(20));
      ok(await cell12.count() === 1 && (await cell12.innerText()).includes(taskLabel), 'B3: tâche le ' + dayCell(12));
      ok(await cell25.count() === 1 && (await cell25.innerText()).includes(alertDossier), 'B4: échéance dossier le ' + dayCell(25));

      // Clic sur l'échéance liée au dossier -> ouvre le dossier
      const ev25 = cell25.locator('[data-testid="planning-event"]').first();
      await ev25.click();
      await page.waitForTimeout(1500);
      ok(page.url().includes('/cabinet/dossier/' + dossierId), 'B5: clic -> ouverture du dossier (' + page.url().split('/cabinet')[1] + ')');

      // Navigation de mois
      await page.goto(BASE + '/cabinet/planning', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="planning-grid"]', { timeout: 15000 });
      await page.click('[data-testid="planning-next"]');
      await page.waitForTimeout(600);
      const nextText = await page.locator('[data-testid="planning-page"]').innerText();
      ok(nextText.includes(alertGlobal) === false && nextText.includes(taskLabel) === false, 'B6: mois suivant sans nos événements');
      const nextCell = page.locator(`[data-testid="planning-day-${nextPrefix}-${pad2(20)}"]`);
      ok(await nextCell.count() === 1, 'B6b: grille du mois suivant rendue (' + nextPrefix + ')');
      await page.click('[data-testid="planning-today"]');
      await page.waitForTimeout(600);
      const todayText = await page.locator('[data-testid="planning-page"]').innerText();
      ok(todayText.includes(alertGlobal) && todayText.includes(taskLabel), 'B7: retour « Aujourd\'hui » -> événements visibles');

      // --- C. Portée comptable (Salim) ---
      await loginAs(page, SAL.email, SAL.pwd);
      await page.waitForSelector('[data-testid="planning-nav"]', { timeout: 20000 });
      await page.click('[data-testid="planning-nav"]');
      await page.waitForSelector('[data-testid="planning-grid"]', { timeout: 15000 });
      const c20 = page.locator(`[data-testid="planning-day-${dayCell(20)}"]`);
      const c12 = page.locator(`[data-testid="planning-day-${dayCell(12)}"]`);
      const c25 = page.locator(`[data-testid="planning-day-${dayCell(25)}"]`);
      await c12.locator('[data-testid="planning-event"]').first().waitFor({ timeout: 20000 }).catch(() => {});
      await c25.locator('[data-testid="planning-event"]').first().waitFor({ timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(500);
      ok(await c20.count() === 1 && !(await c20.innerText()).includes(alertGlobal), 'C1: Salim ne voit PAS l échéance globale (portée)');
      ok(await c12.count() === 1 && (await c12.innerText()).includes(taskLabel), 'C2: Salim voit la tâche de son dossier');
      ok(await c25.count() === 1 && (await c25.innerText()).includes(alertDossier), 'C3: Salim voit l échéance de son dossier');

      ok(errors.length === 0, 'C4: aucune erreur JS (' + errors.length + ')');
    } catch (e) {
      ok(false, 'ERREUR UI: ' + e.message);
    } finally {
      await browser.close();
    }
  } finally {
    await cleanup();
  }

  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAIL');
  process.exit(fails ? 1 : 0);
})();
