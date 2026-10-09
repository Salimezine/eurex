# EUREX local - demarrage complet (cloudflared + serveur API) avec surveillance auto.
# Lance a la main ou par la tache planifiee "EUREX-LOCAL" (voir installer.ps1).
$ErrorActionPreference = 'Stop'
$Here    = Split-Path -Parent $MyInvocation.MyCommand.Path   # api/local/install
$Local   = Split-Path -Parent $Here                          # api/local
$Api     = Split-Path -Parent $Local                         # api
$Data    = Join-Path $Local 'data'
$EnvFile = Join-Path $Local '.env'
$StopFile = Join-Path $Data 'STOP'
$LogDir  = Join-Path $Data 'logs'
New-Item -ItemType Directory -Force -Path $Data, $LogDir | Out-Null

function Write-Log([string]$msg) {
  Add-Content -Path (Join-Path $LogDir 'demarrer.log') -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

function Read-EnvFile {
  $h = @{}
  if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
      if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $h[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
    }
  }
  $h
}

function Write-EnvFile($h) {
  $order = @('EUREX_PORT','EUREX_WORKER_URL','EUREX_INTERNAL_SECRET','EUREX_TUNNEL_URL','EUREX_AI_FALLBACK_URLS')
  $lines = @()
  foreach ($k in $order) { if ($h.ContainsKey($k)) { $lines += "$k=$($h[$k])" } }
  foreach ($k in @($h.Keys)) { if ($order -notcontains $k) { $lines += "$k=$($h[$k])" } }
  [System.IO.File]::WriteAllLines($EnvFile, $lines, (New-Object System.Text.ASCIIEncoding))  # sans BOM
}

function Find-Cloudflared {
  foreach ($c in @("$env:ProgramFiles\cloudflared\cloudflared.exe",
                   "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
                   "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe")) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($c in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

$Port = '8787'
$cfd  = Find-Cloudflared
$node = Find-Node
if (-not $cfd)  { Write-Log 'ERREUR: cloudflared introuvable (lancer installer.ps1)'; exit 1 }
if (-not $node) { Write-Log 'ERREUR: node introuvable (Installer Node.js 24 LTS)'; exit 1 }
if (Test-Path $StopFile) { Remove-Item $StopFile -Force }

$envCfg = Read-EnvFile
if ($envCfg.EUREX_PORT) { $Port = $envCfg.EUREX_PORT }
$nodeMajor = [int]((& $node --version).TrimStart('v') -split '\.')[0]
$nodeArgs = @()
if ($nodeMajor -lt 23 -or ($nodeMajor -eq 23 -and [int]((& $node --version).TrimStart('v') -split '\.')[1] -lt 6)) {
  $nodeArgs += '--experimental-strip-types'   # Node 22.x : type stripping experimental
}
$nodeArgs += '--env-file-if-exists=local/.env', 'local/server.ts'

function Start-Tunnel {
  $out = Join-Path $LogDir 'cloudflared.log'
  $err = Join-Path $LogDir 'cloudflared.err.log'
  Set-Content -Path $out -Value ''
  $p = Start-Process -FilePath $cfd -ArgumentList 'tunnel','--url',"http://127.0.0.1:$Port",'--no-autoupdate' `
        -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $txt = (Get-Content $out -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content $err -Raw -ErrorAction SilentlyContinue)
    if ($txt -match 'https://[a-z0-9\-]+\.trycloudflare\.com') { return @{ Pid = $p.Id; Url = $Matches[0] } }
    if ($p.HasExited) { break }
  }
  return @{ Pid = $p.Id; Url = $null }
}

function Start-Server {
  Start-Process -FilePath $node -ArgumentList $nodeArgs -WorkingDirectory $Api `
    -RedirectStandardOutput (Join-Path $LogDir 'server.out.log') `
    -RedirectStandardError (Join-Path $LogDir 'server.err.log') `
    -WindowStyle Hidden -PassThru
}

Write-Log "demarrage (port $Port)"
$t = Start-Tunnel
if ($t.Url) {
  $envCfg = Read-EnvFile
  $envCfg.EUREX_TUNNEL_URL = $t.Url
  Write-EnvFile $envCfg
  Write-Log "tunnel: $($t.Url)"
} else {
  Write-Log 'ERREUR: URL tunnel non obtenue (voir cloudflared.err.log)'
  exit 1
}
$srv = Start-Server
Write-Log "serveur local PID $($srv.Id)"
Start-Sleep -Seconds 3
try { $ping = (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/_local/ping" -UseBasicParsing -TimeoutSec 10).Content; Write-Log "ping OK: $ping" }
catch { Write-Log "ERREUR ping: $($_.Exception.Message)" }

# --- Surveillance : redemarre tunnel/serveur s ils meurent, arrete sur fichier STOP ---
while ($true) {
  Start-Sleep -Seconds 15
  if (Test-Path $StopFile) { Write-Log 'STOP demande -> arret'; break }
  try {
    $proc = Get-Process -Id $t.Pid -ErrorAction Stop
  } catch { $proc = $null }
  if (-not $proc) {
    Write-Log 'tunnel mort -> redemarrage'
    $t = Start-Tunnel
    if ($t.Url) {
      $envCfg = Read-EnvFile
      $envCfg.EUREX_TUNNEL_URL = $t.Url
      Write-EnvFile $envCfg
      Write-Log "nouveau tunnel: $($t.Url) (heartbeat mis a jour en <=60s)"
    } else { Write-Log 'ERREUR: nouveau tunnel impossible' }
  }
  $srvAlive = $null
  try { $srvAlive = Get-Process -Id $srv.Id -ErrorAction Stop } catch {}
  if (-not $srvAlive) {
    Write-Log 'serveur mort -> redemarrage'
    $srv = Start-Server
    Write-Log "nouveau serveur PID $($srv.Id)"
  }
}
# Arret propre des enfants
foreach ($id in @($t.Pid, $srv.Id)) {
  try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {}
}
Write-Log 'termine'
