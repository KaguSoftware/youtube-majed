#!/bin/zsh
# Install (or update) the studio's two workers as launchd agents.
#
#   deploy/install-worker.sh
#
# Why a copy: macOS privacy protection (TCC) blocks background agents from
# reading anything under ~/Desktop or ~/Documents, and this repo lives on the
# Desktop. An agent pointed at it fails before printing a line (launchd exit 78,
# EX_CONFIG; a probe agent running `ls` on the repo got "Operation not
# permitted"). Rather than grant an interpreter Full Disk Access or move the
# repo, the worker runs from its own install outside the protected folders.
# The worker holds no state (PLAN.md section 2): its cache rebuilds from Blob,
# its secrets are in ~/.config/youtube-majed/worker.env, and relocating it is
# a config change. Re-run this after changing pipeline code: it is the
# worker's deploy step.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Library/Application Support/youtube-majed"
LOGS="$HOME/Library/Logs/youtube-majed"
AGENTS="$HOME/Library/LaunchAgents"
UID_="$(id -u)"

mkdir -p "$APP" "$LOGS"

echo "== code -> $APP"
# Only what the worker imports or reads: the pipeline package, the licence
# gate it reuses from the benchmark harness, and the library style's
# reference images (config.REPO resolves repo-relative refs against $APP).
rsync -a --delete --exclude __pycache__ "$REPO/pipeline/" "$APP/pipeline/"
mkdir -p "$APP/bench"
rsync -a --delete --exclude __pycache__ "$REPO/bench/backends/" "$APP/bench/backends/"
rsync -a --delete "$REPO/bench/refs/" "$APP/bench/refs/"
cp "$REPO/bench/__init__.py" "$APP/bench/__init__.py" 2>/dev/null || touch "$APP/bench/__init__.py"
cp "$REPO/pyproject.toml" "$APP/pyproject.toml"

echo "== packages: the repo venv's exact versions"
# Same interpreter, same package versions as the venv the pipeline was tested
# in (pins such as pillow 12.3.0 are failures already paid for, PLAN.md 8.6).
"$REPO/.venv/bin/python" -m pip --version >/dev/null 2>&1 || true
uv pip freeze --python "$REPO/.venv/bin/python" > "$APP/requirements.lock"
PY_BASE="$("$REPO/.venv/bin/python" -c 'import sys; print(sys.base_prefix)')/bin/python3.12"
[ -x "$APP/.venv/bin/python" ] || uv venv --python "$PY_BASE" "$APP/.venv"
uv pip sync --python "$APP/.venv/bin/python" "$APP/requirements.lock"

echo "== launchd agents"
for name in worker worker-light; do
  label="com.youtube-majed.$name"
  dest="$AGENTS/$label.plist"
  # bootout is asynchronous: bootstrapping again before the old agent is gone
  # fails ("Input/output error") and leaves the old process running.
  launchctl bootout "gui/$UID_/$label" 2>/dev/null || true
  for _ in {1..60}; do launchctl print "gui/$UID_/$label" >/dev/null 2>&1 || break; sleep 1; done
  sed -e "s|REPO/.venv/bin/python|$APP/.venv/bin/python|g" \
      -e "s|<string>REPO</string>|<string>$APP</string>|g" \
      -e "s|REPO/work/|$LOGS/|g" \
      -e "s|HOME/.local/bin|$HOME/.local/bin|g" \
      "$REPO/deploy/$name.plist" > "$dest"
  plutil -lint "$dest" >/dev/null
  launchctl bootstrap "gui/$UID_" "$dest" || { echo "bootstrap of $label failed"; exit 1; }
done

sleep 8
launchctl list | grep youtube-majed || true
echo "logs: $LOGS"
tail -n 3 "$LOGS/worker.log" "$LOGS/worker-light.log" 2>/dev/null || true
