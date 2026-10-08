const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const EXP = { email: 'omar.bouhlila@eurextunisie.com', pwd: 'expert1234567' };
const SAL = { email: 'salim.ezzine@eurextunisie.com', pwd: 'salim1234567' };
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
  const comptables = await j(API + '/api/org/comptables', { headers: HE });
  const salimId = comptables.find(u => u.email === SAL.email).id;

  const ts = Date.now().toString().slice(-6);
  const toDelete = [];
  const importClients = (payload, H) => j(API + '/api/org/clients/import', { method: 'POST', headers: H || HE, body: JSON.stringify(payload) });
  const cleanup = async () => {
    for (const id of toDelete) {
      try { await j(API + '/api/org/clients/' + id, { method: 'DELETE', headers: HE }); }
      catch (e) { console.log('!! CLEANUP FAILED ' + id + ': ' + e.message); fails++; }
    }
    if (toDelete.length) console.log('CLEANUP: ' + toDelete.length + ' client(s) supprimé(s) (cascade)');
  };

  try {
    // --- A. API ---
    const a1 = await importClients({
      clients: [
        { line: 1, name: 'ZZ-IMP-A-' + ts, matricule_fiscal: '11223344', assigned_comptable_id: salimId, export_status: 'exportatrice' },
        { line: 2, name: 'ZZ-IMP-B-' + ts, contact_email: 'b@exemple.tn' },
      ],
      create_dossier: true,
    });
    toDelete.push(...a1.created.map(c => c.id));
    ok(a1.counts.created === 2, 'A1: 2 clients créés (' + JSON.stringify(a1.counts) + ')');
    ok(a1.counts.dossiers === 1, 'A1b: 1 seul dossier (ligne sans comptable -> warning)');
    ok(a1.counts.warnings === 1 && a1.warnings[0].name.includes('ZZ-IMP-B'), 'A1c: warning « Aucun comptable affecté »');
    const createdA = a1.created.find(c => c.name.includes('IMP-A'));
    ok(!!createdA && !!createdA.dossier_id, 'A1d: dossier_id renvoyé pour la ligne avec comptable');
    const ds = await j(API + '/api/org/clients/' + createdA.id + '/dossiers', { headers: HE });
    ok(ds.length === 1 && Number(ds[0].exercice) === new Date(Date.now() + 3600000).getUTCFullYear(), 'A1e: dossier créé sur l exercice courant (' + (ds[0] && ds[0].exercice) + ')');
    ok(ds.length === 1 && ds[0].task_stats && ds[0].task_stats.total >= 10, 'A1f: tâches du modèle générées (' + (ds[0] && ds[0].task_stats.total) + ')');

    const a2 = await importClients({ clients: [
      { name: 'ZZ-IMP-A-' + ts },
      { name: 'ZZ-IMP-B-' + ts },
    ], create_dossier: false });
    ok(a2.counts.created === 0 && a2.counts.skipped === 2, 'A2: ré-import des mêmes noms -> 2 ignorés (doublons)');
    ok(a2.skipped.every(s => s.reason === 'Client déjà existant'), 'A2b: motif « Client déjà existant »');

    const a3 = await importClients({ clients: [
      { name: '' },
      { name: 'ZZ-IMP-C-' + ts, export_status: 'n_importe_quoi' },
      { name: 'ZZ-IMP-D-' + ts, assigned_comptable_id: 'user_inexistant' },
      { name: 'ZZ-IMP-E-' + ts, contact_email: 'pas-un-email' },
    ] });
    ok(a3.counts.created === 0 && a3.counts.errors === 4, 'A3: 4 lignes invalides -> 4 erreurs (' + JSON.stringify(a3.counts) + ')');
    ok(a3.errors.map(e => e.error).join('|').includes('Comptable introuvable'), 'A3b: erreur « Comptable introuvable »');

    const a4 = await importClients({ clients: [{ name: 'ZZ-IMP-F-' + ts, assigned_comptable_id: salimId }], create_dossier: false });
    toDelete.push(...a4.created.map(c => c.id));
    const ds4 = await j(API + '/api/org/clients/' + a4.created[0].id + '/dossiers', { headers: HE });
    ok(a4.counts.created === 1 && a4.counts.dossiers === 0 && ds4.length === 0, 'A4: create_dossier=false -> client sans dossier');

    const a5 = await j(API + '/api/org/clients/import', { method: 'POST', headers: HS, body: JSON.stringify({ clients: [{ name: 'ZZ-IMP-G' }] }), allowFail: true });
    ok(a5 && a5.error, 'A5: comptable (Salim) -> 403 refusé (' + a5.error + ')');

    const a6 = await j(API + '/api/org/clients/import', { method: 'POST', headers: HE, body: JSON.stringify({ clients: [] }), allowFail: true });
    ok(a6 && a6.error === 'Aucune ligne à importer', 'A6: liste vide -> 400');

    const a7 = await j(API + '/api/org/clients/import', { method: 'POST', headers: HE, body: JSON.stringify({ clients: Array.from({ length: 501 }, (_, i) => ({ name: 'X' + i })) }), allowFail: true });
    ok(a7 && a7.error && a7.error.includes('500'), 'A7: 501 lignes -> 400 (limite)');

    // --- B. UI ---
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    const uiA = 'ZZ-UIIMP-A-' + ts, uiB = 'ZZ-UIIMP-B-' + ts;

    try {
      await loginAs(page, EXP.email, EXP.pwd);
      await page.waitForSelector('[data-testid="import-clients"]', { timeout: 20000 });
      ok(await page.locator('[data-testid="import-clients"]').isVisible(), 'B1: bouton « Importer CSV » visible');
      await page.click('[data-testid="import-clients"]');
      await page.waitForSelector('[data-testid="import-modal"]', { timeout: 8000 });
      ok(true, 'B1b: modale d\'import ouverte');

      const csv = `name;comptable;export_status\n${uiA};salim.ezzine@eurextunisie.com;exportatrice\n${uiB};;`;
      await page.fill('[data-testid="import-textarea"]', csv);
      await page.click('[data-testid="import-analyze"]');
      await page.waitForSelector('[data-testid="import-preview-row"]', { timeout: 8000 });
      const nRows = await page.locator('[data-testid="import-preview-row"]').count();
      ok(nRows === 2, 'B2: aperçu = 2 lignes (' + nRows + ')');
      const prevText = (await page.locator('[data-testid="import-preview-row"]').allTextContents()).join('|');
      ok(prevText.includes(uiA) && prevText.includes(uiB) && prevText.includes('Salim'), 'B2b: aperçu nom + comptable résolu (' + prevText.slice(0, 120) + ')');

      await page.click('[data-testid="import-confirm"]');
      await page.waitForSelector('[data-testid="import-result"]', { timeout: 20000 });
      const resText = await page.locator('[data-testid="import-result"]').innerText();
      ok(resText.includes('2 client(s) créé(s)') && resText.includes('1 dossier'), 'B3: résultat ' + resText.split('\n')[0]);

      const list = await j(API + '/api/org/clients', { headers: HE });
      for (const nm of [uiA, uiB]) {
        const c = list.find(x => x.name === nm);
        if (c) toDelete.push(c.id);
        ok(!!c, 'B4: « ' + nm + ' » créé et listé dans l API');
      }
      const uiClient = list.find(x => x.name === uiA);
      const dsUi = await j(API + '/api/org/clients/' + uiClient.id + '/dossiers', { headers: HE });
      ok(dsUi.length === 1, 'B4b: dossier créé depuis l UI');

      await page.click('[data-testid="import-close"]');
      await page.waitForTimeout(800);
      await page.click('[data-testid="dash-tab-global"]');
      await page.waitForTimeout(1200);
      ok((await page.locator('[data-testid="dossier-row"]:has-text("' + uiA + '")').count()) >= 1, 'B5: dossier visible dans la table (vue globale)');
      ok(errors.length === 0, 'B6: aucune erreur JS (' + errors.length + ')');
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
