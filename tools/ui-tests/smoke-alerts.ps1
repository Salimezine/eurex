$env:PATH = "C:\Program Files\nodejs;$env:PATH"
$B = "https://eurex-api.ezzinesalim21.workers.dev"
$script:fail = 0
function OK($cond, $msg) { if ($cond) { "PASS: $msg" } else { $script:fail++; "FAIL: $msg" } }
function Body($o) { ($o | ConvertTo-Json -Compress) }
function St([scriptblock]$fn) { try { $null = & $fn; -1 } catch { [int]$_.Exception.Response.StatusCode.value__ } }

# --- logins ---
$lr = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='expert@eurex.tn';password='expert1234567'}) -ContentType 'application/json'
$H = @{ Authorization = 'Bearer ' + $lr.token }
OK ($null -ne $lr.token) "login expert"
$lr2 = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='samar@eurex.tn';password='samar1234567'}) -ContentType 'application/json'
$H2 = @{ Authorization = 'Bearer ' + $lr2.token }
OK ($null -ne $lr2.token) "login comptable samar"

# --- 1) feed pack : dates + categories ---
$f = Invoke-RestMethod "$B/api/org/alerts" -Headers $H
$pack = @($f.alerts | Where-Object { $_.id -like 'pack_*' })
OK ($pack.Count -ge 5) "pack occurrences fenetre ($($pack.Count))"
$pmBad = @($pack | Where-Object { $_.id -like 'pack_pm_mensuelle_*' -and $_.due_date -notlike '*-20' })
OK ($pmBad.Count -eq 0) "PM mensuelle = jour 20 (tele-declaration)"
OK (@($pack | Where-Object { $_.id -like 'pack_pm_*' -and $_.category -ne 'morale' }).Count -eq 0) "PM mensuelle category=morale"
OK (@($pack | Where-Object { $_.id -like 'pack_acomptes_pm_*' -and $_.category -ne 'morale' }).Count -eq 0) "acomptes PM category=morale"
OK (@($pack | Where-Object { $_.id -like 'pack_cnss_*' -and $null -ne $_.category }).Count -eq 0) "CNSS category=null"

# --- 2) idempotence ---
$f2 = Invoke-RestMethod "$B/api/org/alerts" -Headers $H
OK (@($f2.alerts).Count -eq @($f.alerts).Count) "feed stable au 2e GET (upsert idempotent)"

# --- 3) custom alert : CRUD expert + droits comptable (global = 403) + export_scope ---
$a = Invoke-RestMethod "$B/api/org/alerts" -Headers $H -Method Post -Body (Body @{title='ZZ-TEST alert';due_date='2026-10-10';lead_days=3;category='physique'}) -ContentType 'application/json'
OK ($a.category -eq 'physique') "POST alert category=physique"
$a2 = Invoke-RestMethod ("$B/api/org/alerts/" + $a.id) -Headers $H -Method Patch -Body (Body @{category='morale'}) -ContentType 'application/json'
OK ($a2.category -eq 'morale') "PATCH alert category -> morale"
$a3 = Invoke-RestMethod ("$B/api/org/alerts/" + $a.id) -Headers $H -Method Patch -Body (Body @{title='ZZ-TEST renomme par expert'}) -ContentType 'application/json'
OK ($a3.title -eq 'ZZ-TEST renomme par expert') "PATCH alert title -> 200"
OK ((St { Invoke-RestMethod ("$B/api/org/alerts/" + $a.id) -Headers $H2 -Method Patch -Body (Body @{title='HACK'}) -ContentType 'application/json' }) -eq 403) "comptable PATCH alerte globale -> 403"
OK ((St { Invoke-RestMethod "$B/api/org/alerts" -Headers $H2 -Method Post -Body (Body @{title='ZZ-TEST comptable';due_date='2026-12-15';lead_days=7}) -ContentType 'application/json' }) -eq 403) "comptable POST alerte globale -> 403"
OK ((St { Invoke-RestMethod ("$B/api/org/alerts/" + $a.id) -Headers $H2 -Method Delete }) -eq 403) "comptable DELETE alerte globale -> 403"
# export_scope : validation + set/clear
OK ((St { Invoke-RestMethod ("$B/api/org/alerts/" + $a.id) -Headers $H -Method Patch -Body (Body @{export_scope='bidon'}) -ContentType 'application/json' }) -eq 400) "PATCH export_scope non-tableau -> 400"
OK ((St { Invoke-RestMethod ("$B/api/org/alerts/" + $a.id) -Headers $H -Method Patch -Body (Body @{export_scope=@('bidon')}) -ContentType 'application/json' }) -eq 400) "PATCH export_scope valeur invalide -> 400"
$a5 = Invoke-RestMethod ("$B/api/org/alerts/" + $a.id) -Headers $H -Method Patch -Body (Body @{export_scope=@('exportatrice')}) -ContentType 'application/json'
OK ($a5.export_scope -like '*"exportatrice"*' -and $a5.export_scope -notlike '*semi*' -and $a5.export_scope -notlike '*non_export*') "PATCH export_scope -> stocke"
$a6 = Invoke-RestMethod ("$B/api/org/alerts/" + $a.id) -Headers $H -Method Patch -Body (Body @{export_scope=$null}) -ContentType 'application/json'
OK ($null -eq $a6.export_scope) "PATCH export_scope=null -> efface"

# --- 4) recurrente custom : occurrences, done par occurrence, 400 sans occurrence ---
$r = Invoke-RestMethod "$B/api/org/alerts" -Headers $H -Method Post -Body (Body @{title='ZZ-TEST rec';due_date='2026-10-10';recurrence='mensuelle';lead_days=3}) -ContentType 'application/json'
OK ($r.recurrence -eq 'mensuelle') "POST alert recurrente"
$f3 = Invoke-RestMethod "$B/api/org/alerts" -Headers $H
$occ = @($f3.alerts | Where-Object { $_.id -eq $r.id } | Sort-Object due_date)
$badOcc = @($occ | Where-Object { $_.due_date -notlike '*-10' })
OK ($occ.Count -ge 2 -and $badOcc.Count -eq 0) "occurrences mensuelles au jour 10 ($($occ.Count))"
OK ($occ.Count -eq 0 -or $occ[0].due_date -eq '2026-10-10') "1re occurrence = date butoir ($($occ[0].due_date))"
Invoke-RestMethod ("$B/api/org/alerts/" + $r.id) -Headers $H -Method Patch -Body (Body @{done=$true;occurrence='2026-10-10'}) -ContentType 'application/json' | Out-Null
$f4 = Invoke-RestMethod "$B/api/org/alerts" -Headers $H
$occ2 = @($f4.alerts | Where-Object { $_.id -eq $r.id })
$d1o = @($occ2 | Where-Object due_date -eq '2026-10-10'); $d2o = @($occ2 | Where-Object due_date -eq '2026-11-10')
OK ($d1o.Count -eq 1 -and $d1o[0].done -eq $true -and $d2o.Count -eq 1 -and $d2o[0].done -eq $false) "done sur 1 occurrence, l'autre non"
try { Invoke-RestMethod ("$B/api/org/alerts/" + $r.id) -Headers $H -Method Patch -Body (Body @{done=$true}) -ContentType 'application/json'; OK $false "PATCH done sans occurrence (recurrente) -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "PATCH done sans occurrence (recurrente) -> 400" }
Invoke-RestMethod ("$B/api/org/alerts/" + $a.id) -Headers $H -Method Delete | Out-Null
Invoke-RestMethod ("$B/api/org/alerts/" + $r.id) -Headers $H -Method Delete | Out-Null
OK $true "cleanup alertes test"

# --- 5) client person_type ---
$c = Invoke-RestMethod "$B/api/org/clients" -Headers $H -Method Post -Body (Body @{name='ZZ-TEST PP PM';person_type='physique';assigned_comptable_id='user_comp_001'}) -ContentType 'application/json'
OK ($c.person_type -eq 'physique') "POST client person_type=physique"
$c2 = Invoke-RestMethod ("$B/api/org/clients/" + $c.id) -Headers $H -Method Patch -Body (Body @{person_type='morale'}) -ContentType 'application/json'
OK ($c2.person_type -eq 'morale') "PATCH client -> morale"
try { Invoke-RestMethod ("$B/api/org/clients/" + $c.id) -Headers $H -Method Patch -Body (Body @{person_type='alien'}) -ContentType 'application/json'; OK $false "PATCH type invalide -> 400" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 400) "PATCH type invalide -> 400" }
try { Invoke-RestMethod ("$B/api/org/clients/" + $c.id) -Headers $H2 -Method Patch -Body (Body @{person_type='physique'}) -ContentType 'application/json'; OK $false "comptable PATCH client -> 403" }
catch { OK ($_.Exception.Response.StatusCode.value__ -eq 403) "comptable PATCH client -> 403" }
OK ((St { Invoke-RestMethod "$B/api/org/clients" -Headers $H2 -Method Post -Body (Body @{name='ZZ-TEST BY-COMPTABLE'}) -ContentType 'application/json' }) -eq 403) "comptable POST client -> 403 (expert seul)"
$cA = Invoke-RestMethod "$B/api/org/clients" -Headers $H -Method Post -Body (Body @{name='ZZ-TEST ASSIGNE';person_type='physique';export_status='exportatrice';assigned_comptable_id='user_comp_002'}) -ContentType 'application/json'
OK ($cA.export_status -eq 'exportatrice') "POST client export_status=exportatrice"
$cA2 = Invoke-RestMethod ("$B/api/org/clients/" + $cA.id) -Headers $H2 -Method Patch -Body (Body @{person_type='morale'}) -ContentType 'application/json'
OK ($cA2.person_type -eq 'morale') "comptable assigne PATCH client -> morale"
$cA3 = Invoke-RestMethod ("$B/api/org/clients/" + $cA.id) -Headers $H2 -Method Patch -Body (Body @{export_status='non_exportatrice'}) -ContentType 'application/json'
OK ($cA3.export_status -eq 'non_exportatrice') "comptable assigne PATCH export_status -> non_exportatrice"
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cA.id) -Headers $H2 -Method Patch -Body (Body @{export_status='alien'}) -ContentType 'application/json' }) -eq 400) "PATCH export_status invalide -> 400"

# --- 6) dossier retourne person_type ---
$d = Invoke-RestMethod ("$B/api/org/clients/" + $c.id + "/dossiers") -Headers $H -Method Post -Body (Body @{exercice=2026}) -ContentType 'application/json'
$dd = Invoke-RestMethod ("$B/api/org/dossiers/" + $d.id) -Headers $H
OK ($dd.person_type -eq 'morale') "GET dossier person_type=morale"
$dA = Invoke-RestMethod ("$B/api/org/clients/" + $cA.id + "/dossiers") -Headers $H -Method Post -Body (Body @{exercice=2026}) -ContentType 'application/json'
$dAd = Invoke-RestMethod ("$B/api/org/dossiers/" + $dA.id) -Headers $H
OK ($dAd.client_comptable_id -eq 'user_comp_002') "GET dossier client_comptable_id=user_comp_002"

# --- 6b) comptable : CRUD sur SES echeances + feed restreint ---
$ca1 = Invoke-RestMethod "$B/api/org/alerts" -Headers $H2 -Method Post -Body (Body @{title='ZZ-TEST dossier scope';due_date='2026-11-15';dossier_id=$dA.id}) -ContentType 'application/json'
OK ($ca1.dossier_id -eq $dA.id) "comptable POST alerte dans SON dossier -> 201"
$fH2 = Invoke-RestMethod "$B/api/org/alerts" -Headers $H2
OK (@($fH2.alerts | Where-Object id -eq $ca1.id).Count -eq 1) "feed comptable: voit l'alerte de SON dossier"
OK (@($fH2.alerts | Where-Object { $_.id -like 'pack_*' -and $null -eq $_.dossier_id }).Count -eq 0) "feed comptable: aucun pack global (dossier_id null)"
OK (@($fH2.alerts | Where-Object { $_.id -like 'pack_*' -and $null -ne $_.dossier_id }).Count -ge 1) "feed comptable: packs rattaches a ses dossiers"
$ca2 = Invoke-RestMethod ("$B/api/org/alerts/" + $ca1.id) -Headers $H2 -Method Patch -Body (Body @{title='ZZ-TEST dossier scope 2'}) -ContentType 'application/json'
OK ($ca2.title -eq 'ZZ-TEST dossier scope 2') "comptable PATCH son alerte dossier -> 200"
OK ((St { Invoke-RestMethod ("$B/api/org/alerts/" + $ca1.id) -Headers $H2 -Method Delete }) -eq -1) "comptable DELETE son alerte dossier -> 200"
$fH3 = Invoke-RestMethod "$B/api/org/alerts" -Headers $H2
OK (@($fH3.alerts | Where-Object id -eq $ca1.id).Count -eq 0) "DELETE retiree du feed comptable"

# --- 6c) filtre export sur le feed du dossier ---
$sfxA = 'd' + $dA.id
$fD1 = Invoke-RestMethod ("$B/api/org/alerts?dossier_id=" + $dA.id) -Headers $H
OK (@($fD1.alerts | Where-Object id -eq ('pack_cnss_tr_' + $sfxA)).Count -ge 1) "non exportatrice: cnss_tr visible"
OK (@($fD1.alerts | Where-Object id -eq ('pack_cnss_tr_export_' + $sfxA)).Count -eq 0) "non exportatrice: cnss_tr_export masque"
$ce1 = Invoke-RestMethod ("$B/api/org/clients/" + $cA.id) -Headers $H -Method Patch -Body (Body @{export_status='exportatrice'}) -ContentType 'application/json'
OK ($ce1.export_status -eq 'exportatrice') "PATCH client -> exportatrice"
$fD2 = Invoke-RestMethod ("$B/api/org/alerts?dossier_id=" + $dA.id) -Headers $H
OK (@($fD2.alerts | Where-Object id -eq ('pack_tva_susp_ventes_pm_' + $sfxA)).Count -ge 1) "exportatrice: tva_susp_ventes visible (scope export)"
OK (@($fD2.alerts | Where-Object id -eq ('pack_cnss_tr_' + $sfxA)).Count -eq 0) "exportatrice: cnss_tr masque"
$ce2 = Invoke-RestMethod ("$B/api/org/clients/" + $cA.id) -Headers $H -Method Patch -Body (Body @{export_status='semi_exportatrice'}) -ContentType 'application/json'
OK ($ce2.export_status -eq 'semi_exportatrice') "PATCH client -> semi_exportatrice"
$fD3 = Invoke-RestMethod ("$B/api/org/alerts?dossier_id=" + $dA.id) -Headers $H
OK (@($fD3.alerts | Where-Object id -eq ('pack_cnss_tr_' + $sfxA)).Count -ge 1) "semi exportatrice: cnss_tr visible"
OK (@($fD3.alerts | Where-Object id -eq ('pack_cnss_tr_export_' + $sfxA)).Count -eq 0) "semi exportatrice: cnss_tr_export masque"

# --- 7) pack via D1 : 15 lignes conformes au classeur ---
Invoke-RestMethod ("$B/api/org/alerts?dossier_id=" + $d.id) -Headers $H | Out-Null
$d1raw = npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT id, due_date, recurrence, months, category, export_scope, dossier_id, lead_days FROM org_fiscal_alerts WHERE id LIKE 'pack_%' ORDER BY id" 2>$null
$rows = (($d1raw | Out-String | ConvertFrom-Json)[0]).results
$gRows = @($rows | Where-Object { $null -eq $_.dossier_id })
OK ($gRows.Count -eq 15) "D1 pack global = 15 lignes ($($gRows.Count))"
$dARows = @($rows | Where-Object { $_.dossier_id -eq $dA.id })
OK ($dARows.Count -eq 15) "D1 pack dossier $dA = 15 lignes ($($dARows.Count))"
$dRows = @($rows | Where-Object { $_.dossier_id -eq $d.id })
OK ($dRows.Count -eq 15) "D1 pack dossier $d = 15 lignes ($($dRows.Count))"
OK (@($rows | Where-Object { $_.lead_days -ne 5 }).Count -eq 0) "lead_days = 5 partout"
$rows = $gRows
OK ($rows.Count -eq 15) "D1: 15 cles conformes au classeur ($($rows.Count))"
$absent = @($rows | Where-Object { $_.id -like 'pack_cnss_das_*' -or $_.id -like 'pack_irpp_*' -or $_.id -like 'pack_cnss_tr_export_*' -or $_.id -like 'pack_is_annuelle_export_*' -or $_.id -like 'pack_pp_mensuelle_*' -or $_.id -like 'pack_pm_mensuelle_nt_*' -or $_.id -like 'pack_acomptes_pp_*' -or $_.id -like 'pack_tva_susp_ventes_pp_*' -or $_.id -like 'pack_tva_susp_achats_pp_*' })
OK ($absent.Count -eq 0) "D1: 0 echeance hors-classeur restante ($($absent.Count))"
$isa = $rows | Where-Object { $_.id -like 'pack_is_annuelle_*' }
OK ($isa.due_date -like '*-03-25') "IS annuelle = 25 mars (art.60)"
$acpm = $rows | Where-Object id -like 'pack_acomptes_pm_*'
OK ($acpm.months -eq '[6,9,12]' -and $acpm.due_date -like '*-06-28') "acomptes PM [6,9,12] jour 28"
# cles du pack (15)
$tvas = @($rows | Where-Object id -like 'pack_tva_susp_ventes_*')
OK ($tvas.Count -eq 1) "tva_susp_ventes = 1 ligne classeur ($($tvas.Count))"
OK ($tvas[0].due_date -like '*-01-28' -and $tvas[0].category -eq 'morale' -and $tvas[0].months -eq '[1,4,7,10]') "tva_susp_ventes PM = 28/trim (morale)"
$tvasa = @($rows | Where-Object id -like 'pack_tva_susp_achats_*')
OK ($tvasa.Count -eq 1) "tva_susp_achats = 1 ligne classeur ($($tvasa.Count))"
OK ($tvasa[0].due_date -like '*-01-28' -and $tvasa[0].category -eq 'morale' -and $tvasa[0].months -eq '[1,4,7,10]') "tva_susp_achats PM = 28/trim (morale)"
$pmg = @($rows | Where-Object id -like 'pack_pm_mensuelle_*')
OK ($pmg.Count -eq 1 -and $pmg[0].due_date -like '*-12-20' -and $pmg[0].category -eq 'morale' -and $pmg[0].recurrence -eq 'mensuelle') "DMI = 20 mensuel (PM tele, morale)"
$tej = $rows | Where-Object id -like 'pack_certificats_tej_*'
OK ($null -ne $tej -and $tej.recurrence -eq 'mensuelle' -and $tej.due_date -like '*-01-31') "certificats_tej mensuel fin mois suivant"
$isd = @($rows | Where-Object id -like 'pack_is_definitive_*')
OK ($isd.Count -eq 1 -and $isd[0].due_date -like '*-06-25') "is_definitive = 25 juin"
$lias = @($rows | Where-Object id -like 'pack_liasse_fiscale_*')
OK ($lias.Count -eq 1 -and $lias[0].due_date -like '*-03-25') "liasse_fiscale = 25 mars"
$ctr = @($rows | Where-Object { $_.id -like 'pack_cnss_tr_*' })
OK ($ctr.Count -eq 1 -and $ctr[0].export_scope -like '*semi_exportatrice*' -and $ctr[0].export_scope -like '*non_exportatrice*') "cnss_tr scope [semi,non]"
OK ($null -eq $pmg[0].export_scope) "pack sans portee: export_scope null"
# feed expert : export_scope parse en tableau + global non filtre
$fe = Invoke-RestMethod "$B/api/org/alerts" -Headers $H
$feE = @($fe.alerts | Where-Object { $_.id -like 'pack_tva_susp_ventes_pm_*' -and $null -eq $_.dossier_id })
OK ($feE.Count -ge 1 -and $feE[0].export_scope -contains 'exportatrice') "feed: export_scope = tableau (ventes susp)"
$feG = @($fe.alerts | Where-Object { $_.id -like 'pack_cnss_tr_*' -and $null -eq $_.dossier_id })
OK ($feG.Count -eq 1) "feed expert: cnss_tr global non filtre ($($feG.Count))"
$feN = @($fe.alerts | Where-Object { $_.id -like 'pack_pm_mensuelle_*' -and $null -eq $_.dossier_id })
OK ($feN.Count -ge 1 -and $null -eq $feN[0].export_scope) "feed: export_scope null pour portee globale"

# --- cleanup D1 ---
$cid = $c.id; $did = $d.id; $cAid = $cA.id; $dAid = $dA.id
npx.cmd wrangler d1 execute eurex-db --remote --json --command "DELETE FROM org_alert_dones WHERE alert_id IN (SELECT id FROM org_fiscal_alerts WHERE dossier_id IN ('$did','$dAid')); DELETE FROM org_fiscal_alerts WHERE dossier_id IN ('$did','$dAid'); DELETE FROM org_expected_documents WHERE dossier_id IN ('$did','$dAid'); DELETE FROM org_tasks WHERE dossier_id IN ('$did','$dAid'); DELETE FROM org_notes WHERE dossier_id IN ('$did','$dAid'); DELETE FROM org_dossiers WHERE id IN ('$did','$dAid'); DELETE FROM org_clients WHERE id IN ('$cid','$cAid');" | Out-Null
$left = npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT (SELECT COUNT(*) FROM org_clients WHERE name IN ('ZZ-TEST PP PM','ZZ-TEST ASSIGNE')) + (SELECT COUNT(*) FROM org_fiscal_alerts WHERE dossier_id IN ('$did','$dAid')) as n" 2>$null
$n = (($left | Out-String | ConvertFrom-Json)[0]).results[0].n
OK ($n -eq 0) "cleanup client + packs dossier"

""
if ($script:fail -eq 0) { "ALL PASS" } else { "$script:fail FAILURES" }
exit $script:fail
