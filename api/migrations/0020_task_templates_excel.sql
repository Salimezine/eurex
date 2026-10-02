-- ============================================================
-- 0020 — Tâches manquantes du classeur OBLIGATIONS SOCIETES
-- ============================================================
-- Le classeur Excel est réparti : obligations déclaratives à date
-- légale → pack d'échéances (ensureAlertPack, code) ; travaux
-- opérationnels → tâches de checklist (ci-dessous).

-- 1. Nouveaux modèles (idempotent via NOT EXISTS sur le libellé)
WITH new_templates(label, ord, freq) AS (
  VALUES
    ('Reporting mensuel — édition & envoi client', 19, 'mensuelle'),
    ('Élaboration de la paie mensuelle', 20, 'mensuelle'),
    ('Préparation PV AGO — approbation EF n-1', 21, 'annuelle'),
    ('Renouvellement autorisation achat en suspension TVA', 22, 'annuelle'),
    ('Visa des bons de commande en suspension TVA', 23, 'annuelle')
)
INSERT INTO org_task_templates (id, organization_id, label, order_index, requires_document, frequency)
SELECT lower(hex(randomblob(16))), o.id, v.label, v.ord, 0, v.freq
FROM organizations o, new_templates v
WHERE NOT EXISTS (
  SELECT 1 FROM org_task_templates t
  WHERE t.organization_id = o.id AND t.label = v.label
);

-- 2. Tâches mensuelles ×12 mois dans les dossiers en cours
WITH months(n) AS (
  VALUES (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)
)
INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index, assigned_comptable_id, month)
SELECT lower(hex(randomblob(16))), d.id, t.label, 'a_faire', t.requires_document, t.order_index, t.assigned_comptable_id, m.n
FROM org_task_templates t
JOIN org_clients c ON c.organization_id = t.organization_id
JOIN org_dossiers d ON d.client_id = c.id AND d.status = 'en_cours'
CROSS JOIN months m
WHERE t.order_index BETWEEN 19 AND 23 AND t.frequency = 'mensuelle'
  AND NOT EXISTS (
    SELECT 1 FROM org_tasks e WHERE e.dossier_id = d.id AND e.label = t.label AND e.month = m.n
  );

-- 3. Tâches annuelles ×1 (month NULL)
INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index, assigned_comptable_id, month)
SELECT lower(hex(randomblob(16))), d.id, t.label, 'a_faire', t.requires_document, t.order_index, t.assigned_comptable_id, NULL
FROM org_task_templates t
JOIN org_clients c ON c.organization_id = t.organization_id
JOIN org_dossiers d ON d.client_id = c.id AND d.status = 'en_cours'
WHERE t.order_index BETWEEN 19 AND 23 AND t.frequency = 'annuelle'
  AND NOT EXISTS (
    SELECT 1 FROM org_tasks e WHERE e.dossier_id = d.id AND e.label = t.label AND e.month IS NULL
  );

-- 4. Recalcul de la progression
UPDATE org_dossiers SET cached_progress = COALESCE((
  SELECT ROUND(CAST(SUM(CASE WHEN t.status = 'fait' THEN 1 ELSE 0 END) AS REAL) * 100.0 / COUNT(*), 1)
  FROM org_tasks t WHERE t.dossier_id = org_dossiers.id
), 0);
