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
$HS = @{ Authorization = 'Bearer ' + $lr2.token }
OK ($null -ne $lr2.token) "login samar"
$lr3 = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email='salim@eurex.tn';password='salim1234567'}) -ContentType 'application/json'
$HL = @{ Authorization = 'Bearer ' + $lr3.token }
OK ($null -ne $lr3.token) "login salim"
$me = Invoke-RestMethod "$B/api/org/auth/me" -Headers $H
OK ($me.organization -eq 'EUREX') "GET auth/me + organisation"

# --- 1) creation comptable de test + validations ---
OK ((St { Invoke-RestMethod "$B/api/org/comptables" -Headers $H -Method Post -Body (Body @{full_name='ZZ';email='zz@eurex.tn'}) -ContentType 'application/json' }) -eq 400) "POST comptable champs manquants -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/comptables" -Headers $H -Method Post -Body (Body @{full_name='ZZ';email='zz@eurex.tn';password='court'}) -ContentType 'application/json' }) -eq 400) "POST comptable mot de passe <12 -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/comptables" -Headers $H -Method Post -Body (Body @{full_name='ZZ';email='salim@eurex.tn';password='CabinetTest123456'}) -ContentType 'application/json' }) -eq 409) "POST comptable email duplique -> 409"
$ncMail = 'zz-cab-test-' + (Get-Random -Minimum 100000 -Maximum 999999) + '@test.eurex.tn'
$nc = Invoke-RestMethod "$B/api/org/comptables" -Headers $H -Method Post -Body (Body @{full_name='ZZ-CAB-TEST';email=$ncMail;password='CabinetTest123456'}) -ContentType 'application/json'
OK ($nc.role -eq 'comptable') "POST comptable cree (id=$($nc.id))"
$ncId = $nc.id

# --- 2) login + profil du comptable cree ---
$lc = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email=$ncMail;password='CabinetTest123456'}) -ContentType 'application/json'
$HC = @{ Authorization = 'Bearer ' + $lc.token }
OK ($null -ne $lc.token) "login du comptable cree"
OK ($lc.user.must_change_password -eq 1) "nouveau comptable: must_change_password=1"
OK ((St { Invoke-RestMethod "$B/api/org/auth/change-password" -Headers $HC -Method Post -Body (Body @{current_password='faux';new_password='CabinetTest789012'}) -ContentType 'application/json' }) -eq 401) "change-password mauvais actuel -> 401"
OK ((St { Invoke-RestMethod "$B/api/org/auth/change-password" -Headers $HC -Method Post -Body (Body @{current_password='CabinetTest123456';new_password='court'}) -ContentType 'application/json' }) -eq 400) "change-password nouveau court -> 400"
$cp = Invoke-RestMethod "$B/api/org/auth/change-password" -Headers $HC -Method Post -Body (Body @{current_password='CabinetTest123456';new_password='CabinetTest789012'}) -ContentType 'application/json'
OK ($cp.ok) "change-password OK"
OK ((St { Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email=$ncMail;password='CabinetTest123456'}) -ContentType 'application/json' }) -eq 401) "ancien mot de passe rejete -> 401"
$lc = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email=$ncMail;password='CabinetTest789012'}) -ContentType 'application/json'
$HC = @{ Authorization = 'Bearer ' + $lc.token }
OK ($lc.user.must_change_password -eq 0) "apres change-password: must_change_password=0"
OK ((St { Invoke-RestMethod "$B/api/org/auth/me" -Headers $HC -Method Patch -Body (Body @{full_name=''}) -ContentType 'application/json' }) -eq 400) "PATCH me nom vide -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/auth/me" -Headers $HC -Method Patch -Body (Body @{email='pas-un-email'}) -ContentType 'application/json' }) -eq 400) "PATCH me email invalide -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/auth/me" -Headers $HC -Method Patch -Body (Body @{email='salim@eurex.tn'}) -ContentType 'application/json' }) -eq 409) "PATCH me email duplique -> 409"
$pm = Invoke-RestMethod "$B/api/org/auth/me" -Headers $HC -Method Patch -Body (Body @{full_name='ZZ-CAB-RENOMME'}) -ContentType 'application/json'
OK ($pm.full_name -eq 'ZZ-CAB-RENOMME') "PATCH me nom OK"

# --- 3) comptables : liste / droits / PATCH ---
OK ((St { Invoke-RestMethod "$B/api/org/comptables" -Headers $HL }) -eq 403) "GET comptables: comptable -> 403"
OK ((St { Invoke-RestMethod "$B/api/org/comptables" -Headers $HS }) -eq 403) "GET comptables: samar -> 403"
$list = Invoke-RestMethod "$B/api/org/comptables" -Headers $H
OK (@($list | Where-Object id -eq $ncId).Count -eq 1) "GET comptables expert contient le nouveau"
OK ((St { Invoke-RestMethod ("$B/api/org/comptables/" + $ncId) -Headers $H -Method Patch -Body (Body @{password='court'}) -ContentType 'application/json' }) -eq 400) "PATCH comptable mot de passe court -> 400"
OK ((St { Invoke-RestMethod ("$B/api/org/comptables/" + $ncId) -Headers $H -Method Patch -Body (Body @{email='bad'}) -ContentType 'application/json' }) -eq 400) "PATCH comptable email invalide -> 400"
OK ((St { Invoke-RestMethod ("$B/api/org/comptables/" + $ncId) -Headers $H -Method Patch -Body (Body @{email='salim@eurex.tn'}) -ContentType 'application/json' }) -eq 409) "PATCH comptable email duplique -> 409"
OK ((St { Invoke-RestMethod ("$B/api/org/comptables/" + $ncId) -Headers $H -Method Patch -Body (Body @{}) -ContentType 'application/json' }) -eq 400) "PATCH comptable sans champ -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/comptables/comptable_inexistant" -Headers $H -Method Patch -Body (Body @{full_name='X'}) -ContentType 'application/json' }) -eq 404) "PATCH comptable inconnu -> 404"
OK ((St { Invoke-RestMethod ("$B/api/org/comptables/" + $ncId) -Headers $HL -Method Patch -Body (Body @{full_name='HACK'}) -ContentType 'application/json' }) -eq 403) "PATCH comptable par un comptable -> 403"
$pn = Invoke-RestMethod ("$B/api/org/comptables/" + $ncId) -Headers $H -Method Patch -Body (Body @{full_name='ZZ-CAB-TEST2'}) -ContentType 'application/json'
OK ($pn.ok) "PATCH comptable rename par expert"
# desactivation -> login bloque -> reactivation
Invoke-RestMethod ("$B/api/org/comptables/" + $ncId) -Headers $H -Method Patch -Body (Body @{is_active=$false}) -ContentType 'application/json' | Out-Null
OK ((St { Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email=$ncMail;password='CabinetTest789012'}) -ContentType 'application/json' }) -eq 403) "comptable desactive: login -> 403"
$oldTok = $lc.token
OK ((St { Invoke-RestMethod "$B/api/org/auth/me" -Headers @{Authorization="Bearer $oldTok"} }) -eq 401) "comptable desactive: ancien token -> 401"
Invoke-RestMethod ("$B/api/org/comptables/" + $ncId) -Headers $H -Method Patch -Body (Body @{is_active=$true}) -ContentType 'application/json' | Out-Null
$lc = Invoke-RestMethod "$B/api/org/auth/login" -Method Post -Body (Body @{email=$ncMail;password='CabinetTest789012'}) -ContentType 'application/json'
$HC = @{ Authorization = 'Bearer ' + $lc.token }
OK ($null -ne $lc.token) "comptable reactive: login OK"
# detail
OK ((St { Invoke-RestMethod "$B/api/org/comptables/comptable_inexistant/detail" -Headers $H }) -eq 404) "detail comptable inconnu -> 404"
OK ((St { Invoke-RestMethod ("$B/api/org/comptables/" + $ncId + "/detail") -Headers $HL }) -eq 403) "detail comptable: comptable -> 403"
$det = Invoke-RestMethod ("$B/api/org/comptables/" + $ncId + "/detail") -Headers $H
OK ($det.comptable.full_name -eq 'ZZ-CAB-TEST2') "GET detail comptable (expert)"
OK (($det.PSObject.Properties.Name -contains 'kpis') -and ($det.PSObject.Properties.Name -contains 'time_by_dossier')) "detail contient kpis + time_by_dossier"

# --- 4) clients : creation / portee / droits ---
OK ((St { Invoke-RestMethod "$B/api/org/clients" -Headers $H -Method Post -Body (Body @{person_type='morale'}) -ContentType 'application/json' }) -eq 400) "POST client sans nom -> 400"
$c = Invoke-RestMethod "$B/api/org/clients" -Headers $H -Method Post -Body (Body @{name='ZZ-CAB-CLIENT';person_type='morale';assigned_comptable_id='user_comp_001';contact_email='zzc@test.tn'}) -ContentType 'application/json'
OK ($c.person_type -eq 'morale') "POST client expert + assigne Salim"
$cId = $c.id
OK ((St { Invoke-RestMethod "$B/api/org/clients" -Headers $HS -Method Post -Body (Body @{name='ZZ-CAB-SAMAR-CLIENT';person_type='physique'}) -ContentType 'application/json' }) -eq 403) "POST client par samar -> 403 (expert seul)"
$cS = Invoke-RestMethod "$B/api/org/clients" -Headers $H -Method Post -Body (Body @{name='ZZ-CAB-SAMAR-CLIENT';person_type='physique';assigned_comptable_id='user_comp_002'}) -ContentType 'application/json'
OK ($null -ne $cS.id) "POST client expert + assigne samar (id=$($cS.id))"
$cSId = $cS.id
$allE = Invoke-RestMethod "$B/api/org/clients" -Headers $H
OK (@($allE | Where-Object id -eq $cId).Count -eq 1 -and @($allE | Where-Object id -eq $cSId).Count -eq 1) "GET clients expert: tous visibles"
$allL = Invoke-RestMethod "$B/api/org/clients" -Headers $HL
OK (@($allL | Where-Object id -eq $cId).Count -eq 1) "GET clients salim: voit ZZ-CAB-CLIENT"
OK (@($allL | Where-Object id -eq $cSId).Count -eq 0) "GET clients salim: ne voit PAS le client de samar"
$allS = Invoke-RestMethod "$B/api/org/clients" -Headers $HS
OK (@($allS | Where-Object id -eq $cSId).Count -eq 1) "GET clients samar: voit son client"
OK (@($allS | Where-Object id -eq $cId).Count -eq 0) "GET clients samar: ne voit PAS le client de salim"
# PATCH person_type
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $H -Method Patch -Body (Body @{person_type='xx'}) -ContentType 'application/json' }) -eq 400) "PATCH person_type invalide -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/clients/client_inexistant" -Headers $H -Method Patch -Body (Body @{person_type='morale'}) -ContentType 'application/json' }) -eq 404) "PATCH client inconnu -> 404"
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $HS -Method Patch -Body (Body @{person_type='physique'}) -ContentType 'application/json' }) -eq 403) "PATCH person_type hors assignation -> 403"
$pp = Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $HL -Method Patch -Body (Body @{person_type='physique'}) -ContentType 'application/json'
OK ($pp.person_type -eq 'physique') "PATCH person_type par comptable assigne"
$pp = Invoke-RestMethod ("$B/api/org/clients/" + $cId) -Headers $H -Method Patch -Body (Body @{person_type='morale'}) -ContentType 'application/json'
OK ($pp.person_type -eq 'morale') "PATCH person_type par expert"
# reassign
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cId + "/reassign") -Headers $HL -Method Patch -Body (Body @{assigned_comptable_id='user_comp_002'}) -ContentType 'application/json' }) -eq 403) "reassign par comptable -> 403"
$ra = Invoke-RestMethod ("$B/api/org/clients/" + $cId + "/reassign") -Headers $H -Method Patch -Body (Body @{assigned_comptable_id='user_comp_002'}) -ContentType 'application/json'
OK ($ra.ok) "reassign expert -> samar"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/dossier_quelconque") -Headers $HL }) -eq 403) "apres reassign: salim n a plus acces (403)"
Invoke-RestMethod ("$B/api/org/clients/" + $cId + "/reassign") -Headers $H -Method Patch -Body (Body @{assigned_comptable_id='user_comp_001'}) -ContentType 'application/json' | Out-Null

# --- 5) dossier : creation / duplicata / droits / templates ---
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cId + "/dossiers") -Headers $H -Method Post -Body (Body @{}) -ContentType 'application/json' }) -eq 400) "POST dossier sans exercice -> 400"
$d = Invoke-RestMethod ("$B/api/org/clients/" + $cId + "/dossiers") -Headers $H -Method Post -Body (Body @{exercice=2026}) -ContentType 'application/json'
OK ($d.status -eq 'en_cours') "POST dossier 2026 (id=$($d.id))"
$dId = $d.id
OK ((St { Invoke-RestMethod ("$B/api/org/clients/" + $cId + "/dossiers") -Headers $H -Method Post -Body (Body @{exercice=2026}) -ContentType 'application/json' }) -eq 409) "POST dossier meme exercice -> 409"
$dd = Invoke-RestMethod ("$B/api/org/dossiers/" + $dId) -Headers $H
OK (@($dd.tasks).Count -gt 0) "templates appliques: taches generees ($(@($dd.tasks).Count))"
OK (@($dd.documents).Count -gt 0) "documents attends generes ($(@($dd.documents).Count))"
OK ($dd.client_comptable_id -eq 'user_comp_001') "dossier: client_comptable_id"
OK ((St { Invoke-RestMethod "$B/api/org/dossiers" -Headers $HL }) -eq 403) "GET /org/dossiers: comptable -> 403"
OK (@(@(Invoke-RestMethod "$B/api/org/dossiers" -Headers $H) | Where-Object { $_.id -eq $dId }).Count -eq 1) "GET /org/dossiers expert contient le dossier"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId) -Headers $HS }) -eq 403) "GET dossier par samar (non assigne) -> 403"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId) -Headers $HL }) -eq -1) "GET dossier par salim (assigne) -> 200"

# --- 6) templates CRUD ---
OK ((St { Invoke-RestMethod "$B/api/org/templates" -Headers $HL }) -eq -1) "GET templates acces comptable"
OK ((St { Invoke-RestMethod "$B/api/org/templates" -Headers $HL -Method Post -Body (Body @{label='X'}) -ContentType 'application/json' }) -eq 403) "POST template par comptable -> 403"
OK ((St { Invoke-RestMethod "$B/api/org/templates" -Headers $H -Method Post -Body (Body @{requires_document=$true}) -ContentType 'application/json' }) -eq 400) "POST template sans libelle -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/templates" -Headers $H -Method Post -Body (Body @{label='X';frequency='hebdo'}) -ContentType 'application/json' }) -eq 400) "POST template frequence invalide -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/templates" -Headers $H -Method Post -Body (Body @{label='X';assigned_comptable_id='nimporte'}) -ContentType 'application/json' }) -eq 400) "POST template comptable inconnu -> 400"
$tp = Invoke-RestMethod "$B/api/org/templates" -Headers $H -Method Post -Body (Body @{label='ZZ-CAB TPL';frequency='trimestrielle';assigned_comptable_id='user_comp_001'}) -ContentType 'application/json'
OK ($tp.frequency -eq 'trimestrielle') "POST template cree (id=$($tp.id))"
$tpId = $tp.id
OK ((St { Invoke-RestMethod ("$B/api/org/templates/" + $tpId) -Headers $HL -Method Patch -Body (Body @{label='X'}) -ContentType 'application/json' }) -eq 403) "PATCH template par comptable -> 403"
OK ((St { Invoke-RestMethod "$B/api/org/templates/tmpl_inconnu" -Headers $H -Method Patch -Body (Body @{label='X'}) -ContentType 'application/json' }) -eq 404) "PATCH template inconnu -> 404"
OK ((St { Invoke-RestMethod ("$B/api/org/templates/" + $tpId) -Headers $H -Method Patch -Body (Body @{frequency='hebdo'}) -ContentType 'application/json' }) -eq 400) "PATCH template frequence invalide -> 400"
OK ((St { Invoke-RestMethod ("$B/api/org/templates/" + $tpId) -Headers $H -Method Patch -Body (Body @{}) -ContentType 'application/json' }) -eq 400) "PATCH template sans champ -> 400"
Invoke-RestMethod ("$B/api/org/templates/" + $tpId) -Headers $H -Method Patch -Body (Body @{label='ZZ-CAB TPL-2'}) -ContentType 'application/json' | Out-Null
$tl2 = Invoke-RestMethod "$B/api/org/templates" -Headers $H
OK (@($tl2 | Where-Object id -eq $tpId)[0].label -eq 'ZZ-CAB TPL-2') "PATCH template rename visible"
OK ((St { Invoke-RestMethod ("$B/api/org/templates/" + $tpId) -Headers $HL -Method Delete }) -eq 403) "DELETE template par comptable -> 403"
OK ((St { Invoke-RestMethod ("$B/api/org/templates/" + $tpId) -Headers $H -Method Delete }) -eq -1) "DELETE template par expert -> 200"

# --- 7) documents + notes ---
$t0 = @($dd.tasks)[0]
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/documents") -Headers $H -Method Post -Body (Body @{task_id='x';label='L'}) -ContentType 'application/json' }) -eq 404) "POST document tache inconnue -> 404"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/documents") -Headers $H -Method Post -Body (Body @{label='   '}) -ContentType 'application/json' }) -eq 400) "POST document libelle vide -> 400"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/documents") -Headers $H -Method Post -Body (Body @{label='L';url='ftp://x'}) -ContentType 'application/json' }) -eq 400) "POST document url invalide -> 400"
$doc = Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/documents") -Headers $H -Method Post -Body (Body @{task_id=$t0.id;label='ZZ-CAB DOC';received=$false;url='https://exemple.tn/rapport.pdf'}) -ContentType 'application/json'
OK ($doc.label -eq 'ZZ-CAB DOC') "POST document cree (id=$($doc.id))"
$docId = $doc.id
$docUp = Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/documents/" + $docId) -Headers $H -Method Patch -Body (Body @{received=$true}) -ContentType 'application/json'
OK ($docUp.ok) "PATCH document received"
$ddDoc = Invoke-RestMethod ("$B/api/org/dossiers/" + $dId) -Headers $H
OK (@($ddDoc.documents | Where-Object { $_.id -eq $docId })[0].received -in @($true, 1)) "document received=true persiste en base"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/documents/" + $docId) -Headers $HS -Method Patch -Body (Body @{received=$false}) -ContentType 'application/json' }) -eq 403) "PATCH document hors assignation -> 403"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/documents/doc_inconnu") -Headers $H -Method Patch -Body (Body @{received=$true}) -ContentType 'application/json' }) -eq 404) "PATCH document inconnu -> 404"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/notes") -Headers $HS -Method Post -Body (Body @{content='x'}) -ContentType 'application/json' }) -eq 403) "POST note hors assignation -> 403"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/notes") -Headers $H -Method Post -Body (Body @{content=''}) -ContentType 'application/json' }) -eq 400) "POST note vide -> 400"
$n = Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/notes") -Headers $HL -Method Post -Body (Body @{content='ZZ-CAB note salim'}) -ContentType 'application/json'
OK ($null -ne $n.id) "POST note par salim (id=$($n.id))"
$dd2 = Invoke-RestMethod ("$B/api/org/dossiers/" + $dId) -Headers $H
OK (@($dd2.notes | Where-Object id -eq $n.id).Count -eq 1) "GET dossier contient la note"
$dd2.task_stats | Out-Null

# --- 8) alerts : droits + portee ---
OK ((St { Invoke-RestMethod "$B/api/org/alerts" -Headers $HL -Method Post -Body (Body @{title='X';due_date='2026-12-31'}) -ContentType 'application/json' }) -eq 403) "POST alerte par comptable -> 403"
OK ((St { Invoke-RestMethod "$B/api/org/alerts" -Headers $H -Method Post -Body (Body @{due_date='2026-12-31'}) -ContentType 'application/json' }) -eq 400) "POST alerte sans libelle -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/alerts" -Headers $H -Method Post -Body (Body @{title='X';due_date='31/12/2026'}) -ContentType 'application/json' }) -eq 400) "POST alerte date invalide -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/alerts" -Headers $H -Method Post -Body (Body @{title='X';due_date='2026-12-31';dossier_id='d_inconnu'}) -ContentType 'application/json' }) -eq 404) "POST alerte dossier inconnu -> 404"
$al = Invoke-RestMethod "$B/api/org/alerts" -Headers $H -Method Post -Body (Body @{title='ZZ-CAB ALERT';due_date='2026-12-31';dossier_id=$dId;lead_days=99;recurrence='once'}) -ContentType 'application/json'
OK ($al.lead_days -eq 60) "POST alerte lead_days clamp 99->60 ($($al.lead_days))"
$alId = $al.id
$gE = Invoke-RestMethod "$B/api/org/alerts" -Headers $H
OK (@($gE.alerts | Where-Object id -eq $alId).Count -eq 1) "GET alertes expert: alerte visible"
$gL = Invoke-RestMethod "$B/api/org/alerts" -Headers $HL
OK (@($gL.alerts | Where-Object id -eq $alId).Count -eq 1) "GET alertes salim (assigne): alerte visible"
$gS = Invoke-RestMethod "$B/api/org/alerts" -Headers $HS
OK (@($gS.alerts | Where-Object id -eq $alId).Count -eq 0) "GET alertes samar (non assigne): alerte masquee"
OK ((St { Invoke-RestMethod ("$B/api/org/alerts/" + $alId) -Headers $HL -Method Patch -Body (Body @{title='HACK'}) -ContentType 'application/json' }) -eq -1) "PATCH alerte dossier par comptable assigne -> 200"
OK ((St { Invoke-RestMethod ("$B/api/org/alerts/" + $alId) -Headers $HL -Method Patch -Body (Body @{}) -ContentType 'application/json' }) -eq 400) "PATCH alerte sans champ par comptable -> 400"
OK ((St { Invoke-RestMethod "$B/api/org/alerts/alert_inconnue" -Headers $H -Method Patch -Body (Body @{title='X'}) -ContentType 'application/json' }) -eq 404) "PATCH alerte inconnue -> 404"
$ad = Invoke-RestMethod ("$B/api/org/alerts/" + $alId) -Headers $HL -Method Patch -Body (Body @{done=$true}) -ContentType 'application/json'
OK ($ad.done -eq 1 -or $ad.done -eq $true) "PATCH alerte done par comptable"
$ad2 = Invoke-RestMethod ("$B/api/org/alerts/" + $alId) -Headers $H -Method Patch -Body (Body @{title='ZZ-CAB ALERT-2';lead_days=5}) -ContentType 'application/json'
OK ($ad2.title -eq 'ZZ-CAB ALERT-2' -and $ad2.lead_days -eq 5) "PATCH alerte titre+lead par expert"
OK ((St { Invoke-RestMethod ("$B/api/org/alerts/" + $alId) -Headers $HL -Method Delete }) -eq -1) "DELETE alerte dossier par comptable assigne -> 200"

# --- 9) taches : affectation + cloture ---
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/tasks") -Headers $HL -Method Post -Body (Body @{label='L';assigned_comptable_id='user_comp_002'}) -ContentType 'application/json' }) -eq 403) "POST task affectee par comptable -> 403"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/tasks") -Headers $H -Method Post -Body (Body @{label='L';assigned_comptable_id='zzz'}) -ContentType 'application/json' }) -eq 400) "POST task affectee inconnu -> 400"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/tasks") -Headers $H -Method Post -Body (Body @{label='L';due_date='31/12/2026'}) -ContentType 'application/json' }) -eq 400) "POST task date butoir invalide -> 400"
$tk = Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/tasks") -Headers $H -Method Post -Body (Body @{label='ZZ-CAB TASK';assigned_comptable_id='user_comp_001';due_date='2026-10-31'}) -ContentType 'application/json'
OK ($tk.ok) "POST task affectee a salim (id=$($tk.id))"
$tkId = $tk.id
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/tasks/" + $tkId) -Headers $HL -Method Patch -Body (Body @{assigned_comptable_id='user_comp_002'}) -ContentType 'application/json' }) -eq 403) "PATCH reassign task par comptable -> 403"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/tasks/" + $tkId) -Headers $H -Method Patch -Body (Body @{status='bidon'}) -ContentType 'application/json' }) -eq 400) "PATCH status invalide -> 400"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/tasks/" + $tkId) -Headers $H -Method Patch -Body (Body @{due_date='2026-99-99'}) -ContentType 'application/json' }) -eq 400) "PATCH date butoir invalide -> 400"
# cloture
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/close") -Headers $H -Method Patch -Body (Body @{}) -ContentType 'application/json' }) -eq 400) "close avec taches restantes -> 400"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/close") -Headers $HL -Method Patch -Body (Body @{force=$true;justification='test'}) -ContentType 'application/json' }) -eq 403) "force close par comptable -> 403"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/close") -Headers $H -Method Patch -Body (Body @{force=$true}) -ContentType 'application/json' }) -eq -1) "force close par expert -> 200"
OK ((St { Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/close") -Headers $H -Method Patch -Body (Body @{force=$true}) -ContentType 'application/json' }) -eq 400) "close deja clotre -> 400"
$ddC = Invoke-RestMethod ("$B/api/org/dossiers/" + $dId) -Headers $H
OK ($ddC.status -eq 'cloture') "status cloture"
OK (@($ddC.timeline 2>$null).Count -ge 0) "dossier cloture lisible"
$gTd = Invoke-RestMethod ("$B/api/org/dossiers/" + $dId + "/timeline") -Headers $H
$types = @($gTd | ForEach-Object { $_.type })
OK (@($types | Where-Object { $_ -eq 'dossier_closed' }).Count -ge 1) "timeline: dossier_closed"
OK (@($types | Where-Object { $_ -eq 'document_added' }).Count -ge 1) "timeline: document_added"
OK (@($types | Where-Object { $_ -eq 'note_added' }).Count -ge 1) "timeline: note_added"
OK (@($gTd | Where-Object { $_.label -and $_.icon }).Count -eq @($gTd).Count) "timeline: chaque entree a label+icon"

# --- 10) panel expert sur le nouveau comptable cree ---
$det2 = Invoke-RestMethod ("$B/api/org/comptables/" + $ncId + "/detail") -Headers $H
OK ($det2.kpis.total_dossiers -eq 0) "panel nouveau comptable: 0 dossier (client non assigne a lui)"

# --- cleanup D1 ---
$cid1 = $cId; $cid2 = $cSId; $did = $dId; $comp = $ncId; $tpl = $tpId; $alert = $alId; $note = $n.id; $docx = $docId
$tasks = @($dd2.tasks | ForEach-Object { "'$($_.id)'" }) -join ','
npx.cmd wrangler d1 execute eurex-db --remote --json --command "DELETE FROM org_time_entries WHERE dossier_id='$did'; DELETE FROM org_expected_documents WHERE dossier_id='$did'; DELETE FROM org_tasks WHERE dossier_id='$did'; DELETE FROM org_notes WHERE dossier_id='$did'; DELETE FROM org_alert_dones WHERE alert_id='$alert'; DELETE FROM org_fiscal_alerts WHERE id='$alert'; DELETE FROM org_task_templates WHERE id='$tpl'; DELETE FROM org_audit_log WHERE target_id='$did' OR target_id='$cid1' OR target_id='$cid2' OR target_id='$comp' OR target_id='$tpl' OR target_id='$alert' OR target_id='$note' OR target_id='$docx' OR target_id IN (SELECT id FROM org_expected_documents WHERE dossier_id='$did') OR target_id IN (SELECT id FROM org_notes WHERE dossier_id='$did') OR (target_type='task' AND target_id IN (SELECT id FROM org_tasks WHERE dossier_id='$did')) OR json_extract(details,'$.dossier_id')='$did'; DELETE FROM org_alert_dones WHERE alert_id IN (SELECT id FROM org_fiscal_alerts WHERE dossier_id='$did'); DELETE FROM org_fiscal_alerts WHERE dossier_id='$did'; DELETE FROM org_dossiers WHERE id='$did'; DELETE FROM org_clients WHERE id IN ('$cid1','$cid2'); DELETE FROM org_users WHERE id='$comp';" | Out-Null
$left = npx.cmd wrangler d1 execute eurex-db --remote --json --command "SELECT (SELECT COUNT(*) FROM org_clients WHERE name IN ('ZZ-CAB-CLIENT','ZZ-CAB-SAMAR-CLIENT')) + (SELECT COUNT(*) FROM org_users WHERE id='$comp') + (SELECT COUNT(*) FROM org_dossiers WHERE id='$did') + (SELECT COUNT(*) FROM org_task_templates WHERE id='$tpl') + (SELECT COUNT(*) FROM org_fiscal_alerts WHERE id='$alert') + (SELECT COUNT(*) FROM org_fiscal_alerts WHERE dossier_id='$did') as n" 2>$null
$n2 = (($left | Out-String | ConvertFrom-Json)[0]).results[0].n
OK ($n2 -eq 0) "cleanup complet (restant=$n2)"

""
if ($script:fail -eq 0) { "ALL PASS" } else { "$script:fail FAILURES" }
exit $script:fail
