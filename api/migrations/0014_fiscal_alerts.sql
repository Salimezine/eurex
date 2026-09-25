-- Alertes échéances fiscales (dates butoirs)
CREATE TABLE org_fiscal_alerts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  lead_days INTEGER NOT NULL DEFAULT 7,
  dossier_id TEXT REFERENCES org_dossiers(id),
  note TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES org_users(id),
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_fiscal_alerts_org ON org_fiscal_alerts(organization_id, due_date);

-- Date butoir sur une tâche fiscale
ALTER TABLE org_tasks ADD COLUMN due_date TEXT;
