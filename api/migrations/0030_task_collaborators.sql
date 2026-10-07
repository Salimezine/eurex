-- Collaboration sur une tache : un comptable qui a acces au dossier peut "taguer"
-- un autre comptable sur une tache. Le comptable tague recoit automatiquement un
-- acces temporaire (renfort) au dossier et chronometre/saisit sa part des heures.
CREATE TABLE IF NOT EXISTS org_task_collaborators (
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_collab_user ON org_task_collaborators (user_id);
CREATE INDEX IF NOT EXISTS idx_task_collab_task ON org_task_collaborators (task_id);
