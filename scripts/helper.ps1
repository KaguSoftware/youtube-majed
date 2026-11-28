# The Studio helper on Windows: the worker (127.0.0.1:8766) and the voice service
# (127.0.0.1:8765), kept running from this checkout. The website, local
# (pnpm app) or hosted (https://youtube-majed.vercel.app), talks to them from
# the browser. Same commands as scripts/helper.sh on a Mac, through the
# scripts\helper.cmd wrapper (it gets past the default execution policy):
#
#   scripts\helper.cmd setup     # tools, packages, voice weights (~7 GB), sound library, then start
#   scripts\helper.cmd start     # start now, and at every login (a shortcut in the Startup folder)
#   scripts\helper.cmd stop      # stop both and remove the Startup shortcut
#   scripts\helper.cmd restart
#   scripts\helper.cmd status
#   scripts\helper.cmd logs      # follow both logs
#   scripts\helper.cmd update    # git pull, pnpm install, restart
#
# No administrator rights needed. Written for Windows PowerShell 5.1 (the one
# every Windows has), so: ASCII only, no ternaries, no && in commands.
param([Parameter(Position = 0)][string]$Command = "")
$ErrorActionPreference = "Stop"

$Repo = Split-Path -Parent $PSScriptRoot
$Home_ = Join-Path $env:LOCALAPPDATA "Studio"
$Logs = Join-Path $Home_ "Logs"
$PidFile = Join-Path $Home_ "helper.pid"
$Startup = Join-Path ([Environment]::GetFolderPath("Startup")) "Studio helper.lnk"
$Site = "https://youtube-majed.vercel.app"

function Say([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Has([string]$name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
# picks up what an installer just added, keeping what this shell already had
function Refresh-Path {
  $env:Path = $env:Path + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Run([string]$exe, [string[]]$argv, [string]$dir = $Repo) {
  Push-Location $dir
  try {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed with exit code $LASTEXITCODE" }
  } finally { Pop-Location }
}
# pnpm as a program Start-Process and & can run: pnpm.cmd (npm) or pnpm.exe (standalone), never pnpm.ps1 (blocked by the default execution policy)
function Pnpm {
  foreach ($n in @("pnpm.cmd", "pnpm.exe")) {
    $c = Get-Command $n -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
  }
  throw "pnpm not found: run scripts\helper.cmd setup"
}
function Pnpm-Or([string]$fallback) { try { return (Pnpm) } catch { return $fallback } }
function Answers([string]$url) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $url | Out-Null; return $true } catch { return $false }
}

# ------------------------------------------------------------------ supervisor

# Runs hidden (started by `start` and by the Startup shortcut): starts both
# services and starts either again if it exits. Logs go to %LOCALAPPDATA%\Studio\Logs.
function Supervise {
  New-Item -ItemType Directory -Force $Logs | Out-Null
  Set-Content -Path $PidFile -Value $PID
  Refresh-Path
  $services = @(
    @{ Name = "worker"; Exe = (Pnpm-Or "pnpm"); Args = @("--filter", "@studio/worker", "start"); Dir = $Repo; Proc = $null; Since = [datetime]::MinValue },
    @{ Name = "audio"; Exe = "uv"; Args = @("run", "--no-sync", "python", "-m", "studio_audio.server"); Dir = (Join-Path $Repo "audio"); Proc = $null; Since = [datetime]::MinValue }
  )
  while ($true) {
    foreach ($s in $services) {
      if (($s.Proc -eq $null -or $s.Proc.HasExited) -and ((Get-Date) - $s.Since).TotalSeconds -ge 15) {
        if ($s.Proc -ne $null) { Add-Content (Join-Path $Logs "supervisor.log") "$(Get-Date -Format s) $($s.Name) exited with code $($s.Proc.ExitCode); starting it again" }
        $s.Since = Get-Date
        try {
          $s.Proc = Start-Process -FilePath $s.Exe -ArgumentList $s.Args -WorkingDirectory $s.Dir -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $Logs "$($s.Name).log") -RedirectStandardError (Join-Path $Logs "$($s.Name).err.log")
        } catch {
          # one service that can't start (uv missing, say) must not take the other down; try again in 15 s
          $s.Proc = $null
          Add-Content (Join-Path $Logs "supervisor.log") "$(Get-Date -Format s) $($s.Name) could not start: $($_.Exception.Message)"
        }
      }
    }
    Start-Sleep -Seconds 5
  }
}

function Running-Pid {
  if (-not (Test-Path $PidFile)) { return $null }
  $p = [int]((Get-Content $PidFile -Raw).Trim())
  if (Get-Process -Id $p -ErrorAction SilentlyContinue) { return $p }
  return $null
}

function Stop-Supervisor {
  $p = Running-Pid
  if ($p) { & taskkill.exe /PID $p /T /F | Out-Null }
  Remove-Item -Force -ErrorAction SilentlyContinue $PidFile
}

function Start-Helper {
  New-Item -ItemType Directory -Force $Logs | Out-Null
  $ps = Join-Path $PSHOME "powershell.exe"
  $argv = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" run"
  # at every login
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($Startup)
  $lnk.TargetPath = $ps
  $lnk.Arguments = $argv
  $lnk.WorkingDirectory = $Repo
  $lnk.WindowStyle = 7
  $lnk.Description = "Studio helper: the worker and the voice for the Studio website"
  $lnk.Save()
  # and now
  Stop-Supervisor
  Start-Process -FilePath $ps -ArgumentList $argv -WindowStyle Hidden | Out-Null
  Say "Waiting for the worker..."
  for ($i = 0; $i -lt 90; $i++) {
    if (Answers "http://127.0.0.1:8766/projects") {
      Say "The helper is running. Open $Site in Chrome or Edge (or http://localhost:3100 with pnpm app)."
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "The worker didn't answer within 90 seconds. Look at $Logs\worker.log and worker.err.log"
}

function Stop-Helper {
  Stop-Supervisor
  Remove-Item -Force -ErrorAction SilentlyContinue $Startup
  Say "Stopped. The helper won't start at login until scripts\helper.cmd start."
}

function Status {
  if (Running-Pid) { "helper: running (pid $(Running-Pid))" } else { "helper: not running" }
  if (Test-Path $Startup) { "starts at login: yes" } else { "starts at login: no" }
  if (Answers "http://127.0.0.1:8766/projects") { "worker: answering on 127.0.0.1:8766" } else { "worker: not answering" }
  if (Answers "http://127.0.0.1:8765/health") { "voice: answering on 127.0.0.1:8765" } else { "voice: not answering (it takes a minute to load the models)" }
}

# ------------------------------------------------------------------ setup

function Winget([string]$id) {
  if (-not (Has "winget")) { throw "winget is missing. Install 'App Installer' from the Microsoft Store, then run this again." }
  Say "Installing $id..."
  & winget install --id $id -e --source winget --silent --accept-package-agreements --accept-source-agreements
  Refresh-Path
}

function Setup {
  if (-not (Has "git")) { Winget "Git.Git" }
  if (-not (Has "node")) { Winget "OpenJS.NodeJS.LTS" }
  $major = [int](& node -p "process.versions.node.split('.')[0]")
  if ($major -lt 24) { throw "Node $major is too old (the worker needs 24+): winget upgrade OpenJS.NodeJS.LTS" }
  if (-not (Has "uv")) { Winget "astral-sh.uv" }
  if (-not (Has "ffmpeg")) { Winget "Gyan.FFmpeg" }
  if (-not (Has "pnpm")) {
    Say "Installing pnpm..."
    Run "npm.cmd" @("install", "-g", "pnpm@9.15.9")
    Refresh-Path
  }

  Say "Installing packages..."
  Run (Pnpm) @("install", "--frozen-lockfile")
  if (Has "nvidia-smi") { Say "NVIDIA GPU found: the voice will run on it (CUDA)." } else { Say "No NVIDIA GPU found: the voice will run on the CPU, which is much slower." }
  Say "Setting up the voice (first time downloads ~7 GB of model weights)..."
  Run "uv" @("sync", "--no-install-project") (Join-Path $Repo "audio")
  Run "uv" @("run", "--no-sync", "python", "-m", "studio_audio.pins", "fetch") (Join-Path $Repo "audio")
  Say "Building the sound library..."
  Run (Pnpm) @("assets", "seed")
  Run (Pnpm) @("assets", "index")

  if (-not (Has "claude")) {
    Write-Host ""
    Write-Host "Claude Code isn't installed. The writing steps need it, signed in to your account. In PowerShell:"
    Write-Host "  irm https://claude.ai/install.ps1 | iex"
    Write-Host "then run: claude   (and sign in), then: scripts\helper.cmd restart"
    Write-Host ""
  }
  Start-Helper
}

switch ($Command) {
  "setup" { Setup }
  "start" { Start-Helper }
  "stop" { Stop-Helper }
  "restart" { Start-Helper }
  "status" { Status }
  "logs" {
    New-Item -ItemType Directory -Force $Logs | Out-Null
    Get-Content -Wait -Tail 40 (Join-Path $Logs "worker.log"), (Join-Path $Logs "worker.err.log"), (Join-Path $Logs "audio.log"), (Join-Path $Logs "audio.err.log") -ErrorAction SilentlyContinue
  }
  "update" {
    Run "git" @("pull", "--ff-only")
    Run (Pnpm) @("install", "--frozen-lockfile")
    Start-Helper
  }
  "run" { Supervise }
  default { Get-Content $PSCommandPath | Select-Object -Skip 6 -First 7 | ForEach-Object { $_ -replace '^# ?', '' }; exit 1 }
}
