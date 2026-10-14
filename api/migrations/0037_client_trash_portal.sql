-- Corbeille clients (soft-delete 30 jours) + portail client (lien public tokenise)
ALTER TABLE org_clients ADD COLUMN deleted_at TEXT;
ALTER TABLE org_clients ADD COLUMN portal_token TEXT;
CREATE INDEX IF NOT EXISTS idx_org_clients_deleted ON org_clients(organization_id, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_clients_portal ON org_clients(portal_token);
