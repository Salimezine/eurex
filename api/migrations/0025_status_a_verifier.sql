-- ============================================================
-- 0025 — org_tasks : ajouter 'a_verifier' au CHECK de status
-- ============================================================
-- SQLite ne permet pas d'ALTERer un CHECK : reconstruction de
-- la table. org_expected_documents référence org_tasks (FK) :
-- on le met de côté, on reconstruit, on le restaure.
-- À exécuter APRÈS 0024 (colonnes verified_by/verified_at).
-- Idempotent-ish : à ne ré-exécuter qu'une fois (après exécution,
-- le CHECK contient déjà a_verifier).
-- ============================================================

CREATE TABLE exp_docs_bak AS SELECT * FROM org_expected_documents;
DROP TABLE org_expected_documents;

CREATE TABLE org_tasks_new (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES org_dossiers(id),
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'a_faire'
    CHECK (status IN ('a_faire','en_cours','fait','bloque_client','a_verifier')),
  blocked_reason TEXT,
  requires_document INTEGER DEFAULT 0,
  updated_by TEXT REFERENCES org_users(id),
  updated_at TEXT DEFAULT (datetime('now')),
  order_index INTEGER DEFAULT 0,
  total_time_seconds INTEGER DEFAULT 0,
  timer_started_at TEXT,
  timer_user_id TEXT,
  assigned_comptable_id TEXT REFERENCES org_users(id),
  month INTEGER,
  due_date TEXT,
  export_scope TEXT,
  verified_by TEXT,
  verified_at TEXT
);
INSERT INTO org_tasks_new SELECT * FROM org_tasks;
DROP TABLE org_tasks;
ALTER TABLE org_tasks_new RENAME TO org_tasks;

CREATE TABLE org_expected_documents (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES org_dossiers(id),
  task_id TEXT REFERENCES org_tasks(id),
  label TEXT NOT NULL,
  received INTEGER DEFAULT 0,
  received_at TEXT,
  received_note TEXT,
  file_r2_key TEXT,
  updated_by TEXT REFERENCES org_users(id)
, url TEXT, file_name TEXT, file_type TEXT, file_size INTEGER)
;
INSERT INTO org_expected_documents SELECT * FROM exp_docs_bak;
DROP TABLE exp_docs_bak;
