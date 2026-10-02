-- ============================================================
-- 0019 — Statut export des clients + portée export des échéances
-- ============================================================

-- Statut d'export du client (filtre les échéances différemment)
-- NULL (non renseigné) = traité comme 'non_exportatrice'
ALTER TABLE org_clients ADD COLUMN export_status TEXT;
-- 'exportatrice'  : entreprises totalement exportatrices (ETE, art. 69 loi 2017-8)
-- 'semi_exportatrice' : partiellement exportatrices (<80% du CA à l'export)
-- 'non_exportatrice'  : droit commun

-- Portée export d'une échéance : JSON array des statuts concernés, NULL = toutes
ALTER TABLE org_fiscal_alerts ADD COLUMN export_scope TEXT;
-- ex: ["exportatrice"]               → uniquement les ETE (CNSS jour 25, IS 30 juin)
--     ["semi_exportatrice","non_exportatrice"] → droit commun (CNSS jour 15, IS 25 mars)
