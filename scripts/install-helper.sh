#!/usr/bin/env bash
# One-line install of the Studio helper on a Mac:
#
#   curl -fsSL https://raw.githubusercontent.com/KaguSoftware/youtube-majed/main/scripts/install-helper.sh | bash
#
# Clones the repo into ~/Studio (or $STUDIO_DIR), or updates it if it's there,
# then runs scripts/helper.sh setup: tools, packages, voice weights, sound
# library, and login items that keep the worker and the voice running.
set -euo pipefail

DIR="${STUDIO_DIR:-$HOME/Studio}"
URL="https://github.com/KaguSoftware/youtube-majed.git"
BRANCH="${STUDIO_BRANCH:-main}"

[[ "$(uname -s)" == Darwin ]] || { echo "This installer is for macOS. Windows support is the next step."; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is needed: run  xcode-select --install  and then this again."; exit 1; }

if [[ -d "$DIR/.git" ]]; then
  echo "Updating $DIR"
  git -C "$DIR" pull --ff-only
else
  echo "Installing into $DIR"
  git clone --branch "$BRANCH" "$URL" "$DIR"
fi
exec bash "$DIR/scripts/helper.sh" setup
