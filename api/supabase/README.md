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
                         └─ sinon : D1
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

# activer / revenir en arrière (cache 10 s)
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
- Tests : `cd api && npm test` → **88 tests** dont l'**inventaire SQL** qui
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
- **Limite CPU des Workers (plan gratuit : 10 ms/requête).** La bascule a montré
  que ce n'est pas le réseau qui coûte le plus, c'est le **décodage** et le
  **nombre de requêtes**. Deux pièges trouvés en production, corrigés et couverts
  par des tests :

  | Symptôme prod | Cause racine | Correctif |
  |---|---|---|
  | `503 error code: 1102` sur `/api/org/clients`, `/dossiers`, `/comptables`, `/alerts` — les petites routes (`/exercices`, `/auth/me`) passaient | `FrameParser.push()` faisait `this.buf.slice(total)` **par message** : décodage **O(n²)** en octets. Au-delà de ~15 Ko de réponse, le seul parsing dépassait 10 ms | curseur de lecture `pos`, plus aucune copie du reste du tampon ; `PgClient` lit `msgs` par index (`takeBuffered`) au lieu de `shift()` |
  | `401 {"error":"Non autorisé"}` sporadique | un adaptateur **singleton d'isolate** partageait sa socket entre requêtes concurrentes ; la fermeture de l'une coupait l'autre | `getSupabaseAdapter()` renvoie une instance **par requête** ; seule une **mémoire des PK déjà chargées** est partagée (jamais une promesse en vol, liée à la socket d'une autre requête) |

  Règle : un `5xx` avec un `error code: 1102` ne se diagnostique **qu'avec
  `wrangler tail`** (le corps HTTP ne dit rien) — chercher « Exceeded CPU Limit ».
- **Les motifs N+1 explosent très vite ce budget** : `/api/org/clients` émettait
  208 requêtes, `/api/org/dossiers` 70, `/api/org/comptables` 19. Regroupés en 2 à
  5 requêtes chacun (IDs découpés par blocs de 80 pour rester sous la limite de
  100 paramètres liés de D1), la logique de statistiques JS reste identique.
- **Hyperdrive met en cache les réponses SQL, indexées sur le texte de la
  requête** : une suppression validée par PostgreSQL restait invisible sur
  `GET /api/org/comptables` pendant ~10 min alors que le détail (autre SQL)
  répondait déjà 404. Corrigé par `wrangler hyperdrive update <id>
  --caching-disabled` — détails et protocole de constat en §7.
- **Le quota de lectures D1 ne se diagnostique pas avec `SELECT 1`.** En fin de
  quota, `SELECT 1` (0 ligne) et un `INSERT ... ON CONFLICT` **sans conflit**
  (`rows_read: 0`) passent, alors qu'un `DELETE` par clé ou un upsert qui
  *conflit* — soit **2 à 3 lignes lues** — échoue avec « exceeded D1's free tier
  daily row read limit ». Constat de prod : `wrangler d1 execute` semblait donc
  « fonctionner » alors que la resync échouait sur la 3ᵉ table. Le bon test est
  `meta.rows_read` d'une lecture de vraies lignes, pas l'exécution de la
  commande. La resync ne copie que ~6 500 lignes : elle ne peut pas être la
  cause, elle ne fait que tomber sur un quota déjà consommé.
- **Le coupable se trouve avec `wrangler d1 insights <db>`** (expérimental), qui
  classe les requêtes par `totalRowsRead` et donne une `queryEfficiency`. Constat
  du 2026-10-10 : **5 requêtes seulement avaient consommé 6 973 520 lignes**,
  dont 6 132 161 pour deux `SELECT ... FROM org_tasks WHERE dossier_id = ?`,
  soit **~5 000 lignes lues par exécution** pour une table de ~5 000 lignes.
  C'est le profil exact d'un **balayage complet** : les index de `org_tasks`
  manquaient (restaurés par la migration 0035). Après restauration,
  `EXPLAIN QUERY PLAN` rend `SEARCH org_tasks USING INDEX idx_org_tasks_month
  (dossier_id=?)` et la même requête coûte **`rows_read: 0`**. Conséquence
  pratique : le quota épuisé était un **avant-correctif**, la bascule nocturne
  est tenable — ~6 500 lectures contre 5 000 000.
- **Un index juste peut être refusé par le planificateur : SQLite n'est pas
  PostgreSQL.** Le composant `NouvellesTaches` (monté sur le tableau de bord
  expert **et** comptable, donc sur chaque poste ouvert) appelle
  `/api/org/tasks/recent` toutes les 30 s, dont le
  `ORDER BY t.created_at DESC, t.id DESC LIMIT 10` forçait un
  `USE TEMP B-TREE` : **5 954 lignes lues pour 10 lignes rendues**, soit
  ~714 000 lignes/heure et par poste ouvert. Le quota D1 étant un plafond
  **plat par compte**, il ne dépend pas du nombre de comptables — c'est leur
  *coût* qui croît avec eux. Migration 0036 : `org_tasks(created_at, id)`.
  Les **deux** colonnes sont nécessaires : `(created_at)` seul laisse un
  `TEMP B-TREE` pour le départage par `id`, donc aucun gain. Résultat mesuré,
  même requête :

  | moteur | avant | après |
  |---|---|---|
  | PostgreSQL | `Sort` + `Seq Scan`, **4 920** lignes | `Index Scan Backward`, aucun nœud de tri, **10** lignes (492×) |
  | SQLite (D1) | `TEMP B-TREE` | **inchangé** — 5 954 lignes |

  SQLite **refuse** l'index sur *cette* requête : l'ajout de la seule
  condition `c.organization_id = ?` le fait repartir de `c`, puis `d`, puis
  `t`, ce qui rend le tri complet inévitable (le `LIMIT 10` n'est pas assez
  crédité au chemin alternatif). Vérifié sur un banc d'essai local reproduisant
  le schéma réel : ni `(created_at, id)`, ni un index **couvrant** sur
  toutes les colonnes lues, ni `ANALYZE` ne le font changer d'avis. L'index
  est conservé (il sert Supabase, et les requêtes sans filtre
  d'organisation côté D1) ; la mitigation réelle sur D1 est le garde
  `document.hidden` ajouté à `NouvellesTaches` — aligné sur les trois autres
  sondeurs de l'app, un onglet en arrière-plan ne consomme plus rien et le
  retour sur l'onglet recharge déjà via `onFocus`. **Règle : ne jamais
  supposer qu'un index sera utilisé — `EXPLAIN QUERY PLAN` sur les deux
  moteurs, après chaque index.**
- **`created_by` est NULL pour les 5 747 lots existants, et c'est voulu.**
  `/api/org/tasks/recent` filtre `t.created_by IS NOT NULL` : seules les
  tâches créées **à la main** remontent (index.ts:3369 renseigne
  `created_by = user.id`), pas celles issues des gabarits ou du roulement
  d'exercice. Le flux de notifications est donc vide aujourd'hui et se
  remplira dès la première création manuelle — d'où l'importance de l'index
  côté Supabase.
- **`wrangler d1 insights` est la seule mesure fiable du quota — et elle
  change la donne.** Arrivé à un plafond, l'instinct est de chercher lequel
  des index manque. Mesuré plutôt : `wrangler d1 insights eurex-db
  --sort-by reads --limit 60 --time-period 1h --json` (nettoyer les ANSI
  wrangler avant de parser, sinon `ConvertFrom-Json` échoue). Sur 24 h,
  **74 % des 8,2 M lignes lues venaient de deux requêtes** — et ces deux
  requêtes **n'existent plus dans la source** : elles appartenaient à une
  version antérieure du Worker. Sans cette mesure on aurait optimisé à
  l'aveugle du code mort. Vérifier toujours qu'une requête du rapport est
  bien encore déployée avant de la soigner.
- **Le planificateur SQLite ne donne pas le même plan selon qu'une valeur est
  écrite en dur ou liée.** Requête strictement identique, exécutée en prod :

  | forme | `rows_read` |
  |---|---|
  | `WHERE t.dossier_id = '00a610b1-…'` (littéral) | **85** — `SEARCH … USING INDEX` |
  | `WHERE t.dossier_id = ?` (paramètre, ce que fait l'app) | **5 403** — balayage complet |

  `EXPLAIN QUERY PLAN` rend donc `SEARCH` dans les deux cas : **il ne
  détecte pas le problème**, puisqu'il est exécuté avec la valeur en dur.
  Chaque dossier ne contient que 84 tâches (répartition parfaitement
  régulière, et `sqlite_stat1` le sait : `5747 84`) — donc ces 5 403 lignes
  sont bien un refus du planificateur, pas une donnée volumineuse. Ni index
  couvrant, ni `ANALYZE` ne l'ont corrigé par le passé : voir plus haut.
- **Lecture répartie : `pgAll()` fait passer les requêtes lourdes par
  PostgreSQL quand `mode=d1`.** Ne pas tenter un `GROUP BY` pour « économiser
  des lignes » : l'**agrégat doit tout parcourir pour compter**, les lignes
  *lues* ne baissent pas. Seul un autre moteur retire le coût du quota.
  Cibles : `/api/org/comptables` (5 953 lignes/appel, sondé toutes les 60 s
  par l'expert) et `/api/org/me/tasks/recent` (~4 100 lignes, toutes les
  30 s par **chaque** poste ouvert) — soit à elles seules plus de la moitié
  d'un quota de 5 M/jour. Mesuré avant/après par `d1 insights` : la requête
  routée reste bloquée à son ancien nombre d'exécutions **pendant que les
  deux voisines non routées du même handler continuent d'augmenter** — ce
  trio (témoin + test) est ce qui rend la mesure recevable malgré la latence
  des statistiques. Aucun octet de réponse modifié : balayée de 27 routes
  identique à l'octet près, hors la suppression des comptes de test.
- **`pgAll()` refuse de router sans double écriture**, et c'est le garde le
  plus important du dispositif : seule la primaire reçoit les écritures,
  donc servir Supabase pendant qu'on écrit sur D1 exposerait une création
  invisible à l'utilisateur. Le drapeau `__backend/dual_write` repose donc la
  condition toute seule — couper la double écriture désactive aussi la
  répartition, sans modifier une ligne de code.
- **Le routage a *ajouté* une dépendance : `pgAll()` retombe maintenant sur D1.**
  Avant lui, une requête routée n'avait besoin que de D1 ; avec lui, elle
  échoue aussi si Hyperdrive ou Supabase tousse — et c'est arrivé en production
  le 2026-10-11 : le tableau de bord cabinet affichait ses quatre compteurs à
  zéro derrière « l'API est momentanément indisponible », alors que les mêmes
  appels répondaient normalement une minute plus tard. Le repli sur D1 est
  sans risque et c'est tout l'intérêt de la double écriture : les deux bases
  reçoivent chaque modification et restent identiques, donc lire l'une ou
  l'autre revient au même, D1 étant en plus la primaire. **Sans cette
  garantie, le repli serait dangereux et il faudrait laisser échouer** — c'est
  le drapeau `dual_write` qui rend la chute acceptable.
  Complément côté navigateur : `OrgDashboardExpert`, `OrgDashboardComptable` et
  `OrgSettings` assemblaient leurs routes avec `Promise.all`, qui **annule les
  réponses déjà résolues** dès qu'une seule route échoue. Passées en
  `Promise.allSettled`, elles affichent ce qui est venu et ne signalent
  l'erreur que si rien n'est arrivé — un échec isolé ne vide plus une page
  entière.
- **L'écart avant (`forward_gap`) se répare par rejeu, jamais par recopie.** Le drapeau
  `__backend/forward_gap` se lève quand une écriture de second rang n'atteint
  pas PostgreSQL alors que D1 sert. Copier ensuite Supabase → D1 — ce que fait la
  resync nocturne — **écraserait et purgerait** cette écriture ; d'où l'abstention
  de 409. Depuis 2026-10-11, le cron et `POST /internal/resync` tente d'abord
  `repairForwardGap()`, qui **rejoue les écritures manquantes** conservées dans
  `__backend/outbox` (SQL + paramètres), captées au moment précis où elles ont
  échoué.
  **La première version de cette réparation recopiait toute la base, et ne
  fonctionne pas** : abandon mesuré à **219 ms de CPU**, sur la 9ᵉ table des 35,
  alors qu'aucune ligne n'avait encore été écrite. Le coût est **fixe par
  invocation** (connexion PostgreSQL + lecture du schéma) plus que
  proportionnel au volume, donc fractionner sur plusieurs appels n'aurait fait
  que payer ce fixe plusieurs fois. C'est ce qui a motivé la conservation du
  contenu au moment de l'échec : c'est la seule réparation qui tient dans le
  budget du Worker gratuit. On ne sait donc rien deviner : si le drapeau est levé
  mais que le journal est vide (journalisation elle-même tombée en panne, ou
  drapeau antérieur), la réparation **refuse** et le dit — recopier au hasard
  coûterait plus cher que de traiter à la main.
- **Rejouer est sûr dans les deux sens.** La cible est Supabase, qui n'a
  justement *pas* reçu l'écriture : le rejeu ne peut pas doubler, quel que soit
  le mode en service. Si une insertion venait pourtant à heurter une clé déjà
  présente, elle n'est **pas** prise pour un succès : elle reste dans le journal
  et le rapport le mentionne. Un lot (`batch`) est atomique et son échec ne dit
  pas quelle portion a échoué — on reprogramme le lot complet, en ordre, chaque
  instruction étant un upsert ou un remplacement.
- **Le verrou `__backend/sync` s'applique aussi en mode `d1`** dès que la double
  écriture est active : `pgAll()` lit alors Supabase, et une réparation inverse
  est en train de recopier cette même base — laisser passer une lecture
  exposerait un contenu à moitie reconstruit. La condition a été élargie
  (`backend === 'supabase' || dual`) ; elle ne servait qu'à `supabase` avant
  que la lecture soit répartie.
- **Un échec de resync ne bascule rien et ne corrompt rien** : vérifié deux fois
  en production (`ok:false`, mode resté `supabase`, `d1_state` resté `dirty`,
  verrou libéré). Seul `onSuccess` — appelé après copie *et* purge complètes —
  écrit `mode=d1`.
- **Le quota d'ÉCRITURES D1 (100 000 lignes/jour, remis à zéro à 00:00 UTC,
  compté par compte donc `eurex-db` *et* `eurex-db-copy`) a été dépassé le
  2026-10-11 à 110 k — et le coupable n'était pas l'application.**
  `wrangler d1 insights eurex-db --sort-by writes --limit 15 --time-period 24h`
  (119 159 lignes au total) se décompose ainsi :

  | consommateur | lignes | part |
  |---|---:|---:|
  | `org_tasks` — **resync**, en deux entrées (celle écrite en dur et celle guillemetée, anciennes et nouvelles versions d'`upsertSql`) | 109 068 | **92 %** |
  | `CREATE INDEX` + `ANALYZE` (migration ponctuelle, une seule fois) | 5 800 | 5 % |
  | l'application (journal d'audit, dossiers, clients, notifications) | ~4 000 | **4 %** |

  La preuve que les deux grosses entrées viennent bien de `sync.ts` :
  `index.ts` ne contient **aucun** `ON CONFLICT`, l'application n'upserte donc
  jamais. Le surcoût était la resync, relancée l'équivalent d'une quinzaine de
  copies complètes pendant une journée de test — **pas un problème
  d'exploitation**. Deux règles en découlent : une resync complète coûte
  **~6 500 écritures, soit 6,5 % du quota d'un jour** (lancer avec
  `{"dry":true}` d'abord) ; et un quota dépassé **ne se constate pas en
  essayant une écriture** — l'écriture de test a encore réussi à 110 k, la
  limite n'est donc pas un refus immédiat. Enfin `--time-period 1h` et
  `--time-period 24h` ont rendu **exactement les mêmes chiffres** : cette
  option ne filtre rien, les statistiques sont figées — impossible d'en tirer
  un débit, seule l'attribution par requête est exploitable.

### Opérations

```bash
# état complet (backend, propreté de D1, resync en cours, horodatages)
curl -H "X-Internal-Secret: $EUREX_INTERNAL_SECRET" https://eurex-api.<acc>.workers.dev/internal/backend
# → {"backend":"supabase","d1_state":"dirty|clean","syncing":false,
#    "last_resync":"2026-10-11T00:05:12Z"|null,
#    "last_failover":"2026-10-10T12:52:47.892Z"|null,
#    "dual_write":false,             ← les deux bases écrites-elles à chaque modification ?
#    "forward_gap":null,             ← écriture non parvenue à Supabase : la resync s'abstient
#    "outbox":0}                     ← écritures restant à REJOUPER pour lever ce drapeau

# forcer une resync (par ex. pour tester) — {"dry":true} ne touche à rien
curl -X POST -H "X-Internal-Secret: ..." -d '{}' .../internal/resync
# Un forward_gap éventuel est d'abord levé par REJEU du journal, puis la copie
# a lieu ; si le rejeu échoue : 409, rien n'est copié.
# {"repair":{"ok":true,"rows":3}} apparaît en tête de réponse.
# {"dry":true} refuse d'agir tant que l'écart existe plutôt que de rendre un
# résultat qui ne se produirait pas pour de vrai.

# double écriture seule (ne change pas le moteur en service) ; désactiver
# cette commande désactive aussi la lecture répartie pgAll(), qui en dépend
curl -X POST -H "X-Internal-Secret: ..." -d '{"dual_write":true}' .../internal/backend

# copie D1 -> eurex-db-copy : APPEL MANUEL depuis 2026-10-11, et {"force":true}
# est exigé — l'opération vide chaque table avant de la réécrire
curl -X POST -H "X-Internal-Secret: ..." -d '{"force":true}' .../internal/sync-copy
```

- **La copie nocturne vers `eurex-db-copy` a été retirée** (cron `0 2 * * *`),
  non pas pour économiser — 6 500 lignes lues par nuit, soit 0,13 % du quota —
  mais parce qu'elle était **redondante** : Supabase est depuis la double
  écriture une copie complète, tenue à jour en continu et **interrogeable**,
  là où `eurex-db-copy` était une image figée à laquelle rien ne pouvait accéder.
  L'opération existe toujours (`POST /internal/sync-copy`), ce qui supprime aussi
  son seul défaut réel : un plantage au milieu laissait chaque table vidée.
  Le binding `COPY_DB` est conservé.

**Quand le rejeu ne suffit pas** (`outbox: 0` alors que `forward_gap` est
renseigné) : le Worker ne sait pas ce qui diverge, et refuse de deviner. Ne
tenter **jamais** une copie pleine base depuis le Worker — c'est l'opération qui
meurt à 219 ms de processeur, documentée plus haut. Traiter à la main :
comparer les tables suspectes (`wrangler d1 execute … --remote` d'un côté,
`SELECT` sur Supabase de l'autre), réinsérer ce qui manque côté Supabase, puis
lever le drapeau :

```bash
wrangler kv key delete --namespace-id 9becacff… --remote __backend/forward_gap
wrangler kv key delete --namespace-id 9becacff… --remote __backend/outbox
```

À défaut, `{"allow_forward_gap":true}` fait passer la copie outre en acceptant
de **perdre** l'écriture non rejouée.

**Vérifier le cycle nocturne** (la question « est-ce que D1 reprend la main,
puis retombe sur Supabase ? ») se répond avec ce seul GET :

| Quand | À constater |
|---|---|
| après 00:05 UTC **après une bascule** (mode `supabase`) | copie exécutée : `backend:"d1"`, `d1_state:"clean"`, **`last_resync` avancé** |
| après 00:05 UTC **en temps normal** (mode `d1`) | journal `[resync] ignoree (backend d1)` : il n'y a rien de périmé à écraser. `last_resync` **ne bouge pas** — c'est voulu, et cela économise ~6 500 écritures par nuit |
| dans la journée, D1 à court de quota | `backend:"supabase"`, `d1_state:"dirty"`, `last_failover` renseigné |
| retour manuel sur D1 entre-temps | **409** (`d1_state` = `dirty`) — refusé, c'est voulu |

Le cron teste d'abord `forward_gap` **avant** le test de mode, sinon le drapeau
resterait levé jusqu'à son expiration de sept jours en passant chaque nuit par
la sortie « déjà sur D1 ». Conséquence pratique : dans l'état courant
(`mode=d1`, pas d'écart) il ne fait qu'ouvrir et refermer le KV — le chemin
`repairForwardGap()` ne s'exécute réellement que lorsqu'un écart est levé.

- **Une chaîne reste à vérifier de bout en bout en production** : provoquer un
  échec *réel* du second rang. Elle n'a jamais été déclenchée naturellement
  (ce serait un heureux accident). Procédure, à faire **après remise à zéro du
  quota d'écritures**, parce qu'elle se termine par une copie complète :

  1. insérer dans D1 **seulement** un parent (un `org_clients` de test) via
     `wrangler d1 execute eurex-db --remote …` — la double écriture est
     contournée volontairement ;
  2. créer un enfant qui le référence par l'application : D1 accepte (clé
     présente), Supabase refuse (clé étrangère) → écriture de second rang
     échouée ;
  3. constater via `GET /internal/backend` : `forward_gap` renseigné **et**
     `outbox: 1` — c'est le seul lien du dispositif jamais tiré ;
  4. `POST /internal/resync` → `{"repair":{"ok":true,"rows":1}}`, puis tout
     revenir à la normale (`forward_gap:null`, `outbox:0`) et supprimer le
     parent de test des deux bases.


- **Le relais local a été retiré** : le Worker ne sert plus que D1 ou Supabase.
  Les endpoints `/internal/register|heartbeat|cloud_mode` et les clés KV
  `__local/*` n'existent plus ; le paquet `api/local` reste dans le dépôt mais
  n'est plus joignable. Il n'y a donc plus d'étape manuelle de bascule locale.
- Tests : `cd api && npm test` → **101 tests**, dont la double écriture (avec la
  conservation des paramètres des écritures manquantes), la synchronisation sur
  doubles et la conservation de corps.

