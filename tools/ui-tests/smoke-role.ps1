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

$le = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='expert@eurex.tn';password='expert1234567'}) -ContentType 'application/json'
$H = @{ Authorization = 'Bearer ' + $le.token }
OK ($le.user.role -eq 'expert') "login expert Omar (role=$($le.user.role))"

# 0) Abla = manager (reference : role_label applique)
$lm = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='manager@eurex.tn';password='manager1234567'}) -ContentType 'application/json'
OK ($lm.user.role -eq 'manager') "login Abla role effectif = manager ($($lm.user.role))"
$me = Invoke-RestMethod "$B/api/org/auth/me" -Headers $H
OK ($me.id -ne $null) "id present"

# 1) liste personnel = tout le staff + role
$staff = Invoke-RestMethod "$B/api/org/comptables" -Headers $H
OK (@($staff).Count -ge 3) "GET /comptables : $(@($staff).Count) comptes"
OK (@($staff | Where-Object { $_.role -eq 'manager' }).Count -ge 1) "au moins 1 manager dans la liste"
$comp = @($staff | Where-Object { $_.role -eq 'comptable' -and $_.id -ne 'user_expert_001' })[0]
OK ($null -ne $comp) "un comptable cible : $($comp.full_name)"

# 2) creation avec role manager
$mail = 'zz.role' + (Get-Random) + '@eurex.tn'
$c1 = Invoke-RestMethod "$B/api/org/comptables" -Headers $H -Method Post -Body (Body @{full_name='ZZ Role Test';email=$mail;password='motdepasse1234';role='manager'}) -ContentType 'application/json'
OK ($c1.role -eq 'manager') "creation role=manager -> $($c1.role)"

# 3) le nouveau compte se logge : role manager = superviseur
$l1 = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email=$mail;password='motdepasse1234'}) -ContentType 'application/json'
OK ($l1.user.role -eq 'manager') "login nouveau compte role=$($l1.user.role)"
$H1 = @{ Authorization = 'Bearer ' + $l1.token }
try { $cl = Invoke-RestMethod "$B/api/org/clients" -Headers $H1; OK ($true) "manager = superviseur : GET /clients OK ($($cl.Count) clients)" } catch { OK $false "manager = superviseur : GET /clients" }
try { $st2 = Invoke-RestMethod "$B/api/org/comptables" -Headers $H1; OK ($true) "manager : GET /comptables OK" } catch { OK $false "manager : GET /comptables (403 attendu si pas superviseur)" }

# 4) garde-fou : modifier son propre compte -> 400
try { Req PATCH "$B/api/org/comptables/$($me.id)" $H (Body @{role='comptable'}) | Out-Null; OK $false "auto-modification -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "auto-modification -> 400" }

# 5) garde-fou : role invalide -> 400
try { Req PATCH "$B/api/org/comptables/$($c1.id)" $H (Body @{role='superuser'}) | Out-Null; OK $false "role invalide -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "role invalide -> 400" }

# 6) garde-fou : un comptable ne peut pas changer les roles -> 403
$lc = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='samar@eurex.tn';password='samar1234567'}) -ContentType 'application/json'
$Hc = @{ Authorization = 'Bearer ' + $lc.token }
try { Req PATCH "$B/api/org/comptables/$($c1.id)" $Hc (Body @{role='expert'}) | Out-Null; OK $false "comptable change un role -> 403" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 403) "comptable change un role -> 403" }

# 7) garde-fou : dernier superviseur actif -> 400 (sauté tant qu'un autre superviseur existe)
# NB : ne JAMAIS pipper Invoke-RestMethod directement vers Where-Object (tableau non déplié -> $_ = tableau entier)
$all7 = Invoke-RestMethod "$B/api/org/comptables" -Headers $H
$sups = @($all7 | Where-Object { $_.role -in @('manager','expert') -and $_.is_active -eq 1 -and $_.id -ne $c1.id })
if ($sups.Count -eq 0) {
  try { Req PATCH "$B/api/org/comptables/$($c1.id)" $H (Body @{role='comptable'}) | Out-Null; OK $false "dernier superviseur -> 400" }
  catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "dernier superviseur -> 400" }
} else { OK $true "auto: $($sups.Count) autre(s) superviseur(s) actif(s) (garde-fou derniere ligne : test saute)" }

# 8) promotion manager -> expert puis retrogradation -> comptable
$r = Invoke-RestMethod "$B/api/org/comptables/$($c1.id)" -Headers $H -Method Patch -Body (Body @{role='expert'}) -ContentType 'application/json'
OK ($r.role -eq 'expert') "promotion -> expert ($($r.role))"
$l2 = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email=$mail;password='motdepasse1234'}) -ContentType 'application/json'
OK ($l2.user.role -eq 'expert') "relogin apres promotion role=$($l2.user.role)"
$r2 = Invoke-RestMethod "$B/api/org/comptables/$($c1.id)" -Headers $H -Method Patch -Body (Body @{role='comptable'}) -ContentType 'application/json'
OK ($r2.role -eq 'comptable') "retrogradation -> comptable ($($r2.role))"
$l3 = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email=$mail;password='motdepasse1234'}) -ContentType 'application/json'
OK ($l3.user.role -eq 'comptable') "relogin apres retrogradation role=$($l3.user.role)"
$H3 = @{ Authorization = 'Bearer ' + $l3.token }
try { Invoke-RestMethod "$B/api/org/comptables" -Headers $H3; OK $false "ex-promu (comptable) : GET /comptables -> 403" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 403) "ex-promu (comptable) : GET /comptables -> 403" }

# 9) audit user_role_changed
$aud = $null
for ($i = 0; $i -lt 3 -and -not $aud; $i++) {
  try { $aud = npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT COUNT(*) as n FROM org_audit_log WHERE action='user_role_changed' AND target_id='$($c1.id)'" 2>$null | Out-String | ConvertFrom-Json } catch { $aud = $null }
  if (-not $aud) { Start-Sleep -Seconds 3 }
}
$n = if ($aud) { ($aud[0]).results[0].n } else { -1 }
OK ($n -ge 3) "audit user_role_changed ($n entrees : creation + promotion + retrogradation)"

# 10) le bon role via role_label (manager stocke expert + label)
try { Req PATCH "$B/api/org/comptables/$($c1.id)" $H (Body @{role='manager'}) | Out-Null; $l4 = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email=$mail;password='motdepasse1234'}) -ContentType 'application/json'; OK ($l4.user.role -eq 'manager') "retour manager via role_label ($($l4.user.role))" } catch { OK $false "retour manager via role_label" }

# cleanup SQL : suppression du compte test + audits
npx.cmd wrangler d1 execute eurex-db --remote --json --command "DELETE FROM org_audit_log WHERE target_id='$($c1.id)'; DELETE FROM org_users WHERE id='$($c1.id)';" | Out-Null
$chk = ((npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT COUNT(*) as n FROM org_users WHERE id='$($c1.id)'" 2>$null | Out-String | ConvertFrom-Json)[0]).results[0].n
OK ($chk -eq 0) "cleanup compte test"

""
if ($script:fail -eq 0) { "ALL PASS" } else { "$script:fail FAILURES" }
exit $script:fail
