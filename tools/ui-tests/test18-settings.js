const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
async function bodyText(p) { return p.evaluate(() => document.body.innerText); }
async function waitText(p, sub, want, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if ((await bodyText(p)).includes(sub) === want) return true;
    await p.waitForTimeout(500);
  }
  return false;
}
async function j(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.json();
}

(async () => {
  const ts = Date.now().toString().slice(-6);
  const NAME = 'ZZ-ROLE-' + ts;
  const MAIL = 'zz-role-' + ts + '@test.eurex.tn';
  const PWD = 'roleTest1234567';

  const le = await j(API + '/api/org/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'expert@eurex.tn', password: 'expert1234567' }) });
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + le.token };
  const findTest = async () => (await j(API + '/api/org/comptables', { headers: H })).find(c => c.email === MAIL);

  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  p.on('dialog', async d => { console.log('!! DIALOG[' + d.type() + ']: ' + d.message()); await d.dismiss(); });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => sessionStorage.setItem('eurex_authorized', '1'));
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[name="email"]', { timeout: 20000 });
  await p.fill('input[name="email"]', 'expert@eurex.tn');
  await p.fill('input[name="password"]', 'expert1234567');
  await p.click('button[type="submit"]');
  await p.waitForTimeout(1500);

  // S1 : navigation Settings (onglets Modèles + Comptables)
  await p.locator('a', { hasText: 'Paramètres' }).first().click({ timeout: 20000 });
  const s1 = await waitText(p, 'Ajouter une tâche type', true);
  ok(s1, 'S1: page Settings ouverte (onglet Modèles par defaut)');
  ok((await bodyText(p)).includes('Modèles de tâches'), 'S1b: onglet "Modèles de tâches" present');
  ok((await bodyText(p)).includes('Comptables'), 'S1c: onglet "Comptables" present');

  // S2 : select "Comptable assigné" n'affiche QUE des comptables
  const sel = p.locator('select[title="Comptable assigné par défaut"]').first();
  await sel.waitFor({ timeout: 15000 });
  const opts = await sel.evaluate(s => [...s.options].map(o => o.textContent || ''));
  ok(opts.some(o => o.includes('Salim')), 'S2: select modele contient un comptable (Salim) [' + opts.join(' | ') + ']');
  ok(!opts.some(o => o.includes('Abla')), 'S2b: select modele EXCLUT le manager (Abla)');
  ok(!opts.some(o => o.includes('Omar')), 'S2c: select modele EXCLUT l\'expert (Omar)');

  // S3 : onglet Comptables -> badges de roles + propre ligne sans edition
  await p.locator('button', { hasText: 'Comptables' }).first().click();
  const s3 = await waitText(p, 'Ajouter un comptable', true);
  ok(s3, 'S3: onglet Comptables ouvert');
  const tb = await bodyText(p);
  ok(tb.includes('Manager'), 'S3b: badge Manager visible');
  ok(tb.includes('Expert'), 'S3c: badge Expert visible');
  ok(tb.includes('Comptable'), 'S3d: badge Comptable visible');
  ok(tb.includes('Votre compte'), 'S3e: ligne "Votre compte" (auto-protection)');
  const myRow = p.locator('xpath=//p[normalize-space(.)="expert@eurex.tn"]/ancestor::div[contains(@class,"rounded-xl")][1]');
  ok((await myRow.count()) === 1, 'S3f: une seule ligne trouvee pour expert@eurex.tn');
  const myPencils = await myRow.locator('button[title^="Modifier"]').count();
  ok(myPencils === 0, 'S3g: aucun bouton Modifier sur sa propre ligne');

  // S4 : creation d'un compte avec role=Manager via l'UI
  await p.locator('input[placeholder="Nom complet"]').first().fill(NAME);
  await p.locator('input[placeholder="Email"]').first().fill(MAIL);
  await p.locator('input[placeholder="Mot de passe (12+ car.)"]').first().fill(PWD);
  const createSel = p.locator('select[title="Rôle du compte"]');
  ok((await createSel.count()) === 1, 'S4: 1 select de role (creation)');
  await createSel.first().selectOption('manager');
  await p.locator('button', { hasText: 'Créer le compte' }).first().click();
  const s4 = await waitText(p, NAME, true);
  ok(s4, 'S4b: compte cree visible dans la liste');
  const nameP = p.locator('p', { hasText: NAME }).first();
  const rowTxt = s4 ? await nameP.innerText() : '';
  ok(rowTxt.includes('Manager'), 'S4c: badge Manager sur la nouvelle ligne (' + rowTxt.replace(/\n/g, ' ') + ')');
  const u1 = await findTest();
  ok(u1 && u1.role === 'manager', 'S4d: API role=manager (' + (u1 ? u1.role : 'absent') + ')');

  // S5 : edition -> passage au role Expert
  const row = p.locator('xpath=//p[contains(.,"' + NAME + '")]/ancestor::div[contains(@class,"rounded-xl")][1]');
  await row.locator('button[title^="Modifier"]').click();
  const editSel = p.locator('select[title="Rôle du compte"]');
  await p.waitForFunction(() => document.querySelectorAll('select[title="Rôle du compte"]').length === 2, null, { timeout: 10000 });
  await editSel.last().selectOption('expert');
  await p.locator('button[title="Enregistrer"]').first().click();
  const s5 = await waitText(p, NAME + '\nExpert', true, 20) || (await p.locator('p', { hasText: NAME }).first().innerText()).includes('Expert');
  ok(s5, 'S5: badge Expert apres enregistrement');
  const u2 = await findTest();
  ok(u2 && u2.role === 'expert', 'S5b: API role=expert (' + (u2 ? u2.role : 'absent') + ')');

  // S6 : le nouveau compte (expert) n'apparait plus dans le select des modeles
  await p.locator('button', { hasText: 'Modèles' }).first().click();
  await p.waitForTimeout(1200);
  const opts2 = await p.locator('select[title="Comptable assigné par défaut"]').first().evaluate(s => [...s.options].map(o => o.textContent || ''));
  ok(!opts2.some(o => o.includes(NAME)), 'S6: compte promu expert EXCLU du select des modeles');

  await b.close();
  // --- teardown : suppression definitive du compte de test cree (aucun compte reel touche) ---
  try {
    const u3 = await findTest();
    if (u3) {
      await j(API + '/api/org/comptables/' + u3.id, { method: 'DELETE', headers: H });
      const gone = await findTest();
      ok(!gone, 'S7: compte de test supprime en teardown');
    } else {
      ok(true, 'S7: compte de test deja absent (OK)');
    }
  } catch (e) {
    ok(false, 'S7: teardown suppression compte de test (' + e.message + ')');
  }
  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
