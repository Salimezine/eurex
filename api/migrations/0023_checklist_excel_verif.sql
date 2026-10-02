-- ============================================================
-- 0023 — Checklist alignée 100% sur OBLIGATIONS SOCIETES.xlsx
--        + traçabilité / vérification des tâches
--        + compte manager
--        + alertes suspension PP=15 / PM=28 + DMI PM non-télé=28
--        + lead_days uniformisé à 5 jours (tout le pack)
-- ============================================================

-- 1. Traçabilité : qui a modifié la tâche, qui l'a vérifiée, note de temps
--    (colonnes appliquées en amont via commande directe :
--     ALTER TABLE org_tasks ADD COLUMN verified_by TEXT;
--     ALTER TABLE org_tasks ADD COLUMN verified_at TEXT;
--     ALTER TABLE org_time_entries ADD COLUMN note TEXT;)

-- 2. Compte manager (affiché 'manager' via role_label ; rôle stocké 'expert'
--    car le CHECK de org_users n'accepte que expert/comptable)
INSERT INTO org_users (id, organization_id, full_name, email, password_hash, role, role_label)
SELECT lower(hex(randomblob(16))), o.id, 'Abla', 'manager@eurex.tn',
       'eurexmgr2026salt1:88cd2dc6ce957938373d196c4ed5a2616dc4d1cef2d28becec71ad1589e4e980',
       'expert', 'manager'
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM org_users u WHERE u.email = 'manager@eurex.tn');

-- 3. Remplacement intégral de la checklist (20 tâches du classeur Excel)
--    Idempotent dans son ensemble : DELETE puis INSERT (réexécution = même état).
--    org_expected_documents dépend de org_tasks (FK) : on purge puis on
--    régénère les documents attendus des tâches requires_document.
DELETE FROM org_expected_documents;
DELETE FROM org_tasks;
DELETE FROM org_task_templates;

WITH tmpl(label, ord, req, freq, scope) AS (
  VALUES
    ('SAISIE Comptable et ERB', 1, 1, 'mensuelle', NULL),
    ('Dépôt DMI', 2, 0, 'mensuelle', NULL),
    ('Reporting mensuel', 3, 0, 'mensuelle', NULL),
    ('Préparation paie du mois', 4, 0, 'mensuelle', NULL),
    ('Préparation des certificats TEJ', 5, 0, 'mensuelle', NULL),
    ('Préparation déclaration CNSS trimestrielle', 6, 0, 'trimestrielle', NULL),
    ('Préparation et dépôt déclaration chiffre d''affaire en suspension de TVA', 7, 0, 'trimestrielle', '["exportatrice","semi_exportatrice"]'),
    ('Préparation et dépôt déclaration des achats en suspension de TVA', 8, 0, 'trimestrielle', '["exportatrice","semi_exportatrice"]'),
    ('Préparation Etats financiers annuels', 9, 0, 'annuelle', NULL),
    ('Dépôt AP 1', 10, 0, 'annuelle', NULL),
    ('Dépôt AP 2', 11, 0, 'annuelle', NULL),
    ('Dépôt AP 3', 12, 0, 'annuelle', NULL),
    ('Dépôt IS provisoire', 13, 0, 'annuelle', NULL),
    ('Dépôt IS définitive', 14, 0, 'annuelle', NULL),
    ('Dépôt de la déclaration employeur', 15, 0, 'annuelle', NULL),
    ('Préparation et dépôt de la liasse fiscale', 16, 0, 'annuelle', NULL),
    ('Renouvellement Autorisation d''achat en suspension de TVA', 17, 0, 'annuelle', '["exportatrice","semi_exportatrice"]'),
    ('Visa bon de commande en suspension de TVA', 18, 0, 'annuelle', '["exportatrice","semi_exportatrice"]'),
    ('Préparation PV AGO approbation EF n-1', 19, 0, 'annuelle', NULL),
    ('Dépôt des EF n-1 et du PV AGO au RNE', 20, 0, 'annuelle', NULL)
)
INSERT INTO org_task_templates (id, organization_id, label, order_index, requires_document, frequency, export_scope)
SELECT lower(hex(randomblob(16))), o.id, v.label, v.ord, v.req, v.freq, v.scope
FROM organizations o, tmpl v;

-- 3a. Instances mensuelles ×12 mois (tous dossiers)
WITH months(n) AS (
  VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)
)
INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index, assigned_comptable_id, month, export_scope)
SELECT lower(hex(randomblob(16))), d.id, t.label, 'a_faire', t.requires_document, t.order_index, t.assigned_comptable_id, m.n, t.export_scope
FROM org_task_templates t
JOIN org_clients c ON c.organization_id = t.organization_id
JOIN org_dossiers d ON d.client_id = c.id
CROSS JOIN months m
WHERE t.frequency = 'mensuelle';

-- 3b. Instances trimestrielles : mois [1,4,7,10]
WITH qs(n) AS (
  VALUES (1),(4),(7),(10)
)
INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index, assigned_comptable_id, month, export_scope)
SELECT lower(hex(randomblob(16))), d.id, t.label, 'a_faire', t.requires_document, t.order_index, t.assigned_comptable_id, m.n, t.export_scope
FROM org_task_templates t
JOIN org_clients c ON c.organization_id = t.organization_id
JOIN org_dossiers d ON d.client_id = c.id
CROSS JOIN qs m
WHERE t.frequency = 'trimestrielle';

-- 3c. Instances annuelles : month NULL
INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index, assigned_comptable_id, month, export_scope)
SELECT lower(hex(randomblob(16))), d.id, t.label, 'a_faire', t.requires_document, t.order_index, t.assigned_comptable_id, NULL, t.export_scope
FROM org_task_templates t
JOIN org_clients c ON c.organization_id = t.organization_id
JOIN org_dossiers d ON d.client_id = c.id
WHERE t.frequency = 'annuelle';

-- 3d. Documents attendus des tâches requires_document (mensuelles ×12)
INSERT INTO org_expected_documents (id, dossier_id, task_id, label, received)
SELECT lower(hex(randomblob(16))), t.dossier_id, t.id,
       t.label || ' — ' ||
       CASE t.month WHEN 1 THEN 'Janvier' WHEN 2 THEN 'Février' WHEN 3 THEN 'Mars'
                    WHEN 4 THEN 'Avril' WHEN 5 THEN 'Mai' WHEN 6 THEN 'Juin'
                    WHEN 7 THEN 'Juillet' WHEN 8 THEN 'Août' WHEN 9 THEN 'Septembre'
                    WHEN 10 THEN 'Octobre' WHEN 11 THEN 'Novembre' WHEN 12 THEN 'Décembre' END
       || ' ' || d.exercice,
       0
FROM org_tasks t
JOIN org_dossiers d ON d.id = t.dossier_id
WHERE t.requires_document = 1 AND t.month IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM org_expected_documents e WHERE e.task_id = t.id);

-- 4. Alertes : suppression des 2 lignes suspension uniques (remplacées
--    par les variantes PP=15 / PM=28 créées par ensureAlertPack au
--    prochain chargement du flux) + DMI PM non-télé créée pareillement.
DELETE FROM org_fiscal_alerts
WHERE (id LIKE 'pack_tva_susp_ventes_%' OR id LIKE 'pack_tva_susp_achats_%')
  AND id NOT LIKE 'pack_tva_susp_ventes_pp_%'
  AND id NOT LIKE 'pack_tva_susp_ventes_pm_%'
  AND id NOT LIKE 'pack_tva_susp_achats_pp_%'
  AND id NOT LIKE 'pack_tva_susp_achats_pm_%';

-- 5. Tout le pack apparaît 5 jours avant l'échéance
UPDATE org_fiscal_alerts SET lead_days = 5;

-- 6. Recalcul de la progression
UPDATE org_dossiers SET cached_progress = COALESCE((
  SELECT ROUND(CAST(SUM(CASE WHEN t.status = 'fait' THEN 1 ELSE 0 END) AS REAL) * 100.0 / COUNT(*), 1)
  FROM org_tasks t WHERE t.dossier_id = org_dossiers.id
), 0);
