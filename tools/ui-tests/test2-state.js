const { chromium } = require('playwright');

const BASE = 'https://salimezine.github.io/eurex';
const DOSSIER = 'doss_003';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', async d => { console.log('!! ALERT: ' + d.message()); await d.dismiss(); });
  page.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  page.on('request', r => {
    if (r.url().includes('eurex-api')) console.log('REQ  ' + r.method() + ' ' + r.url().replace('https://eurex-api.ezzinesalim21.workers.dev', ''));
  });
  page.on('response', async r => {
    if (r.url().includes('eurex-api')) {
      let body = ''; try { body = (await r.text()).slice(0, 200); } catch (e) {}
      console.log('RESP ' + r.status() + ' ' + r.url().replace('https://eurex-api.ezzinesalim21.workers.dev', '') + ' :: ' + body.replace(/\s+/g, ' '));
    }
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

  // lit le state React (hook useState contenant client_id) depuis le select
  const readState = () => page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')];
    const sel = sels.find(s => [...s.options].some(o => o.value === 'morale'));
    if (!sel) return { err: 'select introuvable' };
    const key = Object.keys(sel).find(k => k.startsWith('__reactFiber$'));
    let f = sel[key], depth = 0;
    const found = [];
    while (f && depth < 40) {
      let st = f.memoizedState, hi = 0;
      while (st) {
        const v = st.memoizedState;
        if (v && typeof v === 'object' && !Array.isArray(v) && v.client_id) {
          found.push({ depth, hook: hi, person_type: v.person_type, id: v.id });
        }
        st = st.next; hi++;
      }
      f = f.return; depth++;
    }
    return { selectValue: sel.value, stateHits: found };
  });

  console.log('AVANT changement:', JSON.stringify(await readState()));

  // observer les mutations du DOM du select
  await page.evaluate(() => {
    window.__muts = [];
    const sels = [...document.querySelectorAll('select')];
    const sel = sels.find(s => [...s.options].some(o => o.value === 'morale'));
    const obs = new MutationObserver(muts => {
      for (const m of muts) window.__muts.push(m.type + ' ' + (m.attributeName || m.target.nodeName) + (m.attributeName === 'value' ? '=' + m.oldValue + '->' + m.target.getAttribute('value') : ''));
    });
    obs.observe(sel, { attributes: true, attributeOldValue: true, childList: true, subtree: true });
    const bodyObs = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.target.nodeType === 1 || m.type === 'childList') window.__muts.push('BODY:' + m.type);
      }
    });
    bodyObs.observe(document.body, { childList: true, subtree: true });
    window.__sel = sel;
  });

  const v0 = (await readState()).selectValue;
  const target = v0 === 'morale' ? 'physique' : 'morale';
  console.log('=== selectOption(' + target + ') ===');
  await page.locator('select').filter({ has: page.locator('option[value="morale"]') }).first().selectOption(target);
  await page.waitForTimeout(3000);

  const after = await readState();
  console.log('APRES changement:', JSON.stringify(after));
  console.log('MUTATIONS:', JSON.stringify(await page.evaluate(() => window.__muts.slice(0, 40)), null, 1));

  await browser.close();
})().catch(e => { console.error('ERREUR SCRIPT:', e.message); process.exit(1); });
