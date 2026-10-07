const { chromium } = require('playwright');
const BASE = process.env.BASE;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => sessionStorage.setItem('eurex_authorized', '1'));
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[name="email"]', { timeout: 20000 });
  await p.fill('input[name="email"]', 'salim@eurex.tn');
  await p.fill('input[name="password"]', 'salim1234567');
  await p.click('button[type="submit"]');
  await p.waitForSelector('a[href*="/cabinet/dossier/"]', { timeout: 20000 });
  const href = await p.locator('a[href*="/cabinet/dossier/"]').first().getAttribute('href');
  await p.goto(new URL(href, BASE).toString(), { waitUntil: 'domcontentloaded' });
  const sel = p.locator('select[title="Statut export"]');
  await sel.waitFor({ timeout: 15000 });

  const exportItem = p.locator('span', { hasText: 'CA en suspension de TVA' });
  const commonItem = p.locator('text=salaires & cotisations');
  await p.waitForSelector('h3', { timeout: 15000 });
  await p.waitForTimeout(1500);

  const before = await exportItem.count();
  ok(before === 0, 'C1: avant changement, suspension masquee (' + before + ')');

  // changement SANS rechargement de page
  await sel.selectOption('exportatrice');
  let c = 0;
  for (let i = 0; i < 30; i++) { c = await exportItem.count(); if (c >= 1) break; await p.waitForTimeout(500); }
  ok(c >= 1, 'C2: SANS reload, feed percu sur suspension (' + c + ')');
  let c2 = await commonItem.count();
  ok(c2 === 0, 'C3: SANS reload, CNSS droit commun masque (' + c2 + ')');

  // retour a vide SANS rechargement
  await sel.selectOption('');
  let c3 = 0;
  for (let i = 0; i < 30; i++) { c3 = await commonItem.count(); if (c3 >= 1) break; await p.waitForTimeout(500); }
  ok(c3 >= 1, 'C4: SANS reload, retour CNSS droit commun (' + c3 + ')');
  c = await exportItem.count();
  ok(c === 0, 'C5: SANS reload, suspension de nouveau masquee (' + c + ')');
  ok((await sel.inputValue()) === '', 'C6: export_status restaure (vide)');

  await b.close();
  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
