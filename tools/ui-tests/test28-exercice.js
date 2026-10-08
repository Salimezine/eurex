// test28 — Passage automatique au nouvel exercice + selecteur d'exercice au dashboard
//   API : rollover (cloture forcee n-1 + ouverture), idempotence, filtres ?exercice=
//   UI  : selecteur expert (tableau) + selecteur comptable (cartes clients, Mes heures)
const { chromium } = require('playwright');
const BASE = process.env.BASE;
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
const EXP = { email: 'expert@eurex.tn', pwd: 'expert1234567' };
const SAL = { email: 'salim@eurex.tn', pwd: 'salim1234567' };
const CUR = new Date().getFullYear();
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
// attend que le selecteur soit la (recharge du dashboard apres bascule d'exercice)
async function waitSel(p, timeout = 30000) {
  return p.locator('[data-testid="dash-exercice"]').waitFor({ timeout }).then(() => true).catch(() => false);
}
const rowsText = async p => (await p.locator('[data-testid="dossier-row"]').allTextContents()).join('|');
const cardsText = async p => (await p.locator('[data-testid="client-card"]').allTextContents()).join('|');

(async () => {
  const te = await post(API + '/api/org/auth/login', JSON_, { email: EXP.email, password: EXP.pwd });
  const HE = auth(te.token);
  const zz = 'ZZ-EXER-' + Date.now().toString().slice(-6);
  let client = null;
  try {
    // ---------- Setup : client + dossier 2026 ----------
    const comps = await get(API + '/api/org/comptables', HE);
    const comp = comps.find(c => c.id === 'user_comp_001') || comps.find(c => c.role === 'comptable' && c.is_active);
    ok(!!comp, 'A0: comptable actif trouvé (' + (comp && comp.full_name) + ')');
    client = await post(API + '/api/org/clients', HE, { name: zz, assigned_comptable_id: comp.id });
    const d0 = await post(API + `/api/org/clients/${client.id}/dossiers`, HE, { exercice: 2026, assigned_comptable_id: comp.id });
    ok(d0.exercice === 2026, 'A1: dossier 2026 créé');

    // ---------- A : API rollover ----------
    const r1 = await post(API + '/api/org/exercices/rollover', HE, { year: 2027, client_id: client.id });
    ok(r1.closed.length === 1 && r1.created.length === 1, 'A2: rollover 2026 → 2027 (cloturés ' + r1.closed.length + ', créés ' + r1.created.length + ')');
    const ds = await get(API + `/api/org/clients/${client.id}/dossiers`, HE);
    ok(ds.find(d => d.exercice === 2026).status === 'cloture', 'A3: dossier 2026 clôturé');
    ok(ds.find(d => d.exercice === 2027).status === 'en_cours', 'A4: dossier 2027 en_cours');
    const r2 = await post(API + '/api/org/exercices/rollover', HE, { year: 2027, client_id: client.id });
    ok(r2.closed.length === 0 && r2.created.length === 0, 'A5: 2e appel idempotent (0/0)');
    const ex = await get(API + '/api/org/exercices', HE);
    ok(ex.exercices.includes(CUR) && ex.exercices.includes(2027), 'A6: exercices proposés = ' + JSON.stringify(ex.exercices));
    const cl27 = await get(API + '/api/org/clients?exercice=2027', HE);
    ok(cl27.length === 1 && cl27[0].id === client.id, 'A7: clients 2027 = client test (' + cl27.length + ')');
    const dd27 = await get(API + '/api/org/dossiers?exercice=2027', HE);
    ok(dd27.length === 1, 'A8: dossiers 2027 = 1 (' + dd27.length + ')');
    const dd26 = await get(API + '/api/org/dossiers?exercice=2026', HE);
    ok(dd26.length === 6, 'A9: dossiers 2026 = 6 (' + dd26.length + ')');
    const hh = await get(API + '/api/org/me/hours?view=days&exercice=2025', HE);
    ok(hh.view === 'year' && hh.exercice === 2025, 'A10: heures 2025 → vue année (' + hh.view + '/' + hh.exercice + ')');
    const hh2 = await get(API + '/api/org/me/hours?view=days', HE);
    ok(hh2.view === 'days', 'A11: sans exercice → vue jours (' + hh2.view + ')');
    const rec = await get(API + '/api/org/me/tasks/recent?days=90&exercice=2027', HE);
    ok((rec.tasks || []).every(t => t.exercice === 2027), 'A12: recent tasks 2027 filtrées (' + (rec.tasks || []).length + ')');

    const b = await chromium.launch();
    const p = await b.newPage();
    p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
    p.on('dialog', async dg => { console.log('!! DIALOG[' + dg.type() + ']: ' + dg.message()); await dg.accept(); });
    try {
      // ---------- B : dashboard EXPERT ----------
      await loginAs(p, EXP.email, EXP.pwd);
      await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
      ok(await waitSel(p), 'B1: selecteur d\'exercice présent (expert)');
      const sel = p.locator('[data-testid="dash-exercice"]');
      const v0 = await sel.inputValue();
      ok(v0 === String(CUR), 'B2: valeur par défaut = ' + CUR + ' (obtenu ' + v0 + ')');
      const opts = await sel.locator('option').allTextContents();
      ok(opts.includes(String(CUR)) && opts.includes('2027'), 'B3: options ' + CUR + ' + 2027 [' + opts.join(',') + ']');
      ok(!(await p.locator('[data-testid="dash-exercice-badge"]').count()), 'B4: pas de badge sur l\'exercice courant');

      const tabs = p.locator('button', { hasText: 'Vue globale' });
      if (await tabs.count()) { await tabs.first().click(); await p.waitForTimeout(1500); }
      ok(await p.locator('[data-testid="dossier-row"]').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false), 'B5: tableau des dossiers visible');
      const t26 = await rowsText(p);
      const n26 = await p.locator('[data-testid="dossier-row"]').count();
      ok(n26 === 6, 'B6: 6 lignes en ' + CUR + ' (' + n26 + ')');
      ok(t26.includes('ANIMAL CITY'), 'B7: ANIMAL CITY présent en ' + CUR);
      ok(t26.includes(zz), 'B8: client test présent en ' + CUR);
      ok(!t26.includes('2027'), 'B9: aucune ligne 2027 en ' + CUR);

      // Bascule vers 2027 (exercice suivant)
      await sel.selectOption('2027');
      await p.waitForTimeout(2500);
      ok(await p.locator('[data-testid="dossier-row"]').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false), 'B10: tableau rechargé en 2027');
      const t27 = await rowsText(p);
      const n27 = await p.locator('[data-testid="dossier-row"]').count();
      ok(n27 === 1, 'B11: 1 seule ligne en 2027 (' + n27 + ')');
      ok(t27.includes(zz) && t27.includes('2027'), 'B12: ligne = client test / exercice 2027');
      ok(!t27.includes('ANIMAL CITY'), 'B13: ANIMAL CITY absent de 2027');
      const badge = p.locator('[data-testid="dash-exercice-badge"]');
      ok(await badge.count() === 1 && /suivant/i.test(await badge.textContent() || ''), 'B14: badge "exercice suivant" affiché');
      // Mes heures : l'API force la vue année hors exercice courant
      const tabYear = p.locator('[role="tab"]', { hasText: 'Année' });
      ok(await tabYear.first().count() > 0 && (await tabYear.first().getAttribute('aria-selected')) === 'true', 'B15: Mes heures basculé sur "Année"');

      // Retour au courant
      await sel.selectOption(String(CUR));
      await p.waitForTimeout(2500);
      ok(await p.locator('[data-testid="dossier-row"]').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false), 'B16: retour ' + CUR + ' OK');
      const nBack = await p.locator('[data-testid="dossier-row"]').count();
      ok(nBack === 6, 'B17: 6 lignes après retour (' + nBack + ')');
      ok((await rowsText(p)).includes('ANIMAL CITY'), 'B18: ANIMAL CITY de retour');
      ok(!(await p.locator('[data-testid="dash-exercice-badge"]').count()), 'B19: badge disparu sur l\'exercice courant');

      // ---------- C : dashboard COMPTABLE (Salim) ----------
      await loginAs(p, SAL.email, SAL.pwd);
      await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
      ok(await waitSel(p), 'C1: selecteur d\'exercice présent (comptable)');
      const selC = p.locator('[data-testid="dash-exercice"]');
      ok((await selC.inputValue()) === String(CUR), 'C2: valeur par défaut = ' + CUR);
      ok(await p.locator('[data-testid="client-card"]').first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false), 'C3: cartes clients visibles');
      const c26 = await p.locator('[data-testid="client-card"]').count();
      ok(c26 === 4, 'C4: 4 cartes en ' + CUR + ' (Salim : 3 clients + test) = ' + c26);
      const ct26 = await cardsText(p);
      ok(ct26.includes('Exercice ' + CUR) && ct26.includes(zz), 'C5: cartes en exercice ' + CUR + ' avec client test');

      await selC.selectOption('2027');
      await p.waitForTimeout(2500);
      ok(await p.locator('[data-testid="client-card"]').first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false), 'C6: cartes rechargées en 2027');
      const c27 = await p.locator('[data-testid="client-card"]').count();
      ok(c27 === 1, 'C7: 1 seule carte en 2027 (' + c27 + ')');
      const ct27 = await cardsText(p);
      ok(ct27.includes(zz) && ct27.includes('Exercice 2027'), 'C8: carte = client test / exercice 2027');
      ok(!ct27.includes('ANIMAL CITY'), 'C9: ANIMAL CITY absent des cartes 2027');

      await selC.selectOption(String(CUR));
      await p.waitForTimeout(2500);
      ok(await p.locator('[data-testid="client-card"]').first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false), 'C10: retour ' + CUR + ' OK');
      ok((await p.locator('[data-testid="client-card"]').count()) === 4, 'C11: 4 cartes après retour');
    } finally {
      await b.close();
    }
  } finally {
    if (client) {
      const dc = await fetch(API + `/api/org/clients/${client.id}`, { method: 'DELETE', headers: HE });
      ok(dc.status === 200, 'Z1: nettoyage client test (' + dc.status + ')');
    }
  }
  console.log(fails === 0 ? '\nALL PASS' : '\nFAILURES: ' + fails);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
