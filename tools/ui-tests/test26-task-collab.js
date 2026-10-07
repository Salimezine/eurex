// test26 — Collaboration : un comptable tague un autre comptable sur une tache
//   => acces AUTO au dossier (renfort) + chacun son chrono (chronos en parallele)
const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const EXP = { email: 'expert@eurex.tn', pwd: 'expert1234567' };
const A = { email: 'salim@eurex.tn', pwd: 'salim1234567' }; // comptable assigne du dossier
const B = { email: 'samar@eurex.tn', pwd: 'samar1234567' }; // autre comptable (pas d'acces au depart)
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
const JSON_ = { 'Content-Type': 'application/json' };
const auth = tok => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok });
async function j(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(url + ' -> ' + r.status + ' : ' + (await r.text().catch(() => '')));
  return r.json();
}
// reponse brute, pour les erreurs attendues (400/403...)
async function raw(url, opt) {
  const r = await fetch(url, opt);
  let b = null; try { b = await r.json(); } catch {}
  return { s: r.status, b };
}
const post = (url, headers, body) => j(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
const get = (url, headers) => j(url, { headers });
const del = (url, headers) => j(url, { method: 'DELETE', headers });
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
  // ---- tokens ----
  const te = await post(API + '/api/org/auth/login', JSON_, { email: EXP.email, password: EXP.pwd });
  const ta = await post(API + '/api/org/auth/login', JSON_, { email: A.email, password: A.pwd });
  const tb = await post(API + '/api/org/auth/login', JSON_, { email: B.email, password: B.pwd });
  const HE = auth(te.token);
  const HA = auth(ta.token);
  const HB = auth(tb.token);
  const idA = ta.user.id, idB = tb.user.id, nameB = tb.user.full_name;
  const zz = 'ZZ-COLLAB-' + Date.now().toString().slice(-6);
  const label = 'ZZ-COLLAB-TASK-' + Date.now().toString().slice(-4);

  // ---- setup : client + dossier (expert) assigne a Salim, tache ajoutee par Salim ----
  const client = await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz, assigned_comptable_id: idA }) });
  const dossier = await j(API + `/api/org/clients/${client.id}/dossiers`, { method: 'POST', headers: HE, body: JSON.stringify({ exercice: 2026 }) });
  const task = await j(API + `/api/org/dossiers/${dossier.id}/tasks`, { method: 'POST', headers: HA, body: JSON.stringify({ label, month: new Date().getMonth() + 1 }) });
  console.log('SETUP client=' + client.id + ' dossier=' + dossier.id + ' task=' + task.id + ' ' + zz);

  let b;
  try {
    // ---- A0 : B n'a aucun acces au depart ----
    const r0 = await raw(API + `/api/org/dossiers/${dossier.id}`, { headers: HB });
    ok(r0.s === 403, 'A0: samar sans acces au dossier avant le tag (403, obtenu ' + r0.s + ')');

    // ---- A1 : liste des comptables taguables ----
    const cands = await get(API + `/api/org/dossiers/${dossier.id}/collaborators/eligible`, HA);
    ok(Array.isArray(cands) && cands.some(c => c.id === idB && c.has_access === false), 'A1: samar proposee dans les candidats (sans acces)');
    ok(!cands.some(c => c.id === idA), 'A2: on ne se tague pas soi-meme');

    // ---- UI : tag depuis la page dossier (Salim) ----
    b = await chromium.launch();
    const p = await b.newPage();
    p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
    p.on('dialog', async dg => { console.log('!! DIALOG[' + dg.type() + ']: ' + dg.message()); await dg.accept(); });
    await loginAs(p, A.email, A.pwd);
    // deep link : filtre "Tous" + tache ouverte directement
    await p.goto(BASE + '/cabinet/dossier/' + dossier.id + '?task=' + task.id, { waitUntil: 'domcontentloaded' });
    const row = p.locator('[data-testid="task-row"]').filter({ hasText: label });
    ok(await row.first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false), 'U1: la tache de test est visible');
    const addBtn = p.locator('[data-testid="task-collab-add"]');
    if (await addBtn.count() === 0) { await row.first().click(); await p.waitForTimeout(500); }
    ok(await addBtn.count() === 1, 'U2: bouton "+ Taguer un comptable" present');
    await addBtn.click();
    await p.waitForTimeout(500);
    const sel = p.locator('[data-testid="task-collab-select"]');
    ok(await sel.count() === 1, 'U3: select des comptables ouvert');
    const opts = await sel.locator('option').allTextContents();
    ok(opts.length === 2 && opts[1].includes(nameB), 'U4: seul candidat = ' + (opts[1] || '') + ' (' + opts.length + ' options)');
    await sel.selectOption(idB);
    await p.locator('[data-testid="task-collab-days"]').selectOption('7');
    await p.locator('[data-testid="task-collab-confirm"]').click();
    const chip = p.locator('[data-testid="task-collab"]').filter({ hasText: nameB });
    ok(await chip.first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false), 'U5: badge collaborateur "' + nameB + '" affiche sur la tache');

    // ---- A2 : acces automatique au dossier ----
    const r1 = await raw(API + `/api/org/dossiers/${dossier.id}`, { headers: HB });
    ok(r1.s === 200, 'A3: samar a acces au dossier apres le tag (' + r1.s + ')');
    const dForB = r1.b;
    const tForB = (dForB.tasks || []).find(t => t.id === task.id);
    ok(!!tForB && (tForB.collaborators || []).some(c => c.user_id === idB), 'A4: le tag est visible dans le dossier de samar');
    const cands2 = await get(API + `/api/org/dossiers/${dossier.id}/collaborators/eligible`, HA);
    ok(cands2.some(c => c.id === idB && c.has_access === true), 'A5: samar signalee "acces" dans les candidats');
    const grantsExp = await get(API + `/api/org/dossiers/${dossier.id}/grants`, HE);
    const gCollab = grantsExp.find(g => g.granted_to === idB && String(g.reason || '').startsWith('Collaboration'));
    ok(!!gCollab, 'A6: renfort auto cree (motif "' + (gCollab ? gCollab.reason : '?') + '", expire ' + (gCollab ? gCollab.expires_at : '?') + ')');

    // ---- B0 : chacun son chrono (avant : "Timer deja en cours") ----
    await post(API + `/api/org/dossiers/${dossier.id}/tasks/${task.id}/timer/start`, HA);
    const startB = await raw(API + `/api/org/dossiers/${dossier.id}/tasks/${task.id}/timer/start`, { method: 'POST', headers: HB, body: '{}' });
    ok(startB.s === 200, 'B1: samar peut chronometrer la meme tache en parallele (' + startB.s + ')');
    await sleep(1200);
    const dRun = await get(API + `/api/org/dossiers/${dossier.id}`, HA);
    ok((dRun.running_timers || []).length === 2, 'B2: 2 chronos actifs en parallele (' + (dRun.running_timers || []).length + ')');
    const tRun = dRun.tasks.find(t => t.id === task.id);
    ok(!!tRun.timer_started_at, 'B3: le chrono de la tache reste ouvert');

    // double demarrage interdit pour le meme comptable
    const dbl = await raw(API + `/api/org/dossiers/${dossier.id}/tasks/${task.id}/timer/start`, { method: 'POST', headers: HA, body: '{}' });
    ok(dbl.s === 400, 'B4: pas de double chrono pour le meme comptable (400, obtenu ' + dbl.s + ')');

    // ---- U6 : Salim voit le chrono de samar en cours ----
    await p.reload({ waitUntil: 'domcontentloaded' });
    const row2 = p.locator('[data-testid="task-row"]').filter({ hasText: label });
    await row2.first().waitFor({ timeout: 20000 }).catch(() => {});
    if (await p.locator('[data-testid="other-timers"]').count() === 0) { await row2.first().click(); await p.waitForTimeout(500); }
    ok(await p.locator('[data-testid="other-timers"]').count() === 1, 'U6: indicateur "samar chronometre" visible pour Salim');
    ok(await p.locator('[data-testid="my-timer-elapsed"]').count() === 1, 'U7: chrono de Salim affiche');

    // ---- B5 : saisie manuelle bloquee pendant SON propre chrono ----
    const own = await raw(API + `/api/org/dossiers/${dossier.id}/tasks/${task.id}/time`, { method: 'POST', headers: HB, body: JSON.stringify({ seconds: 60, note: 'zz' }) });
    ok(own.s === 400, 'B5: saisie manuelle bloquee pendant son propre chrono (400, obtenu ' + own.s + ')');

    // ---- B6 : apres l'arret de son chrono, samar saisit meme si le chrono de Salim tourne ----
    await post(API + `/api/org/dossiers/${dossier.id}/tasks/${task.id}/timer/stop`, HB);
    const manual = await raw(API + `/api/org/dossiers/${dossier.id}/tasks/${task.id}/time`, { method: 'POST', headers: HB, body: JSON.stringify({ seconds: 60, note: 'zz-collab' }) });
    ok(manual.s === 200, 'B6: saisie manuelle autorisee quand c est le chrono des AUTRES qui tourne (' + manual.s + ')');

    // ---- B7 : arrets + comptabilite separee ----
    const stopA = await post(API + `/api/org/dossiers/${dossier.id}/tasks/${task.id}/timer/stop`, HA);
    ok(stopA.duration_seconds >= 1, 'B7: chrono de Salim arrete avec duree > 0 (' + stopA.duration_seconds + 's)');
    const dEnd = await get(API + `/api/org/dossiers/${dossier.id}`, HA);
    const tEnd = dEnd.tasks.find(t => t.id === task.id);
    ok(tEnd.total_time_seconds >= 61, 'B8: temps total = chrono Salim + saisie samar (' + tEnd.total_time_seconds + 's)');
    ok(!tEnd.timer_started_at, 'B9: plus aucun chrono actif sur la tache');
    const byUsers = dEnd.time_by_user || [];
    ok(byUsers.length === 2 && byUsers.every(u => u.seconds > 0), 'B10: heures comptees SEPAREMENT par comptable (' + byUsers.map(u => u.user_name + '=' + u.seconds + 's').join(', ') + ')');

    await b.close();
    b = null;

    // ---- A7 : retrait du tag -> l acces auto disparait ----
    const rm = await del(API + `/api/org/dossiers/${dossier.id}/tasks/${task.id}/collaborators/${idB}`, HA);
    ok(rm.grant_revoked === true, 'A7: retrait du tag => renfort auto revoque (' + rm.grant_revoked + ')');
    const r2 = await raw(API + `/api/org/dossiers/${dossier.id}`, { headers: HB });
    ok(r2.s === 403, 'A8: samar perd l acces apres le retrait du tag (403, obtenu ' + r2.s + ')');
    const dForA = await get(API + `/api/org/dossiers/${dossier.id}`, HA);
    const tForA = dForA.tasks.find(t => t.id === task.id);
    ok(!(tForA.collaborators || []).some(c => c.user_id === idB), 'A9: plus de badge collaborateur');
  } finally {
    if (b) await b.close().catch(() => {});
    try { await del(API + '/api/org/clients/' + client.id, HE); console.log('CLEANUP: client ' + zz + ' supprime (cascade)'); }
    catch (e) { console.log('!! CLEANUP FAILED: ' + e.message); fails++; }
  }

  const left = await get(API + '/api/org/clients', HE);
  const arr = Array.isArray(left) ? left : (left.clients || left.data || []);
  ok(!arr.some(c => c.name === zz), 'A10: aucun residu client de test');

  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
