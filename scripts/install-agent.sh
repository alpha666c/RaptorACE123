#!/usr/bin/env bash
# Install the latest Personal Coding Agent .vsix into the current VS Code
# (local CLI, Codespace, or Remote-SSH — wherever `code` is on the PATH).
#
# Uses multiple strategies, first one that works wins:
#   1. GitHub release download via `gh` (handles private repos if you're logged in)
#   2. Raw download from the public repo (if the repo is public)
#   3. git clone + install from the packaged file in the repo
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/viktorhedklin/RaptorACE/main/scripts/install-agent.sh | bash
#   # or, after cloning the repo:
#   ./scripts/install-agent.sh

set -euo pipefail

OWNER="viktorhedklin"
REPO="RaptorACE"
VSIX_PATH_IN_REPO="dist-vsix/personal-coding-agent-extension-0.1.0.vsix"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say() { printf "\033[1;36m[install-agent]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[install-agent]\033[0m %s\n" "$*" >&2; }

if ! command -v code >/dev/null 2>&1; then
  warn "VS Code CLI ('code') not on PATH. Install VS Code + enable the 'code' command, then retry."
  exit 1
fi

VSIX=""

# Strategy 1: gh release download
if command -v gh >/dev/null 2>&1; then
  say "Trying gh release download…"
  if gh release download latest \
       --repo "$OWNER/$REPO" \
       --pattern "*.vsix" \
       --dir "$TMP" 2>/dev/null; then
    VSIX="$(ls "$TMP"/*.vsix 2>/dev/null | head -n 1 || true)"
    [ -n "$VSIX" ] && say "Downloaded via gh: $VSIX"
  else
    warn "gh release download failed (not logged in? no release yet?). Falling through."
  fi
fi

# Strategy 2: raw.githubusercontent.com (public repos)
if [ -z "$VSIX" ]; then
  URL="https://raw.githubusercontent.com/$OWNER/$REPO/main/$VSIX_PATH_IN_REPO"
  say "Trying $URL …"
  if curl -fsSL "$URL" -o "$TMP/agent.vsix"; then
    # Sanity: a real .vsix is a zip starting with PK\x03\x04
    if head -c 2 "$TMP/agent.vsix" | grep -q "PK"; then
      VSIX="$TMP/agent.vsix"
      say "Downloaded via raw: $VSIX"
    else
      warn "Raw URL returned non-zip content (likely private repo — got an HTML page). Falling through."
      rm -f "$TMP/agent.vsix"
    fi
  else
    warn "Raw download failed. Falling through."
  fi
fi

# Strategy 3: git clone (uses Codespaces' built-in auth; works for private repos you own)
if [ -z "$VSIX" ]; then
  say "Trying git clone…"
  if git clone --depth 1 "https://github.com/$OWNER/$REPO.git" "$TMP/repo" 2>/dev/null; then
    if [ -f "$TMP/repo/$VSIX_PATH_IN_REPO" ]; then
      VSIX="$TMP/repo/$VSIX_PATH_IN_REPO"
      say "Found in clone: $VSIX"
    fi
  else
    warn "git clone failed (auth missing?)."
  fi
fi

if [ -z "$VSIX" ]; then
  warn "Couldn't obtain the .vsix. Options:"
  warn "  • Run 'gh auth login' (pick the account that owns $OWNER/$REPO), then rerun this script."
  warn "  • Make $OWNER/$REPO public, then rerun."
  warn "  • Upload the .vsix manually via VS Code → Extensions → '…' → Install from VSIX…"
  exit 1
fi

say "Installing: $VSIX"
code --install-extension "$VSIX"
say "Done. Reload the VS Code window: Command Palette → 'Developer: Reload Window'."
