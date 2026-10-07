-- Depots AP rattaches a un mois precis (AP1 = juin, AP2 = septembre, AP3 = decembre)
-- au lieu du classement "annuel" (sans mois).
ALTER TABLE org_task_templates ADD COLUMN month INTEGER;

UPDATE org_task_templates SET month = 6 WHERE label = 'Dépôt AP 1';
UPDATE org_task_templates SET month = 9 WHERE label = 'Dépôt AP 2';
UPDATE org_task_templates SET month = 12 WHERE label = 'Dépôt AP 3';

-- Dossiers existants : les 3 taches sont replacees dans leur mois
UPDATE org_tasks SET month = 6 WHERE label = 'Dépôt AP 1' AND month IS NULL;
UPDATE org_tasks SET month = 9 WHERE label = 'Dépôt AP 2' AND month IS NULL;
UPDATE org_tasks SET month = 12 WHERE label = 'Dépôt AP 3' AND month IS NULL;
