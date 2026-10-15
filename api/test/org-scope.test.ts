// Portee « comptable effectif » d'un dossier : l'expression COALESCE doit
// rester la SEULE source de verite — chaque requete de scope qui compare un
// comptable a un utilisateur doit passer par dossierComp(). Un scope oublie
// ici signifierait qu'un dossier transfere reste visible chez l'ancien
// comptable (ou disparait du nouveau).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dossierComp } from '../src/org-scope.ts';

const SRC = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

test('dossierComp : aliases par defaut (d, c)', () => {
  assert.equal(dossierComp(), 'COALESCE(d.assigned_comptable_id, c.assigned_comptable_id)');
});

test('dossierComp : aliases personnalises (sous-requetes)', () => {
  assert.equal(dossierComp('d2', 'c2'), 'COALESCE(d2.assigned_comptable_id, c2.assigned_comptable_id)');
  assert.equal(dossierComp('da', 'ca'), 'COALESCE(da.assigned_comptable_id, ca.assigned_comptable_id)');
});

test('index.ts : aucun scope brut c.assigned_comptable_id = ? ne subsiste', () => {
  // Les scopes dossier DOIVENT passer par dossierComp(). Restent autorises :
  // - les ecritures (UPDATE/INSERT de org_clients) ;
  // - les lectures strictement client (clientsByUid, reassign, garde PATCH client).
  const lines = SRC.split('\n');
  const offenders: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.includes('c.assigned_comptable_id = ?') && !l.includes('c2.assigned_comptable_id = ?') && !l.includes('ca.assigned_comptable_id = ?')) continue;
    // Ecritures client : autorisees
    if (l.includes('UPDATE org_clients') || l.includes('SELECT COUNT') || l.includes('SELECT c.*')) continue;
    // scopeCli du rapport mensuel : portee client volontaire (grants par dossier)
    if (l.includes('scopeCli')) continue;
    offenders.push(`${i + 1}: ${l.trim().slice(0, 160)}`);
  }
  assert.deepEqual(offenders, [], `${offenders.length} scope(s) dossier encore base(s) sur le seul client:\n` + offenders.join('\n'));
});

test('index.ts : le transfert de dossier ecrit bien org_dossiers.assigned_comptable_id', () => {
  assert.ok(SRC.includes('UPDATE org_dossiers SET assigned_comptable_id = ? WHERE id = ?'),
    'le PATCH /org/dossiers/:id doit ecrire le override au niveau dossier');
  assert.ok(SRC.includes('dossier_reassigned'),
    "l'audit doit journaliser le transfert de dossier (action dossier_reassigned)");
  assert.ok(SRC.includes('UPDATE org_dossiers SET assigned_comptable_id = NULL WHERE client_id = ?'),
    'le transfert global (reassign client) doit remettre les overrides a zero');
});
