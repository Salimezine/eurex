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

  const v0 = await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'morale'));
    return s ? s.value : null;
  });
  const target = v0 === 'morale' ? 'physique' : 'morale';
  console.log('valeur=' + v0 + ' -> ' + target);

  // traceur DOM haute frequence (10ms) : value du select
  await page.evaluate(() => {
    window.__trace = [];
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'morale'));
    window.__s = s;
    window.__last = s.value;
    window.__t0 = performance.now();
    window.__iv = setInterval(() => {
      if (s.value !== window.__last) {
        window.__trace.push(Math.round(performance.now() - window.__t0) + 'ms: ' + window.__last + ' -> ' + s.value);
        window.__last = s.value;
      }
    }, 5);
    // aussi capter les ticks du timer React : mutation de l'element compteur 00:00:00
  });

  await page.locator('select').filter({ has: page.locator('option[value="morale"]') }).first().selectOption(target);
  await page.waitForTimeout(4000);
  const trace = await page.evaluate(() => { clearInterval(window.__iv); return { trace: window.__trace, final: window.__s.value }; });
  console.log('TRANSITIONS DOM du select:');
  console.log(trace.trace.join('\n') || '(aucune)');
  console.log('valeur finale: ' + trace.final + ' | attendu: ' + target);
  await browser.close();
})().catch(e => { console.error('ERREUR SCRIPT:', e.message); process.exit(1); });
