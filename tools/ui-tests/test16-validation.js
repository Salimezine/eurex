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
const jlogin = email => j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: email === 'expert@eurex.tn' ? 'expert1234567' : 'samar1234567' }) });

(async () => {
  // ---- setup API : dossier test + tache en a_verifier ----
  const le = await jlogin('expert@eurex.tn');
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + le.token };
  const lc = await jlogin('samar@eurex.tn');
  const Hc = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lc.token };
  const c = await j(API + '/api/org/clients', { method: 'POST', headers: H, body: JSON.stringify({ name: 'ZZ-VERIFY-UI', assigned_comptable_id: 'user_comp_002' }) });
  const d = await j(API + `/api/org/clients/${c.id}/dossiers`, { method: 'POST', headers: H, body: JSON.stringify({ exercice: 2026 }) });
  const g = await j(API + `/api/org/dossiers/${d.id}`, { headers: H });
  const t0 = g.tasks.find(x => x.month === 10) || g.tasks.find(x => !x.month) || g.tasks[0];
  const tid = t0.id;
  await j(API + `/api/org/dossiers/${d.id}/tasks/${tid}`, { method: 'PATCH', headers: Hc, body: JSON.stringify({ status: 'fait' }) });
  console.log('SETUP OK dossier=' + d.id + ' task=' + tid);

  // ---- UI ----
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  p.on('dialog', async d => { console.log('!! DIALOG[' + d.type() + ']: ' + d.message()); await d.dismiss(); });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => sessionStorage.setItem('eurex_authorized', '1'));
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[name="email"]', { timeout: 20000 });
  await p.fill('input[name="email"]', 'expert@eurex.tn');
  await p.fill('input[name="password"]', 'expert1234567');
  await p.click('button[type="submit"]');
  // onglet Vue globale -> lien dossier du client test
  const glob = p.locator('button', { hasText: 'Vue globale' });
  await glob.first().click({ timeout: 20000 });
  await p.waitForTimeout(1200);
  await p.locator(`a[href*="${d.id}"]`).first().click({ timeout: 20000 });
  // badge delai dans la ligne de la tache
  const v1 = await waitText(p, 'Reste 2', true);
  ok(v1, 'V1: badge compte a rebours visible (ligne tache)');
  if (!v1) {
    const t = await bodyText(p);
    console.log('DEBUG PAGE TITLE:', await p.title(), '| URL:', p.url());
    console.log('DEBUG HAS SAISIE:', t.includes('SAISIE'), '| HAS a_verifier:', t.includes('À vérifier') || t.includes('a_verifier'), '| HAS Reste:', t.includes('Reste'));
    console.log('DEBUG SNIPPET:', t.slice(0, 600).replace(/\n+/g, ' | '));
    await b.close();
    await j(API + `/api/org/dossiers/${d.id}/tasks/${tid}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'a_faire' }) });
    console.log('CLEANUP OK'); process.exit(1);
  }
  // expandre la tache -> panneau Validation
  await p.locator('span', { hasText: t0.label }).first().click();
  ok(await waitText(p, 'Validation :', true), 'V2: panneau Validation affiche');
  ok(await waitText(p, 'Fixer le délai', true), 'V3: bouton Fixer le delai (expert)');
  // fixer 6h
  const inputCount = await p.locator('input[placeholder="h"]').count();
  console.log('DEBUG inputs[h]:', inputCount);
  await p.locator('input[placeholder="h"]').first().fill('6');
  const val = await p.locator('input[placeholder="h"]').first().inputValue();
  console.log('DEBUG input value after fill:', val);
  await p.locator('button', { hasText: 'Fixer le délai' }).first().click();
  const v4 = await waitText(p, 'Reste 5h', true);
  ok(v4, 'V4: badge repasse a ~6h apres fixation (Reste 5h59)');
  if (!v4) {
    const tx = await bodyText(p);
    const i = tx.indexOf('Validation :');
    console.log('DEBUG SNIP:', i >= 0 ? tx.slice(i, i + 300).replace(/\n+/g, ' | ') : 'PANNEAU ABSENT');
  }
  const chk = await j(API + `/api/org/dossiers/${d.id}`, { headers: H });
  const ct = chk.tasks.find(x => x.id === tid);
  const dh = (Date.parse(ct.verify_due_at.replace(' ', 'T') + 'Z') - Date.now()) / 3600000;
  ok(dh > 5.5 && dh <= 6.05, 'V5: API verify_due_at ~ 6h (' + dh.toFixed(2) + 'h)');
  const tv = await bodyText(p);
  ok(/Reste [56]h\d{2}/.test(tv), 'V6: format badge Reste XhMM');
  await b.close();

  // ---- cleanup API ----
  await j(API + `/api/org/dossiers/${d.id}/tasks/${tid}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'a_faire' }) });
  await j(API + '/api/org/clients/' + c.id, { method: 'DELETE', headers: H }).catch(e => console.log('!! deleteClient: ' + e.message));
  console.log('CLEANUP OK dossier=' + d.id + ' client=' + c.id + ' (supprime)');
  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
