-- 0038 — comptable affecte au dossier (override du comptable du client).
-- NULL = le dossier suit le comptable du client (comportement historique).
-- Le transfert d'un dossier seul s'ecrit ici ; le transfert de tout le client
-- (reassign) remet ces overrides a NULL.
ALTER TABLE org_dossiers ADD COLUMN assigned_comptable_id TEXT REFERENCES org_users(id);
CREATE INDEX IF NOT EXISTS idx_org_dossiers_assigned ON org_dossiers(assigned_comptable_id);
