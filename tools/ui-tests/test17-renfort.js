const { chromium } = require('playwright');
const { createQaComptable, deleteQaComptable } = require('./qa-account');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
async function bodyText(p) { return p.evaluate(() => document.body.innerText); }
async function waitText(p, sub, want, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if ((await bodyText(p)).includes(sub) === want) return true;
    await p.waitForTimeout(500);
  }
  return false;
}
async function j(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
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
  const EXP = { email: 'expert@eurex.tn', pwd: 'expert1234567' };

  // ---- setup API ----
  const le = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EXP.email, password: EXP.pwd }) });
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + le.token };
  // Comptable de test JETABLE (cree ici, supprime en fin de test) : aucun compte reel touche
  const COMP = await createQaComptable(H, 'zz-renfort', 'Test Comptable');
  console.log('QA account: ' + COMP.email);
  const zz = 'ZZ-RENFORC-' + Date.now().toString().slice(-6);
  const c = await j(API + '/api/org/clients', { method: 'POST', headers: H, body: JSON.stringify({ name: zz, assigned_comptable_id: 'user_comp_002' }) });
  const d = await j(API + `/api/org/clients/${c.id}/dossiers`, { method: 'POST', headers: H, body: JSON.stringify({ exercice: 2026 }) });
  console.log('SETUP OK client=' + c.id + ' dossier=' + d.id);

  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  p.on('dialog', async dg => { console.log('!! DIALOG[' + dg.type() + ']: ' + dg.message()); await dg.accept(); });

  // ---- U1 : comptable sans acces -> ecran Acces refuse ----
  await loginAs(p, COMP.email, COMP.pwd);
  await p.goto(BASE + `/cabinet/dossier/${d.id}`, { waitUntil: 'domcontentloaded' });
  const u1 = await waitText(p, 'Accès refusé', true);
  ok(u1, 'U1: ecran "Accès refusé" pour un comptable non assigne');
  const t1 = await bodyText(p);
  ok(!t1.includes('Dossier non trouvé'), 'U1b: pas le message "Dossier non trouvé"');
  ok(t1.includes('renfort'), 'U1c: explication renfort presente');

  // ---- U2 : expert -> panneau Renfort + creation du grant ----
  await loginAs(p, EXP.email, EXP.pwd);
  await p.goto(BASE + `/cabinet/dossier/${d.id}`, { waitUntil: 'domcontentloaded' });
  const u2 = await waitText(p, 'Renfort — accès temporaire', true);
  ok(u2, 'U2: panneau Renfort visible (expert)');
  ok((await bodyText(p)).includes('0 accès actif'), 'U2b: 0 acces actif au depart');
  await p.locator('select[title="Comptable bénéficiaire"]').selectOption({ label: 'Test Comptable' });
  await p.locator('select[title="Durée du renfort"]').selectOption('7');
  await p.locator('input[placeholder="Motif du renfort"]').fill('Remplacement congé annuel');
  await p.locator('button', { hasText: "Ouvrir l'accès" }).first().click();
  const u3 = await waitText(p, '1 accès actif', true);
  ok(u3, 'U3: grant cree — 1 acces actif');
  const grantTxt = await bodyText(p);
  ok(grantTxt.includes('Test Comptable') && grantTxt.includes('Remplacement congé annuel') && grantTxt.includes('J-7'), 'U3b: ligne grant (nom, motif, J-7)');

  // ---- U4 : beneficiaire -> badge Renfort + section dashboard ----
  await loginAs(p, COMP.email, COMP.pwd);
  await p.goto(BASE + `/cabinet/dossier/${d.id}`, { waitUntil: 'domcontentloaded' });
  const u4 = await waitText(p, '🔧 Renfort', true);
  ok(u4, 'U4: badge Renfort sur le dossier ouvert');
  ok((await bodyText(p)).includes('avancement'), 'U4b: contenu du dossier charge');
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  const u5 = await waitText(p, 'Dossiers en renfort', true);
  ok(u5, 'U5: dashboard comptable — section "Dossiers en renfort"');
  const dash = await bodyText(p);
  ok(dash.includes(zz), 'U5b: carte du client renforce presente');
  const card = p.locator('a[href*="' + d.id + '"]').first();
  await card.click({ timeout: 10000 });
  ok(await waitText(p, '🔧 Renfort', true), 'U5c: clic carte -> dossier avec badge');

  // ---- U6 : expert revoque -> retour au blocage ----
  await loginAs(p, EXP.email, EXP.pwd);
  await p.goto(BASE + `/cabinet/dossier/${d.id}`, { waitUntil: 'domcontentloaded' });
  await waitText(p, '1 accès actif', true);
  await p.locator('button', { hasText: 'Révoquer' }).first().click();
  const u6 = await waitText(p, '0 accès actif', true);
  ok(u6, 'U6: revocation -> 0 acces actif');

  // ---- U7 : beneficiaire revoit l ecran Acces refuse ----
  await loginAs(p, COMP.email, COMP.pwd);
  await p.goto(BASE + `/cabinet/dossier/${d.id}`, { waitUntil: 'domcontentloaded' });
  const u7 = await waitText(p, 'Accès refusé', true);
  ok(u7, 'U7: apres revocation -> Accès refusé de retour');
  const dash2 = await (async () => { await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500); return bodyText(p); })();
  ok(!dash2.includes('Dossiers en renfort'), 'U7b: section renfort disparue du dashboard');

  await b.close();
  await deleteQaComptable(H, COMP.id);
  await j(API + '/api/org/clients/' + c.id, { method: 'DELETE', headers: H }).catch(e => console.log('!! deleteClient: ' + e.message));
  console.log('CLEANUP OK client=' + c.id + ' dossier=' + d.id + ' (supprime)');
  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
