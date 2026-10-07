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
  const href = await p.locator('a[href*="/cabinet/dossier/doss_002"]').first().getAttribute('href');
  await p.goto(new URL(href, BASE).toString(), { waitUntil: 'domcontentloaded' });

  const sel = p.locator('select[title="Statut export"]');
  await sel.waitFor({ timeout: 15000 });
  const susp = p.locator('text=CA en suspension de TVA');
  const tous = p.locator('button', { hasText: 'Tous' });

  const tousCount = async () => {
    for (const btn of await tous.all()) {
      const txt = (await btn.innerText()).replace(/\s+/g, ' ').trim();
      const m = txt.match(/^Tous\s*(\d+)$/);
      if (m) return parseInt(m[1], 10);
    }
    return -1;
  };
  const waitTous = async n => {
    for (let i = 0; i < 30; i++) { if ((await tousCount()) === n) return true; await p.waitForTimeout(500); }
    return false;
  };
  const waitSusp = async want => {
    for (let i = 0; i < 30; i++) { if ((await susp.count()) > 0 === want) return true; await p.waitForTimeout(500); }
    return false;
  };

  await p.waitForSelector('button', { timeout: 15000 });
  await p.waitForTimeout(1200);

  // Baseline : statut vide = non_exportatrice → suspension masquee, 74/84
  ok((await sel.inputValue()) === '', 'D1: statut initial vide');
  ok(await waitTous(74), 'D2: checklist Tous=74 (10 taches suspension masquees) [' + (await tousCount()) + ']');
  ok(await waitSusp(false), 'D3: feed sans echeance suspension (non-export)');

  // Exportatrice, SANS reload
  await sel.selectOption('exportatrice');
  ok(await waitSusp(true), 'D4: export → echeance suspension visible SANS reload');
  ok(await waitTous(84), 'D5: export → checklist Tous=84 SANS reload [' + (await tousCount()) + ']');

  // Semi, SANS reload
  await sel.selectOption('semi_exportatrice');
  ok(await waitSusp(true), 'D6: semi → suspension visible');
  ok(await waitTous(84), 'D7: semi → checklist Tous=84 [' + (await tousCount()) + ']');

  // Non-export, SANS reload
  await sel.selectOption('non_exportatrice');
  ok(await waitSusp(false), 'D8: non-export → suspension masquee SANS reload');
  ok(await waitTous(74), 'D9: non-export → checklist Tous=74 [' + (await tousCount()) + ']');

  // Retour vide + persistance apres reload
  await sel.selectOption('');
  ok(await (async () => { for (let i = 0; i < 20; i++) { if ((await sel.inputValue()) === '') return true; await p.waitForTimeout(300); } return false; })(), 'D10b: PATCH export_status=null confirme (select vide)');
  ok(await waitTous(74), 'D10: retour statut vide → Tous=74');
  await p.reload({ waitUntil: 'domcontentloaded' });
  await sel.waitFor({ timeout: 15000 });
  await p.waitForTimeout(1200);
  ok((await sel.inputValue()) === '', 'D11: statut restaure (vide) apres reload');
  ok(await waitTous(74), 'D12: apres reload Tous=74 [' + (await tousCount()) + ']');

  await b.close();
  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
