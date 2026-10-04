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
Write-Host "Veroeffentliche Update auf 'production': $Message" -ForegroundColor Cyan
# --environment production: keine Rueckfrage "Select environment" (04.10.2026)
npx eas update --branch production --environment production --platform ios --message $Message
