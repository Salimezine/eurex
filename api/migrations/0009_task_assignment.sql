-- Assign a comptable to task templates (pre-fill) and to tasks (per-dossier override)
ALTER TABLE org_task_templates ADD COLUMN assigned_comptable_id TEXT REFERENCES org_users(id);
ALTER TABLE org_tasks ADD COLUMN assigned_comptable_id TEXT REFERENCES org_users(id);

CREATE INDEX IF NOT EXISTS idx_org_task_templates_assigned ON org_task_templates(assigned_comptable_id);
CREATE INDEX IF NOT EXISTS idx_org_tasks_assigned ON org_tasks(assigned_comptable_id);
