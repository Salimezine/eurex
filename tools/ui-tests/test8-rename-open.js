const { chromium } = require('playwright');

const BASE = process.env.BASE || 'https://salimezine.github.io/eurex';
const RENAMES = [
  { badge: 'ANIMAL', from: 'ANIMAL', to: 'ANIMAL RENAME TEST', link: '/dossier/dossier_animal' },
  { badge: 'SCANFLASH', from: 'SCANFLASH', to: 'SCAN RENAME TEST', link: '/scanflash/dossier/' },
  { badge: 'BAUD', from: 'BAUD', to: 'BAUD RENAME TEST', link: '/baud/dossier/' },
  { badge: 'ACHATS', from: 'PROYASH METROPOLI', to: 'ACHATS RENAME TEST', link: '/achats/dossier/' },
];

const dossierCards = (page) => page.locator('a.group:has(button[title="Renommer"])');

const cardText = async (page, badge) => {
  const c = dossierCards(page).filter({ hasText: badge }).first();
  return (await c.innerText().catch(() => '')).replace(/\n/g, ' | ');
};

const waitText = async (page, badge, expected, timeout = 12000) => {
  const end = Date.now() + timeout;
  let last = '';
  while (Date.now() < end) {
    last = await cardText(page, badge);
    if (last.includes(expected)) return last;
    await page.waitForTimeout(300);
  }
  throw new Error(`texte non obtenu pour ${badge}: attendu "${expected}" → obtenu "${last}"`);
};

const rename = async (page, badge, from, to) => {
  const card = dossierCards(page).filter({ hasText: badge }).first();
  await card.waitFor({ timeout: 10000 });
  await card.hover();
  await card.locator('button[title="Renommer"]').click();
  const input = card.locator('input');
  await input.waitFor({ timeout: 5000 });
  await input.fill(to);
  await input.press('Enter');
  await waitText(page, badge, to);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  page.on('dialog', async d => { console.log('!! DIALOG: ' + d.message()); await d.dismiss(); });
  page.on('response', async r => {
    if (r.request().method() === 'PATCH') console.log('   PATCH → ' + r.status());
  });

  const openHome = async () => {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      sessionStorage.setItem('eurex_authorized', '1');
      // seed du dossier achats (stocke en localStorage) pour le test
      const raw = JSON.parse(localStorage.getItem('achats_dossiers') || '[]');
      if (!raw.some(d => d.nom === 'PROYASH METROPOLI')) {
        raw.push({ id: 'achats_test_001', societe_id: 'default_soc', nom: 'PROYASH METROPOLI', mois: 9, annee: 2026, statut: 'brouillon', nb_factures: 0, nb_ecritures: 0 });
        localStorage.setItem('achats_dossiers', JSON.stringify(raw));
      }
    });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h2:has-text("Dossiers")', { timeout: 20000 });
  };

  await openHome();
  console.log('1. page Dossiers');

  // --- RENOMMAGE ---
  for (const r of RENAMES) {
    const before = await cardText(page, r.badge);
    if (!before.includes(r.from)) { console.log('ECHEC (nom initial ' + r.badge + '): ' + before); process.exit(1); }
    await rename(page, r.badge, r.from, r.to);
    console.log('   ✓ ' + r.from + ' → ' + r.to);
    await rename(page, r.badge, r.to, r.from);
    console.log('   ✓ restauration ' + r.from);
  }
  console.log('2. renommage + restauration 4/4 OK');

  // --- OUVERTURE ---
  for (const r of RENAMES) {
    const card = dossierCards(page).filter({ hasText: r.badge }).first();
    await card.click();
    await page.waitForURL(u => u.href.includes(r.link), { timeout: 20000 });
    await page.waitForTimeout(1200);
    const h = (await page.locator('h1, h2').first().innerText().catch(() => '')).replace(/\n/g, ' ');
    if (!h) { console.log('ECHEC: page vide après ouverture de ' + r.badge); process.exit(1); }
    console.log('   ✓ ' + r.badge + ' → ' + page.url().replace(BASE, '') + ' ("' + h.slice(0, 55) + '")');
    await openHome();
  }
  console.log('3. ouverture des 4 dossiers OK');

  console.log('=== TEST RENOMMER + OUVRIR : OK ===');
  await browser.close();
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
