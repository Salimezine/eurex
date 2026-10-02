-- Portée export des tâches : JSON array des statuts export concernés, NULL = toutes
ALTER TABLE org_task_templates ADD COLUMN export_scope TEXT;
ALTER TABLE org_tasks ADD COLUMN export_scope TEXT;

-- Tâches liées au régime de suspension TVA → exportatrices + semi-exportatrices uniquement
UPDATE org_task_templates SET export_scope = '["exportatrice","semi_exportatrice"]' WHERE label LIKE '%suspension%' AND label LIKE '%TVA%';
UPDATE org_tasks SET export_scope = '["exportatrice","semi_exportatrice"]' WHERE label LIKE '%suspension%' AND label LIKE '%TVA%';
