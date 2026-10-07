const { chromium } = require('playwright');

const BASE = 'https://salimezine.github.io/eurex';
const DOSSIER = 'doss_003'; // TECH SOLUTIONS SARL

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push('CONSOLE-ERR: ' + m.text()); });
  page.on('dialog', async d => { console.log('!! ALERT(' + d.type() + '): ' + d.message()); await d.dismiss(); });
  page.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  page.on('response', async r => {
    if (r.request().method() === 'PATCH' && r.url().includes('/org/clients/')) {
      let body = ''; try { body = await r.text(); } catch (e) {}
      logs.push(`PATCH ${r.url()} -> ${r.status()} ${body}`);
    }
  });

  // 1) bypass access gate
  await page.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('eurex_authorized', '1'));
  await page.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });

  // 2) login expert
  await page.waitForSelector('input[name="email"]', { timeout: 20000 });
  await page.fill('input[name="email"]', 'expert@eurex.tn');
  await page.fill('input[name="password"]', 'expert1234567');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // 3) ouvrir le dossier
  await page.goto(BASE + '/cabinet/dossier/' + DOSSIER, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // 4) trouver le select PP/PM
  const findSelect = async () => {
    const sels = await page.$$('select');
    for (const s of sels) {
      const vals = await s.$$eval('option', os => os.map(o => o.value));
      if (vals.includes('morale')) return s;
    }
    return null;
  };
  let sel = await findSelect();
  if (!sel) { console.log('RESULTAT: select PP/PM introuvable'); console.log(logs.join('\n')); await browser.close(); return; }
  const v0 = await sel.inputValue();
  console.log('valeur initiale = ' + v0);

  // 5) changer vers l'autre valeur
  const target = v0 === 'morale' ? 'physique' : 'morale';
  await sel.selectOption(target);
  await page.waitForTimeout(2500);
  sel = await findSelect();
  const v1 = await sel.inputValue();
  console.log('apres selectOption(' + target + ') -> valeur affichee = ' + v1 + (v1 === target ? '  [OK UI]' : '  [BUG UI: ne change pas]'));
  await page.screenshot({ path: 'after-change.png' });

  // 6) recharger
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  sel = await findSelect();
  const v2 = sel ? await sel.inputValue() : 'PAS-DE-SELECT';
  console.log('apres rechargement -> valeur = ' + v2 + (v2 === target ? '  [PERSISTE OK]' : '  [BUG: revient a ' + v1 + ']'));
  await page.screenshot({ path: 'after-reload.png' });

  // 7) changement via clic utilisateur reel (option menu)
  if (sel) {
    const cur = await sel.inputValue();
    const t2 = cur === 'morale' ? 'physique' : 'morale';
    await sel.selectOption(t2);
    await page.waitForTimeout(2000);
    sel = await findSelect();
    const v3 = await sel.inputValue();
    console.log('2e changement (' + t2 + ') -> affiche ' + v3 + (v3 === t2 ? '  [OK]' : '  [BUG]'));
  }

  console.log('--- reseau ---');
  console.log(logs.join('\n') || '(aucun PATCH intercepte)');
  await browser.close();
})().catch(e => { console.error('ERREUR SCRIPT:', e.message); process.exit(1); });
