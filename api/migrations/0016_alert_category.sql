-- Distinction personne morale / personne physique + mois explicites pour les échéances
ALTER TABLE org_fiscal_alerts ADD COLUMN category TEXT;
ALTER TABLE org_fiscal_alerts ADD COLUMN months TEXT;

-- Purge de l'ancien pack aux dates erronées (reseed correct au prochain GET)
DELETE FROM org_alert_dones WHERE alert_id IN (SELECT id FROM org_fiscal_alerts WHERE created_by_name = 'Type EUREX');
DELETE FROM org_fiscal_alerts WHERE created_by_name = 'Type EUREX';
