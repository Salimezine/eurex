const { chromium } = require('playwright');

const BASE = process.env.BASE || 'https://salimezine.github.io/eurex';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  page.on('response', async r => {
    if (r.request().method() === 'PATCH') console.log('   PATCH → ' + r.status());
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('eurex_authorized', '1'));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h2:has-text("Dossiers")', { timeout: 20000 });
  console.log('1. accueil');

  await page.click('button:has-text("Scinder un PDF")');
  await page.waitForSelector('button:has-text("Choisir un PDF")', { timeout: 10000 });
  await page.waitForSelector('input[type="file"]', { timeout: 10000, state: 'attached' });
  await page.setInputFiles('input[type="file"]', 'C:\\Users\\SAFA~1.DHA\\AppData\\Local\\Temp\\sample2.pdf');

  const deadline = Date.now() + 420000;
  let done = false;
  while (Date.now() < deadline && !done) {
    const txt = (await page.textContent('body').catch(() => '')) || '';
    if (/2 PDF\(s\) genere/.test(txt)) { done = true; break; }
    await page.waitForTimeout(3000);
  }
  if (!done) { console.log('ECHEC: scission non terminee'); process.exit(1); }
  console.log('2. scission OK (2 PDF)');

  const rows = page.locator('div.divide-y > div');
  const row1 = rows.first();
  const nameBefore = (await row1.locator('span.font-mono').innerText()).trim();
  console.log('   nom initial: ' + nameBefore);
  if (!/^001_.*\.pdf$/.test(nameBefore)) { console.log('ECHEC: nom inattendu'); process.exit(1); }

  // --- APERCU ---
  await row1.locator('button[title="Apercu"]').click();
  const canvas = page.locator('canvas');
  await canvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const box = await canvas.boundingBox();
  const header = (await page.locator('button[title="Fermer"]').first().isVisible()) ? 'barre outils OK' : '';
  if (!box || box.width < 100 || box.height < 100) { console.log('ECHEC: canvas non rendu'); process.exit(1); }
  const pagesTxt = await page.textContent('body');
  if (!/page\(s\)/.test(pagesTxt)) { console.log('ECHEC: compteur de pages absent'); process.exit(1); }
  console.log('3. apercu ouvert: canvas ' + Math.round(box.width) + 'x' + Math.round(box.height) + ' | ' + header);
  await page.click('button[title="Fermer"]');
  await canvas.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  if (await page.locator('canvas').count()) { console.log('ECHEC: viewer non ferme'); process.exit(1); }
  console.log('4. apercu ferme');

  // --- EDITION NOM (fournisseur) ---
  const sup = row1.locator('input[title="Cliquer pour corriger le fournisseur"]');
  await sup.fill('MA SOCIETE TEST');
  await page.waitForTimeout(400);
  let nameAfter = (await row1.locator('span.font-mono').innerText()).trim();
  if (!nameAfter.startsWith('001_MA SOCIETE TEST_')) { console.log('ECHEC fournisseur: ' + nameAfter); process.exit(1); }
  console.log('5. fournisseur edite → ' + nameAfter);

  // --- EDITION DATE ---
  const dt = row1.locator('input[type="date"]');
  await dt.fill('2026-12-24');
  await page.waitForTimeout(400);
  nameAfter = (await row1.locator('span.font-mono').innerText()).trim();
  if (!nameAfter.startsWith('001_MA SOCIETE TEST_2026-12-24')) { console.log('ECHEC date: ' + nameAfter); process.exit(1); }
  console.log('6. date editee → ' + nameAfter);

  // --- TELECHARGEMENT AVEC LE NOUVEAU NOM ---
  const dlPromise = page.waitForEvent('download', { timeout: 30000 });
  await row1.locator('button[title="Telecharger"]').click();
  const dl = await dlPromise;
  if (dl.suggestedFilename() !== nameAfter) { console.log('ECHEC dl: ' + dl.suggestedFilename() + ' != ' + nameAfter); process.exit(1); }
  console.log('7. telechargement au bon nom: ' + dl.suggestedFilename());

  console.log('=== TEST APERCU + EDITION NOM : OK ===');
  await browser.close();
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
