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
  const lh = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EXP.email, password: EXP.pwd }) });
  const HE = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lh.token };
  const ls = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAL.email, password: SAL.pwd }) });
  const HS = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ls.token };
  const lm = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAM.email, password: SAM.pwd }) });
  const HM = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lm.token };

  const ts = Date.now().toString().slice(-6);
  const zz = 'ZZ-SEARCH-' + ts;
  const taskLabel = 'TASK-RECH-' + ts;
  const noteContent = 'NOTE-RECH-' + ts + ' contenu unique';
  const client = await j(API + '/api/org/clients', { method: 'POST', headers: HE, body: JSON.stringify({ name: zz, assigned_comptable_id: 'user_comp_001' }) });
  const dossier = await j(API + '/api/org/clients/' + client.id + '/dossiers', { method: 'POST', headers: HE, body: JSON.stringify({ exercice: 2026 }) });
  const task = await j(API + '/api/org/dossiers/' + dossier.id + '/tasks', { method: 'POST', headers: HS, body: JSON.stringify({ label: taskLabel }) });
  const note = await j(API + '/api/org/dossiers/' + dossier.id + '/notes', { method: 'POST', headers: HS, body: JSON.stringify({ content: noteContent }) });
  const cleanup = async () => {
    try { await j(API + '/api/org/clients/' + client.id, { method: 'DELETE', headers: HE }); console.log('CLEANUP: ' + zz + ' supprimé (cascade)'); }
    catch (e) { console.log('!! CLEANUP FAILED: ' + e.message); fails++; }
  };
  console.log('SETUP client=' + client.id + ' dossier=' + dossier.id + ' task=' + task.id + ' note=' + note.id);

  const search = (q, H) => j(API + '/api/org/search?q=' + encodeURIComponent(q), { headers: H });
  const findId = (arr, id) => (arr || []).some(x => x.id === id);

  let r;
  try {
    // --- A. API ---
    r = await search('Z', HE);
    ok(Array.isArray(r.clients) && Array.isArray(r.dossiers) && r.clients.length === 0, 'A1: q de 1 caractère -> résultat vide');

    r = await search(zz, HE);
    ok(findId(r.clients, client.id), 'A2: expert trouve le client par nom');
    const found = (r.clients || []).find(x => x.id === client.id);
    ok(!!found && found.dossier_id === dossier.id, 'A2b: résultat client porte le dossier courant (' + (found && found.dossier_id) + ')');
    ok((r.dossiers || []).some(x => x.id === dossier.id), 'A2c: le dossier apparaît aussi (nom du client)');

    r = await search(taskLabel, HE);
    const t = (r.tasks || []).find(x => x.id === task.id);
    ok(!!t, 'A3: tâche trouvée par libellé');
    ok(!!t && t.dossier_id === dossier.id && t.client_name === zz, 'A3b: tâche rattachée au bon dossier/client');

    r = await search(noteContent.slice(0, 24), HE);
    ok((r.notes || []).some(x => x.id === note.id), 'A4: note trouvée par contenu');

    const dg = (await j(API + '/api/org/dossiers/' + dossier.id, { headers: HE }));
    const docLabel = (dg.documents && dg.documents[0] || {}).label;
    if (docLabel) {
      r = await search(docLabel, HE);
      ok((r.documents || []).some(x => x.dossier_id === dossier.id), 'A5: document attendu trouvé par libellé (' + docLabel + ')');
    } else { ok(false, 'A5: aucun document de template sur le dossier'); }

    r = await search(zz, HS);
    ok((r.clients || []).some(x => x.id === client.id), 'A6: comptable assigné voit le client');

    r = await search(zz, HM);
    ok(!(r.clients || []).some(x => x.id === client.id) && !(r.dossiers || []).some(x => x.id === dossier.id)
      && !(r.tasks || []).some(x => x.dossier_id === dossier.id) && !(r.notes || []).some(x => x.dossier_id === dossier.id),
      'A7: comptable non assigné (Samar) ne voit RIEN (portée)');

    r = await search("' OR 1=1--", HE);
    ok(r.q === "' OR 1=1--", 'A8: injection SQL sans effet (200, retour neutre)');

    r = await search('c ', HE);
    ok(Array.isArray(r.clients) && Array.isArray(r.tasks) && Array.isArray(r.documents), 'A9: q avec espace + jokers -> 200, tableaux');

    // --- B. UI ---
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    try {
      await loginAs(page, EXP.email, EXP.pwd);
      ok(await page.locator('[data-testid="search-input"]').isVisible(), 'B1: champ de recherche visible sur le dashboard');

      await page.fill('[data-testid="search-input"]', zz);
      await page.waitForSelector('[data-testid="search-results"]', { timeout: 8000 });
      const rows = page.locator('[data-testid="search-result"]:has-text("' + zz + '")');
      ok(await rows.count() >= 1, 'B2: résultat client affiché');
      await rows.first().click();
      await page.waitForTimeout(1200);
      ok(page.url().includes('/cabinet/dossier/' + dossier.id), 'B3: clic -> ouverture du dossier (' + page.url().split('/cabinet')[1] + ')');

      await page.fill('[data-testid="search-input"]', taskLabel);
      await page.waitForSelector('[data-testid="search-results"]', { timeout: 8000 });
      const trows = page.locator('[data-testid="search-result"]:has-text("' + taskLabel + '")');
      ok(await trows.count() >= 1, 'B4: résultat tâche affiché');
      await trows.first().click();
      await page.waitForTimeout(1500);
      ok(page.url().includes('?task=' + task.id), 'B4b: clic -> dossier + ?task=' + (page.url().split('?')[1] || ''));
      ok(await page.locator('#task-' + task.id).count() >= 1, 'B4c: tâche dépliée/highlightée sur la page');

      await page.fill('[data-testid="search-input"]', noteContent.slice(0, 24));
      await page.waitForSelector('[data-testid="search-results"]', { timeout: 8000 });
      const nrows = page.locator('[data-testid="search-result"]:has-text("' + noteContent.slice(0, 24) + '")');
      ok(await nrows.count() >= 1, 'B5: résultat note affiché');
      await nrows.first().click();
      await page.waitForTimeout(1500);
      ok(page.url().includes('?tab=notes'), 'B5b: clic -> ?tab=notes');
      const activeNotes = await page.locator('[data-testid="tab-notes"]').evaluate(b => b.className.includes('bg-white'));
      ok(activeNotes, 'B5c: onglet Notes actif');
      ok((await page.locator('body').innerText()).includes(noteContent), 'B5d: la note est visible');

      await page.goto(BASE + '/cabinet/dossier/' + dossier.id + '?tab=documents', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const activeDocs = await page.locator('[data-testid="tab-documents"]').evaluate(b => b.className.includes('bg-white'));
      ok(activeDocs, 'B6: ?tab=documents ouvre directement l\'onglet Documents');

      await page.fill('[data-testid="search-input"]', zz);
      await page.waitForSelector('[data-testid="search-results"]', { timeout: 8000 });
      await page.mouse.click(5, 5);
      await page.waitForTimeout(600);
      const stillOpen = await page.locator('[data-testid="search-results"]').count();
      ok(stillOpen === 0, 'B7: clic à l\'extérieur ferme la liste de résultats');

      ok(errors.length === 0, 'B8: aucune erreur JS (' + errors.length + ')');
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
