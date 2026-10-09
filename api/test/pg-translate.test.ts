// Tests du traducteur SQLite -> PostgreSQL (node --test, sans dependance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPg } from '../src/pg/translate.ts';

test("datetime('now') simple", () => {
  const out = toPg("UPDATE org_dossiers SET status = 'cloture', closed_at = datetime('now') WHERE id = ?");
  assert.equal(
    out,
    "UPDATE org_dossiers SET status = 'cloture', closed_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1",
  );
});

test("datetime('now','-60 seconds') et placeholders multiples", () => {
  const out = toPg(
    "UPDATE org_users SET last_seen_at = datetime('now') WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now','-60 seconds'))",
  );
  assert.equal(
    out,
    "UPDATE org_users SET last_seen_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < to_char(now() AT TIME ZONE 'UTC' + interval '-60 seconds', 'YYYY-MM-DD HH24:MI:SS'))",
  );
});

test("datetime('now','start of day','-60 minutes') : modificateurs en chaine", () => {
  const out = toPg("SELECT user_id FROM org_time_entries WHERE started_at >= datetime('now','start of day','-60 minutes')");
  assert.equal(
    out,
    "SELECT user_id FROM org_time_entries WHERE started_at >= to_char(date_trunc('day', now() AT TIME ZONE 'UTC') + interval '-60 minutes', 'YYYY-MM-DD HH24:MI:SS')",
  );
});

test("datetime('now', ?) : modificateur lie", () => {
  const out = toPg("INSERT INTO org_time_entries (id, started_at) VALUES (?, datetime('now', ?))");
  assert.equal(
    out,
    "INSERT INTO org_time_entries (id, started_at) VALUES ($1, to_char(now() AT TIME ZONE 'UTC' + ($2)::interval, 'YYYY-MM-DD HH24:MI:SS'))",
  );
});

test("datetime('now', '-' || ? || ' days') : concat de lie", () => {
  const out = toPg("SELECT id FROM org_tasks WHERE t.created_at >= datetime('now', '-' || ? || ' days')");
  assert.equal(
    out,
    "SELECT id FROM org_tasks WHERE t.created_at >= to_char(now() AT TIME ZONE 'UTC' + ('-' || $1 || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS')",
  );
});

test("datetime(col, '+60 minutes') : sur colonne TEXT", () => {
  const out = toPg("SELECT date(datetime(te.started_at, '+60 minutes')) as d FROM org_time_entries te");
  assert.equal(
    out,
    "SELECT to_char((NULLIF(to_char(NULLIF(te.started_at, '')::timestamp + interval '60 minutes', 'YYYY-MM-DD HH24:MI:SS'), '')::timestamp)::date, 'YYYY-MM-DD') as d FROM org_time_entries te",
  );
});

test("datetime(?, '+1 year') : premier argument lie", () => {
  const out = toPg("SELECT * FROM org_time_entries WHERE started_at < datetime(?, '+1 year')");
  assert.equal(
    out,
    "SELECT * FROM org_time_entries WHERE started_at < to_char(NULLIF($1, '')::timestamp + interval '1 year', 'YYYY-MM-DD HH24:MI:SS')",
  );
});

test("date(?, '+' || COALESCE(a.lead_days, 7) || ' days') : mod non litteral", () => {
  const out = toPg("SELECT id FROM org_fiscal_alerts a WHERE a.due_date <= date(?, '+' || COALESCE(a.lead_days, 7) || ' days')");
  assert.equal(
    out,
    "SELECT id FROM org_fiscal_alerts a WHERE a.due_date <= to_char((NULLIF($1, '')::timestamp + ('+' || COALESCE(a.lead_days, 7) || ' days')::interval)::date, 'YYYY-MM-DD')",
  );
});

test("strftime('%Y'/'%m', datetime(col, '+60 minutes'))", () => {
  const out = toPg("SELECT id FROM org_time_entries WHERE strftime('%Y', datetime(te.started_at, '+60 minutes')) = ? AND strftime('%m', datetime(te.started_at, '+60 minutes')) = ?");
  assert.equal(
    out,
    "SELECT id FROM org_time_entries WHERE to_char((to_char(NULLIF(te.started_at, '')::timestamp + interval '60 minutes', 'YYYY-MM-DD HH24:MI:SS'))::timestamp, 'YYYY') = $1 AND to_char((to_char(NULLIF(te.started_at, '')::timestamp + interval '60 minutes', 'YYYY-MM-DD HH24:MI:SS'))::timestamp, 'MM') = $2",
  );
});

test("INSERT OR REPLACE : ON CONFLICT sur PK", () => {
  const out = toPg(
    "INSERT OR REPLACE INTO rapport_modes (id, dossier_id, date_jour, especes, cheques, tpe, bonsAchat, avoir, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  assert.equal(
    out,
    "INSERT INTO rapport_modes (id, dossier_id, date_jour, especes, cheques, tpe, bonsAchat, avoir, credit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
    + " ON CONFLICT (id) DO UPDATE SET dossier_id = EXCLUDED.dossier_id, date_jour = EXCLUDED.date_jour, especes = EXCLUDED.especes, cheques = EXCLUDED.cheques, tpe = EXCLUDED.tpe, bonsAchat = EXCLUDED.bonsAchat, avoir = EXCLUDED.avoir, credit = EXCLUDED.credit",
  );
});

test("INSERT OR REPLACE : PK composite org_alert_dones", () => {
  const out = toPg(
    "INSERT OR REPLACE INTO org_alert_dones (alert_id, due_date, organization_id) VALUES (?, ?, ?)",
  );
  assert.equal(
    out,
    "INSERT INTO org_alert_dones (alert_id, due_date, organization_id) VALUES ($1, $2, $3)"
    + " ON CONFLICT (alert_id, due_date) DO UPDATE SET organization_id = EXCLUDED.organization_id",
  );
});

test("INSERT OR IGNORE : DO NOTHING sans cible", () => {
  const out = toPg("INSERT OR IGNORE INTO org_notifications (id, user_id, dossier_id, message) VALUES (?, ?, ?, ?)");
  assert.equal(
    out,
    "INSERT INTO org_notifications (id, user_id, dossier_id, message) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
  );
});

test("LIKE -> ILIKE (litteral et lie), ILIKE existant non touche", () => {
  const out = toPg("SELECT id FROM org_dossier_grants WHERE reason LIKE 'Collaboration%' AND dossier_id ILIKE ?");
  assert.equal(
    out,
    "SELECT id FROM org_dossier_grants WHERE reason ILIKE 'Collaboration%' AND dossier_id ILIKE $1",
  );
});

test("? hors litteraux seulement : un '?' dans une string ne compte pas", () => {
  const out = toPg("SELECT id FROM t WHERE a = ? AND b = 'x?y' AND c = ? AND d LIKE '%?%'");
  assert.equal(
    out,
    "SELECT id FROM t WHERE a = $1 AND b = 'x?y' AND c = $2 AND d ILIKE '%?%'",
  );
});

test("sqlite_master -> information_schema", () => {
  const out = toPg(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB 'd1_*' AND name NOT GLOB '_cf_*' ORDER BY name",
  );
  assert.equal(
    out,
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE 'pg\\_%' ORDER BY table_name",
  );
});

test("commentaires SQL preserves, ? des commentaires ignores", () => {
  const out = toPg("SELECT id FROM t -- WHERE x = ?\nWHERE y = ?");
  assert.equal(out, "SELECT id FROM t -- WHERE x = ?\nWHERE y = $1");
});

test("requete sans specificite : seule la numerotation change", () => {
  const out = toPg("SELECT * FROM org_clients WHERE organization_id = ? AND name LIKE ? ORDER BY name LIMIT 10");
  assert.equal(out, "SELECT * FROM org_clients WHERE organization_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 10");
});

test("erreur : modificateur datetime SQLite inconnu", () => {
  assert.throws(
    () => toPg("SELECT datetime('now', 'weekday 1')"),
    /modificateur datetime SQLite non traduit/,
  );
});

test("erreur : INSERT OR REPLACE sur table sans PK connue", () => {
  assert.throws(
    () => toPg("INSERT OR REPLACE INTO inconnue (id, x) VALUES (?, ?)"),
    /PK inconnue/,
  );
});

test("erreur : strftime format inconnu", () => {
  assert.throws(
    () => toPg("SELECT strftime('%s', started_at) FROM t"),
    /format non traduit/,
  );
});

test("paramOffset : numerotation demarre a un offset", () => {
  const out = toPg("SELECT id FROM t WHERE a = ?", { paramOffset: 2 });
  assert.equal(out, "SELECT id FROM t WHERE a = $3");
});

test("strptime non utilise mais datetime imbrique dans date ne double pas", () => {
  const out = toPg("SELECT date(datetime(id, '+1 month'), '+2 days') FROM t");
  assert.equal(
    out,
    "SELECT to_char((NULLIF(to_char(NULLIF(id, '')::timestamp + interval '1 month', 'YYYY-MM-DD HH24:MI:SS'), '')::timestamp + interval '2 days')::date, 'YYYY-MM-DD') FROM t",
  );
});
