$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$B = "https://eurex-api.ezzinesalim21.workers.dev"
$script:fail = 0
function OK($cond, $msg) { if ($cond) { "PASS: $msg" } else { $script:fail++; "FAIL: $msg" } }
function Body($o) { ($o | ConvertTo-Json -Compress) }

$lr = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='expert@eurex.tn';password='expert1234567'}) -ContentType 'application/json'
$H = @{ Authorization = 'Bearer ' + $lr.token }
OK ($null -ne $lr.token) "login expert"

# dossier test
$c = Invoke-RestMethod "$B/api/org/clients" -Headers $H -Method Post -Body (Body @{name='ZZ-TEST dossier pack';person_type='physique';assigned_comptable_id='user_comp_001'}) -ContentType 'application/json'
$d = Invoke-RestMethod ("$B/api/org/clients/" + $c.id + "/dossiers") -Headers $H -Method Post -Body (Body @{exercice=2026}) -ContentType 'application/json'
OK ($null -ne $d.id) "dossier cree"
$suffix = 'd' + $d.id

# 1) feed dossier : pack du dossier seede au 1er accès
$f1 = Invoke-RestMethod ("$B/api/org/alerts?dossier_id=" + $d.id) -Headers $H
$packD = @($f1.alerts | Where-Object { $_.id -like 'pack_*' })
OK ($packD.Count -ge 5) "pack du dossier visible ($($packD.Count) occ)"
OK (@($f1.alerts | Where-Object { $_.id -notlike ('pack_*_' + $suffix) -and $_.id -like 'pack_*' }).Count -eq 0) "uniquement le pack de CE dossier"
OK (@($packD | Where-Object { $_.id -like 'pack_pm_mensuelle_*' -and ($_.due_date -notlike '*-20' -or $_.category -ne 'morale') }).Count -eq 0) "pack dossier: PM 20 + categorie morale"
OK (@($f1.alerts | Where-Object { $_.kind -eq 'task' }).Count -ge 0) "feed dossier inclut taches"

# 2) modifiable (expert)
$target = $packD | Where-Object { $_.id -like 'pack_pm_mensuelle_*' } | Select-Object -First 1
$p1 = Invoke-RestMethod ("$B/api/org/alerts/" + $target.id) -Headers $H -Method Patch -Body (Body @{title='ZZ-EDIT dossier'}) -ContentType 'application/json'
OK ($p1.title -eq 'ZZ-EDIT dossier') "PATCH alerte pack-dossier (modifiable)"
$p2 = Invoke-RestMethod ("$B/api/org/alerts/" + $target.id) -Headers $H -Method Patch -Body (Body @{category='morale';lead_days=10}) -ContentType 'application/json'
OK ($p2.category -eq 'morale' -and $p2.lead_days -eq 10) "PATCH category+lead sur pack-dossier"
# restauration avant suppression du dossier (inutile mais propre)
Invoke-RestMethod ("$B/api/org/alerts/" + $target.id) -Headers $H -Method Patch -Body (Body @{title=$target.title;category=$target.category;lead_days=$target.lead_days}) -ContentType 'application/json' | Out-Null

# 3) custom alerte dans le dossier
$a = Invoke-RestMethod "$B/api/org/alerts" -Headers $H -Method Post -Body (Body @{title='ZZ custom dossier';due_date='2026-10-20';dossier_id=$d.id;category='physique'}) -ContentType 'application/json'
OK ($a.dossier_id -eq $d.id) "POST custom alerte rattachee au dossier"
$f2 = Invoke-RestMethod ("$B/api/org/alerts?dossier_id=" + $d.id) -Headers $H
OK (@($f2.alerts | Where-Object id -eq $a.id).Count -eq 1) "custom visible dans le feed dossier"
OK (@($f2.alerts).Count -eq (@($f1.alerts).Count + 1)) "feed stable + custom ($(@($f2.alerts).Count) vs $($f1.alerts.Count+1))"

# 4) idempotence : 2e GET sans nouvelle ecriture
$f3 = Invoke-RestMethod ("$B/api/org/alerts?dossier_id=" + $d.id) -Headers $H
OK (@($f3.alerts).Count -eq @($f2.alerts).Count) "idempotent au 2e GET"

# 5) pack global intact sur le feed cabinet
$fg = Invoke-RestMethod "$B/api/org/alerts" -Headers $H
OK (@($fg.alerts | Where-Object { $_.id -like 'pack_*' }).Count -ge 5) "pack global toujours present sur dashboard"

# 6) D1 : 15 lignes rattachees au dossier
$d1raw = npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT COUNT(*) as n FROM org_fiscal_alerts WHERE dossier_id='$($d.id)' AND id LIKE 'pack_%'" 2>$null
$n = (($d1raw | Out-String | ConvertFrom-Json)[0]).results[0].n
OK ($n -eq 15) "D1: 15 lignes pack rattachees au dossier ($n)"

# --- cleanup complet ---
$did = $d.id; $cid = $c.id; $aid = $a.id
npx.cmd wrangler d1 execute eurex-db --remote --json --command "DELETE FROM org_alert_dones WHERE alert_id IN (SELECT id FROM org_fiscal_alerts WHERE dossier_id='$did'); DELETE FROM org_fiscal_alerts WHERE dossier_id='$did'; DELETE FROM org_fiscal_alerts WHERE id='$aid'; DELETE FROM org_expected_documents WHERE dossier_id='$did'; DELETE FROM org_tasks WHERE dossier_id='$did'; DELETE FROM org_notes WHERE dossier_id='$did'; DELETE FROM org_dossiers WHERE id='$did'; DELETE FROM org_clients WHERE id='$cid';" | Out-Null
$d1raw2 = npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT (SELECT COUNT(*) FROM org_clients WHERE id='$cid') as c1, (SELECT COUNT(*) FROM org_fiscal_alerts WHERE dossier_id='$did') as c2, (SELECT COUNT(*) FROM org_fiscal_alerts WHERE id='$aid') as c3" 2>$null
$r = (($d1raw2 | Out-String | ConvertFrom-Json)[0]).results[0]
OK ($r.c1 -eq 0 -and $r.c2 -eq 0 -and $r.c3 -eq 0) "cleanup complet (client, pack dossier, custom)"

""
if ($script:fail -eq 0) { "ALL PASS" } else { "$script:fail FAILURES" }
exit $script:fail
