-- Passage automatique au nouvel exercice (cron 1er janvier + securite au chargement)
--  - unicite (client, exercice) : le rollover peut tourner en parallele (cron + Dashboard)
--  - organizations.last_rollover_year : garde-fou idempotent (une execution par annee civile)
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_dossiers_client_exercice ON org_dossiers(client_id, exercice);
ALTER TABLE organizations ADD COLUMN last_rollover_year INTEGER;
