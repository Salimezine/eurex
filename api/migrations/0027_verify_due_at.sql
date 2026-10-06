-- ============================================================
-- 0027 : Delai de validation des taches (compte a rebours)
-- ============================================================
-- verify_due_at : date/heure limite (UTC) posee par l'expert/
-- manager (ou 24h auto quand la tache passe a_verifier).
-- ============================================================

ALTER TABLE org_tasks ADD COLUMN verify_due_at TEXT;
