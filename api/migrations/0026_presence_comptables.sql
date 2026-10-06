-- ============================================================
-- 0026 : Presence comptables — colonne last_seen_at
-- ============================================================
-- Maj par verifyOrgToken (throttle 60s) sur chaque requete
-- authentifiee. Sert au statut "connecte" (expert) et au
-- calcul des heures pointees du jour (norme 8h30).
-- ============================================================

ALTER TABLE org_users ADD COLUMN last_seen_at TEXT;
