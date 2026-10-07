const { chromium } = require('playwright');
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

(async () => {
  const EXP = { email: 'expert@eurex.tn', pwd: 'expert1234567' };
  const tnDate = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const todayNum = parseInt(tnDate.slice(8, 10), 10);
  const monthNum = parseInt(tnDate.slice(5, 7), 10);

  // ---- setup API : id de Samar ----
  const le = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EXP.email, password: EXP.pwd }) });
  const HE = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + le.token };
  const comps = await j(API + '/api/org/comptables', { headers: HE });
  const samar = comps.find(c => c.email === 'samar@eurex.tn');
  if (!samar) { console.log('ERREUR: samar introuvable'); process.exit(2); }

  // API : les 3 vues des heures de Samar
  const hD = await j(API + `/api/org/comptables/${samar.id}/hours?view=days`, { headers: HE });
  ok(hD.view === 'days' && hD.days.length === 7, 'A1: API heures de Samar -> 7 jours');
  const hY = await j(API + `/api/org/comptables/${samar.id}/hours?view=year`, { headers: HE });
  ok(hY.months.length === monthNum, 'A2: API vue annee -> ' + hY.months.length + ' mois');
  try { await j(API + `/api/org/comptables/${samar.id}/hours`, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' } }); ok(false, 'A3: token invalide -> 401'); }
  catch (e) { ok(String(e.message).includes('401'), 'A3: token invalide -> 401'); }

  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));

  // ---- U1 : fiche comptable -> onglet Temps total ----
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => { localStorage.clear(); sessionStorage.setItem('eurex_authorized', '1'); });
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[name="email"]', { timeout: 20000 });
  await p.fill('input[name="email"]', EXP.email);
  await p.fill('input[name="password"]', EXP.pwd);
  await p.click('button[type="submit"]');
  await p.waitForTimeout(1500);
  await p.goto(BASE + `/cabinet/comptable/${samar.id}`, { waitUntil: 'domcontentloaded' });
  const u1 = await waitText(p, samar.full_name, true);
  ok(u1, 'U1: fiche de ' + samar.full_name + ' ouverte');

  await p.locator('button', { hasText: 'Temps total' }).first().click();
  const u2 = await waitText(p, 'Heures de ' + samar.full_name, true);
  ok(u2, 'U2: section "Heures de ' + samar.full_name + '" dans l\'onglet Temps');

  // ---- U3 : 3 onglets de periode ----
  const sec = p.locator('[data-testid="mes-heures"]');
  const tabs = sec.locator('button[role="tab"]');
  ok((await tabs.count()) === 3, 'U3: 3 onglets (Jours/Mois/Annee)');

  // ---- U4 : vue Mois ----
  await tabs.filter({ hasText: 'Mois' }).click();
  await p.waitForTimeout(1800);
  const table = sec.locator('[data-testid="heures-table"]');
  const rowsMonth = await table.locator('tbody tr').count();
  ok(rowsMonth === todayNum, 'U4: vue Mois -> ' + rowsMonth + ' lignes (1..' + todayNum + ')');

  // ---- U5 : vue Annee ----
  await tabs.filter({ hasText: 'Année' }).click();
  await p.waitForTimeout(1800);
  const rowsYear = await table.locator('tbody tr').count();
  ok(rowsYear === monthNum, 'U5: vue Annee -> ' + rowsYear + ' mois (janv..' + monthNum + ')');
  const thY = await table.locator('thead th').allInnerTexts();
  ok(thY.join(' ').includes('Mois'), 'U5b: entetes annee (colonne Mois)');
  ok((await bodyText(p)).includes('en cours'), 'U5c: mois courant marque "en cours"');

  // ---- U6 : retour Jours ----
  await tabs.filter({ hasText: 'Jours' }).click();
  await p.waitForTimeout(1800);
  const rowsBack = await table.locator('tbody tr').count();
  ok(rowsBack === 7, 'U6: retour Jours -> 7 lignes [' + rowsBack + ']');
  ok((await bodyText(p)).includes('Semaine (7 jours)'), 'U6b: total "Semaine (7 jours)"');

  await b.close();
  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
