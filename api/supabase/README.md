# EUREX — Migration SQLite → Supabase (PostgreSQL)

- **`schema.sql`** : schéma PostgreSQL **final**, généré le **2026-10-09** à partir de
  `api/migrations/0001_init.sql … 0034_template_client.sql` (SQLite), toutes
  migrations fusionnées en un état unique.
- Le fichier est **idempotent** (`CREATE … IF NOT EXISTS`) : on peut le relancer.
- **Aucune donnée** dans `schema.sql` (seeds et `UPDATE`/`DELETE` des migrations
  exclus) → les données viennent du **dump SQLite**, importées à part.

---

## 1. Comment appliquer

### Option A — SQL Editor (recommandé)
1. Supabase Dashboard → **SQL Editor** → **New query**.
2. Coller tout le contenu de `api/supabase/schema.sql`.
3. **Run**. Supabase exécute le script dans une transaction : soit tout passe,
   soit rien n'est créé (voir logs en bas de l'éditeur).
4. Vérifier avec `select count(*) from information_schema.tables where table_schema='public';`
   → **35** tables.

### Option B — psql
```bash
psql "$SUPABASE_DB_URL" -f api/supabase/schema.sql
```

### Ensuite : les données
1. **Générer** le fichier d'import depuis la base locale :
   ```bash
   node api/supabase/import.ts            # -> api/supabase/data.sql (gitignoré)
   ```
   Options : `--out fichier.sql`, `--batch 100` (lignes/INSERT), `--no-replica`
   (ne pas désactiver les FK pendant l'import).
   Le script lit l'ordre FK et les colonnes cibles depuis `schema.sql`, signale
   toute colonne SQLite absente du schéma (et l'inverse) — **ne pas ignorer ces
   avertissements**, ce sont des écarts schéma/production.
2. **Appliquer** dans l'ordre : `schema.sql` puis `data.sql` (SQL Editor ou psql).
   `data.sql` démarre par `BEGIN; SET LOCAL session_replication_role = replica;`
   → les FK ne sont pas vérifiées pendant l'import (SQLite ne les vérifiait pas
   non plus ; détecte donc d'éventuelles orphelines sans les masquer :
   elles restent trouvables après coup avec une requête anti-jointe).
   ⚠️ `session_replication_role` requiert un rôle élevé (`postgres` de Supabase
   convient) — en cas de refus, relancer avec `--no-replica` et corriger les
   orphelines éventuelles signalées à l'import.

---

## 2. Écarts / décisions de conversion

| # | Sujet | Décision |
|---|-------|----------|
| 1 | `DEFAULT (datetime('now'))` sur colonne `TEXT` | → `to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')` |
| 2 | `INTEGER` | → `BIGINT` |
| 3 | `REAL` | → `DOUBLE PRECISION` |
| 4 | `TEXT` / clés `TEXT PRIMARY KEY` | → `TEXT` (inchangé) |
| 5 | `INTEGER PRIMARY KEY AUTOINCREMENT` | **aucun dans le schéma** (cf. §4) |
| 6 | `PRAGMA`, `BEGIN/COMMIT` | supprimés |
| 7 | `UNIQUE(a,b)` | conservé (`table constraint`) |
| 8 | Index | conservés, `IF NOT EXISTS` ajouté partout |
| 9 | FK | conservées telles quelles, **aucune `DEFERRABLE` nécessaire** (cf. §3) |
| 10 | `BLOB` / `NUMERIC` | colonnes absentes du schéma (rien à convertir) |
| 11 | Triggers / vues / virtual tables / séquences | **aucun** dans les 34 migrations |
| 12 | Données des migrations | **exclues** du `schema.sql` |

### 1. `datetime('now')` sur colonne `TEXT` — pourquoi pas `now()` nu
`now()` renvoie `timestamptz`, alors que la colonne est `TEXT` : PostgreSQL refuse
la coercion automatique en contexte d'affectation pour un *default*
(`default for column "created_at" cannot be cast automatically to type text`).
L'expression écrite produit **exactement** le format SQLite `datetime('now')`
(`2026-10-09 14:23:45`, en UTC), indispensable car l'appareil applicatif compare
les dates **lexicographiquement** (`ORDER BY created_at`,
`created_at >= datetime('now','-7 days')`) et existait déjà en SQLite dans ce format.
> Variante acceptable : `(now() AT TIME ZONE 'UTC')::text` (format avec micros +00),
> mais mélange les formats avec les lignes importées depuis SQLite.

### 2. Types
- `INTEGER` → `BIGINT` : SQLite stocke des entiers **signés 64 bits**, `BIGINT` est
  donc sans risque de dépassement. (Alternative `INTEGER` 32 bits acceptée aussi :
  aucune colonne ne contient de gros identifiants.)
- `REAL` → `DOUBLE PRECISION` (même sémantique que SQLite `REAL`).
- Colonnes `DEFAULT 0 / '0' / 'brouillon' / 'annuelle' …` : conservées telles quelles
  (cast implicite `integer → double precision` accepté pour `DOUBLE PRECISION DEFAULT 0`).

---

## 3. Clés étrangères

27 `REFERENCES`, **toutes vers une colonne `id` `PRIMARY KEY`** :
`org_users(9)`, `org_dossiers(5)`, `societes_paie(3)`, `organizations(3)`,
`org_clients(2)`, `dossiers_paie(2)`, `org_fiscal_alerts(1)`, `org_tasks(1)`,
`salaries_paie(1)`.

→ **Aucun cas « FK vers une colonne non unique »** : `DEFERRABLE INITIALLY DEFERRED`
n'est donc **pas** nécessaire (au contraire, PostgreSQL *rejetterait* une FK vers une
colonnes non unique, même deferred — ce cas ne se présente pas ici).

⚠️ Points d'attention :
- SQLite ne **déployait** pas ces FK (pas de `PRAGMA foreign_keys=ON`) → des données
  orphelines peuvent exister dans le dump. Voir §1 « Ensuite : les données ».
- `org_alert_dones.alert_id → org_fiscal_alerts(id)` fait partie de la PK composite
  `(alert_id, due_date)` mais référence bien la colonne unique `id` : valide en PG.
- `org_clients.societe_id`, `org_audit_log.organization_id/user_id/target_id`,
  `org_reminders_log.dossier_id/document_id`, `org_time_entries.dossier_id/task_id/user_id`,
  `org_dossier_grants.*`, `org_task_collaborators.*`, `org_tasks.done_by`,
  `org_task_templates.client_id`, `org_fiscal_alerts.organization_id` :
  **pas de FK déclarée dans les migrations** → volontairement laissées libres.

---

## 4. Identifiants auto-incrémentés

Aucune table n'utilise `INTEGER PRIMARY KEY AUTOINCREMENT` : **toutes les PK sont
`TEXT` générées par le code applicatif** (`crypto.randomUUID()` / `genId()`, et
`lower(hex(randomblob(16)))` dans les seeds de migrations).
Contrôle effectué : tous les `INSERT` du code fournissent la colonne `id`, sauf
`org_task_collaborators` qui a une PK composite `(task_id, user_id)`.
→ **Aucune colonne `GENERATED ALWAYS AS IDENTITY`** n'a été créée.

---

## 5. Cas ambigus rencontrés et arbitrages

| Cas | Décision |
|-----|----------|
| **`org_tasks.done_by`** : utilisée par l'app (`api/src/index.ts` :2587, :3078) mais **absente des 34 migrations** (ajoutée en prod par commande directe, comme les colonnes de 0024) | **Ajoutée** au schéma (`TEXT`, sans FK, cohérent avec `verified_by`/`created_by`) — sans elle, les requêtes applicatives échoueraient |
| **`org_tasks.created_at`** : même cas (colonne prod en directe) — pourtant utilisée par tous les `INSERT`/`SELECT … ORDER BY created_at` de l'app (`index.ts` :176, :2420, :2892, :3188, :4182…) | **Ajoutée** au schéma (`TEXT DEFAULT` UTC format SQLite, comme les autres `created_at`) — détectée par `import.ts` (écart colonne SQLite ↔ schema.sql) |
| Colonnes `notes` **et** `note` sur `org_time_entries` (0008 + 0024) | Les **2 conservées** ; l'app n'utilise que `note` (`SELECT te.note`), `notes` est un résidu |
| 0025 reconstruit `org_tasks`/`org_expected_documents` (backup `exp_docs_bak`) | Reconstruction fusionnée dans les `CREATE TABLE` finaux ; table temp `exp_docs_bak` **exclue** |
| 0024 : 4 colonnes ajoutées en prod « par commande directe », et 0023 les utilise **avant** 0024 dans l'ordre des fichiers | Colonnes **présentes** dans le schéma final (`verified_by`, `verified_at`, `note`, `role_label`). À noter : sur une base neuve, rejouer 0023 avant 0024 casserait — sans objet avec ce schéma unique |
| `org_fiscal_alerts` (0014) et son index créés **sans** `IF NOT EXISTS` | `IF NOT EXISTS` ajouté (comme partout) |
| Index redondants : `idx_org_users_email` (doublon de `UNIQUE(email)`), `idx_org_dossiers_client_exercice` (0032, doublon de `UNIQUE(client_id, exercice)` de 0007) | **Conservés** (fidélité aux migrations ; PG l'accepte, coût : un index de plus) |
| `rapport_modes.bonsAchat` (camelCase) | Conservé **non quoté** → PG le plie en `bonsachat`, exactement comme le fait le SQL de l'app non quoté : cohérent. ⚠️ À l'import du dump, matcher les colonnes sans tenir compte de la casse |
| Colonnes sans `DEFAULT` ajoutées par `ALTER` (38 `ADD COLUMN` : `forme_juridique`, `person_type`, `export_status`, `month`, `due_date`, `export_scope`, `verify_due_at`, `created_by`, `client_id`, `url`, `file_*`…) | Ajoutées en fin de table, `NULL` par défaut — comportement identique à SQLite |
| `org_task_templates.frequency TEXT NOT NULL DEFAULT 'annuelle'` ajouté par `ALTER` | Conservé tel quel (légal en PG : le DEFAULT s'applique aux lignes existantes) |
| `CHECK` | Conservés à l'identique, dont le `status` étendu à `'a_verifier'` (0025) |
| Index partiel `idx_time_entries_active … WHERE stopped_at IS NULL` | Supporté par PostgreSQL, conservé |
| Colonnes réservées | Aucune : `read`, `type`, `context`, `status`, `month`, `label`… ne sont pas réservés en PG |

---

## 6. Liste des 35 tables (ordre du fichier = ordre FK)

**Comptabilité (0001)** — `societes`, `journaux`, `dossiers`, `pieces`,
`ecritures`, `factures`, `rapport_modes`

**BAUD / paie (0002-0004, 0018)** — `societes_paie`, `rubriques_paie`,
`salaries_paie`, `dossiers_paie`, `lignes_extraites`, `imports_ga`,
`corrections` (0003)

**ScanFlash (0005-0006)** — `societes_scan`, `dossiers_scan`, `factures_scan`,
`ecritures_scan`

**Organizations (0007 → 0034)** — `organizations`, `org_users`, `org_clients`,
`org_dossiers`, `org_tasks`, `org_expected_documents`, `org_task_templates`,
`org_audit_log`, `org_notifications`, `org_notes`, `org_fiscal_deadlines`,
`org_reminders_log`, `org_time_entries` (0008), `org_fiscal_alerts` (0014),
`org_alert_dones` (0015), `org_dossier_grants` (0028),
`org_task_collaborators` (0030)

41 index, 27 clés étrangères, 0 vue, 0 trigger.

---

## 7. Étape 3 — Le Worker parle PostgreSQL (adaptateur PG)

Le code applicatif **reste en dialecte SQLite** (la base locale fonctionne telle
quelle) : la traduction est appliquée **à la volée** par l'adaptateur au moment
du `prepare()` — aucun SQL source n'est modifié.

```
Front GH Pages → Worker ─┬─ __backend/mode = supabase → adaptateur PG → Supabase (PostgreSQL)
                         └─ sinon : relais local (tunnel) → SQLite local | D1 gelée (rollback)
```

**Composants** (`api/src/`) :

| Fichier | Rôle |
|---------|------|
| `pg/translate.ts` | SQLite→PG à la volée : `datetime()`/`date()`/`strftime()` (57+ formes réelles de `index.ts`), `INSERT OR REPLACE/IGNORE`→`ON CONFLICT`, `LIKE`→`ILIKE`, `?`→`$n` (hors littéraux), `sqlite_master`→`information_schema`. Tout motif non couvert **lève une erreur** plutôt que de partir en silence |
| `pg/scram.ts` | Auth SCRAM-SHA-256 (RFC 5802/7677, Web Crypto) |
| `pg/md5.ts` | Auth MD5 (RFC 1321 écrite à la main) — c'est celle qu'utilise l'endpoint local d'Hyperdrive, `node:crypto` n'existant pas côté Worker |
| `pg/protocol.ts` | Protocole PG v3 : startup, extended query (Parse/Bind/Describe/Execute/Sync), parser tolérant aux fragments |
| `pg/client.ts` | Handshake, file d'attente sérialisante, timeouts, reconnexion (1 reprise), transactions |
| `pg/transport.ts` | `cloudflare:sockets` (import dynamique → compatible Node) |
| `supabase-adapter.ts` | Interface D1 identique (`prepare/bind/first/all/run/batch`), PK map via `information_schema` (pour `ON CONFLICT`), casse `bonsAchat` |
| `sync.ts` | Reprise de la main sur D1 après une bascule : copie Supabase→D1 puis purge (§9) |

**Bascule** (secret `X-Internal-Secret` requis, fail-closed) :

```bash
# état
curl -H "X-Internal-Secret: $EUREX_INTERNAL_SECRET" https://eurex-api.<acc>.workers.dev/internal/backend
# → {"backend":"d1|supabase","has_url":true|false}

# activer / revenir en arrière (cache 10 s, prioritaire sur le relais)
curl -X POST -H "X-Internal-Secret: ..." -d '{"backend":"supabase"}' .../internal/backend
curl -X POST -H "X-Internal-Secret: ..." -d '{"backend":"d1"}'      .../internal/backend

# copie Supabase -> D1 puis bascule retour (le cron 00:05 UTC le fait tout seul)
# {"dry":true} ne lit que Supabase et rend le plan, sans rien écrire ni basculer
curl -X POST -H "X-Internal-Secret: ..." -d '{"dry":true}' .../internal/resync
```

- **Le retour manuel sur D1 est refusé tant que `d1_state != 'clean'`** (409) :
  D1 contiendrait les données d'avant la bascule et toutes les saisies faites
  depuis seraient perdues. `{"backend":"d1","force":true}` passe outre.
- Secret Worker : `wrangler secret put SUPABASE_DB_URL` (URI **Direct/Session
  pooler** de Supabase). Sans secret, `has_url:false` et la bascule est sans effet.
  Chemin réellement utilisé : le **binding Hyperdrive** (`wrangler.jsonc`), prioritaire
  sur la secret — le TLS direct depuis un Worker vers Supabase est impossible
  (CA privée rejetée par Cloudflare).
- Crons Worker : le `00:05` gère le retour sur D1 (§9) ; les autres sont sans
  objet en mode supabase (sauvegardes D1 → D1).
- `transaction(fn)` : `fn` reçoit un **queryFn** déjà dans la transaction ;
  appeler `client.query()` depuis `fn` provoquerait un deadlock (file non réentrant).
- Tests : `cd api && npm test` → **47 tests** dont l'**inventaire SQL** qui
  soumet *toutes* les chaînes `.prepare()` et les fragments SQLite de `index.ts`
  au traducteur (filet contre toute nouvelle construction non couverte).

**Prochaines étapes** : appliquer `schema.sql` puis `data.sql` sur Supabase
(§1), poser `SUPABASE_DB_URL`, basculer en `{"backend":"supabase"}` et tester.

---

## 8. Hors périmètre (rappel)

`schema.sql` ne contient que le **schéma** ; les données viennent du dump SQLite
(`import.ts` → `data.sql`). Le portage du dialecte applicatif n'est **pas**
nécessaire : il est assuré à la volée par `pg/translate.ts` (voir §7).

---

## 9. Bascule automatique et resync quotidienne

Incident du **2026-10-10** : D1 a épuisé son quota gratuit de lignes lues (5 M/jour,
remise à zéro à 00:00 UTC) et l'application est restée **down** jusqu'au lendemain.
Cause racine : la migration 0025 avait reconstruit `org_tasks` et
`org_expected_documents` sans recréer leurs 6 index → chaque `WHERE dossier_id = ?`
faisait un `SCAN` complet (11,28 M lignes lues). Restaurés (migration 0035), mais
le point de rupture architectural restait.

Deux mécanismes le comblent désormais, dans `api/src/index.ts` + `api/src/sync.ts` :

**1. Bascule automatique D1 → Supabase, à la volée.**
Une erreur de quota reconnue (`isD1QuotaError`) pose `__backend/mode=supabase` et
**rejoue** la requête : l'utilisateur ne voit rien. Le corps des petites requêtes
(< 1 Mo) est donc conservé en mémoire au début de `fetch` — la conservation
**consomme** le flux d'origine, il faut donc servir la copie. Au-delà, un 503
explicite, mais la bascule a déjà eu lieu.

**2. Resync Supabase → D1, puis retour (cron `5 0 * * *`, 00:05 UTC).**
Deux passes, dans `sync.ts` :

| Passe | Ordre | Pourquoi |
|-------|-------|----------|
| upsert des lignes de Supabase | **mères d'abord** | les clés étrangères sont actives dans D1 (vérifié par `SQLITE_CONSTRAINT_FOREIGNKEY`) |
| purge des orphelins | **filles d'abord** | une fille ne peut pas disparaître après sa mère |

Pendant la copie, un **verrou KV** (`__backend/sync`) fait attendre les requêtes :
servir entre-temps laisserait des écritures derrière, et elles seraient perdues au
retour. Le verrou est levé **après** la bascule, jamais avant.

Le retour n'a lieu qu'après **réussite complète** : un échec en cours de route
laisse D1 inutilisé (et marqué `d1_state=dirty`) mais l'application continue de
tourner sur Supabase, et le cron suivant reprend — l'opération est idempotente.

### Pièges rencontrés, validés en production plutôt qu'écrits au hasard

- **`INSERT OR REPLACE` est interdit ici.** Il supprime la ligne en conflit avant
  de la réécrire, ce qui déclenche les clés étrangères qui la référencent :
  mettre à jour `organizations` échouerait à cause de `org_users`. D'où
  `ON CONFLICT ... DO UPDATE` (vérifié sur le moteur D1).
- **D1 refuse aussi les *écritures*** une fois le quota de lectures atteint : la
  copie de diagnostic s'est cassée dès la 3ᵉ table. D1 est donc totalement
  indisponible pendant l'incident, pas seulement ralenti — d'où l'intérêt de la
  bascule.
- **Pas de `WHERE pk NOT IN (...)`** pour la purge : D1 refuse plus de 100
  paramètres liés par requête. Les clés primaires de D1 sont lues une par une.
- **L'ordre topologique vient du schéma Supabase**, jamais de D1 : pendant la
  bascule, D1 est justement à court de quota de lecture.
- **Les clés primaires sont normalisées via `Number()`** : Postgres peut rendre un
  `bigint` là où SQLite rend un nombre, et la comparaison d'orphelins échouerait.

### Opérations

```bash
# état complet (backend, propreté de D1, resync en cours)
curl -H "X-Internal-Secret: $EUREX_INTERNAL_SECRET" https://eurex-api.<acc>.workers.dev/internal/backend
# → {"backend":"supabase","d1_state":"dirty|clean","syncing":false,...}

# forcer une resync (par ex. pour tester) — {"dry":true} ne touche à rien
curl -X POST -H "X-Internal-Secret: ..." -d '{}' .../internal/resync
```

- **Le PC du cabinet** (`__local/mode=1`) est source de vérité : le cron ignore la
  resync tant que le relais local est actif, sous peine d'écraser ses écritures.
- **`__local/mode` doit repasser à `1`** quand le cabinet revient — sinon les
  saisies continueraient d'aller dans le cloud alors que la base locale aurait
  avancé. C'est la seule étape manuelle du dispositif.
- Tests : `cd api && npm test` → **86 tests**, dont la synchronisation sur
  doubles et la conservation de corps.

