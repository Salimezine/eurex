const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) fails++; };

const EXP_NON = { Tous:74, Annuel:10, Janv:6, 'Févr':5, Mars:5, Avr:6, Mai:5, Juin:5, Juil:6, 'Août':5, Sept:5, Oct:6, Nov:5, Déc:5 };
const EXP_EXP = { Tous:84, Annuel:12, Janv:8, 'Févr':5, Mars:5, Avr:8, Mai:5, Juin:5, Juil:8, 'Août':5, Sept:5, Oct:8, Nov:5, Déc:5 };
const KEYS = ['Tous','Annuel','Janv','Févr','Mars','Avr','Mai','Juin','Juil','Août','Sept','Oct','Nov','Déc'];
const CHIPS_RE = /^(Tous|Annuel|Janv\.?|Févr\.?|Mars|Avr\.?|Mai|Juin|Juil\.?|Août|Sept\.?|Oct\.?|Nov\.?|Déc\.?)\s*(\d+)$/;

async function getChips(p) {
  const list = await p.$$eval('button', bs => bs.map(b => (b.innerText || '').replace(/\s+/g, ' ').trim()));
  const out = {};
  for (const t of list) {
    const m = t.match(CHIPS_RE);
    if (!m) continue;
    const k = m[1].replace(/\.$/, '');
    if (KEYS.includes(k)) out[k] = parseInt(m[2], 10);
  }
  return out;
}
const eqChips = (a, e) => KEYS.every(k => a[k] === e[k]);
const chipsStr = c => KEYS.map(k => `${k}=${c[k] ?? '?'}`).join(' ');

async function waitChips(p, exp) {
  for (let i = 0; i < 30; i++) {
    if (eqChips(await getChips(p), exp)) return true;
    await p.waitForTimeout(500);
  }
  return false;
}
async function bodyText(p) { return p.evaluate(() => document.body.innerText); }
async function waitText(p, sub, want) {
  for (let i = 0; i < 30; i++) {
    const t = await bodyText(p);
    if (t.includes(sub) === want) return true;
    await p.waitForTimeout(500);
  }
  return false;
}
async function dump(p, name, txt) {
  fs.writeFileSync(__dirname + '\\' + name + '.txt', txt, 'utf8');
}

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
  await p.waitForTimeout(1500);

  const S = 'CA en suspension de TVA';
  const DROIT = 'des salaires';
  const EXPORT = '(entreprises totalement exportatrices)';
  const PP = '(personne physique)';
  const PM = '(PM télé-déclarante)';

  // ---- Etat A : non_exportatrice ----
  await sel.selectOption('non_exportatrice');
  ok(await waitChips(p, EXP_NON), 'A1: chips = matrice non-export [' + chipsStr(await getChips(p)) + ']');
  ok(await waitText(p, DROIT, true), 'A2: CNSS droit commun visible');
  ok(await waitText(p, S, false), 'A3: suspension absente (feed)');
  ok(await waitText(p, EXPORT, false), 'A4: CNSS export absent (feed)');
  ok(await waitText(p, PP, false), 'A5: pas de ligne (personne physique) [filtre cat morale]');
  ok(await waitText(p, PM, true), 'A6: ligne (personne morale) presente');
  let t = await bodyText(p);
  ok(/25\/10\/2026/.test(t) === false, 'A7: pas de date 25/10 (CNSS export)');
  ok(/20\/10\/2026/.test(t), 'A8: PM a 20/10 present (DMI jour 20)');
  await dump(p, 'stateA-nonexport', t);

  // ---- Etat B : exportatrice ----
  await sel.selectOption('exportatrice');
  ok(await waitChips(p, EXP_EXP), 'B1: chips = matrice export [' + chipsStr(await getChips(p)) + ']');
  ok(await waitText(p, S, true), 'B2: suspension visible (feed)');
  ok(await waitText(p, EXPORT, false), 'B3: plus de ligne CNSS export (hors classeur)');
  ok(await waitText(p, DROIT, false), 'B4: CNSS droit commun masque en export (scope semi+non)');
  ok(await waitText(p, PP, false), 'B5: pas de ligne (personne physique)');
  ok(await waitText(p, PM, true), 'B6: ligne (personne morale) presente');
  t = await bodyText(p);
  ok(/28\/10\/2026/.test(t), 'B7: date 28/10 (suspension ventes PM) presente');
  await dump(p, 'stateB-export', t);

  // ---- Etat C : restauration vide ----
  await sel.selectOption('');
  ok(await waitChips(p, EXP_NON), 'C1: retour vide -> chips non-export [' + chipsStr(await getChips(p)) + ']');
  ok((await sel.inputValue()) === '', 'C2: select vide (null)');
  t = await bodyText(p);
  await dump(p, 'stateC-null', t);

  await b.close();
  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
