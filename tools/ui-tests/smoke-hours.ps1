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
$ls = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='samar@eurex.tn';password='samar1234567'}) -ContentType 'application/json'
$Hs = @{ Authorization = 'Bearer ' + $ls.token }
OK ($ls.user.role -eq 'comptable') "login Samar (comptable)"

# --- 401 sans token ---
try { Invoke-RestMethod "$B/api/org/me/hours" | Out-Null; OK $false "sans token -> 401" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 401) "sans token -> 401" }

# --- setup : client ZZ-HOURS assigne a Samar + dossier 2026 ---
$zz = 'ZZ-HOURS-' + (Get-Random)
$c = Invoke-RestMethod "$B/api/org/clients" -Headers $H -Method Post -Body (Body @{name=$zz;assigned_comptable_id='user_comp_002'}) -ContentType 'application/json'
$d = Invoke-RestMethod "$B/api/org/clients/$($c.id)/dossiers" -Headers $H -Method Post -Body (Body @{exercice=2026}) -ContentType 'application/json'
$g0 = Invoke-RestMethod "$B/api/org/dossiers/$($d.id)" -Headers $H
$t0 = $g0.tasks[0]
OK ($null -ne $d.id -and $null -ne $t0.id) "setup : dossier=$($d.id) task=$($t0.id)"

# --- structure (expert) ---
$h0 = Invoke-RestMethod "$B/api/org/me/hours" -Headers $H
OK (@($h0.days).Count -eq 7) "days = 7 jours"
OK ($h0.today.is_today -eq $true) "today.is_today = true"
OK (@($h0.days)[-1].date -eq $h0.today.date) "today = dernier jour de la liste"
$dates = @($h0.days | ForEach-Object { $_.date })
$sameDates = $true
for ($i = 1; $i -lt $dates.Count; $i++) { if ($dates[$i] -le $dates[$i-1]) { $sameDates = $false } }
OK $sameDates "jours tries en ordre croissant"

# jour TN courant cote SQL == today.date
$tnDate = (Sql "SELECT date(datetime('now','+60 minutes')) as d")[0].d
OK ($h0.today.date -eq $tnDate) "today.date = jour TN courant ($($h0.today.date))"

# norme aujourd'hui : 8h30 lun-ven, 0 sam-dim
$dowTn = [int][DateTime]::ParseExact($h0.today.date, 'yyyy-MM-dd', $null).DayOfWeek.value__
$expNorm = if ($dowTn -eq 0 -or $dowTn -eq 6) { 0 } else { 30600 }
OK ($h0.today.norm_seconds -eq $expNorm) "norme aujourd'hui = $expNorm (dow=$dowTn)"
OK (($h0.today.rest -eq $true) -xor ($expNorm -eq 30600)) "flag repos coherent avec la norme"

# exactement 1 samedi + 1 dimanche dans les 7 jours, norme 0 + missing 0
$restDays = @($h0.days | Where-Object { $_.rest -eq $true })
OK ($restDays.Count -eq 2) "2 jours de repos (sam+dim) dans la fenetre"
OK (@($restDays | Where-Object { $_.norm_seconds -ne 0 }).Count -eq 0) "jours de repos : norme = 0"
OK (@($restDays | Where-Object { $_.missing_seconds -ne 0 }).Count -eq 0) "jours de repos : non travaille = 0"

# jour ouvre : norme 30600, missing = max(0, norm - worked)
$openDays = @($h0.days | Where-Object { $_.rest -eq $false })
$normOk = $true; $missOk = $true
foreach ($x in $openDays) {
  if ($x.norm_seconds -ne 30600) { $normOk = $false }
  $expMiss = [Math]::Max(0, 30600 - [int]$x.worked_seconds)
  if ([int]$x.missing_seconds -ne $expMiss) { $missOk = $false }
}
OK $normOk "jours ouvres : norme = 8h30 (30600s)"
OK $missOk "jours ouvres : non travaille = max(0, 8h30 - realise)"

# totaux = sommes des jours
$sw = 0; $sn = 0; $sm = 0; $so = 0
foreach ($x in $h0.days) { $sw += [int]$x.worked_seconds; $sn += [int]$x.norm_seconds; $sm += [int]$x.missing_seconds; $so += [int]$x.overtime_seconds }
OK ([int]$h0.totals.worked_seconds -eq $sw) "totals.worked = somme jours ($sw)"
OK ([int]$h0.totals.norm_seconds -eq $sn) "totals.norm = somme normes ($sn)"
OK ([int]$h0.totals.missing_seconds -eq $sm) "totals.missing = somme manques ($sm)"
OK ([int]$h0.totals.overtime_seconds -eq $so) "totals.overtime = somme depassements ($so)"

# depassement par jour = max(0, realise - norme) — y compris le jour de repos (rattrapage)
$otOk = $true
foreach ($x in $h0.days) {
  $expOt = [Math]::Max(0, [int]$x.worked_seconds - [int]$x.norm_seconds)
  if ([int]$x.overtime_seconds -ne $expOt) { $otOk = $false }
}
OK $otOk "overtime par jour = max(0, realise - norme) (inclus repos)"

# solde net de la semaine : le depassement d'un jour compense le ghyeb d'un autre
$expNet = [Math]::Max(0, [int]$h0.totals.norm_seconds - [int]$h0.totals.worked_seconds)
$expSur = [Math]::Max(0, [int]$h0.totals.worked_seconds - [int]$h0.totals.norm_seconds)
OK ([int]$h0.totals.net_missing_seconds -eq $expNet) "totals.net_missing = max(0, norme - realise) ($expNet)"
OK ([int]$h0.totals.surplus_seconds -eq $expSur) "totals.surplus = max(0, realise - norme) ($expSur)"
OK ([int]$h0.totals.net_missing_seconds -le $sm) "solde net <= somme des manques (compensation possible)"

# online flag present
OK (($h0.online -eq $true) -or ($h0.online -eq $false)) "online = bool ($($h0.online))"

# --- VUE MOIS : jours 1..aujourd'hui, norme cumulee ---
$hm = Invoke-RestMethod "$B/api/org/me/hours?view=month" -Headers $H
OK ($hm.view -eq 'month') "view=month : echo de la vue"
$tnNow = [datetime]::UtcNow.AddHours(1)
OK (@($hm.days).Count -eq [int]$tnNow.Day) "vue mois : $($tnNow.Day) lignes (1er -> $($tnNow.Day))"
OK (@($hm.days)[-1].is_today -eq $true) "vue mois : dernier jour = aujourd'hui"
OK (@($hm.days)[0].date -eq $tnNow.ToString('yyyy-MM-01')) "vue mois : premier jour = 1er du mois"
$wNorm = 0; $wWork = 0
foreach ($x in $hm.days) { $wNorm += [int]$x.norm_seconds; $wWork += [int]$x.worked_seconds }
OK ([int]$hm.totals.norm_seconds -eq $wNorm) "vue mois : norme totale = somme des jours ($wNorm)"
OK ([int]$hm.totals.worked_seconds -eq $wWork) "vue mois : realise total = somme des jours ($wWork)"

# --- VUE ANNEE : un rang par mois (janv -> mois courant) ---
$hy = Invoke-RestMethod "$B/api/org/me/hours?view=year" -Headers $H
OK ($hy.view -eq 'year') "view=year : echo de la vue"
OK (@($hy.months).Count -eq [int]$tnNow.Month) "vue annee : $($tnNow.Month) mois (janv -> $($tnNow.Month))"
OK ((@($hy.months)[-1].is_current -eq $true)) "vue annee : dernier mois = mois courant"
OK ([int](@($hy.months)[0].month) -eq 1) "vue annee : premier rang = janvier (1)"
# norme annee = 30600 x (jours ouvres de l'annee jusqu'aujourd'hui)
$wk = 0
$d0 = (Get-Date -Year $tnNow.Year -Month 1 -Day 1).Date
while ($d0 -le $tnNow.Date) { if ($d0.DayOfWeek -ne 'Saturday' -and $d0.DayOfWeek -ne 'Sunday') { $wk++ }; $d0 = $d0.AddDays(1) }
OK ([int]$hy.totals.norm_seconds -eq ($wk * 30600)) "vue annee : norme = $wk jours ouvres x 8h30 ($($wk * 30600))"
$swY = 0; foreach ($m in $hy.months) { $swY += [int]$m.worked_seconds }
OK ([int]$hy.totals.worked_seconds -eq $swY) "vue annee : totals.worked = somme des mois ($swY)"
# la vue mois est incluse dans l'annee (meme mois courant)
OK ([int](@($hy.months)[-1].worked_seconds) -ge [int]$hm.totals.worked_seconds - 60) "coherence mois/annee : mois courant >= total mois ($($hm.totals.worked_seconds)s)"

# --- HEURES D'UN COMPTABLE (fiche comptable, expert) ---
$uc = 'user_comp_002'
$hc = Invoke-RestMethod "$B/api/org/comptables/$uc/hours?view=days" -Headers $H
OK ($hc.view -eq 'days' -and (@($hc.days).Count -eq 7)) "comptables/{id}/hours : 7 jours (Samar)"
OK ($null -ne $hc.totals) "comptables/{id}/hours : totaux presents"
$hcY = Invoke-RestMethod "$B/api/org/comptables/$uc/hours?view=year" -Headers $H
OK (@($hcY.months).Count -eq [int]$tnNow.Month) "comptables/{id}/hours : vue annee = $($tnNow.Month) mois"
$hcM = Invoke-RestMethod "$B/api/org/comptables/$uc/hours?view=month" -Headers $H
OK (@($hcM.days).Count -eq [int]$tnNow.Day) "comptables/{id}/hours : vue mois = $($tnNow.Day) jours"
# un comptable ne peut pas consulter les heures des autres
try { Invoke-RestMethod "$B/api/org/comptables/user_comp_001/hours" -Headers $Hs | Out-Null; OK $false "comptable -> 403 sur les heures des autres" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 403) "comptable -> 403 sur les heures des autres" }
# id inexistant -> 404
try { Invoke-RestMethod "$B/api/org/comptables/user_zz_nope/hours" -Headers $H | Out-Null; OK $false "id inconnu -> 404" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 404) "id inconnu -> 404" }

# --- RATTRAPAGE DU GHYEB : 10h pointees sur un jour -3 (compense le solde net) ---
$rId = 'te_hh_' + [guid]::NewGuid().ToString('N').Substring(0, 12)
Sql "INSERT INTO org_time_entries (id, dossier_id, task_id, user_id, started_at, stopped_at, duration_seconds, note) VALUES ('$rId', '$($d.id)', '$($t0.id)', 'user_comp_002', datetime('now','-3 days','start of day','+9 hours'), datetime('now','-3 days','start of day','+19 hours'), 36000, 'rattrapage ghyeb')" | Out-Null
$r0 = Invoke-RestMethod "$B/api/org/me/hours" -Headers $Hs
Sql "DELETE FROM org_time_entries WHERE id='$rId'" | Out-Null
$r1 = Invoke-RestMethod "$B/api/org/me/hours" -Headers $Hs
# apres suppression : retour a l'etat initial (le fetch r0 etait avec l'entree, r1 sans)
$net0 = [int]$r1.totals.net_missing_seconds
$work0 = [int]$r1.totals.worked_seconds
$norm0 = [int]$r1.totals.norm_seconds
OK ([Math]::Abs(([int]$r0.totals.worked_seconds) - ($work0 + 36000)) -le 60) "avec entree 10h : totals.worked + 36000 ($($r0.totals.worked_seconds))"
$netWith = [Math]::Max(0, $norm0 - ($work0 + 36000))
OK ([Math]::Abs(([int]$r0.totals.net_missing_seconds) - $netWith) -le 60) "avec entree 10h : solde net recalcule ($netWith)"
if ($net0 -ge 36000) {
  OK ([Math]::Abs(([int]$r0.totals.net_missing_seconds) - ($net0 - 36000)) -le 60) "RATTRAPAGE : le solde net diminue d'autant que les 10h pointees ($net0 -> $($r0.totals.net_missing_seconds))"
} else {
  OK (([int]$r0.totals.net_missing_seconds) -eq 0) "RATTRAPAGE : ghyeb entierement compense (solde net = 0)"
}
# le jour -3 porte bien les 10h + le depassement
$tnM3 = ([DateTime]::UtcNow.AddHours(1).AddDays(-3)).ToString('yyyy-MM-dd')
$dayM3 = @($r0.days | Where-Object { $_.date -eq $tnM3 })[0]
OK ($null -ne $dayM3) "jour -3 ($tnM3) present dans la fenetre"
OK ([int]$dayM3.worked_seconds -ge 36000) "jour -3 : +10h de realise ($($dayM3.worked_seconds)s)"
OK ([int]$dayM3.overtime_seconds -eq [Math]::Max(0, [int]$dayM3.worked_seconds - [int]$dayM3.norm_seconds)) "jour -3 : overtime = max(0, realise - norme) = $($dayM3.overtime_seconds)s"

# --- add time 3600s (Samar) -> delta du jour courant ---
$before = Invoke-RestMethod "$B/api/org/me/hours" -Headers $Hs
$w0 = [int]$before.today.worked_seconds
$t0b = [int]$before.totals.worked_seconds
Req POST "$B/api/org/dossiers/$($d.id)/tasks/$($t0.id)/time" $Hs (Body @{seconds=3600;note='smoke heures'}) | Out-Null
$after = Invoke-RestMethod "$B/api/org/me/hours" -Headers $Hs
$w1 = [int]$after.today.worked_seconds
$t1 = [int]$after.totals.worked_seconds
OK (($w1 - $w0) -ge 3500 -and ($w1 - $w0) -le 3900) "add time 3600s -> today.worked +$($w1 - $w0)"
OK (($t1 - $t0b) -ge 3500 -and ($t1 - $t0b) -le 3900) "add time 3600s -> totals.worked +$($t1 - $t0b)"
# today reste coherent apres l'ajout
$expMiss1 = [Math]::Max(0, [int]$after.today.norm_seconds - $w1)
OK ([int]$after.today.missing_seconds -eq $expMiss1) "today.missing recalcule ($expMiss1)"
# la source SQL confirme l'entree
$src = (Sql "SELECT COALESCE(SUM(duration_seconds),0) as n FROM org_time_entries WHERE user_id='user_comp_002' AND dossier_id='$($d.id)' AND stopped_at IS NOT NULL")[0].n
OK ($src -ge 3600) "SQL : entree de temps enregistree ($src s)"

# --- acces tous roles : manager + expert voient aussi les leurs ---
OK ((@($h0.days).Count -eq 7)) "expert : jours presents"
OK ((@($after.days).Count -eq 7)) "comptable (Samar) : jours presents"

# --- cleanup SQL (DELETE separes, ordre des FK) ---
Sql "DELETE FROM org_expected_documents WHERE dossier_id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_alert_dones WHERE alert_id IN (SELECT id FROM org_fiscal_alerts WHERE dossier_id='$($d.id)')" | Out-Null
Sql "DELETE FROM org_fiscal_alerts WHERE dossier_id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_notes WHERE dossier_id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_audit_log WHERE action='time_manual' AND target_id IN (SELECT id FROM org_tasks WHERE dossier_id='$($d.id)')" | Out-Null
Sql "DELETE FROM org_time_entries WHERE dossier_id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_tasks WHERE dossier_id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_dossiers WHERE id='$($d.id)'" | Out-Null
Sql "DELETE FROM org_clients WHERE id='$($c.id)'" | Out-Null
$rest = (Sql "SELECT (SELECT COUNT(*) FROM org_dossiers WHERE id='$($d.id)') + (SELECT COUNT(*) FROM org_clients WHERE id='$($c.id)') + (SELECT COUNT(*) FROM org_time_entries WHERE dossier_id='$($d.id)') as n")[0].n
OK ($rest -eq 0) "cleanup SQL (rest=$rest)"

""
if ($script:fail -eq 0) { "ALL PASS" } else { "$($script:fail) FAILURES" }
exit $script:fail
