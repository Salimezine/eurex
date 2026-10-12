# EUREX local — API sur SQLite (paquet conservé ; relais Worker retiré)

> ⚠️ **Ce mode n'est plus actif en production.** Le Worker Cloudflare ne sert
> plus que **D1** ou **Supabase** (bascule automatique). Les endpoints
> `/internal/register`, `/internal/heartbeat` et `/internal/cloud_mode` ont été
> **supprimés**, le mode `__local/mode` n'est plus lu et les clés KV `__local/*`
> ont été effacées. Ce paquet reste dans le dépôt (serveur SQLite local, crons,
> sauvegardes) mais n'est **plus joignable** via le Worker. `/internal/ai`, lui,
> est conservé : `ai-relay.ts` peut toujours l'appeler.

## Description d'origine (historique)

La base vivait en local (PC du cabinet). Le Worker Cloudflare ne faisait que
**relayer** les requetes du front GH Pages vers ce PC via un tunnel cloudflared :

```
Front (GH Pages) → Worker workers.dev → tunnel cloudflared → serveur local (Node, port 8787)
                                            ↳ IA : le local relaie vers /internal/ai (Workers AI Cloudflare)
```

- Mode actif = cle KV `__local/mode` = `1` posee par `/internal/register` (bascule).
- PC eteint/tunnel coupe → reponse **503** « API locale hors ligne… » (rollback possible : `/internal/cloud_mode`).
- D1 n'est plus ecrite : elle garde un instantane de secours (dernier dump avant bascule).

## Fichiers

| Fichier | Role |
|---|---|
| `adapter-d1.ts` | API D1 (prepare/bind/first/all/run/batch) sur `node:sqlite` |
| `kv-disk.ts` | KV Cloudflare sur disque (`data/kv/`) |
| `ai-relay.ts` | `env.AI` → `/internal/ai` du Worker (quota Cloudflare conserve) |
| `server.ts` | Serveur HTTP local : execute `src/index.ts` + crons (rollover 1/1, backup 02:00 UTC) + heartbeat |
| `migrate.ts` | `npm run migrate -- <dump.sql> [--force]` : dump SQL → SQLite |
| `.env` | Port, secret, URL Worker, URL tunnel (jamais commite) |
| `data/eurex.db` | La base (jamais commitee) |
| `data/backups/` | 7 derniers snapshots (`VACUUM INTO`) + copie cloud quotidienne (gzip → KV Worker) |
| `data/logs/` | Journaux `demarrer`, `server`, `cloudflared` |
| `install/` | Scripts d'installation au cabinet |

## Commandes (dans `api/`)

```powershell
npm run local                  # demarrer le serveur seul (developpement)
npm run migrate -- dump.sql    # importer un dump D1
powershell -File local\install\demarrer.ps1   # demarrage complet (tunnel + serveur + surveillance)
powershell -File local\install\arreter.ps1    # arret complet
GET http://127.0.0.1:8787/_local/ping         # sante
GET http://127.0.0.1:8787/_local/backup       # snapshot immediat + copie cloud
```

## Installation sur le PC du cabinet

1. Installer **Node.js 24 LTS** (https://nodejs.org) — requis (>= 22.9 minimum).
2. Copier/cloner tout le dossier du projet sur le PC cabinet.
3. Copier depuis la machine actuelle : `api/local/.env` (contient le secret) et
   `api/local/data/` (base + documents). *Voir « Bascule » ci-dessous.*
4. Executer **une fois** : `powershell -ExecutionPolicy Bypass -File api\local\install\installer.ps1`
   (installe cloudflared + configure le demarrage auto : tache planifiee SYSTEM si le
   script est lance **en administrateur**, sinon cle Run de la session).
5. Verifier : `http://127.0.0.1:8787/_local/ping`, puis le front (login).
6. Laisser le PC allume (avec la tache SYSTEM, aucune session ouverte n'est necessaire).

## Bascule depuis la machine actuelle (quand le cabinet est pret)

1. **Arreter proprement** ici : `local\install\arreter.ps1` (la base est figee/coherente).
2. Copier `api/local/.env` + `api/local/data/` sur le PC cabinet (code du projet inclus).
3. Sur le cabinet : `installer.ps1 -DemarrerMaintenant`.
4. Le premier heartbeat met a jour l'URL du tunnel chez Cloudflare automatiquement
   (le mode reste `local`, aucune action supplémentaire).
5. Verifier : login sur le front, `data/logs/demarrer.log` → `tunnel: https://…`, et
   sur la machine ancienne plus rien ne tourne.

## Sauvegardes & restauration

- Locale : `data/backups/eurex-YYYY-MM-DD.db` (7 jours, auto 02:00 UTC).
- Cloud : meme fichier gzip dans la KV du Worker (cle `backups/…`, 7 jours) :
  `wrangler kv key list --namespace-id 9becacff0b9a4a07ab859e91e4208d92 --remote`
- Restauration : telecharger le `.gz`, decompresser, arreter le serveur, remplacer
  `data/eurex.db` (+ supprimer `-wal`/`-shm`), redemarrer.

## Rollback (obsolète)

Le rollback vers D1 passait par `/internal/cloud_mode`, **supprimé** avec le
relais. Le backend se pilote désormais par `/internal/backend`
(`{"backend":"d1"|"supabase"}`) et `/internal/resync` (cf. `api/supabase/README.md`).

## Securite

- `EUREX_INTERNAL_SECRET` : mis par `wrangler secret put` (jamais dans le repo),
  duplique dans `api/local/.env` (ignore par git). Necessaire pour `/internal/*`.
- Le tunnel est en lecture seule pour le monde : il pointe sur le serveur local qui
  expose les memes routes `/api/*` que le Worker (memes verifications token).
