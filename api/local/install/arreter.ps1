# EUREX local - arret complet (serveur API + tunnel cloudflared + surveillance).
$ErrorActionPreference = 'SilentlyContinue'
$Here  = Split-Path -Parent $MyInvocation.MyCommand.Path    # api/local/install
$Local = Split-Path -Parent $Here                           # api/local
$Data  = Join-Path $Local 'data'

# Demande l'arret de la boucle de surveillance (demarrer.ps1)
Set-Content -Path (Join-Path $Data 'STOP') -Value ''

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*local/server.ts*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "serveur local arrete (PID $($_.ProcessId))" }

Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
  Where-Object { $_.CommandLine -like '*--url*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "tunnel arrete (PID $($_.ProcessId))" }

Start-Sleep -Seconds 2
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*demarrer.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "surveillance arretee (PID $($_.ProcessId))" }

Write-Host 'EUREX local arrete.'
