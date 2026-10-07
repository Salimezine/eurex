$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$B = "https://eurex-api.ezzinesalim21.workers.dev"
$script:fail = 0
function OK($cond, $msg) { if ($cond) { "PASS: $msg" } else { $script:fail++; "FAIL: $msg" } }
function Body($o) { ($o | ConvertTo-Json -Compress) }
function Req($m, $u, $h, $b) {
  $p = @{ Method = $m; Uri = $u }
  if ($h) { $p.Headers = $h }
  if ($b -ne $null) { $p.Body = $b; $p.ContentType = 'application/json' }
  return Invoke-WebRequest @p -UseBasicParsing
}

# --- logins (comptes reels, AUCUN compte cree/supprime) ---
$le = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='expert@eurex.tn';password='expert1234567'}) -ContentType 'application/json'
$H = @{ Authorization = 'Bearer ' + $le.token }
OK ($le.user.role -eq 'expert') "login expert Omar"
$ls = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='samar@eurex.tn';password='samar1234567'}) -ContentType 'application/json'
$Hs = @{ Authorization = 'Bearer ' + $ls.token }
OK ($ls.user.role -eq 'comptable') "login comptable Samar (comptable assignee)"

# dossier assigne a Samar : CONSTRUCTION DELTA (client_004, assignee user_comp_002) = doss_004
$DOSS = 'doss_004'
$gd = Invoke-RestMethod "$B/api/org/dossiers/$DOSS" -Headers $Hs
OK ($gd.id -eq $DOSS) "Samar accede a son dossier $DOSS"

$tnToday = [DateTime]::UtcNow.AddHours(1).Date
$due = $tnToday.AddDays(7).ToString('yyyy-MM-dd')
$label1 = 'QA-NT-avec-echeance-' + (Get-Random -Minimum 100000 -Maximum 999999)
$label2 = 'QA-NT-sans-echeance-' + (Get-Random -Minimum 100000 -Maximum 999999)

# 1) le comptable ajoute une tache AVEC echeance (7 jours)
$t1 = $null
try { $t1 = Invoke-RestMethod "$B/api/org/dossiers/$DOSS/tasks" -Headers $Hs -Method Post -Body (Body @{label=$label1; due_date=$due}) -ContentType 'application/json'; OK ($null -ne $t1.id) "comptable : POST tache avec echeance -> 201 ($($t1.id))" }
catch { OK $false "comptable : POST tache avec echeance -> 201 (err: $($_.Exception.Message))" }

# 2) le comptable ajoute une tache SANS echeance
$t2 = $null
try { $t2 = Invoke-RestMethod "$B/api/org/dossiers/$DOSS/tasks" -Headers $Hs -Method Post -Body (Body @{label=$label2}) -ContentType 'application/json'; OK ($null -ne $t2.id) "comptable : POST tache sans echeance -> 201 ($($t2.id))" }
catch { OK $false "comptable : POST tache sans echeance -> 201 (err: $($_.Exception.Message))" }

# 3) GET /org/me/tasks/recent : les 2 taches y sont, avec tous les details demandes
$rec = Invoke-RestMethod "$B/api/org/me/tasks/recent" -Headers $Hs
OK ($null -ne $rec.tasks) "recent : reponse { tasks, days } ($($rec.days) j)"
$a1 = $rec.tasks | Where-Object { $_.id -eq $t1.id } | Select-Object -First 1
$a2 = $rec.tasks | Where-Object { $_.id -eq $t2.id } | Select-Object -First 1
OK ($null -ne $a1) "recent : tache 1 presente dans la carte"
OK ($null -ne $a2) "recent : tache 2 presente dans la carte"

if ($a1) {
  OK ($a1.label -eq $label1) "recent : libelle exact ($($a1.label))"
  OK ($a1.dossier_id -eq $DOSS) "recent : dossier = $DOSS"
  OK ($a1.client_name -eq 'CONSTRUCTION DELTA') "recent : client = $($a1.client_name)"
  OK ($a1.exercice -eq 2026) "recent : exercice = $($a1.exercice)"
  OK ($a1.status -eq 'a_faire') "recent : statut = $($a1.status)"
  OK ([string]::IsNullOrEmpty($a1.created_at) -eq $false) "recent : created_at renseigne ($($a1.created_at))"
  $created = [DateTime]::ParseExact([string]$a1.created_at, 'yyyy-MM-dd HH:mm:ss', $null)
  OK ($created -gt [DateTime]::UtcNow.AddMinutes(-5)) "recent : created_at = maintenant (UTC $($created.ToString('HH:mm:ss')))"
  OK ($a1.due_date -eq $due) "recent : date butoir = $due"
  OK ($a1.days_left -eq 7) "recent : temps restant = J-$($a1.days_left) (attendu J-7)"
}
if ($a2) {
  OK ($null -eq $a2.due_date) "recent : tache 2 sans date butoir"
  OK ($null -eq $a2.days_left) "recent : tache 2 => pas de J-x (null)"
}

# 4) l'expert voit aussi la nouvelle tache (superviseur = toute l'organisation)
$recE = Invoke-RestMethod "$B/api/org/me/tasks/recent" -Headers $H
$inExpert = $recE.tasks | Where-Object { $_.id -eq $t1.id } | Select-Object -First 1
OK ($null -ne $inExpert) "expert : la nouvelle tache figure aussi dans son feed"

# 5) sans jeton -> 401
try { Invoke-RestMethod "$B/api/org/me/tasks/recent" | Out-Null; OK $false "recent : sans jeton -> 401" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 401) "recent : sans jeton -> 401" }

# 6) created_at present aussi sur les taches existantes (backfill)
$gd2 = Invoke-RestMethod "$B/api/org/dossiers/$DOSS" -Headers $Hs
$nullCreated = @($gd2.tasks | Where-Object { [string]::IsNullOrEmpty($_.created_at) }).Count
OK ($nullCreated -eq 0) "backfill : toutes les taches du dossier ont un created_at ($(@($gd2.tasks).Count) taches)"

# 7) nettoyage : suppression des 2 taches de test
if ($t1) { try { Req DELETE "$B/api/org/dossiers/$DOSS/tasks/$($t1.id)" $Hs | Out-Null; OK $true "cleanup : tache 1 supprimee" } catch { OK $false "cleanup : tache 1 supprimee" } }
if ($t2) { try { Req DELETE "$B/api/org/dossiers/$DOSS/tasks/$($t2.id)" $Hs | Out-Null; OK $true "cleanup : tache 2 supprimee" } catch { OK $false "cleanup : tache 2 supprimee" } }
$rec3 = Invoke-RestMethod "$B/api/org/me/tasks/recent" -Headers $Hs
$leftover = @($rec3.tasks | Where-Object { $_.id -eq $t1.id -or $_.id -eq $t2.id }).Count
OK ($leftover -eq 0) "cleanup : plus aucune tache de test dans le feed"
$labels = @($rec3.tasks | Where-Object { $_.label -like 'QA-NT-*' }).Count
OK ($labels -eq 0) "cleanup : aucun libelle QA-NT-* residuel"

if ($script:fail -eq 0) { "`nALL PASS" } else { "`n$($script:fail) FAIL" }
exit $script:fail
