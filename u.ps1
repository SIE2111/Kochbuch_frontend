# Aenderungsbuild veroeffentlichen:  .\u.ps1 "Was ist neu"
# Holt selbst den neuesten Stand (git pull) und veroeffentlicht fix auf production.
param([string]$Message = "Update")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Hole neuesten Stand (git pull)..." -ForegroundColor Cyan
git pull --ff-only
if ($LASTEXITCODE -ne 0) {
  Write-Host "git pull fehlgeschlagen (lokale Aenderungen?) - ABBRUCH, sonst wuerde ein alter Stand veroeffentlicht." -ForegroundColor Red
  exit 1
}
if (-not $env:EXPO_TOKEN) {
  Write-Host "EXPO_TOKEN ist nicht gesetzt." -ForegroundColor Red
  Write-Host "Token erzeugen: https://expo.dev/settings/access-tokens"
  Write-Host 'Dann:  $env:EXPO_TOKEN = "dein-token"'
  exit 1
}
Write-Host "Eingeloggt als:" -ForegroundColor Cyan
npx eas whoami
Write-Host "Installiere Dependencies..." -ForegroundColor Cyan
npm install
# Metro-Zwischenspeicher leeren - sonst bricht der Export unter Windows
# gelegentlich mit "ENOTEMPTY ... metro-cache" ab (04.10.2026)
Write-Host "Leere Metro-Zwischenspeicher..." -ForegroundColor Cyan
Remove-Item -Recurse -Force (Join-Path $env:TEMP "metro-cache") -ErrorAction SilentlyContinue
# Frischer, leerer Temp-Ordner je Lauf: Windows haelt Dateien im alten metro-cache manchmal fest (Virenscanner), dann scheitert "--clear" (12.10.2026)
$neuerTemp = Join-Path $env:LOCALAPPDATA ("Temp\metro-" + (Get-Date -Format "yyyyMMddHHmmss"))
New-Item -ItemType Directory -Force -Path $neuerTemp | Out-Null
$env:TEMP = $neuerTemp
$env:TMP = $neuerTemp
Write-Host "Veroeffentliche Update auf 'production': $Message" -ForegroundColor Cyan
# --environment production: keine Rueckfrage "Select environment" (04.10.2026)
# Je Plattform einzeln und mit bis zu 3 Versuchen, jeder Versuch mit frischem Temp-Ordner: der parallele Export beider
# Plattformen leert den Metro-Cache gleichzeitig und scheitert unter Windows an "ENOTEMPTY" (12.10.2026)
foreach ($plattform in @("ios", "android")) {
  $geschafft = $false
  for ($versuch = 1; $versuch -le 3 -and -not $geschafft; $versuch++) {
    $t = Join-Path $env:LOCALAPPDATA ("Temp\metro-" + $plattform + "-" + $versuch + "-" + (Get-Date -Format "HHmmss"))
    New-Item -ItemType Directory -Force -Path $t | Out-Null
    $env:TEMP = $t
    $env:TMP = $t
    Remove-Item -Recurse -Force (Join-Path $PSScriptRoot "dist") -ErrorAction SilentlyContinue
    Write-Host "Veroeffentliche $plattform (Versuch $versuch)..." -ForegroundColor Cyan
    npx eas update --branch production --environment production --platform $plattform --message $Message
    if ($LASTEXITCODE -eq 0) { $geschafft = $true }
  }
  if (-not $geschafft) { Write-Host "Update fuer $plattform fehlgeschlagen." -ForegroundColor Red; exit 1 }
}
# Android-Tablet/Emulator (APK mit Kanal 'preview'): bekommt denselben Stand (Okt 2026)
# Wie oben mit bis zu 3 Versuchen und frischem Temp-Ordner. Zusaetzlich wird der Export-Ordner 'dist' vorher geloescht:
# Windows haelt ihn nach dem vorigen Export manchmal kurz fest ("EPERM: rmdir ...\dist\_expo\static", 18.10.2026)
$previewGeschafft = $false
for ($versuch = 1; $versuch -le 3 -and -not $previewGeschafft; $versuch++) {
  Start-Sleep -Seconds (3 * $versuch)
  Remove-Item -Recurse -Force (Join-Path $PSScriptRoot "dist") -ErrorAction SilentlyContinue
  $t = Join-Path $env:LOCALAPPDATA ("Temp\metro-preview-" + $versuch + "-" + (Get-Date -Format "HHmmss"))
  New-Item -ItemType Directory -Force -Path $t | Out-Null
  $env:TEMP = $t
  $env:TMP = $t
  Write-Host "Veroeffentliche Update fuer Android-Test (Kanal 'preview'), Versuch $versuch..." -ForegroundColor Cyan
  npx eas update --branch preview --environment production --platform android --message $Message
  if ($LASTEXITCODE -eq 0) { $previewGeschafft = $true }
}
if (-not $previewGeschafft) { Write-Host "Update fuer Android-Test (preview) fehlgeschlagen. production ist aber veroeffentlicht." -ForegroundColor Red; exit 1 }
Write-Host "Fertig: iOS, Android und Android-Test veroeffentlicht." -ForegroundColor Green
