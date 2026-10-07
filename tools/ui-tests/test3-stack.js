const { chromium } = require('playwright');

const BASE = 'https://salimezine.github.io/eurex';
const DOSSIER = 'doss_003';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', async d => { console.log('!! ALERT: ' + d.message()); await d.dismiss(); });
  page.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    if (t.startsWith('STACKPATCH') || t.startsWith('!!')) console.log(t);
  });

  await page.addInitScript(() => {
    const orig = window.fetch;
    window.fetch = function (...args) {
      try {
        const [url, opts] = args;
        const u = String(url);
        if (opts && opts.method === 'PATCH' && u.includes('/org/clients/') && !u.includes('reassign')) {
          const st = new Error('x').stack || '';
          console.log('STACKPATCH::' + st.split('\n').slice(0, 12).join(' | '));
        }
      } catch (e) { console.log('STACKPATCH-ERR ' + e.message); }
      return orig.apply(this, args);
    };
  });

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

  const v0 = await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'morale'));
    return s ? s.value : null;
  });
  const target = v0 === 'morale' ? 'physique' : 'morale';
  console.log('valeur=' + v0 + ' -> selectOption(' + target + ')');
  await page.locator('select').filter({ has: page.locator('option[value="morale"]') }).first().selectOption(target);
  await page.waitForTimeout(3000);

  const v1 = await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'morale'));
    return s ? s.value : null;
  });
  console.log('apres -> select=' + v1);
  await browser.close();
})().catch(e => { console.error('ERREUR SCRIPT:', e.message); process.exit(1); });
