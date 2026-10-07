$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$B = "https://eurex-api.ezzinesalim21.workers.dev"
$script:fail = 0
function OK($cond, $msg) { if ($cond) { "PASS: $msg" } else { $script:fail++; "FAIL: $msg" } }
function Body($o) { ($o | ConvertTo-Json -Compress) }
function St([scriptblock]$fn) { try { $null = & $fn; -1 } catch { [int]$_.Exception.Response.StatusCode.value__ } }
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

# --- logins (comptes reels : aucun compte modifie) ---
$le = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='expert@eurex.tn';password='expert1234567'}) -ContentType 'application/json'
$H = @{ Authorization = 'Bearer ' + $le.token }
OK ($le.user.role -eq 'expert') "login expert"
$ls = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='samar@eurex.tn';password='samar1234567'}) -ContentType 'application/json'
$HS = @{ Authorization = 'Bearer ' + $ls.token }
OK ($null -ne $ls.token) "login samar (comptable non assigne)"

# --- compte de test JETABLE (cree ici, supprime en fin) ---
$qaMail = 'zz-clientdel-' + (Get-Random -Minimum 100000 -Maximum 999999) + '@test.eurex.tn'
$qaPwd = 'QaClientDel-' + (Get-Random -Minimum 100000 -Maximum 999999)
$qa = Invoke-RestMethod "$B/api/org/comptables" -Headers $H -Method Post -Body (Body @{full_name='QA ClientDel';email=$qaMail;password=$qaPwd;role='comptable'}) -ContentType 'application/json'
$qaId = $qa.id
Sql "UPDATE org_users SET must_change_password=0 WHERE id='$qaId'" | Out-Null
$lq = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email=$qaMail;password=$qaPwd}) -ContentType 'application/json'
$HQ = @{ Authorization = 'Bearer ' + $lq.token }
OK ($lq.user.role -eq 'comptable') "login du compte de test jetable"
OK ((St { Invoke-RestMethod ("$B/api/org/comptables/" + $qaId) -Headers $HS -Method Delete }) -eq 403) "DELETE compte par un comptable -> 403"
OK ((St { Invoke-RestMethod "$B/api/org/comptables/id_inconnu" -Headers $H -Method Delete }) -eq 404) "DELETE compte inconnu -> 404"
OK ((St { Invoke-RestMethod "$B/api/org/comptables/user_expert_001" -Headers $H -Method Delete }) -eq 400) "DELETE de son propre compte -> 400"

# --- client ZZ + dossier 2026 (pour tester la cascade) ---
$zz = 'ZZ-CLIENTDEL-' + (Get-Random -Minimum 100000 -Maximum 999999)
$c = Invoke-RestMethod "$B/api/org/clients" -Headers $H -Method Post -Body (Body @{name=$zz;person_type='morale';assigned_comptable_id=$qaId}) -ContentType 'application/json'
$cId = $c.id
$d = Invoke-RestMethod ("$B/api/org/clients/" + $cId + "/dossiers") -Headers $H -Method Post -Body (Body @{exercice=2026}) -ContentType 'application/json'
$dId = $d.id
$g0 = Invoke-RestMethod ("$B/api/org/dossiers/" + $dId) -Headers $H
OK (@($g0.tasks).Count -gt 0 -and @($g0.documents).Count -gt 0) "setup : dossier $dId avec taches + documents"
OK ((St { Invoke-RestMethod ("$B/api/org/comptables/" + $qaId) -Headers $H -Method Delete }) -eq 409) "DELETE compte avec client assigne -> 409"

# --- A) PATCH infos (expert) ---
$p1 = Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $H -Method Patch -Body (Body @{name=$zz+'-MODIF';matricule_fiscal='77777777/A/M/000';contact_email='nouveau@test.tn';contact_phone='+216 71 000 000'}) -ContentType 'application/json'
OK ($p1.ok -and $p1.name -eq ($zz+'-MODIF') -and $p1.matricule_fiscal -eq '77777777/A/M/000' -and $p1.contact_email -eq 'nouveau@test.tn' -and $p1.contact_phone -eq '+216 71 000 000') "PATCH infos client par expert -> 200 (4 champs)"
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $H -Method Patch -Body (Body @{name=''}) -ContentType 'application/json' }) -eq 400) "PATCH nom vide -> 400"
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $H -Method Patch -Body (Body @{contact_email='pas-un-email'}) -ContentType 'application/json' }) -eq 400) "PATCH email invalide -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/clients/client_inexistant" -Headers $H -Method Patch -Body (Body @{name='X'}) -ContentType 'application/json' }) -eq 404) "PATCH client inconnu -> 404"
# comptable assigne : person_type oui, nom non
$p2 = Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $HQ -Method Patch -Body (Body @{person_type='physique'}) -ContentType 'application/json'
OK ($p2.person_type -eq 'physique') "PATCH person_type par le comptable assigne -> 200"
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $HQ -Method Patch -Body (Body @{name='HACK'}) -ContentType 'application/json' }) -eq 403) "PATCH nom par un comptable -> 403 (reserve superviseur)"
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $HS -Method Patch -Body (Body @{person_type='morale'}) -ContentType 'application/json' }) -eq 403) "PATCH par un comptable non assigne -> 403"

# --- B) DELETE client ---
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $HQ -Method Delete }) -eq 403) "DELETE client par un comptable -> 403"
OK ((St { Invoke-RestMethod "$B/api/org/clients/client_inexistant" -Headers $H -Method Delete }) -eq 404) "DELETE client inconnu -> 404"
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $HS -Method Delete }) -eq 403) "DELETE client par samar (non assigne) -> 403"
$del = Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $H -Method Delete
OK ($del.ok -and $del.deleted -eq ($zz+'-MODIF')) "DELETE client par expert -> 200 (nom: $($del.deleted))"
$rest = (Sql "SELECT (SELECT COUNT(*) FROM org_clients WHERE id='$cId') + (SELECT COUNT(*) FROM org_dossiers WHERE id='$dId') + (SELECT COUNT(*) FROM org_tasks WHERE dossier_id='$dId') + (SELECT COUNT(*) FROM org_expected_documents WHERE dossier_id='$dId') + (SELECT COUNT(*) FROM org_fiscal_alerts WHERE dossier_id='$dId') as n")[0].n
OK ($rest -eq 0) "cascade : client + dossier + taches + documents + alertes purges (rest=$rest)"
$aud = (Sql "SELECT COUNT(*) as n FROM org_audit_log WHERE action='client_deleted' AND target_id='$cId'")[0].n
OK ($aud -ge 1) "audit client_deleted trace ($aud)"

# --- C) DELETE compte de test (plus de client assigne) ---
$del2 = Invoke-RestMethod ("$B/api/org/comptables/" + $qaId) -Headers $H -Method Delete
OK ($del2.ok -and $del2.deleted -eq $qaMail) "DELETE compte de test -> 200 ($($del2.deleted))"
$qaLeft = (Sql "SELECT COUNT(*) as n FROM org_users WHERE id='$qaId'")[0].n
OK ($qaLeft -eq 0) "compte de test supprime de la base (reste=$qaLeft)"

# --- cleanup : lignes d'audit residuelles ---
Sql "DELETE FROM org_audit_log WHERE target_id='$cId' OR target_id='$dId' OR target_id='$qaId'" | Out-Null
$auditRest = (Sql "SELECT COUNT(*) as n FROM org_audit_log WHERE target_id IN ('$cId','$dId','$qaId')")[0].n
OK ($auditRest -eq 0) "cleanup audit (reste=$auditRest)"
$zzRest = (Sql "SELECT COUNT(*) as n FROM org_users WHERE email LIKE 'zz-clientdel-%' OR email LIKE 'zz-grant-%' OR email LIKE 'zz-cab-test-%' OR email LIKE 'zz-role-%'")[0].n
OK ($zzRest -eq 0) "aucun compte de test residuel (reste=$zzRest)"

""
if ($script:fail -eq 0) { "ALL PASS" } else { "$script:fail FAILURES" }
exit $script:fail
