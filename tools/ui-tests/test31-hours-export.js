const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const EXP = { email: 'omar.bouhlila@eurextunisie.com', pwd: 'expert1234567' };
const SAL = { email: 'salim.ezzine@eurextunisie.com', pwd: 'salim1234567' };
const SAM = { email: 'samar.daboussi@eurextunisie.com', pwd: 'samar1234567' };
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
async function j(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok && (!opt || !opt.allowFail)) throw new Error(url + ' -> ' + r.status + ' : ' + (await r.text().catch(() => '')));
  return r.json();
}
async function getRaw(url, headers) {
  const r = await fetch(url, { headers });
  // arrayBuffer -> utf8 : on garde le BOM (r.text() le décodeur le mange)
  const body = Buffer.from(await r.arrayBuffer()).toString('utf8');
  return { s: r.status, ct: r.headers.get('content-type') || '', cd: r.headers.get('content-disposition') || '', body };
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
// lignes « données » du CSV (hors en-tête et hors ligne TOTAL)
const dataLines = body => body.replace(/^\uFEFF/, '').split('\r\n').filter(l => l && !l.startsWith('"date"') && !l.includes('"TOTAL"'));

(async () => {
  const lh = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EXP.email, password: EXP.pwd }) });
  const HE = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lh.token };
  const ls = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAL.email, password: SAL.pwd }) });
  const HS = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ls.token };
  const lm = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAM.email, password: SAM.pwd }) });
  const HM = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lm.token };

  const ts = Date.now().toString().slice(-6);
  const zz = 'ZZ-EXPHEURES-' + ts;
  const noteSalim = 'EXP-NOTE-' + ts + ' "quote"; ligne';
  const noteExpert = 'EXP-EXPNOTE-' + ts;
  const client = await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz, assigned_comptable_id: 'user_comp_001' }) });
  const dossier = await j(API + '/api/org/clients/' + client.id + '/dossiers', { method: 'POST', headers: HE, body: JSON.stringify({ exercice: 2026 }) });
  const task = await j(API + '/api/org/dossiers/' + dossier.id + '/tasks', { method: 'POST', headers: HS, body: JSON.stringify({ label: 'TASK-EXPHEURES-' + ts }) });
  await j(API + '/api/org/dossiers/' + dossier.id + '/tasks/' + task.id + '/time', { method: 'POST', headers: HS, body: JSON.stringify({ seconds: 5400, note: noteSalim }) });
  await j(API + '/api/org/dossiers/' + dossier.id + '/tasks/' + task.id + '/time', { method: 'POST', headers: HE, body: JSON.stringify({ seconds: 3600, note: noteExpert }) });
  const cleanup = async () => {
    try { await j(API + '/api/org/clients/' + client.id, { method: 'DELETE', headers: HE }); console.log('CLEANUP: ' + zz + ' supprimé (cascade)'); }
    catch (e) { console.log('!! CLEANUP FAILED: ' + e.message); fails++; }
  };
  console.log('SETUP client=' + client.id + ' dossier=' + dossier.id + ' task=' + task.id);

  const EXP_URL = API + '/api/org/hours/export';
  try {
    // --- A. API ---
    const a1 = await getRaw(EXP_URL, HE);
    ok(a1.s === 200 && a1.ct.includes('text/csv'), 'A1: 200 + content-type text/csv (' + a1.ct + ')');
    ok(a1.cd.includes('filename="') && a1.cd.includes('.csv"'), 'A1b: Content-Disposition attachment (' + a1.cd + ')');
    ok(a1.body.charCodeAt(0) === 0xFEFF, 'A1c: BOM UTF-8 présent (Excel FR)');
    const header = a1.body.replace(/^\uFEFF/, '').split('\r\n')[0];
    ok(header.startsWith('"date";"debut";"fin";"duree"'), 'A1d: en-tête CSV (' + header.slice(0, 60) + '...)');
    ok(a1.body.includes('EXP-NOTE-' + ts) && a1.body.includes('EXP-EXPNOTE-' + ts), 'A1e: les 2 saisies (Salim + expert) sont exportées');
    ok(a1.body.includes('""quote""'), 'A1f: échappement des guillemets (note avec ")');
    ok(a1.body.includes('"TOTAL"'), 'A1g: ligne TOTAL présente');
    const lines1 = dataLines(a1.body);
    if (lines1.length !== 2) console.log('DEBUG dataLines(' + lines1.length + '):', JSON.stringify(lines1, null, 1).slice(0, 1500));
    ok(lines1.length === 2, 'A1h: exactement 2 lignes de données (' + lines1.length + ')');

    const a2 = await getRaw(EXP_URL + '?exercice=2026', HE);
    ok(a2.s === 200 && dataLines(a2.body).length === 2, 'A2: filtre exercice=2026 garde les 2 saisies');
    const a2b = await getRaw(EXP_URL + '?exercice=2025', HE);
    ok(a2b.s === 200 && dataLines(a2b.body).length === 0, 'A2b: exercice=2025 -> 0 ligne (header seuls)');
    ok(a2b.body.includes('"TOTAL"'), 'A2c: TOTAL toujours présent même sans donnée');

    const a3 = await getRaw(EXP_URL + '?dossier_id=' + dossier.id, HE);
    ok(dataLines(a3.body).length === 2, 'A3: dossier_id filtre correctement');
    const a3b = await getRaw(EXP_URL + '?dossier_id=inexistant', HE);
    ok(a3b.s === 200 && dataLines(a3b.body).length === 0, 'A3b: dossier inconnu -> 0 ligne');

    const comptables = await j(API + '/api/org/comptables', { headers: HE });
    const salimId = comptables.find(u => u.email === SAL.email).id;
    const samarId = comptables.find(u => u.email === SAM.email).id;
    const a4 = await getRaw(EXP_URL + '?user_id=' + salimId, HE);
    ok(dataLines(a4.body).length === 1 && a4.body.includes('EXP-NOTE-' + ts) && !a4.body.includes('EXP-EXPNOTE-' + ts), 'A4: expert filtre sur Salim -> 1 ligne, uniquement la sienne');
    const a4b = await getRaw(EXP_URL + '?user_id=' + samarId, HE);
    ok(dataLines(a4b.body).length === 0, 'A4b: expert filtre sur Samar (0 saisie) -> 0 ligne');

    const a5 = await getRaw(EXP_URL, HS);
    ok(dataLines(a5.body).length === 1 && a5.body.includes('EXP-NOTE-' + ts) && !a5.body.includes('EXP-EXPNOTE-' + ts), 'A5: Salim exporte -> SEULEMENT ses heures (portée)');
    const a5b = await getRaw(EXP_URL + '?user_id=' + salimId, HS);
    ok(dataLines(a5b.body).length === 1 && !a5b.body.includes('EXP-EXPNOTE-' + ts), 'A5b: Salim avec ?user_id=expert -> ignoré, reste ses heures');

    const a6 = await getRaw(EXP_URL, HM);
    ok(a6.s === 200 && dataLines(a6.body).length === 0, 'A6: Samar (0 saisie) -> 200, 0 ligne');

    const now = new Date(Date.now() + 3600000);
    const a7 = await getRaw(`${EXP_URL}?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`, HE);
    ok(dataLines(a7.body).length === 2, 'A7: filtre year+month du mois courant -> 2 lignes');
    const otherM = now.getUTCMonth() + 1 === 12 ? 1 : now.getUTCMonth() + 2;
    const a7b = await getRaw(`${EXP_URL}?year=${now.getUTCFullYear()}&month=${otherM}`, HE);
    ok(dataLines(a7b.body).length === 0, 'A7b: autre mois -> 0 ligne');

    // --- B. UI ---
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    try {
      // Expert : export cabinet
      await loginAs(page, EXP.email, EXP.pwd);
      await page.waitForSelector('[data-testid="export-heures-cabinet"]', { timeout: 20000 });
      ok(await page.locator('[data-testid="export-heures-cabinet"]').isVisible(), 'B1: bouton « Export heures » visible (dashboard expert)');
      const [dl1] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }),
        page.click('[data-testid="export-heures-cabinet"]'),
      ]);
      ok(dl1.suggestedFilename().endsWith('.csv') && dl1.suggestedFilename().includes('cabinet'), 'B1b: téléchargement (' + dl1.suggestedFilename() + ')');
      const csv1 = fs.readFileSync(await dl1.path(), 'utf8');
      ok(csv1.includes('EXP-EXPNOTE-' + ts) && csv1.includes('EXP-NOTE-' + ts), 'B1c: contenu CSV = les 2 saisies du cabinet');

      // Comptable : export « mes heures »
      await loginAs(page, SAL.email, SAL.pwd);
      await page.waitForSelector('[data-testid="heures-export"]', { timeout: 20000 });
      ok(await page.locator('[data-testid="heures-export"]').isVisible(), 'B2: bouton ⬇ CSV visible (carte Mes heures, Salim)');
      const [dl2] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }),
        page.click('[data-testid="heures-export"]'),
      ]);
      ok(dl2.suggestedFilename().endsWith('.csv'), 'B2b: téléchargement (' + dl2.suggestedFilename() + ')');
      const csv2 = fs.readFileSync(await dl2.path(), 'utf8');
      ok(csv2.includes('EXP-NOTE-' + ts) && !csv2.includes('EXP-EXPNOTE-' + ts), 'B2c: CSV de Salim = ses heures uniquement');

      ok(errors.length === 0, 'B3: aucune erreur JS (' + errors.length + ')');
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
