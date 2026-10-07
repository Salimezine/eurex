$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$B = "https://eurex-api.ezzinesalim21.workers.dev"
$script:fail = 0
function OK($cond, $msg) { if ($cond) { "PASS: $msg" } else { $script:fail++; "FAIL: $msg" } }
function Body($o) { ($o | ConvertTo-Json -Compress) }

# --- logins ---
$lr = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='expert@eurex.tn';password='expert1234567'}) -ContentType 'application/json'
$H = @{ Authorization = 'Bearer ' + $lr.token }
OK ($null -ne $lr.token) "login expert"
$lr2 = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='samar@eurex.tn';password='samar1234567'}) -ContentType 'application/json'
$HS = @{ Authorization = 'Bearer ' + $lr2.token }
OK ($null -ne $lr2.token) "login samar (comptable NON assigne)"
$lr3 = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='salim@eurex.tn';password='salim1234567'}) -ContentType 'application/json'
$HL = @{ Authorization = 'Bearer ' + $lr3.token }
OK ($null -ne $lr3.token) "login salim (comptable assigne)"

# --- 1) setup : client assigne a Salim, type physique ---
$c = Invoke-RestMethod "$B/api/org/clients" -Headers $H -Method Post -Body (Body @{name='ZZ-FLOW-TEST';person_type='physique';assigned_comptable_id='user_comp_001'}) -ContentType 'application/json'
OK ($c.person_type -eq 'physique') "POST client person_type=physique + assigne Salim"
$d = Invoke-RestMethod ("$B/api/org/clients/" + $c.id + "/dossiers") -Headers $H -Method Post -Body (Body @{exercice=2026}) -ContentType 'application/json'
$dd = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
OK ($dd.person_type -eq 'physique') "GET dossier person_type=physique"
OK ($dd.client_comptable_id -eq 'user_comp_001') "GET dossier client_comptable_id"
OK (@($dd.tasks).Count -gt 0) "dossier seede de taches ($(@($dd.tasks).Count))"

# --- 2) taches : create / rename / due_date / status / droits ---
$tAdd = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks") -Headers $H -Method Post -Body (Body @{label='ZZ-FLOW task';due_date='2026-12-31'}) -ContentType 'application/json'
OK ($tAdd.ok) "POST task + date butoir"
$tAddId = $tAdd.id
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tAddId) -Headers $H -Method Patch -Body (Body @{label='ZZ-FLOW renommee'}) -ContentType 'application/json' | Out-Null
$dd2 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
$ta = @($dd2.tasks | Where-Object id -eq $tAddId)[0]
OK ($ta.label -eq 'ZZ-FLOW renommee') "PATCH rename task"
OK ($ta.due_date -eq '2026-12-31') "date butoir stockee"
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tAddId) -Headers $H -Method Patch -Body (Body @{due_date='2026-11-15'}) -ContentType 'application/json' | Out-Null
$dd2 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
$ta = @($dd2.tasks | Where-Object id -eq $tAddId)[0]
OK ($ta.due_date -eq '2026-11-15') "PATCH date butoir"
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tAddId) -Headers $H -Method Patch -Body (Body @{status='fait'}) -ContentType 'application/json' | Out-Null
$dd2 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
OK ((@($dd2.tasks | Where-Object id -eq $tAddId)[0].status) -eq 'fait') "PATCH status -> fait"
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tAddId) -Headers $HL -Method Patch -Body (Body @{status='a_faire'}) -ContentType 'application/json' | Out-Null
$dd2 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
OK ((@($dd2.tasks | Where-Object id -eq $tAddId)[0].status) -eq 'a_faire') "comptable ASSIGNE PATCH status -> ok"
try { Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tAddId) -Headers $HS -Method Patch -Body (Body @{status='fait'}); OK $false "comptable non assigne PATCH task -> 403" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 403) "comptable non assigne PATCH task -> 403" }
try { $r = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks") -Headers $H -Method Post -Body (Body @{label='  '}); OK $false "task label vide -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "task label vide -> 400" }

# --- 3) timer : start / auto-stop / stop + coherence des sommes ---
$tA = $tAddId
$tB = @($dd2.tasks | Where-Object id -ne $tAddId)[0].id
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tA + "/timer/start") -Headers $H -Method Post | Out-Null
Start-Sleep -Seconds 4
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tB + "/timer/start") -Headers $H -Method Post | Out-Null
Start-Sleep -Seconds 2
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tB + "/timer/stop") -Headers $H -Method Post | Out-Null
$dd3 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
$gA = @($dd3.tasks | Where-Object id -eq $tA)[0]; $gB = @($dd3.tasks | Where-Object id -eq $tB)[0]
OK ($gA.total_time_seconds -ge 4) "auto-stop: tache A total >=4s ($($gA.total_time_seconds))"
OK ($gB.total_time_seconds -ge 2) "stop manuel: tache B total >=2s ($($gB.total_time_seconds))"
$sumUser = ($dd3.time_by_user | Measure-Object -Property seconds -Sum).Sum
$sumTasks = ($dd3.tasks | Measure-Object -Property total_time_seconds -Sum).Sum
OK ($sumUser -eq $sumTasks) "time_by_user == SUM tasks ($sumUser == $sumTasks)"
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tA + "/timer/start") -Headers $H -Method Post | Out-Null
try { Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tA + "/timer/start") -Headers $H -Method Post | Out-Null; OK $false "double start sur tache deja en chrono -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "double start sur tache deja en chrono -> 400" }
try { Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tA + "/time") -Headers $H -Method Post -Body (Body @{seconds=60}); OK $false "addTime avec chrono actif -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "addTime avec chrono actif -> 400" }
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tA + "/timer/stop") -Headers $H -Method Post | Out-Null
$ddA = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
$gA2 = @($ddA.tasks | Where-Object id -eq $tA)[0]

# --- 4) saisie manuelle du temps ---
$r1 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tAddId + "/time") -Headers $H -Method Post -Body (Body @{seconds=5400}) -ContentType 'application/json'
OK ($r1.total_seconds -eq ($gA2.total_time_seconds + 5400)) "addTime 5400 cumule ($($r1.total_seconds))"
$r2 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tAddId + "/time") -Headers $H -Method Post -Body (Body @{seconds=1800}) -ContentType 'application/json'
OK ($r2.total_seconds -eq ($r1.total_seconds + 1800)) "addTime 1800 cumule ($($r2.total_seconds))"
try { Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tAddId + "/time") -Headers $H -Method Post -Body (Body @{seconds=0}); OK $false "addTime 0 -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "addTime 0 -> 400" }
try { Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tAddId + "/time") -Headers $H -Method Post -Body (Body @{seconds=90000}); OK $false "addTime 25h -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "addTime 25h -> 400" }
$dd4 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
$sumTasks2 = ($dd4.tasks | Measure-Object -Property total_time_seconds -Sum).Sum
$sumUser2 = ($dd4.time_by_user | Measure-Object -Property seconds -Sum).Sum
OK ($sumTasks2 -eq $sumUser2) "apres saisies manuelles: SUM tasks == time_by_user ($sumTasks2 == $sumUser2)"

# --- 5) panel expert : time_by_dossier == SUM tasks du dossier ---
$det = Invoke-RestMethod "$B/api/org/comptables/user_comp_001/detail" -Headers $H
$td = @($det.time_by_dossier | Where-Object client_name -eq 'ZZ-FLOW-TEST')
OK ($td.Count -eq 1 -and $td[0].seconds -eq $sumTasks2) "panel temps par dossier == SUM tasks ($($td[0].seconds) == $sumTasks2)"
OK (($det.time_by_dossier | Where-Object client_name -eq 'ZZ-FLOW-TEST').seconds -gt 23) "panel depasse l ancien 23s"

# --- 6) note + timeline ---
$note = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/notes") -Headers $H -Method Post -Body (Body @{content='ZZ-FLOW note de test'}) -ContentType 'application/json'
$dd5 = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
OK (@($dd5.notes | Where-Object content -eq 'ZZ-FLOW note de test').Count -eq 1) "POST + GET note"
$tl = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/timeline") -Headers $H
$acts = @($tl | ForEach-Object { $_.type })
OK (@($acts | Where-Object { $_ -eq 'timer_started' }).Count -ge 1) "timeline: timer_started"
OK (@($acts | Where-Object { $_ -eq 'timer_stopped' }).Count -ge 1) "timeline: timer_stopped"
OK (@($acts | Where-Object { $_ -eq 'time_manual' }).Count -ge 2) "timeline: time_manual x2"
OK (@($acts | Where-Object { $_ -eq 'task_added' }).Count -ge 1) "timeline: task_added"

# --- 7) cloture : refuse si taches restantes, OK quand tout fait ---
try { Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/close") -Headers $H -Method Patch -Body (Body @{}); OK $false "close avec taches restantes -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "close avec taches restantes -> 400" }
foreach ($tk in @($dd5.tasks)) {
  if ($tk.status -ne 'fait') { Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/tasks/" + $tk.id) -Headers $H -Method Patch -Body (Body @{status='fait'}) -ContentType 'application/json' | Out-Null }
}
Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id + "/close") -Headers $H -Method Patch -Body (Body @{}) -ContentType 'application/json' | Out-Null
$ddC = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
OK ($ddC.status -eq 'cloture') "close -> status cloture"

# --- cleanup D1 ---
$cid = $c.id; $did = $d.id
npx.cmd wrangler d1 execute eurex-db --remote --json --command "DELETE FROM org_time_entries WHERE dossier_id='$did'; DELETE FROM org_expected_documents WHERE dossier_id='$did'; DELETE FROM org_tasks WHERE dossier_id='$did'; DELETE FROM org_notes WHERE dossier_id='$did'; DELETE FROM org_audit_log WHERE target_id='$did' OR target_id IN (SELECT id FROM org_time_entries WHERE dossier_id='$did') OR target_id IN (SELECT id FROM org_notes WHERE dossier_id='$did') OR (target_type='task' AND json_extract(details,'$.dossier_id')='$did'); DELETE FROM org_alert_dones WHERE alert_id IN (SELECT id FROM org_fiscal_alerts WHERE dossier_id='$did'); DELETE FROM org_fiscal_alerts WHERE dossier_id='$did'; DELETE FROM org_dossiers WHERE id='$did'; DELETE FROM org_clients WHERE id='$cid';" | Out-Null
$left = npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT (SELECT COUNT(*) FROM org_clients WHERE name='ZZ-FLOW-TEST') + (SELECT COUNT(*) FROM org_dossiers WHERE id='$did') + (SELECT COUNT(*) FROM org_fiscal_alerts WHERE dossier_id='$did') as n" 2>$null
$n = (($left | Out-String | ConvertFrom-Json)[0]).results[0].n
OK ($n -eq 0) "cleanup complet"

""
if ($script:fail -eq 0) { "ALL PASS" } else { "$script:fail FAILURES" }
exit $script:fail
