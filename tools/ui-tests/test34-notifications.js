const { chromium } = require('playwright');
const { execSync } = require('child_process');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const API_DIR = 'C:\\Users\\safa.dhaoui\\Documents\\Default Project\\eurex\\api';
const EXP = { email: 'expert@eurex.tn', pwd: 'expert1234567' };
const SAL = { email: 'salim@eurex.tn', pwd: 'salim1234567' };
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
async function j(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok && (!opt || !opt.allowFail)) throw new Error(url + ' -> ' + r.status + ' : ' + (await r.text().catch(() => '')));
  return { status: r.status, body: await r.json().catch(() => ({})) };
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
const d1 = sql => execSync(
  `npx wrangler d1 execute eurex-db --remote --json --command "${sql}"`,
  { cwd: API_DIR, stdio: 'pipe', timeout: 90000 }
);

(async () => {
  const lh = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EXP.email, password: EXP.pwd }) });
  const HE = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lh.body.token };
  const ls = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAL.email, password: SAL.pwd }) });
  const HS = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ls.body.token };

  const ts = Date.now().toString().slice(-6);
  const zz = 'ZZ-NOTIF-' + ts;
  const lateLabel = 'NOTIF-LATE-' + ts;
  const verifyLabel = 'NOTIF-VERIFY-' + ts;
  const alertDossier = 'NOTIF-DOSS-' + ts;
  const alertGlobal = 'NOTIF-GLOB-' + ts;
  const day = off => new Date(Date.now() + off * 86400000 + 3600000).toISOString().slice(0, 10);
  const alertIds = [];
  let clientId = null, dossierId = null;
  const cleanup = async () => {
    for (const id of alertIds) {
      try { await j(API + '/api/org/alerts/' + id, { method: 'DELETE', headers: HE }); }
      catch (e) { console.log('!! cleanup alert ' + id + ': ' + e.message); fails++; }
    }
    try { await j(API + '/api/org/clients/' + clientId, { method: 'DELETE', headers: HE }); console.log('CLEANUP: ' + zz + ' supprimé (cascade) + ' + alertIds.length + ' échéance(s)'); }
    catch (e) { console.log('!! CLEANUP FAILED: ' + e.message); fails++; }
  };

  try {
    // --- Setup API ---
    const c = await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz, assigned_comptable_id: 'user_comp_001' }) });
    clientId = c.body.id;
    const d = await j(API + '/api/org/clients/' + c.id + '/dossiers', { method: 'POST', headers: HE, body: JSON.stringify({ exercice: 2026 }) });
    dossierId = d.body.id;

    // 1) Tâche en retard (hier) -> notification Salim
    const tLate = await j(API + '/api/org/dossiers/' + dossierId + '/tasks', { method: 'POST', headers: HS, body: JSON.stringify({ label: lateLabel, due_date: day(-1) }) });
    // 2) Échéance dossier dans la fenêtre de relance -> notification Salim
    const aD = await j(API + '/api/org/alerts', { method: 'POST', headers: HE, body: JSON.stringify({ title: alertDossier, due_date: day(1), lead_days: 5, dossier_id: dossierId }) });
    alertIds.push(aD.body.id);
    // 3) Échéance globale -> notification experts uniquement
    const aG = await j(API + '/api/org/alerts', { method: 'POST', headers: HE, body: JSON.stringify({ title: alertGlobal, due_date: day(2), lead_days: 5 }) });
    alertIds.push(aG.body.id);
    // 4) Tâche en vérification avec délai dépassé -> notification experts (via SQL)
    const tVer = await j(API + '/api/org/dossiers/' + dossierId + '/tasks', { method: 'POST', headers: HS, body: JSON.stringify({ label: verifyLabel, due_date: day(3) }) });
    const tVerId = tVer.body.id;
    await j(API + '/api/org/dossiers/' + dossierId + '/tasks/' + tVerId, { method: 'PATCH', headers: HS, body: JSON.stringify({ status: 'fait' }) });
    d1(`UPDATE org_tasks SET verify_due_at = datetime('now','-1 hours') WHERE id = '${tVerId}'`);
    console.log('SETUP client=' + clientId + ' dossier=' + dossierId + ' late=' + tLate.body.id + ' verify=' + tVerId);

    // --- A. Génération + portée (API) ---
    const g1 = await j(API + '/api/org/notifications', { headers: HS });
    const n1 = g1.body.notifications || [];
    ok(n1.some(n => n.message.includes(lateLabel) && n.message.includes('En retard')), 'A1a: notif tâche en retard pour Salim');
    ok(n1.some(n => n.message.includes(alertDossier) && n.message.includes('Échéance')), 'A1b: notif échéance dossier pour Salim');
    ok(g1.body.unread >= 2, 'A1c: Salim a >= 2 non lues (' + g1.body.unread + ')');

    const g2 = await j(API + '/api/org/notifications', { headers: HS });
    ok((g2.body.notifications || []).length === n1.length, 'A2: idempotent (2e appel, même total=' + n1.length + ')');

    const gE = await j(API + '/api/org/notifications', { headers: HE });
    const nE = gE.body.notifications || [];
    ok(nE.some(n => n.message.includes(alertGlobal) && n.message.includes('Échéance')), 'A3a: notif échéance globale pour expert');
    ok(nE.some(n => n.message.includes(verifyLabel) && n.message.includes('Validation dépassée')), 'A3b: notif vérification dépassée pour expert');
    ok(!nE.some(n => n.message.includes(lateLabel)), 'A3c: expert ne reçoit PAS la tâche en retard de Salim');

    const lateNotif = n1.find(n => n.message.includes(lateLabel));
    const r1 = await j(API + '/api/org/notifications/read', { method: 'POST', headers: HS, body: JSON.stringify({ id: lateNotif.id }) });
    ok(r1.status === 200 && r1.body.unread === g1.body.unread - 1, 'A4: lecture unitaire -> unread ' + g1.body.unread + ' -> ' + r1.body.unread);

    const globNotif = nE.find(n => n.message.includes(alertGlobal));
    const r2 = await j(API + '/api/org/notifications/read', { method: 'POST', headers: HS, body: JSON.stringify({ id: globNotif.id }), allowFail: true });
    ok(r2.status === 404, 'A5: Salim ne peut pas marquer la notif d\'un expert (' + r2.status + ')');

    // --- B. UI (cloche, liste, clic, marquer tout lu) ---
    const browser = await chromium.launch();
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    try {
      await loginAs(page, SAL.email, SAL.pwd);
      await page.waitForSelector('[data-testid="notif-bell"]', { timeout: 20000 });
      ok(await page.locator('[data-testid="notif-bell"]').isVisible(), 'B1a: cloche visible');
      const badge = page.locator('[data-testid="notif-unread"]');
      await badge.waitFor({ timeout: 15000 }).catch(() => {});
      const badgeN = Number(await badge.innerText().catch(() => '0'));
      ok(badgeN >= 1, 'B1b: badge >= 1 non lu (' + badgeN + ')');

      await page.click('[data-testid="notif-bell"]');
      await page.waitForSelector('[data-testid="notif-list"]', { timeout: 10000 });
      const items = page.locator('[data-testid="notif-item"]');
      const cnt = await items.count();
      ok(cnt >= 1, 'B2a: liste ouverte avec ' + cnt + ' item(s)');
      const listText = await page.locator('[data-testid="notif-list"]').innerText();
      ok(listText.includes(lateLabel), 'B2b: item « tâche en retard » présent');
      ok(!listText.includes(alertGlobal), 'B2c: pas d\'échéance globale pour Salim (portée)');

      await items.filter({ hasText: lateLabel }).first().click();
      await page.waitForTimeout(1500);
      ok(page.url().includes('/cabinet/dossier/' + dossierId), 'B3: clic notif -> dossier (' + page.url().split('/cabinet')[1] + ')');

      await page.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="notif-bell"]', { timeout: 20000 });
      await page.waitForTimeout(800);
      await page.click('[data-testid="notif-bell"]');
      await page.waitForSelector('[data-testid="notif-list"]', { timeout: 10000 });
      const markAll = page.locator('[data-testid="notif-mark-all"]');
      ok(await markAll.isVisible(), 'B4a: bouton « Tout marquer comme lu » visible');
      await markAll.click();
      await page.waitForTimeout(1200);
      const badgeAfter = await page.locator('[data-testid="notif-unread"]').count();
      ok(badgeAfter === 0, 'B4b: badge disparu après « tout lu »');

      ok(errors.length === 0, 'B5: aucune erreur JS (' + errors.length + ')');
    } catch (e) {
      ok(false, 'ERREUR UI: ' + e.message);
    } finally {
      await browser.close();
    }

    const g3 = await j(API + '/api/org/notifications', { headers: HS });
    ok(g3.body.unread === 0, 'A6: Salim -> 0 non lu après marquage (' + g3.body.unread + ')');
  } finally {
    await cleanup();
  }

  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAIL');
  process.exit(fails ? 1 : 0);
})();
