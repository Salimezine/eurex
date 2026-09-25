-- ============================================================
-- 0010 — Tâches par mois (exercice complet)
-- ============================================================

-- 1. Colonnes
ALTER TABLE org_tasks ADD COLUMN month INTEGER; -- 1-12, NULL = annuel
ALTER TABLE org_task_templates ADD COLUMN frequency TEXT NOT NULL DEFAULT 'annuelle'; -- 'mensuelle' | 'annuelle'

-- 2. Templates : les 6 tâches opérationnelles deviennent mensuelles
--    (1 Relevés, 2 Saisie achats, 3 Saisie ventes, 4 Rapprochement, 5 TVA, 6 CNSS)
UPDATE org_task_templates SET frequency = 'mensuelle' WHERE order_index BETWEEN 1 AND 6;

-- 3. Expansion des tâches existantes (dossiers plate -> 12 mois)
--    Les tâches mensuelles (order_index 1-6) sont dupliquees pour les 11 autres
--    mois avec statut 'a_faire' ; l'original garde son statut sur le mois
--    courant (Septembre 2026 = 9). Les tâches annuelles (7-9) restent month NULL.
WITH months(n) AS (
  VALUES (1),(2),(3),(4),(5),(6),(7),(8),(10),(11),(12)
)
INSERT INTO org_tasks (id, dossier_id, label, status, requires_document, order_index, assigned_comptable_id, month, updated_at)
SELECT lower(hex(randomblob(16))), t.dossier_id, t.label, 'a_faire', t.requires_document, t.order_index, t.assigned_comptable_id, m.n, datetime('now')
FROM org_tasks t, months m
WHERE t.month IS NULL AND t.order_index <= 6;

UPDATE org_tasks SET month = 9 WHERE month IS NULL AND order_index <= 6;

-- 4. Index + recalcul de la progression
CREATE INDEX IF NOT EXISTS idx_org_tasks_month ON org_tasks(dossier_id, month);

UPDATE org_dossiers SET cached_progress = COALESCE((
  SELECT ROUND(CAST(SUM(CASE WHEN t.status = 'fait' THEN 1 ELSE 0 END) AS REAL) * 100.0 / COUNT(*), 1)
  FROM org_tasks t WHERE t.dossier_id = org_dossiers.id
), 0);
