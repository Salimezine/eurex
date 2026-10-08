// test27 — Depots AP 1/2/3 rattaches a juin / septembre / decembre
//   API : modeles + validation + futur dossier ; UI : filtres mois du dossier + badge Settings
const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const EXP = { email: 'expert@eurex.tn', pwd: 'expert1234567' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };
const JSON_ = { 'Content-Type': 'application/json' };
const auth = tok => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok });
async function j(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(url + ' -> ' + r.status + ' : ' + (await r.text().catch(() => '')));
  return r.json();
}
async function raw(url, opt) {
  const r = await fetch(url, opt);
  let b = null; try { b = await r.json(); } catch {}
  return { s: r.status, b };
}
const post = (url, headers, body) => j(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
const get = (url, headers) => j(url, { headers });
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
const inMonth = (d, label, mo) => (d.tasks.find(t => t.label === label) || {}).month === mo;

(async () => {
  const te = await post(API + '/api/org/auth/login', JSON_, { email: EXP.email, password: EXP.pwd });
  const HE = auth(te.token);
  const zz = 'ZZ-APM-' + Date.now().toString().slice(-6);

  // ---- A : modeles rattaches aux mois ----
  const tmpls = await get(API + '/api/org/templates', HE);
  const tOf = l => tmpls.find(x => x.label === l) || {};
  ok(tOf('Dépôt AP 1').month === 6, 'A1: modele "Depot AP 1" = juin (' + tOf('Dépôt AP 1').month + ')');
  ok(tOf('Dépôt AP 2').month === 9, 'A2: modele "Depot AP 2" = septembre (' + tOf('Dépôt AP 2').month + ')');
  ok(tOf('Dépôt AP 3').month === 12, 'A3: modele "Depot AP 3" = decembre (' + tOf('Dépôt AP 3').month + ')');
  ok(tOf('Dépôt IS provisoire').month == null, 'A4: modele sans mois reste annuel');
  ok(tOf('SAISIE Comptable et ERB').frequency === 'mensuelle', 'A5: SAISIE reste mensuelle');

  // ---- B : validation de l'API ----
  const ap1 = tOf('Dépôt AP 1');
  const bad = await raw(API + `/api/org/templates/${ap1.id}`, { method: 'PATCH', headers: HE, body: JSON.stringify({ month: 99 }) });
  ok(bad.s === 400, 'B1: month=99 rejete (400, obtenu ' + bad.s + ')');
  const bad2 = await raw(API + `/api/org/templates/${ap1.id}`, { method: 'PATCH', headers: HE, body: JSON.stringify({ month: 3.5 }) });
  ok(bad2.s === 400, 'B2: month=3.5 rejete (400, obtenu ' + bad2.s + ')');
  const good = await raw(API + `/api/org/templates/${ap1.id}`, { method: 'PATCH', headers: HE, body: JSON.stringify({ month: 6 }) });
  ok(good.s === 200, 'B3: month=6 accepte (200, obtenu ' + good.s + ')');

  // ---- C : dossier existant deja aligne ----
  const d001 = await get(API + '/api/org/dossiers/doss_001', HE);
  ok(inMonth(d001, 'Dépôt AP 1', 6) && inMonth(d001, 'Dépôt AP 2', 9) && inMonth(d001, 'Dépôt AP 3', 12), 'C1: doss_001 AP en 6/9/12');
  const annuel = d001.tasks.find(t => t.label === 'Préparation Etats financiers annuels');
  ok(annuel && (annuel.month == null), 'C2: Etats financiers annuels sans mois');

  // ---- D : futur dossier cree via API ----
  let client = null;
  try {
    client = await post(API + '/api/org/clients', HE, { name: zz, assigned_comptable_id: te.user.id });
    const dossier = await post(API + `/api/org/clients/${client.id}/dossiers`, HE, { exercice: 2026 });
    const d = await get(API + `/api/org/dossiers/${dossier.id}`, HE);
    ok(inMonth(d, 'Dépôt AP 1', 6), 'D1: futur dossier, AP 1 en juin');
    ok(inMonth(d, 'Dépôt AP 2', 9), 'D2: futur dossier, AP 2 en septembre');
    ok(inMonth(d, 'Dépôt AP 3', 12), 'D3: futur dossier, AP 3 en decembre');
    const counts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(mo => d.tasks.filter(t => t.month === mo).length);
    ok(counts.every(n => n >= 5), 'D4: chaque mois au moins 5 taches [' + counts.join(',') + ']');
    ok(d.tasks.filter(t => t.month == null).length === 7, 'D5: 7 taches annuelles hors mois (' + d.tasks.filter(t => t.month == null).length + ')');

    // ---- U : UI ----
    const b = await chromium.launch();
    const p = await b.newPage();
    p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
    p.on('dialog', async dg => { console.log('!! DIALOG[' + dg.type() + ']: ' + dg.message()); await dg.accept(); });
    try {
      await loginAs(p, EXP.email, EXP.pwd);

      // U1 : page dossier -> onglet Checklist (par defaut) -> filtre Juin
      await p.goto(BASE + '/cabinet/dossier/doss_001', { waitUntil: 'domcontentloaded' });
      const june = p.locator('[data-testid="month-chip-6"]');
      ok(await june.waitFor({ timeout: 25000 }).then(() => true).catch(() => false), 'U1: chips de mois presents');
      await june.click(); await p.waitForTimeout(600);
      ok(await p.locator('[data-testid="task-row"]').filter({ hasText: 'Dépôt AP 1' }).count() > 0, 'U2: "Depot AP 1" visible dans Juin');
      ok(await p.locator('[data-testid="task-row"]').filter({ hasText: 'Etats financiers annuels' }).count() === 0, 'U3: tache annuelle absente de Juin');
      const juneChipText = (await june.textContent() || '').trim();
      ok(/6/.test(juneChipText), 'U4: compteur du chip Juin = ' + juneChipText.replace(/\s+/g, ' '));

      // U5 : filtre Septembre
      await p.locator('[data-testid="month-chip-9"]').click(); await p.waitForTimeout(600);
      const sep = await p.locator('[data-testid="task-row"]').allTextContents();
      ok(sep.some(t => t.includes('Dépôt AP 2')), 'U5: "Depot AP 2" visible dans Septembre');
      ok(!sep.some(t => t.includes('Dépôt AP 3')), 'U6: "Depot AP 3" absent de Septembre');

      // U7 : filtre Decembre
      await p.locator('[data-testid="month-chip-12"]').click(); await p.waitForTimeout(600);
      const dec = await p.locator('[data-testid="task-row"]').allTextContents();
      ok(dec.some(t => t.includes('Dépôt AP 3')), 'U7: "Depot AP 3" visible dans Decembre');
      ok(!dec.some(t => t.includes('Dépôt AP 1')), 'U8: "Depot AP 1" absent de Decembre');

      // U9 : filtre Annuel -> AP 1 n'y est plus
      await p.locator('[data-testid="month-chip-annuel"]').click(); await p.waitForTimeout(600);
      const ann = await p.locator('[data-testid="task-row"]').allTextContents();
      ok(!ann.some(t => t.includes('Dépôt AP 1')), 'U9: "Depot AP 1" absent du filtre Annuel');
      ok(ann.some(t => t.includes('Etats financiers annuels')), 'U10: taches annuelles presentes');

      // U10 : filtre Tous -> tout le monde
      await p.locator('[data-testid="month-chip-tous"]').click(); await p.waitForTimeout(600);
      const tous = await p.locator('[data-testid="task-row"]').allTextContents();
      ok(tous.some(t => t.includes('Dépôt AP 1')) && tous.some(t => t.includes('Dépôt AP 3')), 'U11: filtre "Tous" contient les 3 Depots AP');

      // U12 : Settings -> badge mois des modeles
      await p.goto(BASE + '/cabinet/settings', { waitUntil: 'domcontentloaded' });
      const badges = p.locator('[data-testid="template-month"]');
      ok(await badges.first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false), 'U12: page Settings ouverte (badges mois)');
      ok(await badges.count() === 3, 'U13: 3 modeles avec mois (' + await badges.count() + ')');
      const badgeTexts = (await badges.allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
      ok(badgeTexts.some(t => t.includes('Juin')), 'U14: badge Juin present [' + badgeTexts.join(' | ') + ']');
      ok(badgeTexts.some(t => t.includes('Septembre')), 'U15: badge Septembre present');
      ok(badgeTexts.some(t => t.includes('Décembre')), 'U16: badge Decembre present');
      const ap1Row = p.locator('div.rounded-xl').filter({ hasText: 'Dépôt AP 1' }).last();
      const ap1Txt = await ap1Row.textContent().catch(() => '');
      ok((ap1Txt || '').includes('Juin'), 'U17: ligne "Depot AP 1" porte le badge Juin');
    } finally {
      await b.close();
    }
  } finally {
    if (client) {
      const dc = await raw(API + `/api/org/clients/${client.id}`, { method: 'DELETE', headers: HE });
      ok(dc.s === 200, 'Z1: nettoyage client (' + dc.s + ')');
    }
  }
  console.log(fails === 0 ? '\nALL PASS' : '\nFAILURES: ' + fails);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
