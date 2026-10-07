const { chromium } = require('playwright');

const BASE = 'https://salimezine.github.io/eurex';
const DOSSIER = 'doss_003';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', async d => { console.log('!! ALERT: ' + d.message()); await d.dismiss(); });
  page.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));

  await page.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('eurex_authorized', '1'));
  await page.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name="email"]', { timeout: 20000 });
  await page.fill('input[name="email"]', 'expert@eurex.tn');
  await page.fill('input[name="password"]', 'expert1234567');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.goto(BASE + '/cabinet/dossier/' + DOSSIER, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const sel = () => page.locator('select').filter({ has: page.locator('option[value="morale"]') }).first();
  const readSel = () => page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'morale'));
    return s ? s.value : null;
  });
  const readBadge = () => page.evaluate(() => {
    // badge header "Personne morale/physique" (span hors select) + tags des echeances
    const spans = [...document.querySelectorAll('span')].map(s => s.textContent.trim()).filter(t => /^.*(Personne (morale|physique))$/.test(t));
    return spans.slice(0, 4);
  });

  const v0 = await readSel();
  console.log('initial = ' + v0);
  let fail = 0;

  // 1) changement 1
  const t1 = v0 === 'morale' ? 'physique' : 'morale';
  await sel().selectOption(t1);
  await page.waitForTimeout(2500);
  const a1 = await readSel();
  const ok1 = a1 === t1;
  if (!ok1) fail++;
  console.log('changement1 -> select=' + a1 + ' (attendu ' + t1 + ') ' + (ok1 ? '[OK]' : '[ECHEC]'));

  // 2) changement 2 (retour)
  const t2 = t1 === 'morale' ? 'physique' : 'morale';
  await sel().selectOption(t2);
  await page.waitForTimeout(2500);
  const a2 = await readSel();
  const ok2 = a2 === t2;
  if (!ok2) fail++;
  console.log('changement2 -> select=' + a2 + ' (attendu ' + t2 + ') ' + (ok2 ? '[OK]' : '[ECHEC]'));

  // 3) persistance apres rechargement
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const a3 = await readSel();
  const ok3 = a3 === t2;
  if (!ok3) fail++;
  console.log('apres reload -> select=' + a3 + ' (attendu ' + t2 + ') ' + (ok3 ? '[OK]' : '[ECHEC]'));

  // 4) badges / echeances coherent ?
  const badges = await readBadge();
  console.log('badges: ' + JSON.stringify(badges));

  // 5) restauration de la valeur initiale (DB retourne a 'morale')
  const t4 = v0;
  await sel().selectOption(t4);
  await page.waitForTimeout(2500);
  const a4 = await readSel();
  const ok4 = a4 === t4;
  if (!ok4) fail++;
  console.log('restauration -> select=' + a4 + ' (attendu ' + t4 + ') ' + (ok4 ? '[OK]' : '[ECHEC]'));

  console.log(fail === 0 ? '=== TOUS LES TESTS PASS ===' : '=== ' + fail + ' ECHEC(S) ===');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERREUR SCRIPT:', e.message); process.exit(2); });
