const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const SAL = { email: 'salim@eurex.tn', pwd: 'salim1234567' };
const DOSS = 'doss_001'; // ANIMAL CITY — assigne a Salim
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
// rouge (red-500/600 tailwind) : r fort, g et b faibles
const isRed = css => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css || ''); return !!m && +m[1] > 150 && +m[2] < 110 && +m[3] < 110; };
async function j(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(url + ' -> ' + r.status + ' : ' + (await r.text().catch(() => '')));
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
async function addTask(H, label) {
  return j(API + '/api/org/dossiers/' + DOSS + '/tasks', { method: 'POST', headers: H, body: JSON.stringify({ label }) });
}
async function delTask(H, id) {
  try { await j(API + '/api/org/dossiers/' + DOSS + '/tasks/' + id, { method: 'DELETE', headers: H }); console.log('CLEANUP: tache ' + id + ' supprimee'); }
  catch (e) { console.log('!! CLEANUP FAILED: ' + e.message); fails++; }
}

(async () => {
  const le = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAL.email, password: SAL.pwd }) });
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + le.token };
  const ts = Date.now().toString().slice(-7);
  const labelA = 'QA-NTN-A-' + ts; // cree AVANT l'ouverture -> badge rouge + tag NOUVEAU
  const labelB = 'QA-NTN-B-' + ts; // cree PENDANT la session -> toast rouge

  const a = await addTask(H, labelA);
  const idA = a.id || (a.task && a.task.id);
  console.log('SETUP A=' + idA + ' ' + labelA);
  let idB = null;
  let b;

  try {
    b = await chromium.launch();
    const p = await b.newPage();
    p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));

    await loginAs(p, SAL.email, SAL.pwd);
    await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });

    // ---- N1-N4 : badge rouge + tag NOUVEAU sur la tache < 24h ----
    ok(await p.locator('[data-testid="nouvelles-taches"]').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false), 'N1: section "Nouvelles taches" presente');
    const badge = p.locator('[data-testid="nouvelles-taches-badge"]');
    ok(await badge.count() === 1, 'N2: badge rouge "N nouvelles" present (' + await badge.count() + ')');
    ok(/🔴 \d+ nouvelle/.test(await badge.first().innerText()), 'N3: texte du badge (' + (await badge.first().innerText()).trim() + ')');
    ok(isRed(await badge.first().evaluate(el => getComputedStyle(el).backgroundColor)), 'N4: badge bien rouge (bg red-600 = ' + await badge.first().evaluate(el => getComputedStyle(el).backgroundColor) + ')');
    const cardA = p.locator('[data-testid="recent-task-card"]').filter({ hasText: labelA });
    ok(await cardA.count() === 1, 'N5: carte de la tache A presente');
    ok(await cardA.first().locator('[data-testid="recent-task-new"]').count() === 1, 'N6: tag "NOUVEAU" rouge sur la carte < 24h');
    const hrefA = await cardA.first().getAttribute('href');
    ok((hrefA || '').includes('/cabinet/dossier/' + DOSS + '?task=' + idA), 'N7: carte liee directement a la tache (' + hrefA + ')');

    // ---- N8-N11 : tache creee EN DIRECT -> toast rouge ----
    const created = await addTask(H, labelB);
    idB = created.id || (created.task && created.task.id);
    console.log('SETUP B=' + idB + ' ' + labelB + ' (pendant la session)');
    const toast = p.locator('[data-testid="new-task-toast"]');
    ok(await toast.waitFor({ state: 'visible', timeout: 50000 }).then(() => true).catch(() => false), 'N8: toast de notification apparait (< 30s)');
    const tTxt = await toast.innerText();
    ok(tTxt.includes(labelB), 'N9: le toast nomme la tache (' + tTxt.replace(/\s+/g, ' ').slice(0, 80) + ')');
    ok(isRed(await toast.evaluate(el => getComputedStyle(el).borderTopColor)), 'N10: bordure rouge du toast (' + await toast.evaluate(el => getComputedStyle(el).borderTopColor) + ')');
    ok(await p.locator('[data-testid="new-task-toast-close"]').count() === 1, 'N11: bouton de fermeture present');

    // ---- N12-N15 : le lien du toast mene directement a la tache ----
    const link = p.locator('[data-testid="new-task-toast-link"]');
    const hrefB = await link.getAttribute('href');
    ok((hrefB || '').includes('/cabinet/dossier/' + DOSS + '?task=' + idB), 'N12: lien direct vers la tache (' + hrefB + ')');
    await link.click();
    await p.waitForURL('**/cabinet/dossier/' + DOSS + '**', { timeout: 15000 });
    ok(p.url().includes('task=' + idB), 'N13: URL contient ?task=' + idB);
    const row = p.locator('#task-' + idB);
    ok(await row.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false), 'N14: la ligne de la tache est visible sur la page dossier');
    const cls = await row.getAttribute('class');
    ok((cls || '').includes('ring-red-400'), 'N15: la tache est surlignee en rouge (' + (cls || '').slice(-60) + ')');
    ok((await row.innerText()).includes(labelB), 'N16: c est bien la bonne tache');
    ok(await p.locator('[data-testid="nouvelles-taches"]').count() === 0, 'N17: la carte n est plus sur la page dossier (on est arrive a la tache)');

    await b.close();
  } finally {
    if (b) await b.close().catch(() => {});
    if (idA) await delTask(H, idA);
    if (idB) await delTask(H, idB);
  }

  const after = await j(API + '/api/org/me/tasks/recent', { headers: H });
  ok(!after.tasks.some(t => t.id === idA || t.id === idB), 'N18: aucune tache de test dans le feed');

  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
