-- ============================================================
-- MODULE ORGANIZATIONS — Cabinet d'Expertise Comptable
-- ============================================================

-- Cabinets
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Utilisateurs (experts + comptables)
CREATE TABLE IF NOT EXISTS org_users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('expert','comptable')),
  must_change_password INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Clients du cabinet (liés à societes existantes si besoin)
CREATE TABLE IF NOT EXISTS org_clients (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  assigned_comptable_id TEXT REFERENCES org_users(id),
  societe_id TEXT,  -- lien optionnel vers la table societes existante
  name TEXT NOT NULL,
  matricule_fiscal TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Dossiers (un par exercice comptable par client)
CREATE TABLE IF NOT EXISTS org_dossiers (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES org_clients(id),
  exercice INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours','cloture')),
  cached_progress REAL DEFAULT 0,
  opened_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  closed_by TEXT REFERENCES org_users(id),
  UNIQUE(client_id, exercice)
);

-- Checklist des tâches par dossier
CREATE TABLE IF NOT EXISTS org_tasks (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES org_dossiers(id),
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'a_faire'
    CHECK (status IN ('a_faire','en_cours','fait','bloque_client')),
  blocked_reason TEXT,
  requires_document INTEGER DEFAULT 0,
  updated_by TEXT REFERENCES org_users(id),
  updated_at TEXT DEFAULT (datetime('now')),
  order_index INTEGER DEFAULT 0
);

-- Documents attendus du client
CREATE TABLE IF NOT EXISTS org_expected_documents (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES org_dossiers(id),
  task_id TEXT REFERENCES org_tasks(id),
  label TEXT NOT NULL,
  received INTEGER DEFAULT 0,
  received_at TEXT,
  received_note TEXT,
  file_r2_key TEXT,
  updated_by TEXT REFERENCES org_users(id)
);

-- Template de tâches par défaut (par cabinet)
CREATE TABLE IF NOT EXISTS org_task_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  label TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  requires_document INTEGER DEFAULT 0
);

-- Journal d'audit
CREATE TABLE IF NOT EXISTS org_audit_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Notifications internes
CREATE TABLE IF NOT EXISTS org_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES org_users(id),
  dossier_id TEXT,
  message TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Notes internes par dossier
CREATE TABLE IF NOT EXISTS org_notes (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES org_dossiers(id),
  user_id TEXT NOT NULL REFERENCES org_users(id),
  user_name TEXT,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Échéances fiscales et sociales
CREATE TABLE IF NOT EXISTS org_fiscal_deadlines (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES org_clients(id),
  type TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT DEFAULT 'a_faire' CHECK (status IN ('a_faire','fait','en_retard')),
  dossier_id TEXT REFERENCES org_dossiers(id)
);

-- Log des relances (v2)
CREATE TABLE IF NOT EXISTS org_reminders_log (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  document_id TEXT,
  sent_at TEXT DEFAULT (datetime('now')),
  channel TEXT CHECK (channel IN ('email','sms'))
);

-- ============================================================
-- INDEX
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_org_users_org ON org_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_users_email ON org_users(email);
CREATE INDEX IF NOT EXISTS idx_org_clients_org ON org_clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_clients_comptable ON org_clients(assigned_comptable_id);
CREATE INDEX IF NOT EXISTS idx_org_dossiers_client ON org_dossiers(client_id);
CREATE INDEX IF NOT EXISTS idx_org_dossiers_exercice ON org_dossiers(client_id, exercice);
CREATE INDEX IF NOT EXISTS idx_org_tasks_dossier ON org_tasks(dossier_id);
CREATE INDEX IF NOT EXISTS idx_org_tasks_status ON org_tasks(dossier_id, status);
CREATE INDEX IF NOT EXISTS idx_org_expected_docs_dossier ON org_expected_documents(dossier_id);
CREATE INDEX IF NOT EXISTS idx_org_expected_docs_received ON org_expected_documents(dossier_id, received);
CREATE INDEX IF NOT EXISTS idx_org_audit_log_org ON org_audit_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_audit_log_dossier ON org_audit_log(target_id);
CREATE INDEX IF NOT EXISTS idx_org_notifications_user ON org_notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_org_notes_dossier ON org_notes(dossier_id);
CREATE INDEX IF NOT EXISTS idx_org_fiscal_org ON org_fiscal_deadlines(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_fiscal_client ON org_fiscal_deadlines(client_id);

-- ============================================================
-- SEED DATA — Cabinet test (2 comptables, 5 clients)
-- ============================================================

-- Organization
INSERT INTO organizations (id, name) VALUES ('org_cabinet_001', 'Cabinet Ezzine & Associates');

-- Users (passwords: hash of "expert1234567" and "comptable1234567")
-- SHA-256 hashes computed at runtime, using placeholder bcrypt-compatible hashes
INSERT INTO org_users (id, organization_id, full_name, email, password_hash, role) VALUES
  ('user_expert_001', 'org_cabinet_001', 'Med Salim Ezzine', 'expert@eurex.tn', '$argon2id$v=19$m=65536,t=3,p=4$placeholder_expert_hash', 'expert'),
  ('user_comp_001', 'org_cabinet_001', 'Ahmed Ben Ali', 'ahmed@eurex.tn', '$argon2id$v=19$m=65536,t=3,p=4$placeholder_comp1_hash', 'comptable'),
  ('user_comp_002', 'org_cabinet_001', 'Fatma Trabelsi', 'fatma@eurex.tn', '$argon2id$v=19$m=65536,t=3,p=4$placeholder_comp2_hash', 'comptable');

-- Clients
INSERT INTO org_clients (id, organization_id, assigned_comptable_id, name, matricule_fiscal, contact_email) VALUES
  ('client_001', 'org_cabinet_001', 'user_comp_001', 'ANIMAL CITY', '1234567/H', 'contact@animalcity.tn'),
  ('client_002', 'org_cabinet_001', 'user_comp_001', 'PROYASH METROPOLI', '2345678/A', 'proyash@metropoli.tn'),
  ('client_003', 'org_cabinet_001', 'user_comp_001', 'TECH SOLUTIONS SARL', '3456789/B', 'tech@solutions.tn'),
  ('client_004', 'org_cabinet_001', 'user_comp_002', 'CONSTRUCTION DELTA', '4567890/C', 'delta@construction.tn'),
  ('client_005', 'org_cabinet_001', 'user_comp_002', 'RESTAURANT LE PALAIS', '5678901/D', 'palais@restaurant.tn');

-- Dossiers exercice 2026
INSERT INTO org_dossiers (id, client_id, exercice, status) VALUES
  ('doss_001', 'client_001', 2026, 'en_cours'),
  ('doss_002', 'client_002', 2026, 'en_cours'),
  ('doss_003', 'client_003', 2026, 'en_cours'),
  ('doss_004', 'client_004', 2026, 'en_cours'),
  ('doss_005', 'client_005', 2026, 'en_cours');

-- Default task templates for the cabinet
INSERT INTO org_task_templates (id, organization_id, label, order_index, requires_document) VALUES
  ('tmpl_001', 'org_cabinet_001', 'Réception relevés bancaires', 1, 1),
  ('tmpl_002', 'org_cabinet_001', 'Saisie achats', 2, 0),
  ('tmpl_003', 'org_cabinet_001', 'Saisie ventes', 3, 0),
  ('tmpl_004', 'org_cabinet_001', 'Rapprochement bancaire', 4, 0),
  ('tmpl_005', 'org_cabinet_001', 'Déclaration TVA mensuelle', 5, 0),
  ('tmpl_006', 'org_cabinet_001', 'Déclaration CNSS mensuelle', 6, 0),
  ('tmpl_007', 'org_cabinet_001', 'Révision balance', 7, 0),
  ('tmpl_008', 'org_cabinet_001', 'Établissement états financiers', 8, 0),
  ('tmpl_009', 'org_cabinet_001', 'Liasse fiscale / déclaration IS', 9, 0);

-- Tasks for dossiers (staggered progress for demo)
-- Dossier 001 (ANIMAL CITY) — 5/9 done
INSERT INTO org_tasks (id, dossier_id, label, status, order_index) VALUES
  ('task_001_1', 'doss_001', 'Réception relevés bancaires', 'fait', 1),
  ('task_001_2', 'doss_001', 'Saisie achats', 'fait', 2),
  ('task_001_3', 'doss_001', 'Saisie ventes', 'fait', 3),
  ('task_001_4', 'doss_001', 'Rapprochement bancaire', 'fait', 4),
  ('task_001_5', 'doss_001', 'Déclaration TVA mensuelle', 'fait', 5),
  ('task_001_6', 'doss_001', 'Déclaration CNSS mensuelle', 'en_cours', 6),
  ('task_001_7', 'doss_001', 'Révision balance', 'a_faire', 7),
  ('task_001_8', 'doss_001', 'Établissement états financiers', 'a_faire', 8),
  ('task_001_9', 'doss_001', 'Liasse fiscale / déclaration IS', 'a_faire', 9);

-- Dossier 002 (PROYASH) — 3/9, 1 blocked
INSERT INTO org_tasks (id, dossier_id, label, status, blocked_reason, order_index) VALUES
  ('task_002_1', 'doss_002', 'Réception relevés bancaires', 'fait', NULL, 1),
  ('task_002_2', 'doss_002', 'Saisie achats', 'fait', NULL, 2),
  ('task_002_3', 'doss_002', 'Saisie ventes', 'fait', NULL, 3),
  ('task_002_4', 'doss_002', 'Rapprochement bancaire', 'bloque_client', 'Relevé bancaire Août manquant', 4),
  ('task_002_5', 'doss_002', 'Déclaration TVA mensuelle', 'a_faire', NULL, 5),
  ('task_002_6', 'doss_002', 'Déclaration CNSS mensuelle', 'a_faire', NULL, 6),
  ('task_002_7', 'doss_002', 'Révision balance', 'a_faire', NULL, 7),
  ('task_002_8', 'doss_002', 'Établissement états financiers', 'a_faire', NULL, 8),
  ('task_002_9', 'doss_002', 'Liasse fiscale / déclaration IS', 'a_faire', NULL, 9);

-- Dossier 003 (TECH SOLUTIONS) — 7/9 done
INSERT INTO org_tasks (id, dossier_id, label, status, order_index) VALUES
  ('task_003_1', 'doss_003', 'Réception relevés bancaires', 'fait', 1),
  ('task_003_2', 'doss_003', 'Saisie achats', 'fait', 2),
  ('task_003_3', 'doss_003', 'Saisie ventes', 'fait', 3),
  ('task_003_4', 'doss_003', 'Rapprochement bancaire', 'fait', 4),
  ('task_003_5', 'doss_003', 'Déclaration TVA mensuelle', 'fait', 5),
  ('task_003_6', 'doss_003', 'Déclaration CNSS mensuelle', 'fait', 6),
  ('task_003_7', 'doss_003', 'Révision balance', 'fait', 7),
  ('task_003_8', 'doss_003', 'Établissement états financiers', 'en_cours', 8),
  ('task_003_9', 'doss_003', 'Liasse fiscale / déclaration IS', 'a_faire', 9);

-- Dossier 004 (CONSTRUCTION DELTA) — 1/9, mostly blocked
INSERT INTO org_tasks (id, dossier_id, label, status, blocked_reason, order_index) VALUES
  ('task_004_1', 'doss_004', 'Réception relevés bancaires', 'fait', NULL, 1),
  ('task_004_2', 'doss_004', 'Saisie achats', 'bloque_client', 'Factures fournisseurs Septembre non reçues', 2),
  ('task_004_3', 'doss_004', 'Saisie ventes', 'bloque_client', 'Factures ventes Septembre non reçues', 3),
  ('task_004_4', 'doss_004', 'Rapprochement bancaire', 'a_faire', NULL, 4),
  ('task_004_5', 'doss_004', 'Déclaration TVA mensuelle', 'a_faire', NULL, 5),
  ('task_004_6', 'doss_004', 'Déclaration CNSS mensuelle', 'a_faire', NULL, 6),
  ('task_004_7', 'doss_004', 'Révision balance', 'a_faire', NULL, 7),
  ('task_004_8', 'doss_004', 'Établissement états financiers', 'a_faire', NULL, 8),
  ('task_004_9', 'doss_004', 'Liasse fiscale / déclaration IS', 'a_faire', NULL, 9);

-- Dossier 005 (RESTAURANT LE PALAIS) — 4/9
INSERT INTO org_tasks (id, dossier_id, label, status, order_index) VALUES
  ('task_005_1', 'doss_005', 'Réception relevés bancaires', 'fait', 1),
  ('task_005_2', 'doss_005', 'Saisie achats', 'fait', 2),
  ('task_005_3', 'doss_005', 'Saisie ventes', 'fait', 3),
  ('task_005_4', 'doss_005', 'Rapprochement bancaire', 'fait', 4),
  ('task_005_5', 'doss_005', 'Déclaration TVA mensuelle', 'en_cours', 5),
  ('task_005_6', 'doss_005', 'Déclaration CNSS mensuelle', 'a_faire', 6),
  ('task_005_7', 'doss_005', 'Révision balance', 'a_faire', 7),
  ('task_005_8', 'doss_005', 'Établissement états financiers', 'a_faire', 8),
  ('task_005_9', 'doss_005', 'Liasse fiscale / déclaration IS', 'a_faire', 9);

-- Expected documents (for dossiers with requires_document tasks)
INSERT INTO org_expected_documents (id, dossier_id, task_id, label, received) VALUES
  ('doc_002_1', 'doss_002', 'task_002_1', 'Relevé bancaire Août', 0),
  ('doc_004_1', 'doss_004', 'task_004_1', 'Relevé bancaire Septembre', 1),
  ('doc_004_2', 'doss_004', NULL, 'Factures fournisseurs Septembre', 0),
  ('doc_004_3', 'doss_004', NULL, 'Factures ventes Septembre', 0);

-- Update cached_progress for all dossiers
UPDATE org_dossiers SET cached_progress = (
  SELECT ROUND(CAST(SUM(CASE WHEN t.status = 'fait' THEN 1 ELSE 0 END) AS REAL) * 100.0 / COUNT(*), 1)
  FROM org_tasks t WHERE t.dossier_id = org_dossiers.id
);
