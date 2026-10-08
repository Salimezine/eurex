-- Tâches masquables par dossier (ex. « Reporting mensuel »)
-- hide  = excluded des compteurs / progression / vérification
-- restore = remise à 0 (statuts et heures conservés)
ALTER TABLE org_tasks ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
