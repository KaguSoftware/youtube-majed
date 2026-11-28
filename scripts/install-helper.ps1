# One-line install of the Studio helper on Windows. In PowerShell (no administrator needed):
#
#   irm https://raw.githubusercontent.com/KaguSoftware/youtube-majed/main/scripts/install-helper.ps1 | iex
#
# Clones the repo into %USERPROFILE%\Studio (or $env:STUDIO_DIR), or updates it
# if it's there, then runs scripts\helper.ps1 setup: tools (winget), packages,
# voice weights, sound library, and a Startup shortcut that keeps the worker and
# the voice running.
$ErrorActionPreference = "Stop"

$dir = $env:STUDIO_DIR
if (-not $dir) { $dir = Join-Path $env:USERPROFILE "Studio" }
$url = "https://github.com/KaguSoftware/youtube-majed.git"
$branch = $env:STUDIO_BRANCH
if (-not $branch) { $branch = "main" }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "winget is missing. Install 'App Installer' from the Microsoft Store, then run this again." }
  Write-Host "Installing Git..." -ForegroundColor Cyan
  & winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

if (Test-Path (Join-Path $dir ".git")) {
  Write-Host "Updating $dir" -ForegroundColor Cyan
  & git -C $dir pull --ff-only
} else {
  Write-Host "Installing into $dir" -ForegroundColor Cyan
  # LF line endings exactly as committed, and paths past 260 characters (pnpm's node_modules)
  & git -c core.autocrlf=false -c core.longpaths=true clone --branch $branch $url $dir
  & git -C $dir config core.autocrlf false
  & git -C $dir config core.longpaths true
}
if ($LASTEXITCODE -ne 0) { throw "git failed" }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir "scripts\helper.ps1") setup
