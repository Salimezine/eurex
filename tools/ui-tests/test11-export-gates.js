const { chromium } = require('playwright');
const BASE = process.env.BASE;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };

async function enter(p) {
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => sessionStorage.setItem('eurex_authorized', '1'));
}
async function login(p, email, pwd) {
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[name="email"]', { timeout: 20000 });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', pwd);
  await p.click('button[type="submit"]');
  await p.waitForSelector('text=Échéances fiscales', { timeout: 20000 });
}

(async () => {
  const b = await chromium.launch();

  // ================= A) EXPERT =================
  const c1 = await b.newContext();
  const p1 = await c1.newPage();
  p1.on('pageerror', e => console.log('!! PAGEERROR expert: ' + e.message));
  await enter(p1);
  await login(p1, 'expert@eurex.tn', 'expert1234567');
  ok(await p1.locator('button', { hasText: 'Nouveau dossier' }).count() === 1, 'A1 expert: bouton Nouveau dossier present');
  const addBtn = p1.locator('button', { hasText: 'Échéance' });
  ok(await addBtn.count() === 1, 'A2 expert: bouton ajouter echeance present (' + await addBtn.count() + ')');
  await addBtn.first().click();
  await p1.waitForSelector('text=Nouvelle échéance', { timeout: 5000 });
  ok(true, 'A3 expert: modale Nouvelle echeance ouverte');
  ok(await p1.locator('label', { hasText: 'Portée export' }).count() === 1, 'A4: label Portee export');
  const tgExp = p1.locator('button', { hasText: 'Exportatrices (ETE 100%)' });
  ok(await tgExp.count() === 1, 'A5: toggle Exportatrices (ETE 100%)');
  ok(await p1.locator('button', { hasText: 'Semi-exportatrices' }).count() === 1, 'A6: toggle Semi-exportatrices');
  ok(await p1.locator('button', { hasText: 'Non-exportatrices' }).count() === 1, 'A7: toggle Non-exportatrices');
  ok(await p1.locator('span', { hasText: 'Toutes' }).count() >= 1, 'A8: mention Toutes (porte vide)');
  await tgExp.click();
  ok(((await tgExp.getAttribute('class')) || '').includes('bg-cyan-50'), 'A9: toggle actif (cyan) apres clic');
  await p1.locator('button:text-is("✕")').click();
  await p1.waitForTimeout(400);
  ok(await p1.locator('text=Nouvelle échéance').count() === 0, 'A10: modale fermee sans enregistrement');
  await p1.locator('button', { hasText: 'Vue globale' }).click();
  await p1.waitForSelector('a[href*="/cabinet/dossier/"]', { timeout: 10000 });
  await p1.locator('a[href*="/cabinet/dossier/"]').first().click();
  await p1.waitForSelector('select[title="Statut export"]', { timeout: 15000 });
  ok(true, 'A11 expert: select Statut export sur le dossier');
  ok(await p1.locator('button', { hasText: "Ouvrir l'exercice suivant" }).count() === 0, "A12: pas d'ouverture exercice suivant (dossier en cours)");
  await c1.close();

  // ================= B) COMPTABLE (salim) =================
  const c2 = await b.newContext();
  const p2 = await c2.newPage();
  p2.on('pageerror', e => console.log('!! PAGEERROR salim: ' + e.message));
  await enter(p2);
  await login(p2, 'salim@eurex.tn', 'salim1234567');
  ok(await p2.locator('button', { hasText: 'Nouveau dossier' }).count() === 0, 'B1 salim: aucun bouton Nouveau dossier');
  ok(await p2.locator('button', { hasText: 'Échéance' }).count() === 0, "B2 salim: pas de bouton d'ajout d'echeance globale");
  await p2.waitForSelector('text=salaires & cotisations', { timeout: 15000 });
  ok(await p2.locator('text=salaires & cotisations').count() >= 1, 'B3: CNSS droit commun visible (clients non export)');
  ok(await p2.locator('span', { hasText: '(entreprises totalement exportatrices)' }).count() === 0, 'B4: CNSS export masque (client non export)');
  const href = await p2.locator('a[href*="/cabinet/dossier/"]').first().getAttribute('href');
  await p2.goto(new URL(href, BASE).toString(), { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('select[title="Statut export"]', { timeout: 15000 });
  ok(true, 'B5 salim: select Statut export present (dossier assigne)');
  ok((await p2.locator('select[title="Statut export"]').inputValue()) === '', 'B6: select a la valeur vide (statut non renseigne)');
  await p2.waitForSelector('text=salaires & cotisations', { timeout: 15000 });
  ok(await p2.locator('text=salaires & cotisations').count() >= 1, 'B7: feed dossier: CNSS droit commun visible');
  ok(await p2.locator('span', { hasText: '(entreprises totalement exportatrices)' }).count() === 0, 'B8: feed dossier: CNSS export masque');
  // passage en exportatrice
  await p2.selectOption('select[title="Statut export"]', 'exportatrice');
  await p2.waitForTimeout(1200);
  ok((await p2.locator('select[title="Statut export"]').inputValue()) === 'exportatrice', 'B9: statut export enregistre et affiche (select)');
  await p2.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('span[title="Statut export du client"]:has-text("Export")', { timeout: 15000 });
  ok(true, 'B10: badge export sur la carte client (dashboard)');
  // rechargement du dossier : feed permuté
  await p2.goto(new URL(href, BASE).toString(), { waitUntil: 'domcontentloaded' });
  let c11 = 0;
  for (let i = 0; i < 40; i++) {
    c11 = await p2.locator('span', { hasText: 'CA en suspension de TVA' }).count();
    if (c11 >= 1) break;
    await p2.waitForTimeout(500);
  }
  ok(c11 >= 1, 'B11: apres export: suspension ventes visible dans le feed (' + c11 + ')');
  ok(await p2.locator('text=salaires & cotisations').count() === 0, 'B12: apres export: CNSS droit commun masque');
  // restauration
  await p2.selectOption('select[title="Statut export"]', '');
  await p2.waitForTimeout(900);
  await p2.reload({ waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('select[title="Statut export"]', { timeout: 15000 });
  ok((await p2.locator('select[title="Statut export"]').inputValue()) === '', 'B13: export_status restaure (vide) apres rechargement');
  await c2.close();

  await b.close();
  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
