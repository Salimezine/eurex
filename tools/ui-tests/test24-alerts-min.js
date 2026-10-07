// test24 — minimisation de la carte "Échéances fiscales" (OrgAlerts)
// M1-M8 : bouton chevron, repli sur une seule ligne, persistance localStorage, retour a l'etat etendu.
const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const SAL = { email: 'salim@eurex.tn', pwd: 'salim1234567' };
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
async function j(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(url + ' -> ' + r.status + ' : ' + (await r.text().catch(() => '')));
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
  await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: SAL.email, password: SAL.pwd }) });
  let b;
  try {
    b = await chromium.launch();
    const p = await b.newPage();
    p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));

    await loginAs(p, SAL.email, SAL.pwd);
    await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });

    const card = p.locator('[data-testid="org-alerts"]');
    ok(await card.waitFor({ timeout: 20000 }).then(() => true).catch(() => false), 'M1: carte "Echeances fiscales" presente');
    const btn = p.locator('[data-testid="alerts-minimize"]');
    ok(await btn.count() === 1, 'M1b: bouton de minimisation present (' + await btn.count() + ')');
    ok((await card.innerText()).includes('Échéances fiscales'), 'M2: titre visible en etat etendu');

    const addBtn = p.locator('[data-testid="org-alerts"] button').filter({ hasText: 'Échéance' });
    ok(await addBtn.count() >= 1, 'M3: bouton "+" Etanche affiche avant minimisation');
    const padOpen = await card.evaluate(el => getComputedStyle(el).paddingTop);
    ok(padOpen === '16px', 'M3b: padding etendu p-4 (' + padOpen + ')');

    // ---- M4-M6 : minimisation ----
    await btn.click();
    await p.waitForTimeout(300);
    ok((await card.innerText()).includes('Échéances fiscales'), 'M4: le titre reste apres minimisation');
    ok(await addBtn.count() === 0, 'M4b: le contenu (bouton +, legende) est replie');
    const padMin = await card.evaluate(el => getComputedStyle(el).paddingTop);
    ok(padMin !== padOpen, 'M5: la carte est devenue compacte (padding ' + padOpen + ' -> ' + padMin + ')');
    ok(await p.evaluate(() => localStorage.getItem('eurex_alerts_min')) === '1', 'M5b: etat memorise (eurex_alerts_min=1)');

    // ---- M6 : persistence apres rechargement ----
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    const card2 = p.locator('[data-testid="org-alerts"]');
    ok(await card2.count() === 1 && (await card2.innerText()).includes('Échéances fiscales'), 'M6: toujours present apres rechargement');
    ok(await p.locator('[data-testid="org-alerts"] button').filter({ hasText: 'Échéance' }).count() === 0, 'M6b: toujours minimise apres rechargement');

    // ---- M7-M8 : retour a l'etat etendu ----
    const btn2 = p.locator('[data-testid="alerts-minimize"]');
    await btn2.click();
    await p.waitForTimeout(300);
    ok(await p.locator('[data-testid="org-alerts"] button').filter({ hasText: 'Échéance' }).count() >= 1, 'M7: la carte se deroule a nouveau');
    ok(await p.evaluate(() => localStorage.getItem('eurex_alerts_min')) === '0', 'M8: etat remis a zero');

    await b.close();
  } finally {
    if (b) await b.close().catch(() => {});
  }

  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
