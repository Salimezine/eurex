-- ============================================================
-- 0028 : Renfort encadre (grants d'acces a un dossier)
-- ============================================================
-- Un expert/manager ouvre un acces temporaire a un dossier pour
-- un autre comptable (motif + duree 1/7/30 jours).
-- expires_at : fin de validite (UTC, toujours renseignee).
-- revoked_at : revoque anticipement par l'expert.
-- ============================================================

CREATE TABLE IF NOT EXISTS org_dossier_grants (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  granted_to TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  reason TEXT,
  days INTEGER NOT NULL DEFAULT 7,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_grants_to ON org_dossier_grants (granted_to);
CREATE INDEX IF NOT EXISTS idx_grants_dossier ON org_dossier_grants (dossier_id);
