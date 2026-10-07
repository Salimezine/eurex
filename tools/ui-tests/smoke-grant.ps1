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
function Sql($q) {
  for ($i = 0; $i -lt 4; $i++) {
    try {
      $j = npx.cmd wrangler d1 execute eurex-db --remote --json --command $q 2>$null | Out-String | ConvertFrom-Json
      $r = $j[0].results
      if ($null -ne $r) { return $r }
    } catch {}
    Start-Sleep -Seconds 3
  }
  return $null
}

# --- logins ---
$le = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='expert@eurex.tn';password='expert1234567'}) -ContentType 'application/json'
$H = @{ Authorization = 'Bearer ' + $le.token }
OK ($le.user.role -eq 'expert') "login expert Omar"
# Comptable de test JETABLE (cree ici, supprime en fin) : aucun compte reel touche
$qaMail = 'zz-grant-' + (Get-Random -Minimum 100000 -Maximum 999999) + '@test.eurex.tn'
$qaPwd = 'QaGrant-' + (Get-Random -Minimum 100000 -Maximum 999999) + 'x'
$qa = Invoke-RestMethod "$B/api/org/comptables" -Headers $H -Method Post -Body (Body @{full_name='Test Comptable';email=$qaMail;password=$qaPwd;role='comptable'}) -ContentType 'application/json'
Sql "UPDATE org_users SET must_change_password=0 WHERE id='$($qa.id)'" | Out-Null
$lt = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email=$qaMail;password=$qaPwd}) -ContentType 'application/json'
$Ht = @{ Authorization = 'Bearer ' + $lt.token }
OK ($lt.user.role -eq 'comptable') "login comptable de test jetable ($qaMail)"
$ls = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='samar@eurex.tn';password='samar1234567'}) -ContentType 'application/json'
$Hs = @{ Authorization = 'Bearer ' + $ls.token }

# --- setup : client ZZ-GRANT assigne a Samar + dossier 2026 ---
$zz = 'ZZ-GRANT-' + (Get-Random)
$c = Invoke-RestMethod "$B/api/org/clients" -Headers $H -Method Post -Body (Body @{name=$zz;assigned_comptable_id='user_comp_002'}) -ContentType 'application/json'
$d = Invoke-RestMethod "$B/api/org/clients/$($c.id)/dossiers" -Headers $H -Method Post -Body (Body @{exercice=2026}) -ContentType 'application/json'
$g0 = Invoke-RestMethod "$B/api/org/dossiers/$($d.id)" -Headers $H
$t0 = $g0.tasks[0]
OK ($null -ne $d.id -and $null -ne $t0.id) "setup : dossier=$($d.id) task=$($t0.id)"

# due_date sur la tache (pour le feed des echeances)
Req PATCH "$B/api/org/dossiers/$($d.id)/tasks/$($t0.id)" $H (Body @{due_date='2026-12-31'}) | Out-Null

# 1) blocage hors dossier : le comptable non assigne est refuse
try { Invoke-RestMethod "$B/api/org/dossiers/$($d.id)" -Headers $Ht | Out-Null; OK $false "sans grant : GET dossier -> 403" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 403) "sans grant : GET dossier -> 403" }

# 2) ouverture du renfort (1 jour)
$gr = $null
  try { $gr = Invoke-RestMethod "$B/api/org/dossiers/$($d.id)/grants" -Headers $H -Method Post -Body (Body @{granted_to=$qa.id;days=1;reason='Remplacement conge'}) -ContentType 'application/json'; OK $true "grant 1j cree ($($gr.id))" }
catch { OK $false "grant 1j cree" }

# 3) le beneficiaire a maintenant acces + flag is_granted
try { $gd = Invoke-RestMethod "$B/api/org/dossiers/$($d.id)" -Headers $Ht; OK ($gd.is_granted -eq $true) "avec grant : GET dossier 200 + is_granted=true" }
catch { OK $false "avec grant : GET dossier 200 + is_granted=true" }

# 4) mes renforts
$mine = Invoke-RestMethod "$B/api/org/grants/mine" -Headers $Ht
OK (@(@($mine) | Where-Object { $_.dossier_id -eq $d.id }).Count -ge 1) "GET /grants/mine contient le dossier"

# 5) liste expert
$gl = Invoke-RestMethod "$B/api/org/dossiers/$($d.id)/grants" -Headers $H
OK ((@($gl).Count -eq 1) -and (@($gl)[0].granted_to_name -eq 'Test Comptable')) "liste expert : 1 grant (Test Comptable)"

# 6) garde-fous de creation
try { Req POST "$B/api/org/dossiers/$($d.id)/grants" $H (Body @{granted_to=$qa.id;days=7;reason='encore'}) | Out-Null; OK $false "doublon -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "doublon -> 400" }
try { Req POST "$B/api/org/dossiers/$($d.id)/grants" $H (Body @{granted_to='user_comp_001';days=5;reason='test'}) | Out-Null; OK $false "jours hors presets (5) -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "jours hors presets (5) -> 400" }
try { Req POST "$B/api/org/dossiers/$($d.id)/grants" $H (Body @{granted_to='user_comp_001';days=7;reason=''}) | Out-Null; OK $false "motif vide -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "motif vide -> 400" }
try { Req POST "$B/api/org/dossiers/$($d.id)/grants" $Ht (Body @{granted_to='user_comp_001';days=7;reason='x'}) | Out-Null; OK $false "comptable ouvre un grant -> 403" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 403) "comptable ouvre un grant -> 403" }

# 7) assignation de tache : acces (grant) -> 200 ; sans acces -> 400
try { Req PATCH "$B/api/org/dossiers/$($d.id)/tasks/$($t0.id)" $H (Body @{assigned_comptable_id=$qa.id}) | Out-Null; OK $true "assignation avec grant -> 200" }
catch { OK $false "assignation avec grant -> 200 ($($_.Exception.Response.StatusCode.value__))" }
try { Req PATCH "$B/api/org/dossiers/$($d.id)/tasks/$($t0.id)" $H (Body @{assigned_comptable_id='user_comp_001'}) | Out-Null; OK $false "assignation sans acces (Salim) -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "assignation sans acces (Salim) -> 400" }

# 8) feed : echeance + tache visibles pour le beneficiaire (grant actif)
$al = Invoke-RestMethod "$B/api/org/alerts" -Headers $Ht
OK (@(@($al.alerts) | Where-Object { $_.dossier_id -eq $d.id }).Count -ge 1) "feed alerts : echeance du dossier renforce visible"
OK (@(@($al.tasks) | Where-Object { $_.dossier_id -eq $d.id }).Count -ge 1) "feed tasks : tache due du dossier renforce visible"

# 9) revocation -> retour au blocage
Req DELETE "$B/api/org/dossiers/$($d.id)/grants/$($gr.id)" $H | Out-Null
try { Invoke-RestMethod "$B/api/org/dossiers/$($d.id)" -Headers $Ht | Out-Null; OK $false "apres revocation : GET dossier -> 403" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 403) "apres revocation : GET dossier -> 403" }
$mine2 = Invoke-RestMethod "$B/api/org/grants/mine" -Headers $Ht
OK ((@($mine2) | Where-Object { $_.dossier_id -eq $d.id }).Count -eq 0) "apres revocation : /grants/mine vide"
$al2 = Invoke-RestMethod "$B/api/org/alerts" -Headers $Ht
OK ((@($al2.alerts) | Where-Object { $_.dossier_id -eq $d.id }).Count -eq 0) "apres revocation : echeance hors feed"

# 10) regrant 30 jours -> expires_at ~ +30j
$gr2 = Invoke-RestMethod "$B/api/org/dossiers/$($d.id)/grants" -Headers $H -Method Post -Body (Body @{granted_to=$qa.id;days=30;reason='Renfort long'}) -ContentType 'application/json'
$row = (Sql "SELECT expires_at FROM org_dossier_grants WHERE id='$($gr2.id)'")[0]
$deltaH = (([datetime]::ParseExact($row.expires_at, 'yyyy-MM-dd HH:mm:ss', $null)) - [datetime]::UtcNow).TotalHours
OK ($deltaH -gt 696 -and $deltaH -lt 721) "expires_at ~ +30j ($([math]::Round($deltaH,1))h = $([math]::Round($deltaH/24,1))j)"

# 11) expiration forcee -> acces perdu
Sql "UPDATE org_dossier_grants SET expires_at = datetime('now','-1 minute') WHERE id='$($gr2.id)'" | Out-Null
try { Invoke-RestMethod "$B/api/org/dossiers/$($d.id)" -Headers $Ht | Out-Null; OK $false "grant expire : GET dossier -> 403" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 403) "grant expire : GET dossier -> 403" }

# 12) audits
$ac = (Sql "SELECT COUNT(*) as n FROM org_audit_log WHERE action='grant_created' AND target_id='$($d.id)'")[0].n
$ar = (Sql "SELECT COUNT(*) as n FROM org_audit_log WHERE action='grant_revoked' AND target_id='$($d.id)'")[0].n
OK ($ac -ge 2) "audit grant_created ($ac)"
OK ($ar -ge 1) "audit grant_revoked ($ar)"

# --- cleanup SQL (DELETE separes, ordre des FK) ---
Sql "DELETE FROM org_expected_documents WHERE dossier_id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_alert_dones WHERE alert_id IN (SELECT id FROM org_fiscal_alerts WHERE dossier_id='$($d.id)')" | Out-Null
Sql "DELETE FROM org_fiscal_alerts WHERE dossier_id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_notes WHERE dossier_id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_time_entries WHERE dossier_id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_tasks WHERE dossier_id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_dossier_grants WHERE dossier_id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_audit_log WHERE target_id='$($d.id)' AND action IN ('grant_created','grant_revoked')" | Out-Null
Sql "DELETE FROM org_dossiers WHERE id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_clients WHERE id='$($c.id)'" | Out-Null
$rest = (Sql "SELECT (SELECT COUNT(*) FROM org_dossiers WHERE id='$($d.id)') + (SELECT COUNT(*) FROM org_clients WHERE id='$($c.id)') + (SELECT COUNT(*) FROM org_dossier_grants WHERE dossier_id='$($d.id)') as n")[0].n
OK ($rest -eq 0) "cleanup SQL (rest=$rest)"

# --- suppression du compte de test jetable ---
try { Invoke-RestMethod "$B/api/org/comptables/$($qa.id)" -Headers $H -Method Delete | Out-Null; $qaGone = $true } catch { $qaGone = $false }
$qaLeft = (Sql "SELECT COUNT(*) as n FROM org_users WHERE id='$($qa.id)'")[0].n
OK ($qaGone -and $qaLeft -eq 0) "cleanup : compte de test jetable supprime"

""
if ($script:fail -eq 0) { "ALL PASS" } else { "$($script:fail) FAILURES" }
exit $script:fail
