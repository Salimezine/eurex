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

  // jour TN courant (UTC+1)
  const tnDate = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const dow = new Date(tnDate + 'T12:00:00+01:00').getUTCDay();
  const isRest = dow === 0 || dow === 6;

  // ---- setup API : compte de test JETABLE + client ZZ-HOURS-UI assigne + 1h pointee ----
  const le = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EXP.email, password: EXP.pwd }) });
  const HE = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + le.token };
  const SAM = await createQaComptable(HE, 'zz-hours', 'Test Heures');
  console.log('QA account: ' + SAM.email);
  const zz = 'ZZ-HOURS-UI-' + Date.now().toString().slice(-6);
  const c = await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz, assigned_comptable_id: SAM.id }) });
  const d = await j(API + `/api/org/clients/${c.id}/dossiers`, { method: 'POST', headers: HE, body: JSON.stringify({ exercice: 2026 }) });
  const g0 = await j(API + `/api/org/dossiers/${d.id}`, { headers: HE });
  const taskId = g0.tasks[0].id;
  const ls = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAM.email, password: SAM.pwd }) });
  const HS = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ls.token };
  await j(API + `/api/org/dossiers/${d.id}/tasks/${taskId}/time`, { method: 'POST', headers: HS, body: JSON.stringify({ seconds: 3600, note: 'test heures' }) });
  console.log('SETUP OK client=' + c.id + ' dossier=' + d.id + ' (+1h pointee)');

  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  p.on('dialog', async dg => { console.log('!! DIALOG[' + dg.type() + ']: ' + dg.message()); await dg.dismiss(); });

  // ---- H1 : le comptable voit la section "Mes heures" sur SON dashboard ----
  await loginAs(p, SAM.email, SAM.pwd);
  const sec = p.locator('[data-testid="mes-heures"]');
  await sec.waitFor({ timeout: 20000 }).catch(() => {});
  ok((await sec.count()) === 1, 'H1: section "Mes heures" visible sur le dashboard comptable');
  const tb = await bodyText(p);
  ok(tb.includes('⏱ Mes heures'), 'H1b: titre "⏱ Mes heures"');
  ok(tb.includes('norme 8h30'), 'H1c: mention de la norme 8h30');

  // ---- H2 : ligne du jour (realise / norme) ----
  ok(tb.includes("Aujourd'hui"), 'H2: ligne "Aujourd\'hui" presente');
  const todayTxt = isRest ? 'Repos' : '8h30';
  ok(tb.includes(todayTxt), 'H2b: norme du jour affichee (' + todayTxt + ')');
  const todayLine = sec.locator('span', { hasText: "Aujourd'hui" }).first();
  const todayLineTxt = await todayLine.innerText();
  ok(/\d+h\d\d/.test(todayLineTxt), 'H2c: formatage XhYY (' + todayLineTxt.replace(/\n/g, ' ') + ')');

  // ---- H3 : total semaine ----
  const weekOk = await waitText(p, 'Semaine (7 jours)', true);
  ok(weekOk, 'H3: total "Semaine (7 jours)"');
  const secTxt = await sec.innerText();
  ok(/\d+h\d\d \/ \d+h\d\d/.test(secTxt), 'H3b: totaux semaine format XhYY / XhYY');
  ok(/(solde net|au-delà de la norme|à jour)/.test(secTxt), 'H3c: solde net affiche (manque/depassement/a-jour)');

  // ---- H4 : barre de progression du jour ----
  const bar = sec.locator('div[style*="width"]');
  ok((await bar.count()) >= 1, 'H4: barre de progression du jour presente');

  // ---- H5 : tableau 7 jours + entetes ----
  const table = sec.locator('[data-testid="heures-table"]');
  ok((await table.count()) === 1, 'H5: tableau des heures present');
  const rows = table.locator('tbody tr');
  const nRows = await rows.count();
  ok(nRows === 7, 'H5b: 7 lignes (7 derniers jours) [' + nRows + ']');
  const ths = await table.locator('thead th').allInnerTexts();
  ok(ths.join(' ').includes('Jour') && ths.join(' ').includes('Réalisé') && ths.join(' ').includes('Norme') && ths.join(' ').includes('Écart norme'),
    'H5c: entetes Jour/Realise/Norme/Ecart norme');

  // ---- H6 : repos sam-dim affiche ----
  const tableTxt = await table.innerText();
  const restCount = (tableTxt.match(/Repos/g) || []).length;
  ok(restCount >= 2, 'H6: jours "Repos" affiches (sam+dim) [' + restCount + ']');

  // ---- H7 : ligne d\'aujourd\'hui surlignee + 1h minimum (add time) ----
  let todayRow = table.locator('tr', { hasText: 'aujourd\u2019ui' });
  let todayRowCount = await todayRow.count();
  if (todayRowCount === 0) todayRow = table.locator('tr', { hasText: "aujourd'hui" });
  todayRowCount = await todayRow.count();
  ok(todayRowCount === 1, 'H7: ligne "aujourd\'hui" unique');
  if (todayRowCount === 1) {
    const cells = await todayRow.locator('td').allInnerTexts();
    const m = (cells[1] || '').match(/(\d+)h(\d\d)/);
    ok(!!m, 'H7b: realise du jour format XhYY (' + (cells[1] || '') + ')');
    if (m && !isRest) ok(parseInt(m[1], 10) >= 1, 'H7c: >= 1h pointee aujourd\'hui (' + cells[1] + ')');
  }

  // ---- H8 : colonne "Ecart norme" renseignee sur chaque ligne ----
  let cellsOk = true;
  const allRows = await rows.all();
  for (const r of allRows) {
    const tds = await r.locator('td').allInnerTexts();
    const normTxt = tds[2] || '';
    const missTxt = (tds[3] || '').trim();
    const okCell = /\d+h\d\d/.test(missTxt) || missTxt.includes('✓ atteint') || missTxt.startsWith('+') || missTxt === '—';
    if (!okCell) cellsOk = false;
    if (normTxt.includes('Repos') && missTxt !== '—' && !missTxt.startsWith('+')) cellsOk = false;
  }
  ok(cellsOk, 'H8: chaque ligne a "XhYY" | "+XhYY" (depassement) | "atteint" | "—"');

  // ---- H10 : onglets de periode (Jours / Mois / Annee) ----
  const tabs = sec.locator('button[role="tab"]');
  ok((await tabs.count()) === 3, 'H10: 3 onglets (Jours/Mois/Annee)');
  await tabs.filter({ hasText: 'Mois' }).click();
  await p.waitForTimeout(1800);
  const rowsMonth = await table.locator('tbody tr').count();
  const todayNum = parseInt(tnDate.slice(8, 10), 10);
  ok(rowsMonth === todayNum, 'H10b: vue Mois -> ' + rowsMonth + ' lignes (jours 1..' + todayNum + ')');
  ok((await bodyText(p)).includes('Mois (au'), 'H10c: total "Mois (au JJ/MM)" affiche');

  await tabs.filter({ hasText: 'Année' }).click();
  await p.waitForTimeout(1800);
  const thYear = await table.locator('thead th').allInnerTexts();
  ok(thYear.join(' ').includes('Mois'), 'H10d: entetes vue Annee (colonne "Mois")');
  const rowsYear = await table.locator('tbody tr').count();
  const monthNum = parseInt(tnDate.slice(5, 7), 10);
  ok(rowsYear === monthNum, 'H10e: vue Annee -> ' + rowsYear + ' mois (janv..' + monthNum + ')');
  const yearTxt = await bodyText(p);
  ok(yearTxt.includes('Année ' + tnDate.slice(0, 4)), 'H10f: total "Annee ' + tnDate.slice(0, 4) + '" affiche');
  ok(yearTxt.includes('en cours'), 'H10g: mois courant marque "en cours"');

  await tabs.filter({ hasText: 'Jours' }).click();
  await p.waitForTimeout(1800);
  const backRows = await table.locator('tbody tr').count();
  ok(backRows === 7, 'H10h: retour vue Jours -> 7 lignes [' + backRows + ']');
  ok((await bodyText(p)).includes('Semaine (7 jours)'), 'H10i: total "Semaine (7 jours)" de retour');

  // ---- H9 : l'expert voit AUSSI ses heures sur son dashboard ----
  await loginAs(p, EXP.email, EXP.pwd);
  const expSec = p.locator('[data-testid="mes-heures"]');
  await expSec.waitFor({ timeout: 20000 }).catch(() => {});
  ok((await expSec.count()) === 1, 'H9: expert -> section "Mes heures" presente sur son dashboard');
  const expTxt = await bodyText(p);
  ok(expTxt.includes('⏱ Mes heures') && /\d+h\d\d \/ (8h30|Repos)/.test(expTxt), 'H9b: heures de l\'expert affichees (XhYY / 8h30)');

  await b.close();
  // teardown : d'abord le client (sinon 409 : client encore assigne), puis le compte de test
  await j(API + '/api/org/clients/' + c.id, { method: 'DELETE', headers: HE }).catch(e => console.log('!! deleteClient: ' + e.message));
  await deleteQaComptable(HE, SAM.id);
  console.log('CLEANUP-NEEDED client=' + c.id + ' dossier=' + d.id);
  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
