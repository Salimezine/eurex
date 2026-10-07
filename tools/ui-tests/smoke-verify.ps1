$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$B = "https://eurex-api.ezzinesalim21.workers.dev"
$script:fail = 0
function OK($cond, $msg) { if ($cond) { "PASS: $msg" } else { $script:fail++; "FAIL: $msg" } }
function Body($o) { ($o | ConvertTo-Json -Compress) }

$lr = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='expert@eurex.tn';password='expert1234567'}) -ContentType 'application/json'
$H = @{ Authorization = 'Bearer ' + $lr.token }
$lc = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='samar@eurex.tn';password='samar1234567'}) -ContentType 'application/json'
$Hc = @{ Authorization = 'Bearer ' + $lc.token }
OK ($null -ne $lr.token -and $null -ne $lc.token) "logins expert + comptable"

# setup : client + dossier (comptable user_comp_002)
$c = Invoke-RestMethod "$B/api/org/clients" -Headers $H -Method Post -Body (Body @{name='ZZ-VERIFY delai';assigned_comptable_id='user_comp_002'}) -ContentType 'application/json'
$d = Invoke-RestMethod ("$B/api/org/clients/" + $c.id + "/dossiers") -Headers $H -Method Post -Body (Body @{exercice=2026}) -ContentType 'application/json'
OK ($null -ne $d.id) "dossier cree"
$g = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
$tid = $g.tasks[0].id
OK ($null -ne $tid) "tache disponible ($($g.tasks[0].label))"

# 1) comptable marque fait -> a_verifier + delai auto 24h
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tid) -Headers $Hc -Method Patch -Body (Body @{status='fait'}) -ContentType 'application/json' | Out-Null
$g1 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
$t1 = $g1.tasks | Where-Object id -eq $tid
OK ($t1.status -eq 'a_verifier') "comptable fait -> a_verifier"
$due1 = [DateTime]::ParseExact($t1.verify_due_at, 'yyyy-MM-dd HH:mm:ss', $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
$h1 = ($due1 - [DateTime]::UtcNow).TotalHours
OK ($h1 -gt 23 -and $h1 -lt 25) "delai auto = 24h ($([math]::Round($h1,1))h)"

# 1b) qui a travaille la tache + feed expert des taches a verifier
$dk = ((npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT done_by FROM org_tasks WHERE id='$tid'" 2>$null | Out-String | ConvertFrom-Json)[0]).results[0].done_by
OK ($dk -eq 'user_comp_002') "done_by = le comptable qui a travaille ($dk)"
$vf = Invoke-RestMethod "$B/api/org/tasks/verify" -Headers $H
$v1 = $vf.tasks | Where-Object id -eq $tid | Select-Object -First 1
OK ($null -ne $v1) "GET /org/tasks/verify : la tache figure au feed"
OK ($v1.done_by_name -eq 'Samar') "feed : travaillee par $($v1.done_by_name)"
OK ($v1.verify_left_hours -gt 23 -and $v1.verify_left_hours -lt 25) "feed : delai restant = $($v1.verify_left_hours) h"
OK ($v1.client_name -eq 'ZZ-VERIFY delai') "feed : client = $($v1.client_name)"
OK ($v1.dossier_id -eq $d.id -and $v1.exercice -eq 2026) "feed : dossier/exercice renseignes"
try { Invoke-RestMethod "$B/api/org/tasks/verify" -Headers $Hc | Out-Null; OK $false "comptable : GET /tasks/verify -> 403" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 403) "comptable : GET /tasks/verify -> 403" }

# 2) expert fixe un delai de 4h
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tid) -Headers $H -Method Patch -Body (Body @{verify_due_hours=4}) -ContentType 'application/json' | Out-Null
$g2 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
$t2 = $g2.tasks | Where-Object id -eq $tid
$due2 = [DateTime]::ParseExact($t2.verify_due_at, 'yyyy-MM-dd HH:mm:ss', $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
$h2 = ($due2 - [DateTime]::UtcNow).TotalHours
OK ($h2 -gt 3 -and $h2 -lt 5) "expert fixe delai 4h ($([math]::Round($h2,1))h)"

# 3) le comptable ne peut pas fixer le delai
try { Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tid) -Headers $Hc -Method Patch -Body (Body @{verify_due_hours=2}) -ContentType 'application/json'; OK $false "comptable fixe delai -> 403" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 403) "comptable fixe delai -> 403" }

# 4) delai invalide -> 400
try { Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tid) -Headers $H -Method Patch -Body (Body @{verify_due_hours=0}) -ContentType 'application/json'; OK $false "delai 0h -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "delai 0h -> 400" }

# 5) expert valide -> fait + pointage 5 min + audit task_verified
$before = ((npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT COUNT(*) as n FROM org_time_entries WHERE task_id='$tid'" 2>$null | Out-String | ConvertFrom-Json)[0]).results[0].n
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tid) -Headers $H -Method Patch -Body (Body @{status='fait'}) -ContentType 'application/json' | Out-Null
$g3 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
$t3 = $g3.tasks | Where-Object id -eq $tid
OK ($t3.status -eq 'fait') "expert valide -> fait"
OK ($t3.verified_by_name -eq 'Omar') "badge validateur = Omar ($($t3.verified_by_name))"
OK ($t3.done_by_name -eq 'Samar') "badge travailleur = Samar (intact apres validation) ($($t3.done_by_name))"
$vf2 = Invoke-RestMethod "$B/api/org/tasks/verify" -Headers $H
OK ($null -eq ($vf2.tasks | Where-Object id -eq $tid | Select-Object -First 1)) "apres validation : sortie du feed A verifier"
$d1 = npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT (SELECT COUNT(*) FROM org_time_entries WHERE task_id='$tid' AND user_id='user_expert_001' AND duration_seconds=300 AND stopped_at IS NOT NULL) as te, (SELECT COUNT(*) FROM org_audit_log WHERE target_id='$tid' AND action='task_verified') as aud" 2>$null
$r = (($d1 | Out-String | ConvertFrom-Json)[0]).results[0]
OK ($r.te -ge 1) "pointage auto 5 min cree pour l'expert ($($r.te))"
OK ($r.aud -ge 1) "audit task_verified enregistre ($($r.aud))"

# 6) la validation entre dans les heures du jour (somme expert aujourd'hui)
$e = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='expert@eurex.tn';password='expert1234567'}) -ContentType 'application/json'
$me = Invoke-RestMethod "$B/api/org/auth/me" -Headers @{Authorization='Bearer '+$e.token}
$day = ((npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT COALESCE(SUM(duration_seconds),0) as s FROM org_time_entries WHERE user_id='user_expert_001' AND stopped_at IS NOT NULL AND started_at >= datetime('now','start of day','-60 minutes')" 2>$null | Out-String | ConvertFrom-Json)[0]).results[0].s
OK ($day -ge 300) "heures du jour expert incluent la validation (>= 300s = $day)"

# 7) retour a l'etat initial de la tache seedee + cleanup complet
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tid) -Headers $H -Method Patch -Body (Body @{status='a_faire'}) -ContentType 'application/json' | Out-Null
$did = $d.id; $cid = $c.id
npx.cmd wrangler d1 execute eurex-db --remote --json --command "DELETE FROM org_time_entries WHERE dossier_id='$did'; DELETE FROM org_alert_dones WHERE alert_id IN (SELECT id FROM org_fiscal_alerts WHERE dossier_id='$did'); DELETE FROM org_fiscal_alerts WHERE dossier_id='$did'; DELETE FROM org_expected_documents WHERE dossier_id='$did'; DELETE FROM org_tasks WHERE dossier_id='$did'; DELETE FROM org_notes WHERE dossier_id='$did'; DELETE FROM org_dossiers WHERE id='$did'; DELETE FROM org_clients WHERE id='$cid';" | Out-Null
$chk = ((npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT (SELECT COUNT(*) FROM org_clients WHERE id='$cid') + (SELECT COUNT(*) FROM org_dossiers WHERE id='$did') + (SELECT COUNT(*) FROM org_time_entries WHERE dossier_id='$did') as n" 2>$null | Out-String | ConvertFrom-Json)[0]).results[0].n
OK ($chk -eq 0) "cleanup complet"

""
if ($script:fail -eq 0) { "ALL PASS" } else { "$script:fail FAILURES" }
exit $script:fail
