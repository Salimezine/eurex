const { chromium } = require('playwright');
const BASE = process.env.BASE;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('!! PAGEERROR: ' + e.message));
  p.on('response', async r => {
    if (r.url().includes('/org/auth/')) console.log('   ' + r.request().method() + ' ' + r.url().split('/api')[1] + ' -> ' + r.status());
  });

  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => sessionStorage.setItem('eurex_authorized', '1'));
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[name="email"]', { timeout: 20000 });
  console.log('1. ecran connexion cabinet');

  const email = p.locator('input[name="email"]');
  const pwd = p.locator('input[name="password"]');
  console.log('   email autocomplete=' + await email.getAttribute('autocomplete') + ' | type=' + await email.getAttribute('type'));
  console.log('   mdp autocomplete=' + await pwd.getAttribute('autocomplete') + ' | type=' + await pwd.getAttribute('type') + ' | name=' + await pwd.getAttribute('name'));
  if ((await pwd.getAttribute('autocomplete')) !== 'current-password') { console.log('ECHEC autocomplete'); process.exit(1); }
  const submit = p.locator('button[type="submit"]');
  if (!(await submit.count())) { console.log('ECHEC: pas de bouton submit'); process.exit(1); }
  console.log('2. structure form OK (autocomplete + name + submit)');

  await email.fill('expert@eurex.tn');
  await pwd.fill('expert1234567');
  await p.click('button[title="Afficher"]');
  if ((await pwd.getAttribute('type')) !== 'text') { console.log('ECHEC oeil'); process.exit(1); }
  console.log('3. oeil actif (type=text)');

  // le listener submit doit forcer type=password au moment du clic
  await p.click('button[title="Masquer"]');
  await submit.click();
  await p.waitForTimeout(3500);
  const body = await p.textContent('body');
  if (body.includes('Espace protégé') || body.includes('EUREX — Cabinet')) {
    console.log('ECHEC connexion: ' + body.slice(0, 250)); process.exit(1);
  }
  console.log('4. connexion expert OK -> ' + p.url().replace(BASE, '') + ' | ' + body.slice(0, 80).replace(/\n/g, ' '));

  const bundle = await p.evaluate(async () => {
    const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src);
    for (const s of scripts) { const t = await fetch(s).then(r => r.text()).catch(() => ''); if (t.includes('PasswordCredential')) return true; }
    return false;
  });
  console.log('5. PasswordCredential dans le bundle: ' + bundle);
  if (!bundle) { console.log('ECHEC bundle'); process.exit(1); }

  console.log('=== TEST CONNEXION / SAVE PASSWORD : OK ===');
  await b.close();
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
