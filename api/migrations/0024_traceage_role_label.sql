-- ============================================================
-- 0024 — Colonnes traçabilité/vérification + role_label
-- ============================================================
-- !! BASE PROD UNIQUEMENT : ces 4 colonnes ont été ajoutées en prod
--    le 02/10/2026 par commande directe. Ce fichier sert aux bases
--    FRAÎCHEMENT créées (chaîne de migrations complète).
--    NE PAS l'exécuter sur la prod actuelle (duplicate column).
-- ============================================================
ALTER TABLE org_tasks ADD COLUMN verified_by TEXT;
ALTER TABLE org_tasks ADD COLUMN verified_at TEXT;
ALTER TABLE org_time_entries ADD COLUMN note TEXT;
ALTER TABLE org_users ADD COLUMN role_label TEXT;
