-- Échéances récurrentes (TVA, CNSS, IS… toujours présentes)
ALTER TABLE org_fiscal_alerts ADD COLUMN recurrence TEXT;

-- « Traité » par occurrence (ex: TVA octobre traitée, TVA novembre non)
CREATE TABLE org_alert_dones (
  alert_id TEXT NOT NULL REFERENCES org_fiscal_alerts(id),
  due_date TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  PRIMARY KEY (alert_id, due_date)
);
