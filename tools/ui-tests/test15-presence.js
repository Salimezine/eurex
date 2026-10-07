const { chromium } = require('playwright');
const BASE = process.env.BASE;
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

(async () => {
  // Setup presence : le dashboard expert n'affiche QUE les comptables (l'expert est exclu),
  // donc on "reactive" Samar juste avant le chargement (login + appel authentifie, seul
  // verifyOrgToken ecrit last_seen_at) pour que sa carte affiche "Connecte".
  const lr = await fetch('https://eurex-api.ezzinesalim21.workers.dev/api/org/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'samar@eurex.tn', password: 'samar1234567' }),
  }).then(r => r.json());
  await fetch('https://eurex-api.ezzinesalim21.workers.dev/api/org/auth/me', {
    headers: { Authorization: 'Bearer ' + lr.token },
  }).then(r => r.json()).then(m => console.log('SETUP presence samar: last_seen ok (' + (m.email || 'KO') + ')'));

  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => sessionStorage.setItem('eurex_authorized', '1'));
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[name="email"]', { timeout: 20000 });
  await p.fill('input[name="email"]', 'expert@eurex.tn');
  await p.fill('input[name="password"]', 'expert1234567');
  await p.click('button[type="submit"]');
  // dashboard expert : tab comptables par defaut
  ok(await waitText(p, 'Connect', true), 'E1: statut presence affiche (Connecte/Hors ligne)');
  ok(await waitText(p, '8h30', true), 'E2: norme 8h30 affichee');
  ok(await waitText(p, "Aujourd'hui :", true), 'E3: ligne heures du jour affichee');
  const t = await bodyText(p);
  ok(!/Repos \(samedi \/ dimanche\)/.test(t), 'E4: pas de mention Repos (jour ouvrable)');
  ok(/Hors ligne|Connect/.test(t), 'E5: comptables listes avec presence');
  // colonne Comptable du tableau (onglet Vue globale)
  const tabs = p.locator('button', { hasText: 'Vue globale' });
  if (await tabs.count()) { await tabs.first().click(); await p.waitForTimeout(1500); }
  const t2 = await bodyText(p);
  ok(/\/\s*8h30|Repos/.test(t2), 'E6: colonne Comptable = heures / 8h30');
  // E7 : auto-refresh presence (intervalle 60s depuis l'economie D1 : refresh 15s -> 60s)
  let hits = 0;
  const onReq = r => { if (r.url().includes('/org/comptables')) hits++; };
  p.on('request', onReq);
  await p.waitForTimeout(75000);
  p.off('request', onReq);
  ok(hits >= 1, 'E7: auto-refresh presence (~60s) (' + hits + ' requetes / 75s)');
  await b.close();
  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
