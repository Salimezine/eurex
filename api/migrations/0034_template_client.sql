-- Ciblage client des modèles de tâches : une tâche récurrente peut viser UN client
-- (NULL = tous les dossiers du cabinet, comportement historique).
ALTER TABLE org_task_templates ADD COLUMN client_id TEXT;
CREATE INDEX IF NOT EXISTS idx_org_task_templates_client ON org_task_templates(client_id);
