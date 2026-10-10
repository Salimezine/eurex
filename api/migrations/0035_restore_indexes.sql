-- ============================================================
-- 0035 -- restauration des 6 index perdus par 0025
-- ============================================================
-- La migration 0025 a reconstruit org_tasks et org_expected_documents
-- (SQLite ne sait pas ALTERer un CHECK) : DROP TABLE + CREATE TABLE
-- effacent les index de la table, et 0025 ne les a pas recrees.
-- Resultat observe en production le 2026-10-10 : les requetes
-- WHERE dossier_id = ? faisaient un SCAN complet de org_tasks
-- (11,28M lignes lues par requete) et ont epuise en une matinee le
-- quota gratuit de D1 (5M lignes lues par jour) — l'application est
-- reste down jusqu'au lendemain 00:00 UTC.
--
-- Ces 6 index etaient deja restaures manuellement en prod (35/41 puis
-- 41/41). Cette migration les versionne : une installation neuve qui
-- repasserait par 0025 les perdrait a nouveau.
--
-- Idempotent (IF NOT EXISTS) : re-executable sans risque, y compris
-- sur une base ou les index sont deja presents.
-- ============================================================

-- Tables reconstruites par 0025
CREATE INDEX IF NOT EXISTS idx_org_tasks_dossier ON org_tasks(dossier_id);
CREATE INDEX IF NOT EXISTS idx_org_tasks_status ON org_tasks(dossier_id, status);
CREATE INDEX IF NOT EXISTS idx_org_tasks_assigned ON org_tasks(assigned_comptable_id);
CREATE INDEX IF NOT EXISTS idx_org_tasks_month ON org_tasks(dossier_id, month);

CREATE INDEX IF NOT EXISTS idx_org_expected_docs_dossier ON org_expected_documents(dossier_id);
CREATE INDEX IF NOT EXISTS idx_org_expected_docs_received ON org_expected_documents(dossier_id, received);
