# EUREX local - installation sur le PC du cabinet (a executer UNE fois).
# 1) Verifie Node.js, 2) installe cloudflared si absent,
# 3) cree la tache planifiee "EUREX-LOCAL" (demarrage auto au demarrage de Windows).
# Options: -DemarrerMaintenant  lance aussi le service tout de suite.
param([switch]$DemarrerMaintenant)
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Local = Split-Path -Parent $Here

Write-Host '=== EUREX local - installation ===' -ForegroundColor Cyan

# --- 1. Node.js ---
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  foreach ($c in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) { if (Test-Path $c) { $node = $c } }
}
if (-not $node) {
  Write-Host 'Node.js INTROUVABLE. Installer Node.js 24 LTS depuis https://nodejs.org puis relancer.' -ForegroundColor Red
  exit 1
}
$ver = & $node --version
Write-Host "Node: $ver ($node)"
$parts = $ver.TrimStart('v') -split '\.'
if ([int]$parts[0] -lt 22 -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -lt 9)) {
  Write-Host 'Node trop ancien (>= 22.9 requis, 24 LTS recommande).' -ForegroundColor Red
  exit 1
}

# --- 2. cloudflared ---
$cfd = $null
foreach ($c in @("$env:ProgramFiles\cloudflared\cloudflared.exe",
                 "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
                 "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe")) {
  if (Test-Path $c) { $cfd = $c }
}
if (-not $cfd) {
  $wg = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $wg) { Write-Host 'winget absent : telecharger cloudflared depuis https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ puis relancer.' -ForegroundColor Red; exit 1 }
  Write-Host 'Installation de cloudflared (winget)...'
  winget install --id Cloudflare.cloudflared --silent --accept-package-agreements --accept-source-agreements | Out-Null
  foreach ($c in @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe")) { if (Test-Path $c) { $cfd = $c } }
}
if (-not $cfd) { Write-Host 'cloudflared toujours introuvable apres installation.' -ForegroundColor Red; exit 1 }
Write-Host "cloudflared: $cfd"

# --- 3. Fichiers requis ---
if (-not (Test-Path (Join-Path $Local '.env'))) {
  $src = Join-Path $Local '.env.example'
  if (Test-Path $src) { Copy-Item $src (Join-Path $Local '.env'); Write-Host '.env cree depuis .env.example -> A COMPLETER (EUREX_INTERNAL_SECRET)' -ForegroundColor Yellow }
  else { Write-Host '.env manquant.' -ForegroundColor Red; exit 1 }
}
if (-not (Test-Path (Join-Path $Local 'data\eurex.db'))) {
  Write-Host 'data\eurex.db absent -> copier le dossier data depuis la machine actuelle (voir README).' -ForegroundColor Yellow
}

# --- 4. Demarrage auto au boot ---
#   - Administrateur  : tache planifiee "EUREX-LOCAL" (SYSTEM, ONSTART = avant login, ideal)
#   - Sans admin       : cle Run (HKCU) au demarrage de la session (fallback)
$script = Join-Path $Here 'demarrer.ps1'
# Chemin court 8.3 : evite les espaces/quotes que schtasks /TR mange (bug classique)
try { $short = (New-Object -ComObject Scripting.FileSystemObject).GetFile($script).ShortPath } catch { $short = $script }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$done = $false
if ($isAdmin) {
  $tr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File $short"
  schtasks /Create /TN 'EUREX-LOCAL' /TR $tr /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host 'Tache "EUREX-LOCAL" creee : demarrage auto au boot de Windows (avant login).' -ForegroundColor Green
    $done = $true
  } else { Write-Host "Creation tache echouee (code $LASTEXITCODE)." -ForegroundColor Yellow }
}
if (-not $done) {
  $run = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File $short"
  reg.exe add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v EUREX-LOCAL /t REG_SZ /d $run /f | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host 'Cle Run HKCU creee : demarrage auto a l OUVERTURE DE SESSION.' -ForegroundColor Green
    Write-Host '  (Pour demarrer avant login : relancer ce script en administrateur.)' -ForegroundColor DarkGray
  } else { Write-Host 'Creation demarrage auto echouee - lancer manuellement.' -ForegroundColor Yellow }
}

Write-Host ''
Write-Host 'Commandes utiles:' -ForegroundColor Cyan
Write-Host "  Demarrer : powershell -ExecutionPolicy Bypass -File `"$script`""
Write-Host "  Arreter  : powershell -ExecutionPolicy Bypass -File `"$(Join-Path $Here 'arreter.ps1')`""
Write-Host "  Logs     : $Local\data\logs\"

if ($DemarrerMaintenant) {
  Write-Host ''
  Write-Host 'Demarrage...' -ForegroundColor Cyan
  # NB : -ArgumentList avec tableau coupe au premier espace du chemin -> ligne unique citee
  Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -WindowStyle Hidden
  Start-Sleep -Seconds 8
  try { $p = (Invoke-WebRequest -Uri 'http://127.0.0.1:8787/_local/ping' -UseBasicParsing -TimeoutSec 10).Content; Write-Host "OK: $p" -ForegroundColor Green }
  catch { Write-Host 'Ping KO - verifier les logs.' -ForegroundColor Red }
}
