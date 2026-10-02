-- ============================================================
-- 0022 — Corrections pack (LF 2026 / agenda DGI / classeur)
-- ============================================================
-- 1. DMI : renommée « Déclaration mensuelle d'impôts (DMI) » ;
--    PM télé-déclaration = le 20 du mois suivant (agenda DGI :
--    20 juillet 2026, 22 juin = report du 20 dimanche) ; non
--    télé = 28 ; PP = 15. Note : télé-déclaration DGI (et non
--    TEJ, qui ne sert qu'aux certificats de retenue).
-- 2. Acomptes IS : 28 juin/sept/déc pour personnes morales
--    (art. 51 ; 25 = personnes physiques).
-- 3. 5 février = vignette VP (personnes morales), pas la taxe
--    de circulation (10 janv/10 fév selon parité).
-- 4. Classeur : tâches mensuelles « Préparation des certificats
--    TEJ » ×12 mois ajoutées.
-- 5. Classeur : suspension scindée en listes de ventes (art. 36)
--    et d'achats (art. 35), ×4 trimestres chacune, portée
--    exportatrice + semi-exportatrice.
-- 6. Résidu smoke : client_001 repasse à statut non renseigné.

-- 1a. Alertes pack : DMI PM (titre, jour 20, note)
UPDATE org_fiscal_alerts
SET title = 'Déclaration mensuelle d''impôts (DMI) — TVA, retenues, TFP, FOPROLOS (personne morale)',
    due_date = substr(due_date, 1, 4) || '-12-20',
    note = 'Personnes morales soumises à la télé-déclaration : au plus tard le 20 du mois suivant (télé-déclaration DGI) ; non télé-déclarantes : 28 — report au 1er jour ouvrable si férié/dimanche'
WHERE id LIKE 'pack_pm_mensuelle_%';

-- 1b. Alertes pack : DMI PP (titre, note)
UPDATE org_fiscal_alerts
SET title = 'Déclaration mensuelle d''impôts (DMI) — TVA, retenues, TFP, FOPROLOS (personne physique)',
    note = 'Personnes physiques au régime réel : au plus tard le 15 du mois suivant (PM télé-déclaration : 20) — report au 1er jour ouvrable si férié/dimanche'
WHERE id LIKE 'pack_pp_mensuelle_%';

-- 1c. Modèles + tâches : renommage DMI
UPDATE org_task_templates
SET label = 'Déclaration mensuelle d''impôts (DMI) — 15 (PP) / 20 (PM) du mois suivant'
WHERE label = 'Déclaration TVA mensuelle';
UPDATE org_tasks
SET label = 'Déclaration mensuelle d''impôts (DMI) — 15 (PP) / 20 (PM) du mois suivant'
WHERE label = 'Déclaration TVA mensuelle';

-- 2. Renommage acomptes IS (personnes morales)
UPDATE org_task_templates
SET label = 'Acomptes provisionnels IS — 28 juin / 28 sept / 28 déc (personnes morales)'
WHERE label = 'Acomptes provisionnels IS — 25 juin / 25 sept / 25 déc';
UPDATE org_tasks
SET label = 'Acomptes provisionnels IS — 28 juin / 28 sept / 28 déc (personnes morales)'
WHERE label = 'Acomptes provisionnels IS — 25 juin / 25 sept / 25 déc';

-- 3. Renommage vignette (5 février = vignette VP PM, pas circulation)
UPDATE org_task_templates
SET label = 'Vignette des voitures particulières (PM) — 5 février'
WHERE label = 'Taxe de circulation PM — 5 février';
UPDATE org_tasks
SET label = 'Vignette des voitures particulières (PM) — 5 février'
WHERE label = 'Taxe de circulation PM — 5 février';

-- 5a. Suppression de la tâche fusionnée de suspension
DELETE FROM org_tasks
WHERE label = 'État suspension de TVA art. 18 II — 28 j après trimestre';
DELETE FROM org_task_templates
WHERE label = 'État suspension de TVA art. 18 II — 28 j après trimestre';

-- 5b. Deux modèles de listes de suspension (portée export + semi)
WITH new_templates(label, ord) AS (
  VALUES
    ('Listes des factures de ventes en suspension TVA (art. 36 LF 2013) — 28 j après trimestre', 12),
    ('Listes des factures d''achats en suspension TVA (art. 35 LF 2013) — 28 j après trimestre', 12)
)
INSERT INTO org_task_templates (id, organization_id, label, order_index, requires_document, frequency, export_scope)
SELECT lower(hex(randomblob(16))), o.id, v.label, v.ord, 0, 'trimestrielle', '["exportatrice","semi_exportatrice"]'
FROM organizations o, new_templates v
WHERE NOT EXISTS (
  SELECT 1 FROM org_task_templates t
  WHERE t.organization_id = o.id AND t.label = v.label
);

-- 5c. Instances ×4 trimestres dans les dossiers en cours
WITH months(n) AS (
  VALUES (1),(4),(7),(10)
)
INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index, assigned_comptable_id, month, export_scope)
SELECT lower(hex(randomblob(16))), d.id, t.label, 'a_faire', t.requires_document, t.order_index, t.assigned_comptable_id, m.n, t.export_scope
FROM org_task_templates t
JOIN org_clients c ON c.organization_id = t.organization_id
JOIN org_dossiers d ON d.client_id = c.id AND d.status = 'en_cours'
CROSS JOIN months m
WHERE t.label LIKE 'Listes des factures%en suspension TVA%'
  AND NOT EXISTS (
    SELECT 1 FROM org_tasks e WHERE e.dossier_id = d.id AND e.label = t.label AND e.month = m.n
  );

-- 4a. Modèle TEJ (classeur : « Préparation des certificats TEJ »)
WITH new_t(label, ord) AS (
  VALUES ('Préparation des certificats de retenue à la source (TEJ)', 5)
)
INSERT INTO org_task_templates (id, organization_id, label, order_index, requires_document, frequency, export_scope)
SELECT lower(hex(randomblob(16))), o.id, v.label, v.ord, 0, 'mensuelle', NULL
FROM organizations o, new_t v
WHERE NOT EXISTS (
  SELECT 1 FROM org_task_templates t
  WHERE t.organization_id = o.id AND t.label = v.label
);

-- 4b. Instances ×12 mois dans les dossiers en cours
WITH months(n) AS (
  VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)
)
INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index, assigned_comptable_id, month, export_scope)
SELECT lower(hex(randomblob(16))), d.id, t.label, 'a_faire', t.requires_document, t.order_index, t.assigned_comptable_id, m.n, t.export_scope
FROM org_task_templates t
JOIN org_clients c ON c.organization_id = t.organization_id
JOIN org_dossiers d ON d.client_id = c.id AND d.status = 'en_cours'
CROSS JOIN months m
WHERE t.label = 'Préparation des certificats de retenue à la source (TEJ)'
  AND NOT EXISTS (
    SELECT 1 FROM org_tasks e WHERE e.dossier_id = d.id AND e.label = t.label AND e.month = m.n
  );

-- 6. Résidu smoke : client_001 repasse à statut non renseigné
UPDATE org_clients SET export_status = NULL WHERE id = 'client_001';

-- 7. Recalcul de la progression
UPDATE org_dossiers SET cached_progress = COALESCE((
  SELECT ROUND(CAST(SUM(CASE WHEN t.status = 'fait' THEN 1 ELSE 0 END) AS REAL) * 100.0 / COUNT(*), 1)
  FROM org_tasks t WHERE t.dossier_id = org_dossiers.id
), 0);
