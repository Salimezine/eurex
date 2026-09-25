-- Type de client : personne physique ou personne morale (filtre les échéances du dossier)
ALTER TABLE org_clients ADD COLUMN person_type TEXT;
