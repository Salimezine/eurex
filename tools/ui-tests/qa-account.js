// Comptable de test JETABLE (@test.eurex.tn = marqueur purge audit)
// createQaComptable(headers, prefix, fullName) -> { id, email, pwd }
// deleteQaComptable(headers, id)               -> true
const API = 'https://eurex-api.ezzinesalim21.workers.dev';
let seq = 0;

async function createQaComptable(headers, prefix, fullName) {
  const H = { 'Content-Type': 'application/json', ...headers };
  const pfx = prefix || 'zz-qa';
  // Self-healing : supprime les comptes jetables restes d'un run precedent
  // (meme nom "Test Comptable" = selectOption ambigu chez le test appelant)
  try {
    const list = await fetch(API + '/api/org/comptables', { headers: H }).then(r => (r.ok ? r.json() : []));
    for (const c of Array.isArray(list) ? list : []) {
      if (c.email && c.email.startsWith(pfx + '-') && c.email.endsWith('@test.eurex.tn')) {
        await fetch(API + '/api/org/comptables/' + c.id, { method: 'DELETE', headers: H });
      }
    }
  } catch {}
  const email = `${pfx}-${Date.now().toString().slice(-6)}${seq++}@test.eurex.tn`;
  const password = 'QaTest-Comptable-2026';
  const r = await fetch(API + '/api/org/comptables', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ full_name: fullName || 'Comptable QA', email, password }),
  });
  if (!r.ok) throw new Error('createQaComptable ' + r.status + ' ' + (await r.text().catch(() => '')));
  const b = await r.json();
  const acc = { id: b.id, email, pwd: password, password };
  // Le compte est cree avec must_change_password=1 (l'app afficherait l'ecran
  // "changer le mot de passe") -> on le valide tout de suite via l'API.
  const lr = await fetch(API + '/api/org/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (lr.ok) {
    const { token } = await lr.json();
    await fetch(API + '/api/org/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ current_password: password, new_password: password }),
    });
  }
  return acc;
}

async function deleteQaComptable(headers, id) {
  const r = await fetch(API + '/api/org/comptables/' + id, { method: 'DELETE', headers });
  if (!r.ok) throw new Error('deleteQaComptable ' + r.status + ' ' + (await r.text().catch(() => '')));
  return true;
}

module.exports = { createQaComptable, deleteQaComptable };
