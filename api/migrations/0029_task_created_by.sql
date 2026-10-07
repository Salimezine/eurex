-- Trace l'auteur d'une tache ajoutee manuellement via l'application.
-- Les tache generees automatiquement (checklist a l'ouverture du dossier, seed)
-- laissent created_by NULL et n'apparaissent donc pas dans "Nouvelles taches".
ALTER TABLE org_tasks ADD COLUMN created_by TEXT;
