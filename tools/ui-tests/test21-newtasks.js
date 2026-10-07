const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const SAL = { email: 'salim@eurex.tn', pwd: 'salim1234567' };
const DOSS = 'doss_001'; // ANIMAL CITY — assigne a Salim (user_comp_001)
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
async function bodyText(p) { return p.evaluate(() => document.body.innerText); }
async function waitText(p, sub, want, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if ((await bodyText(p)).includes(sub) === want) return true;
    await p.waitForTimeout(500);
  }
  return false;
}
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

(async () => {
  // ---- setup API : jeton Salim + nettoyage garanti ----
  const le = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAL.email, password: SAL.pwd }) });
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + le.token };
  const label = 'QA-NT-UI-' + Date.now().toString().slice(-7);
  let taskId = null;

  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  p.on('dialog', async dg => { console.log('!! DIALOG[' + dg.type() + ']: ' + dg.message()); await dg.accept(); });

  // ---- U1 : le comptable ajoute une tache depuis la page dossier ----
  await loginAs(p, SAL.email, SAL.pwd);
  await p.goto(BASE + '/cabinet/dossier/' + DOSS, { waitUntil: 'domcontentloaded' });
  const u1 = await waitText(p, '+ Ajouter une tâche', true);
  ok(u1, 'U1: bouton "+ Ajouter une tache" visible (dossier en cours)');
  await p.locator('button', { hasText: '+ Ajouter une tâche' }).click();
  await p.locator('input[placeholder="Libellé de la nouvelle tâche..."]').fill(label);
  await p.locator('button', { hasText: /^Ajouter$/ }).click();
  const u2 = await waitText(p, label, true);
  ok(u2, 'U2: la tache "' + label + '" apparait dans la checklist');

  // id de la tache creee (pour l echeance + le nettoyage)
  const gd = await j(API + '/api/org/dossiers/' + DOSS, { headers: H });
  const created = gd.tasks.find(t => t.label === label);
  taskId = created && created.id;
  ok(!!taskId, 'U3: tache creee cote API (id=' + taskId + ')');
  ok(created && !!created.created_at, 'U3b: created_at renseigne (' + (created && created.created_at) + ')');

  // ---- U4 : la carte "Nouvelles taches" est dans le dashboard ----
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  const u4 = await waitText(p, 'Nouvelles tâches', true);
  ok(u4, 'U4: section "Nouvelles taches" presente dans le dashboard comptable');
  const card = p.locator('[data-testid="recent-task-card"]').filter({ hasText: label });
  ok(await card.count() === 1, 'U5: la nouvelle tache a sa propre carte');
  const cardTxt = await card.first().innerText();
  ok(cardTxt.includes('ANIMAL CITY') && cardTxt.includes('Exercice 2026'), 'U6: la carte precise le dossier (ANIMAL CITY, exercice 2026)');
  const createdTxt = await card.first().locator('[data-testid="recent-task-created"]').innerText();
  ok(/Ajoutée le \d{2}\/\d{2}\/\d{4} à \d{2}h\d{2}/.test(createdTxt), 'U7: date + heure de creation affichees (' + createdTxt.trim() + ')');
  const restTxt = (await card.first().locator('[data-testid="recent-task-rest"]').innerText()).trim();
  ok(restTxt === 'Sans échéance', 'U8: sans date butoir => "Sans echeance" (' + restTxt + ')');
  const href = await card.first().getAttribute('href');
  ok((href || '').includes(DOSS), 'U9: la carte pointe vers le dossier (' + href + ')');

  // ---- U10 : echeance posee -> le badge affiche le temps restant (J-7) ----
  const tn = new Date(Date.now() + 3600000);
  const due = new Date(tn.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  await j(API + '/api/org/dossiers/' + DOSS + '/tasks/' + taskId, { method: 'PATCH', headers: H, body: JSON.stringify({ due_date: due }) });
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await waitText(p, 'Nouvelles tâches', true);
  const card2 = p.locator('[data-testid="recent-task-card"]').filter({ hasText: label });
  const rest2 = (await card2.first().locator('[data-testid="recent-task-rest"]').innerText()).trim();
  ok(rest2 === 'J-7', 'U10: echeance +7j => badge "J-7" (' + rest2 + ')');
  const card2Txt = await card2.first().innerText();
  ok(card2Txt.includes(due) === false, 'U11: la carte affiche le reste, pas la date brute');

  await b.close();

  // ---- teardown : suppression de la tache de test ----
  try { await j(API + '/api/org/dossiers/' + DOSS + '/tasks/' + taskId, { method: 'DELETE', headers: H }); console.log('CLEANUP: tache ' + taskId + ' supprimee'); }
  catch (e) { console.log('!! CLEANUP FAILED: ' + e.message); fails++; }
  const after = await j(API + '/api/org/me/tasks/recent', { headers: H });
  const left = after.tasks.filter(t => t.id === taskId).length;
  ok(left === 0, 'U12: la tache de test a disparu du feed');

  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
