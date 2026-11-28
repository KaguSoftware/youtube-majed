#!/usr/bin/env bash
# The Studio helper on a Mac: the worker (127.0.0.1:8766) and the voice service
# (127.0.0.1:8765), kept running by launchd from this checkout. The website,
# local (pnpm app) or hosted (https://youtube-majed.vercel.app), talks to them
# from the browser.
#
#   scripts/helper.sh setup     # tools, packages, voice weights (~7 GB), sound library, then start
#   scripts/helper.sh start     # install the login items (if missing) and start both services
#   scripts/helper.sh stop      # stop both and remove the login items
#   scripts/helper.sh restart
#   scripts/helper.sh status
#   scripts/helper.sh logs      # follow both logs
#   scripts/helper.sh update    # git pull, pnpm install, restart
#
# Projects live in <checkout>/projects (or STUDIO_PROJECTS_DIR). Each computer
# has its own; nothing is shared between computers.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/Studio"
UID_N="$(id -u)"
WORKER=com.studio.worker
AUDIO=com.studio.audio
SITE="https://youtube-majed.vercel.app"
PATH_FOR_AGENTS="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1; }

xml() { local s="$1"; s="${s//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"; printf '%s' "$s"; }

# plist <label> <workdir> <log> <program> [args...]
plist() {
  local label="$1" dir="$2" log="$3"; shift 3
  {
    cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>WorkingDirectory</key><string>$(xml "$dir")</string>
  <key>ProgramArguments</key>
  <array>
EOF
    for a in "$@"; do printf '    <string>%s</string>\n' "$(xml "$a")"; done
    cat <<EOF
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$PATH_FOR_AGENTS")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>StandardOutPath</key><string>$(xml "$log")</string>
  <key>StandardErrorPath</key><string>$(xml "$log")</string>
</dict>
</plist>
EOF
  } >"$AGENTS/$label.plist"
}

write_agents() {
  mkdir -p "$AGENTS" "$LOGS"
  local pnpm uv
  pnpm="$(command -v pnpm)" || { echo "pnpm not found: run scripts/helper.sh setup"; exit 1; }
  uv="$(command -v uv)" || { echo "uv not found: run scripts/helper.sh setup"; exit 1; }
  plist "$WORKER" "$REPO" "$LOGS/worker.log" "$pnpm" --filter @studio/worker start
  plist "$AUDIO" "$REPO/audio" "$LOGS/audio.log" "$uv" run --no-sync python -m studio_audio.server
}

loaded() { launchctl print "gui/$UID_N/$1" >/dev/null 2>&1; }

start() {
  write_agents
  for label in "$AUDIO" "$WORKER"; do
    if loaded "$label"; then launchctl kickstart -k "gui/$UID_N/$label"
    # launchd may still be tearing down a service that was just stopped: one retry
    else launchctl bootstrap "gui/$UID_N" "$AGENTS/$label.plist" 2>/dev/null || { sleep 2; launchctl bootstrap "gui/$UID_N" "$AGENTS/$label.plist"; }; fi
  done
  say "Waiting for the worker..."
  for _ in $(seq 1 60); do
    if curl -fs -o /dev/null http://127.0.0.1:8766/projects; then
      say "The helper is running. Open $SITE (or http://localhost:3100 with pnpm app)."
      return 0
    fi
    sleep 1
  done
  echo "The worker didn't answer within a minute. Look at $LOGS/worker.log"; exit 1
}

stop() {
  for label in "$WORKER" "$AUDIO"; do
    loaded "$label" && launchctl bootout "gui/$UID_N/$label" || true
    for _ in $(seq 1 20); do loaded "$label" || break; sleep 0.5; done
    rm -f "$AGENTS/$label.plist"
  done
  say "Stopped. The helper won't start at login until scripts/helper.sh start."
}

status() {
  for label in "$WORKER" "$AUDIO"; do
    if loaded "$label"; then echo "$label: loaded"; else echo "$label: not loaded"; fi
  done
  curl -fs -o /dev/null http://127.0.0.1:8766/projects && echo "worker: answering on 127.0.0.1:8766" || echo "worker: not answering"
  curl -fs -o /dev/null http://127.0.0.1:8765/health && echo "voice: answering on 127.0.0.1:8765" || echo "voice: not answering (it takes a minute to load the models)"
}

setup() {
  [[ "$(uname -s)" == Darwin ]] || { echo "This script is for macOS. Windows support is the next step."; exit 1; }
  [[ "$(uname -m)" == arm64 ]] || echo "Note: this is an Intel Mac; the voice runs on the CPU and will be slow."
  if ! need brew; then
    echo "Homebrew is needed for node, uv and ffmpeg. Install it from https://brew.sh, then run this again."; exit 1
  fi
  need node || brew install node
  local major; major="$(node -p 'process.versions.node.split(".")[0]')"
  (( major >= 24 )) || { echo "Node $major is too old (the worker needs 24+): brew upgrade node"; exit 1; }
  need uv || brew install uv
  need ffmpeg || brew install ffmpeg
  if ! need pnpm; then corepack enable --install-directory "$HOME/.local/bin" pnpm; export PATH="$HOME/.local/bin:$PATH"; fi

  say "Installing packages..."
  (cd "$REPO" && pnpm install --frozen-lockfile)
  say "Setting up the voice (first time downloads ~7 GB of model weights)..."
  (cd "$REPO/audio" && uv sync --no-install-project && uv run --no-sync python -m studio_audio.pins fetch)
  say "Building the sound library..."
  (cd "$REPO" && pnpm assets seed && pnpm assets index)

  if ! need claude; then
    echo
    echo "Claude Code isn't installed. The writing steps need it, signed in to your account:"
    echo "  https://docs.claude.com/en/docs/claude-code/setup   (then run: claude, and sign in)"
    echo
  fi
  start
}

case "${1:-}" in
  setup) setup ;;
  start) start ;;
  stop) stop ;;
  restart) stop >/dev/null; start ;;
  status) status ;;
  logs) mkdir -p "$LOGS"; touch "$LOGS/worker.log" "$LOGS/audio.log"; tail -f "$LOGS/worker.log" "$LOGS/audio.log" ;;
  update) git -C "$REPO" pull --ff-only && (cd "$REPO" && pnpm install --frozen-lockfile) && start ;;
  *) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
