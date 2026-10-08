const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const EXP = { email: 'expert@eurex.tn', pwd: 'expert1234567' };
const SAL = { email: 'salim@eurex.tn', pwd: 'salim1234567' };
const SAM = { email: 'samar@eurex.tn', pwd: 'samar1234567' };
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
const pad2 = n => String(n).padStart(2, '0');
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const nowTn = new Date(Date.now() + 3600000);
const CUR_Y = nowTn.getUTCFullYear();
const CUR_M = nowTn.getUTCMonth() + 1;
const day = off => new Date(Date.now() + off * 86400000 + 3600000).toISOString().slice(0, 10);

(async () => {
  const lh = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EXP.email, password: EXP.pwd }) });
  const HE = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lh.body.token };
  const ls = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAL.email, password: SAL.pwd }) });
  const HS = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ls.body.token };
  const lm = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAM.email, password: SAM.pwd }) });
  const HM = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lm.body.token };

  const ts = Date.now().toString().slice(-6);
  const zz1 = 'ZZ-REPORT-' + ts;   // dossier de Salim
  const zz2 = 'ZZ-OTHER-' + ts;    // dossier de Samar
  const lateLabel = 'REPORT-LATE-' + ts;
  const doneLabel = 'REPORT-DONE-' + ts;
  const otherLabel = 'REPORT-OTHER-' + ts;
  const alertDossier = 'REPORT-ALERT-D-' + ts;
  const alertGlobal = 'REPORT-ALERT-G-' + ts;
  const alertIds = [];
  let c1 = null, c2 = null, d1 = null, d2 = null, tA = null, tB = null;
  const cleanup = async () => {
    for (const id of alertIds) {
      try { await j(API + '/api/org/alerts/' + id, { method: 'DELETE', headers: HE }); }
      catch (e) { console.log('!! cleanup alert ' + id + ': ' + e.message); fails++; }
    }
    for (const cid of [c1, c2]) {
      if (!cid) continue;
      try { await j(API + '/api/org/clients/' + cid, { method: 'DELETE', headers: HE }); }
      catch (e) { console.log('!! cleanup client ' + cid + ': ' + e.message); fails++; }
    }
    console.log('CLEANUP: ' + zz1 + ' + ' + zz2 + ' supprimés (cascade) + ' + alertIds.length + ' échéance(s)');
  };

  try {
    // --- Setup API ---
    const a = await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz1, assigned_comptable_id: 'user_comp_001' }) });
    c1 = a.body.id;
    const da = await j(API + '/api/org/clients/' + c1 + '/dossiers', { method: 'POST', headers: HE, body: JSON.stringify({ exercice: CUR_Y }) });
    d1 = da.body.id;
    const b = await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz2, assigned_comptable_id: 'user_comp_002' }) });
    c2 = b.body.id;
    const db = await j(API + '/api/org/clients/' + c2 + '/dossiers', { method: 'POST', headers: HE, body: JSON.stringify({ exercice: CUR_Y }) });
    d2 = db.body.id;

    // Tâches : 1 en retard (Salim), 1 faite (expert), 1 sur le dossier de Samar
    tA = (await j(API + '/api/org/dossiers/' + d1 + '/tasks', { method: 'POST', headers: HS, body: JSON.stringify({ label: lateLabel, due_date: day(-1) }) })).body;
    tB = (await j(API + '/api/org/dossiers/' + d1 + '/tasks', { method: 'POST', headers: HE, body: JSON.stringify({ label: doneLabel, due_date: day(5) }) })).body;
    await j(API + '/api/org/dossiers/' + d1 + '/tasks/' + tB.id, { method: 'PATCH', headers: HE, body: JSON.stringify({ status: 'fait' }) });
    await j(API + '/api/org/dossiers/' + d2 + '/tasks', { method: 'POST', headers: HE, body: JSON.stringify({ label: otherLabel, due_date: day(10) }) });

    // Échéances : dossier (Salim) + globale (experts), toutes dans le mois courant
    const ad = await j(API + '/api/org/alerts', { method: 'POST', headers: HE, body: JSON.stringify({ title: alertDossier, due_date: `${CUR_Y}-${pad2(CUR_M)}-15`, lead_days: 5, dossier_id: d1 }) });
    alertIds.push(ad.body.id);
    const ag = await j(API + '/api/org/alerts', { method: 'POST', headers: HE, body: JSON.stringify({ title: alertGlobal, due_date: `${CUR_Y}-${pad2(CUR_M)}-25`, lead_days: 5 }) });
    alertIds.push(ag.body.id);

    // Heures du mois : Salim 2h00 (d1), expert 1h00 (d1) + 30min (d2)
    await j(API + '/api/org/dossiers/' + d1 + '/tasks/' + tA.id + '/time', { method: 'POST', headers: HS, body: JSON.stringify({ seconds: 7200, note: 'rapport' }) });
    await j(API + '/api/org/dossiers/' + d1 + '/tasks/' + tB.id + '/time', { method: 'POST', headers: HE, body: JSON.stringify({ seconds: 3600, note: 'rapport' }) });
    const tC = (await j(API + '/api/org/dossiers/' + d2 + '/tasks', { method: 'POST', headers: HE, body: JSON.stringify({ label: 'REPORT-TIME-' + ts, due_date: day(3) }) })).body;
    await j(API + '/api/org/dossiers/' + d2 + '/tasks/' + tC.id + '/time', { method: 'POST', headers: HE, body: JSON.stringify({ seconds: 1800, note: 'rapport' }) });
    console.log('SETUP d1=' + d1 + ' d2=' + d2 + ' tA=' + tA.id + ' tB=' + tB.id);

    const rp = (h, ex, m) => j(API + `/api/org/reports/monthly?exercice=${ex}&month=${m}`, { headers: h });

    // --- A. API ---
    const rE = (await rp(HE, CUR_Y, CUR_M)).body;
    ok(rE.exercice === CUR_Y && rE.month === CUR_M && rE.month_label === `${MONTHS[CUR_M - 1]} ${CUR_Y}`, 'A1a: métadonnées (' + rE.month_label + ')');
    ok(rE.scope === 'cabinet', 'A1b: périmètre cabinet pour expert');
    const dz1 = (rE.dossiers || []).find(d => d.client_name === zz1);
    const dz2 = (rE.dossiers || []).find(d => d.client_name === zz2);
    ok(!!dz1 && !!dz2, 'A1c: les 2 dossiers dans le rapport expert');
    ok(dz1 && dz1.tasks_done >= 1 && dz1.tasks_late >= 1 && dz1.tasks_total > dz1.tasks_done, 'A1d: tâches faites/retard du dossier 1');
    ok(dz1 && dz1.hours_seconds === 10800 && dz1.progress > 0 && dz1.progress < 100, 'A1e: heures dossier 1 = 3h00 (' + (dz1 && dz1.hours_seconds) + '), progression ' + (dz1 && dz1.progress) + '%');
    ok(rE.totals.hours_seconds === 12600, 'A1f: total heures cabinet = 3h30 (' + rE.totals.hours_seconds + ')');
    ok(rE.hours_by_user.some(u => u.full_name && u.full_name.includes('Salim') && u.seconds === 7200), 'A1g: Salim 2h00 dans les collaborateurs');
    ok(rE.alerts.some(x => x.title === alertDossier) && rE.alerts.some(x => x.title === alertGlobal), 'A1h: échéances dossier + globale présentes');
    ok(rE.late_tasks.some(l => l.label === lateLabel), 'A1i: tâche en retard listée');

    const rJ = (await rp(HE, CUR_Y, 1)).body;
    ok(rJ.month === 1 && rJ.totals.hours_seconds === 0, 'A2a: janvier -> 0 heure (' + rJ.totals.hours_seconds + ')');
    ok(!rJ.alerts.some(x => x.title === alertDossier), 'A2b: échéance du mois courant absente de janvier');

    const rS = (await rp(HS, CUR_Y, CUR_M)).body;
    ok(rS.scope === 'comptable', 'A3a: périmètre comptable pour Salim');
    ok((rS.dossiers || []).some(d => d.client_name === zz1) && !(rS.dossiers || []).some(d => d.client_name === zz2), 'A3b: Salim voit son dossier, pas celui de Samar');
    ok(rS.totals.hours_seconds === 7200, 'A3c: Salim ne compte que ses heures (2h00 = ' + rS.totals.hours_seconds + ')');
    ok(rS.alerts.some(x => x.title === alertDossier) && !rS.alerts.some(x => x.title === alertGlobal), 'A3d: échéance dossier oui, globale non');
    ok(!rS.late_tasks.some(l => l.label === otherLabel), 'A3e: pas de tâche de l autre comptable');

    const rM = (await rp(HM, CUR_Y, CUR_M)).body;
    ok((rM.dossiers || []).some(d => d.client_name === zz2) && !(rM.dossiers || []).some(d => d.client_name === zz1), 'A4a: Samar voit son dossier uniquement');
    ok(rM.totals.hours_seconds === 0, 'A4b: Samar n a pointé aucune heure (' + rM.totals.hours_seconds + ')');

    // --- B. UI ---
    const browser = await chromium.launch();
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    try {
      await loginAs(page, EXP.email, EXP.pwd);
      await page.waitForSelector('[data-testid="report-nav"]', { timeout: 20000 });
      await page.click('[data-testid="report-nav"]');
      await page.waitForSelector('[data-testid="report-page"]', { timeout: 15000 });
      ok(page.url().includes('/cabinet/report'), 'B1a: navigation /cabinet/report');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="report-dossier-row"]').length > 0, null, { timeout: 20000 }).catch(() => {});
      const rowsTxt = await page.locator('[data-testid="report-dossier-row"]').allInnerTexts();
      ok(rowsTxt.some(t => t.includes(zz1)) && rowsTxt.some(t => t.includes(zz2)), 'B1b: lignes dossiers rendues (expert)');
      ok((await page.locator('[data-testid="report-kpi-hours"]').innerText()).includes('3h30'), 'B1c: KPI heures = 3h30 (' + (await page.locator('[data-testid="report-kpi-hours"]').innerText()).replace(/\n/g, ' ') + ')');
      const titleTxt = await page.locator('[data-testid="report-title"]').innerText();
      ok(titleTxt.includes(`${MONTHS[CUR_M - 1]} ${CUR_Y}`), 'B1d: titre = mois courant');

      // Navigation de mois : mois suivant (hors données du mois courant)
      const nextM = CUR_M === 12 ? 1 : CUR_M + 1;
      const nextY = CUR_M === 12 ? CUR_Y + 1 : CUR_Y;
      await page.click('[data-testid="report-next"]');
      await page.waitForFunction((lbl) => (document.querySelector('[data-testid="report-title"]')?.innerText || '').includes(lbl), `${MONTHS[nextM - 1]} ${nextY}`, { timeout: 15000 }).catch(() => {});
      const nextTitle = await page.locator('[data-testid="report-title"]').innerText();
      ok(nextTitle.includes(`${MONTHS[nextM - 1]} ${nextY}`), 'B2a: titre mois suivant (' + nextTitle.split('\n')[0] + ')');
      await page.waitForFunction(() => (document.querySelector('[data-testid="report-kpi-hours"]')?.innerText || '').includes('0h'), null, { timeout: 15000 }).catch(() => {});
      ok((await page.locator('[data-testid="report-kpi-hours"]').innerText()).includes('0h'), 'B2b: heures du mois suivant = 0h');
      const nextAlerts = await page.locator('[data-testid="report-alert-row"]').allInnerTexts().catch(() => []);
      ok(!nextAlerts.some(t => t.includes(alertDossier)), 'B2c: échéance du mois courant absente');
      await page.click('[data-testid="report-prev"]');
      await page.waitForFunction((lbl) => (document.querySelector('[data-testid="report-title"]')?.innerText || '').includes(lbl), `${MONTHS[CUR_M - 1]} ${CUR_Y}`, { timeout: 15000 }).catch(() => {});

      // Excel : téléchargement .xlsx
      const dlPromise = page.waitForEvent('download', { timeout: 20000 });
      await page.click('[data-testid="report-excel"]');
      const dl = await dlPromise;
      const fname = dl.suggestedFilename();
      ok(/^rapport-mensuel-\d{4}-\d{2}\.xlsx$/.test(fname), 'B3: export Excel (' + fname + ')');
      await dl.cancel().catch(() => {});

      ok(await page.locator('[data-testid="report-print"]').isVisible(), 'B4: bouton PDF / Imprimer visible');

      // Portée comptable (Salim)
      await loginAs(page, SAL.email, SAL.pwd);
      await page.waitForSelector('[data-testid="report-nav"]', { timeout: 20000 });
      await page.click('[data-testid="report-nav"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="report-dossier-row"]').length > 0, null, { timeout: 20000 }).catch(() => {});
      const sRows = await page.locator('[data-testid="report-dossier-row"]').allInnerTexts();
      ok(sRows.some(t => t.includes(zz1)) && !sRows.some(t => t.includes(zz2)), 'B5a: Salim ne voit que son dossier');
      ok((await page.locator('[data-testid="report-kpi-hours"]').innerText()).includes('2h00'), 'B5b: KPI heures Salim = 2h00');
      const sAlerts = await page.locator('[data-testid="report-alert-row"]').allInnerTexts().catch(() => []);
      ok(sAlerts.some(t => t.includes(alertDossier)) && !sAlerts.some(t => t.includes(alertGlobal)), 'B5c: portée des échéances dans l UI');

      ok(errors.length === 0, 'B6: aucune erreur JS (' + errors.length + ')');
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
