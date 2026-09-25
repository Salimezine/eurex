-- ============================================================
-- 0011 — Fréquence trimestrielle + modèles fiscaux tunisiens
-- ============================================================
-- Pas d'ALTER : frequency est déjà TEXT sans CHECK ('trimestrielle'
-- est stockable tel quel), org_tasks.month absorbe le trimestre
-- (occurrences sur les mois 1, 4, 7, 10).

-- 1. Nouveaux modèles (idempotent via NOT EXISTS sur le libellé)
--    Trimestriels : dépôt dans le mois suivant chaque trimestre
--    Annuels : échéances officielles (CIRPPIS / RNE / LF)
WITH new_templates(label, ord, freq) AS (
  VALUES
    ('Déclaration TVA trimestrielle (option) — 15 du mois suivant', 10, 'trimestrielle'),
    ('CNSS déclaration trimestrielle I16 — 15 du mois suivant', 11, 'trimestrielle'),
    ('État suspension de TVA art. 18 II — 28 j après trimestre', 12, 'trimestrielle'),
    ('Déclaration annuelle IS/IRPP — 25 mars', 13, 'annuelle'),
    ('Acomptes provisionnels IS — 25 juin / 25 sept / 25 déc', 14, 'annuelle'),
    ('Déclaration annuelle employeur — 28 février', 15, 'annuelle'),
    ('Dépôt états financiers au RNE — 31 juillet', 16, 'annuelle'),
    ('Dossier AG / rapport CAC — 30 j après AG', 17, 'annuelle'),
    ('Taxe de circulation PM — 5 février', 18, 'annuelle')
)
INSERT INTO org_task_templates (id, organization_id, label, order_index, requires_document, frequency)
SELECT lower(hex(randomblob(16))), o.id, v.label, v.ord, 0, v.freq
FROM organizations o, new_templates v
WHERE NOT EXISTS (
  SELECT 1 FROM org_task_templates t
  WHERE t.organization_id = o.id AND t.label = v.label
);

-- 2. Tâches trimestrielles ×4 mois (Janv, Avr, Juil, Oct) dans les
--    dossiers en cours — uniquement pour les NOUVEAUX modèles (order >= 10)
WITH months(n) AS (
  VALUES (1),(4),(7),(10)
)
INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index, assigned_comptable_id, month)
SELECT lower(hex(randomblob(16))), d.id, t.label, 'a_faire', t.requires_document, t.order_index, t.assigned_comptable_id, m.n
FROM org_task_templates t
JOIN org_clients c ON c.organization_id = t.organization_id
JOIN org_dossiers d ON d.client_id = c.id AND d.status = 'en_cours'
CROSS JOIN months m
WHERE t.order_index >= 10 AND t.frequency = 'trimestrielle'
  AND NOT EXISTS (
    SELECT 1 FROM org_tasks e WHERE e.dossier_id = d.id AND e.label = t.label AND e.month = m.n
  );

-- 3. Tâches annuelles ×1 (month NULL) pour les nouveaux modèles annuels
INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index, assigned_comptable_id, month)
SELECT lower(hex(randomblob(16))), d.id, t.label, 'a_faire', t.requires_document, t.order_index, t.assigned_comptable_id, NULL
FROM org_task_templates t
JOIN org_clients c ON c.organization_id = t.organization_id
JOIN org_dossiers d ON d.client_id = c.id AND d.status = 'en_cours'
WHERE t.order_index >= 10 AND t.frequency = 'annuelle'
  AND NOT EXISTS (
    SELECT 1 FROM org_tasks e WHERE e.dossier_id = d.id AND e.label = t.label AND e.month IS NULL
  );

-- 4. Recalcul de la progression
UPDATE org_dossiers SET cached_progress = COALESCE((
  SELECT ROUND(CAST(SUM(CASE WHEN t.status = 'fait' THEN 1 ELSE 0 END) AS REAL) * 100.0 / COUNT(*), 1)
  FROM org_tasks t WHERE t.dossier_id = org_dossiers.id
), 0);
