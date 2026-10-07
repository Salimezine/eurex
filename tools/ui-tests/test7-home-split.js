const { chromium } = require('playwright');

const BASE = process.env.BASE || 'https://salimezine.github.io/eurex';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('!! CONSOLE: ' + m.text().slice(0, 200)); });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('eurex_authorized', '1'));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h2:has-text("Dossiers")', { timeout: 20000 });
  console.log('1. page Dossiers (accueil)');

  const btn = page.locator('button:has-text("Scinder un PDF")');
  await btn.waitFor({ timeout: 15000 });
  if (!(await btn.isVisible())) { console.log('ECHEC: bouton invisible'); process.exit(1); }
  console.log('2. bouton "Scinder un PDF" visible sur la liste Dossiers');

  await btn.click();
  await page.waitForSelector('button:has-text("Choisir un PDF")', { timeout: 10000 });
  await page.waitForSelector('input[type="file"]', { timeout: 10000, state: 'attached' });
  console.log('3. modal ouvert');

  await page.setInputFiles('input[type="file"]', 'C:\\Users\\SAFA~1.DHA\\AppData\\Local\\Temp\\sample2.pdf');

  const deadline = Date.now() + 420000;
  let done = false;
  while (Date.now() < deadline && !done) {
    const txt = await page.textContent('body').catch(() => '');
    if (/2 PDF\(s\) genere/.test(txt || '')) { done = true; break; }
    if (/Erreur|ECHEC/i.test((txt || '').slice(0, 2000)) && !/Lecture|OCR|analyse/.test(txt || '')) break;
    await page.waitForTimeout(3000);
  }
  if (!done) { console.log('ECHEC: pas de resultat'); console.log((await page.textContent('body')).slice(0, 500)); process.exit(1); }
  console.log('4. resultat affiche');

  const rows = await page.$$eval('div.divide-y > div', els => els.map(e => e.innerText.replace(/\n+/g, ' | ')));
  rows.forEach(r => console.log('   ' + r));
  if (rows.length !== 2) { console.log('ECHEC: ' + rows.length + ' lignes au lieu de 2'); process.exit(1); }
  if (!rows.some(r => /MYTEK/.test(r))) { console.log('ECHEC: MYTEK introuvable'); process.exit(1); }
  if (!rows.some(r => /Ooredoo/.test(r))) { console.log('ECHEC: Ooredoo introuvable'); process.exit(1); }
  console.log('5. fournisseurs + dates corrects');

  const dlPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.click('button:has-text("Tout telecharger")');
  const dl = await dlPromise;
  console.log('6. ZIP telecharge: ' + dl.suggestedFilename());

  console.log('=== TEST BOUTON ACCUEIL SPLIT PDF : OK ===');
  await browser.close();
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
