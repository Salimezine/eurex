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
const nowTn = new Date(Date.now() + 3600000);
const CUR_Y = nowTn.getUTCFullYear();

(async () => {
  const lh = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EXP.email, password: EXP.pwd }) });
  const HE = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lh.body.token };

  const ts = Date.now().toString().slice(-6);
  const zz1 = 'ZZ-TPL1-' + ts;
  const zz2 = 'ZZ-TPL2-' + ts;
  const zz3 = 'ZZ-TPL3-' + ts;
  const L_ALL = 'TPL-ALL-' + ts;
  const L_MAR = 'TPL-MAR-' + ts;
  const L_ONE = 'TPL-ONE-' + ts;
  const L_UI = 'TPL-UI-' + ts;
  const L_UI2 = 'TPL-UI2-' + ts;
  const L_DEL = 'TPL-DEL-' + ts;
  let c1 = null, c2 = null, c3 = null, d1 = null, d2 = null, d3 = null;
  let tAll = null, tMar = null, tOne = null, tDel = null;
  const cleanup = async () => {
    // Supprimer les modeles crees par ce test (ne pas polluer les runs suivants)
    try {
      const tl = (await j(API + '/api/org/templates', { headers: HE })).body;
      for (const t of tl) {
        if (t.label && t.label.includes(ts)) {
          try { await j(API + '/api/org/templates/' + t.id, { method: 'DELETE', headers: HE }); }
          catch (e) { console.log('!! cleanup template ' + t.label + ': ' + e.message); fails++; }
        }
      }
    } catch (e) { console.log('!! cleanup list templates: ' + e.message); fails++; }
    for (const cid of [c1, c2, c3]) {
      if (!cid) continue;
      try { await j(API + '/api/org/clients/' + cid, { method: 'DELETE', headers: HE }); }
      catch (e) { console.log('!! cleanup client ' + cid + ': ' + e.message); fails++; }
    }
    console.log('CLEANUP: clients restants supprimés + modèles TPL-* supprimés');
  };

  try {
    // --- Setup : 2 clients + dossiers AVANT tout nouveau modele ---
    c1 = (await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz1, assigned_comptable_id: 'user_comp_001' }) })).body.id;
    d1 = (await j(API + '/api/org/clients/' + c1 + '/dossiers', { method: 'POST', headers: HE, body: JSON.stringify({ exercice: CUR_Y }) })).body.id;
    c2 = (await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz2, assigned_comptable_id: 'user_comp_002' }) })).body.id;
    d2 = (await j(API + '/api/org/clients/' + c2 + '/dossiers', { method: 'POST', headers: HE, body: JSON.stringify({ exercice: CUR_Y }) })).body.id;
    console.log('SETUP c1=' + c1 + ' d1=' + d1 + ' c2=' + c2 + ' d2=' + d2);

    const tasksOf = async did => (await j(API + '/api/org/dossiers/' + did, { headers: HE })).body.tasks || [];
    const countLbl = (tasks, lbl) => tasks.filter(t => t.label === lbl).length;
    const getTmpl = async lbl => ((await j(API + '/api/org/templates', { headers: HE })).body).find(t => t.label === lbl) || null;
    const apply = id => j(API + '/api/org/templates/' + id + '/apply', { method: 'POST', headers: HE });

    // --- A1 : modele cree apres le dossier -> pas d'application retroactive auto ---
    const tp1 = (await j(API + '/api/org/templates', { method: 'POST', headers: HE, body: JSON.stringify({ label: L_ALL, requires_document: false, frequency: 'mensuelle' }) })).body;
    tAll = tp1.id;
    const tp2 = (await j(API + '/api/org/templates', { method: 'POST', headers: HE, body: JSON.stringify({ label: L_MAR, requires_document: false, frequency: 'annuelle', month: 3 }) })).body;
    tMar = tp2.id;
    const tp3 = (await j(API + '/api/org/templates', { method: 'POST', headers: HE, body: JSON.stringify({ label: L_ONE, requires_document: false, frequency: 'mensuelle', client_id: c1 }) })).body;
    tOne = tp3.id;
    const tk1 = await tasksOf(d1);
    ok(countLbl(tk1, L_ALL) === 0 && countLbl(tk1, L_MAR) === 0 && countLbl(tk1, L_ONE) === 0, 'A1a: dossier cree avant les modeles -> aucune tache TPL-ALL/MAR/ONE');
    const g3 = await getTmpl(L_ONE);
    ok(g3 && g3.client_id === c1 && g3.client_name === zz1, 'A1b: GET templates -> client_id + client_name ressortis (JOIN)');

    // --- A2 : application retroactive cabinet-wide (modeles mensuelle) ---
    const rA = (await apply(tAll)).body;
    ok(rA.created === 24 && rA.dossiers === 2, 'A2a: apply TPL-ALL -> created=24 (12 mois x 2 dossiers), dossiers=2 (' + rA.created + '/' + rA.dossiers + ')');
    const t1a = await tasksOf(d1);
    const monthsA = t1a.filter(t => t.label === L_ALL).map(t => t.month).sort((a, b) => a - b);
    ok(monthsA.length === 12 && monthsA.every((m, i) => m === i + 1), 'A2b: d1 -> 12 exemplaires TPL-ALL (mois 1..12)');
    const t2a = await tasksOf(d2);
    ok(countLbl(t2a, L_ALL) === 12, 'A2c: d2 -> 12 exemplaires TPL-ALL');
    const rA2 = (await apply(tAll)).body;
    ok(rA2.created === 0, 'A2d: re-apply idempotent -> created=0 (' + rA2.created + ')');

    // --- A3 : application scopee au client ---
    const rB = (await apply(tOne)).body;
    ok(rB.created === 12 && rB.dossiers === 1, 'A3a: apply TPL-ONE (client zz1) -> created=12, dossiers=1 (' + rB.created + '/' + rB.dossiers + ')');
    const t1b = await tasksOf(d1);
    const t2b = await tasksOf(d2);
    ok(countLbl(t1b, L_ONE) === 12, 'A3b: d1 (zz1) -> 12 exemplaires TPL-ONE');
    ok(countLbl(t2b, L_ONE) === 0, 'A3c: d2 (zz2) -> 0 exemplaire TPL-ONE (scope respecte)');

    // --- A4 : nouveau dossier -> modele client non applique + mois epingle applique ---
    c3 = (await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz3, assigned_comptable_id: 'user_comp_001' }) })).body.id;
    d3 = (await j(API + '/api/org/clients/' + c3 + '/dossiers', { method: 'POST', headers: HE, body: JSON.stringify({ exercice: CUR_Y }) })).body.id;
    const t3 = await tasksOf(d3);
    ok(countLbl(t3, L_ALL) === 12, 'A4a: nouveau dossier zz3 -> 12 x TPL-ALL (modele cabinet)');
    const mar3 = t3.filter(t => t.label === L_MAR);
    ok(mar3.length === 1 && mar3[0].month === 3, 'A4b: modele mois epingle -> 1 exemplaire en Mars');
    ok(countLbl(t3, L_ONE) === 0, 'A4c: modele cible zz1 ignore pour zz3');
    await j(API + '/api/org/clients/' + c3, { method: 'DELETE', headers: HE });
    c3 = null; d3 = null;

    // --- A5 : re-ciblage d un modele sur un autre client ---
    await j(API + '/api/org/templates/' + tOne, { method: 'PATCH', headers: HE, body: JSON.stringify({ client_id: c2 }) });
    const rC = (await apply(tOne)).body;
    ok(rC.created === 12 && rC.dossiers === 1, 'A5a: PATCH client zz2 + apply -> created=12, dossiers=1 (' + rC.created + '/' + rC.dossiers + ')');
    const t2c = await tasksOf(d2);
    ok(countLbl(t2c, L_ONE) === 12, 'A5b: d2 (zz2) -> 12 exemplaires TPL-ONE apres re-ciblage');
    const gOne = await getTmpl(L_ONE);
    ok(gOne && gOne.client_id === c2 && gOne.client_name === zz2, 'A5c: client_name mis a jour apres PATCH');

    // --- B. UI ---
    const browser = await chromium.launch();
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    const dlg = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    page.on('dialog', async d => { dlg.push(d.message()); await d.accept(); });
    try {
      await loginAs(page, EXP.email, EXP.pwd);
      await page.goto(BASE + '/cabinet/settings', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="template-month-new"]', { timeout: 25000 });
      ok(await page.locator('[data-testid="template-client-new"]').isVisible(), 'B1a: select client a l ajout present');
      ok(await page.locator('[data-testid="template-freq-new"]').isVisible(), 'B1b: select frequence a l ajout present');

      // B2 : ajout d un modele mensuel cabinet-wide
      await page.fill('input[placeholder="Libellé de la tâche"]', L_UI);
      await page.selectOption('[data-testid="template-freq-new"]', 'mensuelle');
      await page.click('button:has-text("Ajouter")');
      const rowUi = page.locator('[data-testid="template-row"]').filter({ hasText: L_UI });
      ok(await rowUi.waitFor({ timeout: 15000 }).then(() => true).catch(() => false), 'B2a: ligne du modele ajoutee rendue');
      ok((await rowUi.locator('[data-testid="template-target"]').innerText()).includes('Tous les dossiers'), 'B2b: chip cible = tous les dossiers');

      // B3 : application depuis l UI (dialogues confirm + alert)
      const d0 = dlg.length;
      await rowUi.locator('[data-testid="template-apply"]').click();
      for (let i = 0; i < 40 && dlg.length < d0 + 2; i++) await page.waitForTimeout(250);
      ok(dlg.length >= d0 + 1 && dlg[d0].includes('dossiers ouverts'), 'B3a: confirmation demandee (' + dlg[d0] + ')');
      ok(dlg[d0 + 1] === '24 tâche(s) créée(s) dans 2 dossier(s)', 'B3b: resultat apply = 24 taches / 2 dossiers (' + dlg[d0 + 1] + ')');
      const t1u = await tasksOf(d1);
      ok(countLbl(t1u, L_UI) === 12, 'B3c: API d1 -> 12 x TPL-UI apres apply UI');

      // B4 : mois precis sur une ligne existante
      await rowUi.locator('[data-testid="template-month-select"]').selectOption('3');
      await rowUi.locator('[data-testid="template-month"]').waitFor({ timeout: 10000 }).catch(() => {});
      ok((await rowUi.locator('[data-testid="template-month"]').innerText()).includes('Mars'), 'B4a: chip mois = Mars apres PATCH');
      const gUi = await getTmpl(L_UI);
      ok(gUi && gUi.month === 3, 'B4b: API month=3 (' + (gUi && gUi.month) + ')');

      // B5 : ajout avec ciblage client
      await page.fill('input[placeholder="Libellé de la tâche"]', L_UI2);
      await page.selectOption('[data-testid="template-client-new"]', { label: zz1 });
      await page.click('button:has-text("Ajouter")');
      const rowUi2 = page.locator('[data-testid="template-row"]').filter({ hasText: L_UI2 });
      ok(await rowUi2.waitFor({ timeout: 15000 }).then(() => true).catch(() => false), 'B5a: deuxieme modele ajoutee');
      ok((await rowUi2.locator('[data-testid="template-target"]').innerText()).includes(zz1), 'B5b: chip cible = ' + zz1);
      const gUi2 = await getTmpl(L_UI2);
      ok(gUi2 && gUi2.client_id === c1, 'B5c: API client_id = c1 (' + (gUi2 && gUi2.client_id) + ')');

      ok(errors.length === 0, 'B6: aucune erreur JS (' + errors.length + ')');
    } catch (e) {
      ok(false, 'ERREUR UI: ' + e.message);
    } finally {
      await browser.close();
    }

    // --- A6 : suppression du client cible supprime ses modeles ---
    const tp4 = (await j(API + '/api/org/templates', { method: 'POST', headers: HE, body: JSON.stringify({ label: L_DEL, requires_document: false, frequency: 'mensuelle', client_id: c1 }) })).body;
    tDel = tp4.id;
    await j(API + '/api/org/clients/' + c1, { method: 'DELETE', headers: HE });
    c1 = null; d1 = null;
    const tlAfter = (await j(API + '/api/org/templates', { headers: HE })).body;
    ok(!tlAfter.some(t => t.label === L_DEL), 'A6a: modele cible zz1 supprime avec le client');
    ok(tlAfter.some(t => t.id === tOne), 'A6b: modele re-cible sur zz2 conserve');
    ok(tlAfter.some(t => t.id === tAll && t.client_id == null), 'A6c: modele cabinet-wide conserve');
  } finally {
    await cleanup();
  }

  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAIL');
  process.exit(fails ? 1 : 0);
})();
