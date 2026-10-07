// test25 — minimisation des cartes dashboard : Nouvelles taches / A verifier / Mes heures
// Chaque carte a son propre bouton chevron + etat memorise (localStorage), comme Echeances fiscales.
const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const EXP = { email: 'expert@eurex.tn', pwd: 'expert1234567' };
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
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
const getLS = (p, k) => p.evaluate(kk => localStorage.getItem(kk), k);
const shown = async (loc) => loc.count();

(async () => {
  const he = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EXP.email, password: EXP.pwd }) });
  const HE = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + he.token };
  const lc = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'salim@eurex.tn', password: 'salim1234567' }) });
  const HC = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lc.token };
  const zz = 'ZZ-CARDSMIN-' + Date.now().toString().slice(-6);

  // Setup : client + dossier (expert) + tache AJOUTEE MANUELLEMENT (comptable)
  // -> carte "Nouvelles taches" ; puis "fait" -> carte "A verifier".
  const client = await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz, assigned_comptable_id: 'user_comp_001' }) });
  const dossier = await j(API + `/api/org/clients/${client.id}/dossiers`, { method: 'POST', headers: HE, body: JSON.stringify({ exercice: 2026 }) });
  const task = await j(API + '/api/org/dossiers/' + dossier.id + '/tasks', { method: 'POST', headers: HC, body: JSON.stringify({ label: 'ZZ-CARDSMIN-TASK' }) });
  await j(API + '/api/org/dossiers/' + dossier.id + '/tasks/' + task.id, { method: 'PATCH', headers: HC, body: JSON.stringify({ status: 'fait' }) });
  console.log('SETUP client=' + client.id + ' dossier=' + dossier.id + ' task=' + task.id + ' ' + zz);

  let b;
  try {
    b = await chromium.launch();
    const p = await b.newPage();
    p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));

    await loginAs(p, EXP.email, EXP.pwd);
    await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });

    // ---- C1 : carte Nouvelles taches ----
    const nt = p.locator('[data-testid="nouvelles-taches"]');
    ok(await nt.waitFor({ timeout: 20000 }).then(() => true).catch(() => false), 'C1: carte "Nouvelles taches" presente');
    ok(await p.locator('[data-testid="recent-task-card"]').count() >= 1, 'C1b: au moins une carte de tache');
    await p.locator('[data-testid="nouvelles-taches-min"]').click();
    await p.waitForTimeout(250);
    ok(await shown(p.locator('[data-testid="recent-task-card"]')) === 0, 'C2: contenu replie apres clic');
    ok(await shown(p.locator('[data-testid="nouvelles-taches-count"]')) === 1, 'C2b: compteur visible en carte minimale');
    ok(await getLS(p, 'eurex_nt_min') === '1', 'C2c: etat memorise (eurex_nt_min)');
    await p.locator('[data-testid="nouvelles-taches-min"]').click();
    await p.waitForTimeout(250);
    ok(await p.locator('[data-testid="recent-task-card"]').count() >= 1, 'C3: la carte se deroule a nouveau');

    // ---- C4 : carte A verifier ----
    const av = p.locator('[data-testid="a-verifier"]');
    ok(await av.waitFor({ timeout: 20000 }).then(() => true).catch(() => false), 'C4: carte "A verifier" presente');
    ok(await p.locator('[data-testid="verify-task-card"]').count() >= 1, 'C4b: au moins une carte de verification');
    await p.locator('[data-testid="a-verifier-min"]').click();
    await p.waitForTimeout(250);
    ok(await shown(p.locator('[data-testid="verify-task-card"]')) === 0, 'C5: contenu replie apres clic');
    ok(await shown(p.locator('[data-testid="a-verifier-count"]')) === 1, 'C5b: compteur visible en carte minimale');
    ok(await getLS(p, 'eurex_verify_min') === '1', 'C5c: etat memorise (eurex_verify_min)');
    await p.locator('[data-testid="a-verifier-min"]').click();
    await p.waitForTimeout(250);
    ok(await p.locator('[data-testid="verify-task-card"]').count() >= 1, 'C6: la carte se deroule a nouveau');

    // ---- C7 : carte Mes heures (+ persistance apres rechargement) ----
    const mh = p.locator('[data-testid="mes-heures"]');
    ok(await mh.waitFor({ timeout: 20000 }).then(() => true).catch(() => false), 'C7: carte "Mes heures" presente');
    ok(await shown(p.locator('[data-testid="heures-table"]')) === 1, 'C7b: tableau visible avant minimisation');
    await p.locator('[data-testid="heures-minimize"]').click();
    await p.waitForTimeout(250);
    ok(await shown(p.locator('[data-testid="heures-table"]')) === 0, 'C8: tableau replie apres clic');
    ok(await shown(p.locator('[data-testid="heures-today-chip"]')) === 1, 'C8b: resume du jour visible en carte minimale');
    ok(await getLS(p, 'eurex_heures_min') === '1', 'C8c: etat memorise (eurex_heures_min)');

    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2000);
    ok(await p.locator('[data-testid="mes-heures"]').count() === 1 && await shown(p.locator('[data-testid="heures-table"]')) === 0, 'C9: "Mes heures" toujours minimise apres rechargement');
    ok(await p.locator('[data-testid="recent-task-card"]').count() >= 1 && await p.locator('[data-testid="verify-task-card"]').count() >= 1, 'C9b: les autres cartes restent deployees (etats independants)');
    await p.locator('[data-testid="heures-minimize"]').click();
    await p.waitForTimeout(250);
    ok(await shown(p.locator('[data-testid="heures-table"]')) === 1, 'C10: la carte se deroule a nouveau');
    ok(await getLS(p, 'eurex_heures_min') === '0', 'C11: etat remis a zero');

    await b.close();
  } finally {
    if (b) await b.close().catch(() => {});
    try { await j(API + '/api/org/clients/' + client.id, { method: 'DELETE', headers: HE }); console.log('CLEANUP: client ' + zz + ' supprime (cascade)'); }
    catch (e) { console.log('!! CLEANUP FAILED: ' + e.message); fails++; }
  }

  const left = await j(API + '/api/org/clients', { headers: HE });
  const arr = Array.isArray(left) ? left : (left.clients || left.data || []);
  ok(!arr.some(c => c.name === zz), 'C12: aucun residu client de test');

  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
