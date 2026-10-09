-- ============================================================================
-- EUREX — Schéma PostgreSQL (Supabase) FINAL
-- Généré le 2026-10-09 — source : api/migrations/0001 … 0034 (SQLite)
-- État final après application de TOUTES les migrations (ALTER fusionnés dans
-- les CREATE TABLE, reconstruction 0025 prise en compte).
--
--  · Aucune donnée ici : les seeds/UPDATE/DELETE des migrations sont exclus,
--    les données viendront du dump SQLite.
--  · Tout est idempotent (CREATE ... IF NOT EXISTS) : réexécution sans effet.
--  · Équivalences de types & décisions de conversion : api/supabase/README.md
--
-- Raccourci répété ci-dessous :
--   datetime('now') sur colonne TEXT  ->  to_char(now() AT TIME ZONE 'UTC',
--                                          'YYYY-MM-DD HH24:MI:SS')
--   (now() brut renvoie timestamptz, non coercible en TEXT : voir README §1)
-- ============================================================================

-- ============================================================================
-- A. COMPTABILITÉ — 0001_init
-- ============================================================================
CREATE TABLE IF NOT EXISTS societes (
  id TEXT PRIMARY KEY,
  raison_sociale TEXT NOT NULL,
  matricule_fiscal TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS journaux (
  id TEXT PRIMARY KEY,
  societe_id TEXT NOT NULL,
  code TEXT NOT NULL,
  libelle TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dossiers (
  id TEXT PRIMARY KEY,
  societe_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  statut TEXT DEFAULT 'brouillon',
  nb_pieces BIGINT DEFAULT 0,
  nb_ecritures BIGINT DEFAULT 0,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS pieces (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  societe_id TEXT NOT NULL,
  nom_fichier TEXT NOT NULL,
  chemin TEXT,
  date_document TEXT,
  numero_facture TEXT,
  tiers TEXT,
  montant_ht DOUBLE PRECISION DEFAULT 0,
  montant_tva DOUBLE PRECISION DEFAULT 0,
  montant_ttc DOUBLE PRECISION DEFAULT 0,
  mode_reglement TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS ecritures (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  societe_id TEXT NOT NULL,
  journal_code TEXT NOT NULL,
  date_operation TEXT NOT NULL,
  date_piece TEXT,
  numero_doc TEXT,
  libelle TEXT NOT NULL,
  compte TEXT NOT NULL,
  sens TEXT NOT NULL,
  montant DOUBLE PRECISION NOT NULL,
  tresorerie TEXT,
  statut TEXT DEFAULT 'brouillon',
  piece_id TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS factures (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  societe_id TEXT NOT NULL,
  date_facture TEXT NOT NULL,
  numero_facture TEXT NOT NULL,
  client TEXT,
  total_ht_0 DOUBLE PRECISION DEFAULT 0,
  total_ht_19 DOUBLE PRECISION DEFAULT 0,
  tva_19 DOUBLE PRECISION DEFAULT 0,
  timbre DOUBLE PRECISION DEFAULT 1,
  total_ttc DOUBLE PRECISION DEFAULT 0,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS rapport_modes (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  date_jour TEXT NOT NULL,
  especes DOUBLE PRECISION DEFAULT 0,
  cheques DOUBLE PRECISION DEFAULT 0,
  tpe DOUBLE PRECISION DEFAULT 0,
  bonsAchat DOUBLE PRECISION DEFAULT 0,
  avoir DOUBLE PRECISION DEFAULT 0,
  credit DOUBLE PRECISION DEFAULT 0,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (dossier_id, date_jour)
);

-- ============================================================================
-- B. BAUD — paie automatisée (0002, 0003, 0004, 0018)
-- ============================================================================
CREATE TABLE IF NOT EXISTS societes_paie (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  matricule_fiscal TEXT,
  activite TEXT,
  sage_code_dossier TEXT,
  sage_debut_exercice TEXT,
  navette_format_notes TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  forme_juridique TEXT
);

CREATE TABLE IF NOT EXISTS rubriques_paie (
  id TEXT PRIMARY KEY,
  societe_id TEXT NOT NULL REFERENCES societes_paie(id),
  code TEXT NOT NULL,
  libelle TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rubrique', 'constante')),
  zone TEXT DEFAULT '0',
  navette_aliases TEXT,
  valeur_defaut DOUBLE PRECISION,
  ordre BIGINT DEFAULT 0,
  actif BIGINT DEFAULT 1,
  UNIQUE (societe_id, code)
);

CREATE TABLE IF NOT EXISTS salaries_paie (
  id TEXT PRIMARY KEY,
  societe_id TEXT NOT NULL REFERENCES societes_paie(id),
  matricule TEXT NOT NULL,
  nom TEXT NOT NULL,
  prenom TEXT,
  civilite TEXT CHECK (civilite IN ('0','1','2')),
  date_naissance TEXT,
  date_embauche TEXT,
  poste TEXT,
  type_contrat TEXT,
  statut TEXT DEFAULT 'actif' CHECK (statut IN ('actif','sorti')),
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE (societe_id, matricule)
);

CREATE TABLE IF NOT EXISTS dossiers_paie (
  id TEXT PRIMARY KEY,
  societe_id TEXT NOT NULL REFERENCES societes_paie(id),
  mois BIGINT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  annee BIGINT NOT NULL,
  statut TEXT DEFAULT 'brouillon' CHECK (statut IN (
    'brouillon','extraction','controle','valide','exporte'
  )),
  fichier_navette_nom TEXT,
  extraction_json TEXT,
  extraction_confiance DOUBLE PRECISION,
  extraction_log TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  nom TEXT,
  UNIQUE (societe_id, mois, annee)
);

CREATE TABLE IF NOT EXISTS lignes_extraites (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossiers_paie(id),
  salary_id TEXT REFERENCES salaries_paie(id),
  matricule TEXT,
  nom_prenom TEXT,
  type_ligne TEXT NOT NULL CHECK (type_ligne IN (
    'mouvement','variable','prime','retenue','constante'
  )),
  champs TEXT NOT NULL,
  rubrique_code TEXT,
  zone TEXT,
  valeur DOUBLE PRECISION,
  source_feuille TEXT,
  source_plage TEXT,
  statut TEXT DEFAULT 'extrait' CHECK (statut IN (
    'extrait','valide','modifie','ignore'
  )),
  confiance DOUBLE PRECISION,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS imports_ga (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossiers_paie(id),
  type_import TEXT NOT NULL CHECK (type_import IN ('salaries','variables')),
  fichier_nom TEXT,
  fichier_base64 TEXT,
  nb_lignes BIGINT,
  statut TEXT DEFAULT 'genere' CHECK (statut IN ('genere','telecharge')),
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

-- 0003 — apprentissage IA depuis corrections utilisateur
CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY,
  societe_id TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('matricule','rubrique_code','zone','valeur','nom_prenom')),
  old_value TEXT,
  new_value TEXT NOT NULL,
  source_pattern TEXT,
  context TEXT,
  hit_count BIGINT DEFAULT 0,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

-- ============================================================================
-- C. SCANFLASH (0005, 0006)
-- ============================================================================
CREATE TABLE IF NOT EXISTS societes_scan (
  id TEXT PRIMARY KEY,
  raison_sociale TEXT NOT NULL,
  matricule_fiscal TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS dossiers_scan (
  id TEXT PRIMARY KEY,
  societe_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  mois BIGINT NOT NULL,
  annee BIGINT NOT NULL,
  statut TEXT DEFAULT 'brouillon',
  nb_pieces BIGINT DEFAULT 0,
  nb_ecritures BIGINT DEFAULT 0,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS factures_scan (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  numero TEXT,
  date_facture TEXT,
  client TEXT,
  compte_client TEXT,
  total_ht_0 DOUBLE PRECISION DEFAULT 0,
  total_ht_19 DOUBLE PRECISION DEFAULT 0,
  tva_19 DOUBLE PRECISION DEFAULT 0,
  fodec DOUBLE PRECISION DEFAULT 0,
  timbre DOUBLE PRECISION DEFAULT 0,
  total_ttc DOUBLE PRECISION DEFAULT 0,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  code_client TEXT,
  is_avoir BIGINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ecritures_scan (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  numero_doc TEXT,
  date_operation TEXT,
  journal_code TEXT DEFAULT 'VT',
  compte TEXT NOT NULL,
  libelle TEXT,
  sens TEXT NOT NULL CHECK (sens IN ('D', 'C')),
  montant DOUBLE PRECISION NOT NULL,
  page BIGINT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

-- ============================================================================
-- D. MODULE ORGANIZATIONS (0007 → 0034)
-- ============================================================================
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  last_rollover_year BIGINT
);

CREATE TABLE IF NOT EXISTS org_users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('expert','comptable')),
  must_change_password BIGINT DEFAULT 0,
  is_active BIGINT DEFAULT 1,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  role_label TEXT,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS org_clients (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  assigned_comptable_id TEXT REFERENCES org_users(id),
  societe_id TEXT,
  name TEXT NOT NULL,
  matricule_fiscal TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  person_type TEXT,
  export_status TEXT
);

CREATE TABLE IF NOT EXISTS org_dossiers (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES org_clients(id),
  exercice BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours','cloture')),
  cached_progress DOUBLE PRECISION DEFAULT 0,
  opened_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  closed_at TEXT,
  closed_by TEXT REFERENCES org_users(id),
  UNIQUE (client_id, exercice)
);

CREATE TABLE IF NOT EXISTS org_tasks (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES org_dossiers(id),
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'a_faire'
    CHECK (status IN ('a_faire','en_cours','fait','bloque_client','a_verifier')),
  blocked_reason TEXT,
  requires_document BIGINT DEFAULT 0,
  updated_by TEXT REFERENCES org_users(id),
  updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  order_index BIGINT DEFAULT 0,
  total_time_seconds BIGINT DEFAULT 0,
  timer_started_at TEXT,
  timer_user_id TEXT,
  assigned_comptable_id TEXT REFERENCES org_users(id),
  month BIGINT,
  due_date TEXT,
  export_scope TEXT,
  verified_by TEXT,
  verified_at TEXT,
  verify_due_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  done_by TEXT,
  hidden BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS org_expected_documents (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES org_dossiers(id),
  task_id TEXT REFERENCES org_tasks(id),
  label TEXT NOT NULL,
  received BIGINT DEFAULT 0,
  received_at TEXT,
  received_note TEXT,
  file_r2_key TEXT,
  updated_by TEXT REFERENCES org_users(id),
  url TEXT,
  file_name TEXT,
  file_type TEXT,
  file_size BIGINT
);

CREATE TABLE IF NOT EXISTS org_task_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  label TEXT NOT NULL,
  order_index BIGINT DEFAULT 0,
  requires_document BIGINT DEFAULT 0,
  assigned_comptable_id TEXT REFERENCES org_users(id),
  frequency TEXT NOT NULL DEFAULT 'annuelle',
  export_scope TEXT,
  month BIGINT,
  client_id TEXT
);

CREATE TABLE IF NOT EXISTS org_audit_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS org_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES org_users(id),
  dossier_id TEXT,
  message TEXT NOT NULL,
  read BIGINT DEFAULT 0,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS org_notes (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES org_dossiers(id),
  user_id TEXT NOT NULL REFERENCES org_users(id),
  user_name TEXT,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS org_fiscal_deadlines (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES org_clients(id),
  type TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT DEFAULT 'a_faire' CHECK (status IN ('a_faire','fait','en_retard')),
  dossier_id TEXT REFERENCES org_dossiers(id)
);

CREATE TABLE IF NOT EXISTS org_reminders_log (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  document_id TEXT,
  sent_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  channel TEXT CHECK (channel IN ('email','sms'))
);

-- 0008 — pointage temps
CREATE TABLE IF NOT EXISTS org_time_entries (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  duration_seconds BIGINT DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  note TEXT
);

-- 0014 / 0015 / 0016 / 0019 — échéances fiscales
CREATE TABLE IF NOT EXISTS org_fiscal_alerts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  lead_days BIGINT NOT NULL DEFAULT 7,
  dossier_id TEXT REFERENCES org_dossiers(id),
  note TEXT,
  done BIGINT NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES org_users(id),
  created_by_name TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  recurrence TEXT,
  category TEXT,
  months TEXT,
  export_scope TEXT
);

CREATE TABLE IF NOT EXISTS org_alert_dones (
  alert_id TEXT NOT NULL REFERENCES org_fiscal_alerts(id),
  due_date TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  PRIMARY KEY (alert_id, due_date)
);

-- 0028 — grants d'accès ponctuels à un dossier
CREATE TABLE IF NOT EXISTS org_dossier_grants (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  granted_to TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  reason TEXT,
  days BIGINT NOT NULL DEFAULT 7,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  revoked_at TEXT
);

-- 0030 — collaboration sur une tâche (PK composite)
CREATE TABLE IF NOT EXISTS org_task_collaborators (
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT,
  created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (task_id, user_id)
);

-- ============================================================================
-- INDEX (0001, 0002, 0003, 0007, 0008, 0009, 0010, 0014, 0028, 0030, 0032, 0034)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ecritures_dossier ON ecritures(dossier_id);
CREATE INDEX IF NOT EXISTS idx_ecritures_journal ON ecritures(dossier_id, journal_code);
CREATE INDEX IF NOT EXISTS idx_factures_dossier ON factures(dossier_id);
CREATE INDEX IF NOT EXISTS idx_rapport_dossier ON rapport_modes(dossier_id);
CREATE INDEX IF NOT EXISTS idx_pieces_dossier ON pieces(dossier_id);

CREATE INDEX IF NOT EXISTS idx_baud_salaries_societe ON salaries_paie(societe_id);
CREATE INDEX IF NOT EXISTS idx_baud_salaries_matricule ON salaries_paie(societe_id, matricule);
CREATE INDEX IF NOT EXISTS idx_baud_dossiers_societe ON dossiers_paie(societe_id);
CREATE INDEX IF NOT EXISTS idx_baud_lignes_dossier ON lignes_extraites(dossier_id);
CREATE INDEX IF NOT EXISTS idx_baud_rubriques_societe ON rubriques_paie(societe_id);

CREATE INDEX IF NOT EXISTS idx_corrections_societe ON corrections(societe_id, field);

CREATE INDEX IF NOT EXISTS idx_org_users_org ON org_users(organization_id);
-- doublon partiel de l'UNIQUE (email) : conservé tel quel (fidélité aux migrations)
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

CREATE INDEX IF NOT EXISTS idx_time_entries_dossier ON org_time_entries(dossier_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task ON org_time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON org_time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_active ON org_time_entries(task_id, stopped_at) WHERE stopped_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_task_templates_assigned ON org_task_templates(assigned_comptable_id);
CREATE INDEX IF NOT EXISTS idx_org_tasks_assigned ON org_tasks(assigned_comptable_id);

CREATE INDEX IF NOT EXISTS idx_org_tasks_month ON org_tasks(dossier_id, month);

CREATE INDEX IF NOT EXISTS idx_fiscal_alerts_org ON org_fiscal_alerts(organization_id, due_date);

CREATE INDEX IF NOT EXISTS idx_grants_to ON org_dossier_grants(granted_to);
CREATE INDEX IF NOT EXISTS idx_grants_dossier ON org_dossier_grants(dossier_id);

CREATE INDEX IF NOT EXISTS idx_task_collab_user ON org_task_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_task_collab_task ON org_task_collaborators(task_id);

-- 0032 : redondant avec UNIQUE (client_id, exercice) — conservé tel quel
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_dossiers_client_exercice ON org_dossiers(client_id, exercice);

CREATE INDEX IF NOT EXISTS idx_org_task_templates_client ON org_task_templates(client_id);
