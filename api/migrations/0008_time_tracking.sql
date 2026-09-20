-- Time tracking per task
CREATE TABLE IF NOT EXISTS org_time_entries (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  duration_seconds INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_time_entries_dossier ON org_time_entries(dossier_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task ON org_time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON org_time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_active ON org_time_entries(task_id, stopped_at) WHERE stopped_at IS NULL;

-- Add cached time fields to org_tasks
ALTER TABLE org_tasks ADD COLUMN total_time_seconds INTEGER DEFAULT 0;
ALTER TABLE org_tasks ADD COLUMN timer_started_at TEXT;
ALTER TABLE org_tasks ADD COLUMN timer_user_id TEXT;
