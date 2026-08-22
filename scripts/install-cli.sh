#!/usr/bin/env bash
# One-command install/repair of the `optiflow` CLI.
#
# This is the BOOTSTRAP path. Once it has run once, `optiflow update` does
# the same job and you never need this script again.
#
# It exists because getting the CLI onto a machine used to require knowing
# three unrelated things, and getting any one wrong produced an error that
# looked like a broken build:
#
#   1. `npm install -g github:kristijankopacevic/optiflow-mcp` is BROKEN.
#      npm symlinks the global install to its own temp git clone
#      (_cacache/tmp/git-clone-XXXX) and then cleans that up, leaving working
#      bin shims that point at nothing:
#        Error: Cannot find module '.../optiflow-mcp/plugin/bin/optiflow'
#      The remote-tarball URL takes npm's ordinary path and works.
#
#   2. Older docs in this repo told users to add
#      `alias optiflow='node ~/.claude/plugins/cache/.../bin/optiflow'`,
#      because before the packaging was fixed that was the only working copy.
#      That alias now shadows every install and pins the user to whatever
#      build the plugin cache holds:
#        error: unknown command 'savings'
#
#   3. bash caches command lookups, so even after fixing both, the old path
#      can still be used until `hash -r`.
#
# Safe to re-run at any time.

set -euo pipefail

TARBALL="https://github.com/kristijankopacevic/optiflow-mcp/archive/refs/heads/master.tar.gz"

say() { printf '%s\n' "$*"; }

say "==> Removing stale optiflow aliases"
removed_any=0
for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.zshrc" "$HOME/.profile"; do
  [ -f "$rc" ] || continue
  if grep -qE '^\s*alias\s+optiflow\s*=' "$rc"; then
    # Back up before editing someone's shell config, always.
    cp "$rc" "$rc.optiflow-backup-$(date +%Y%m%d%H%M%S)"
    sed -i.tmp -E '/^\s*alias\s+optiflow\s*=/d' "$rc" && rm -f "$rc.tmp"
    say "    removed alias from $rc (backup written alongside it)"
    removed_any=1
  fi
done
[ "$removed_any" -eq 0 ] && say "    none found"

say "==> Removing any previous global install"
# The broken github: form leaves a dangling symlink; installing over it is
# not reliably clean, so remove first. A failure here is fine — it usually
# just means nothing was installed.
npm uninstall -g optiflow-mcp >/dev/null 2>&1 || true

say "==> Installing from $TARBALL"
npm install -g "$TARBALL"

BIN_DIR="$(npm config get prefix)/bin"
say ""
say "==> Verifying"
if ! command -v optiflow >/dev/null 2>&1; then
  say "    'optiflow' is not on your PATH."
  say "    Add npm's global bin directory:"
  say ""
  say "      echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc"
  say "      source ~/.bashrc"
  say ""
  exit 1
fi

# `savings` is the newest command, so its presence is a good proxy for "this
# is actually the current build and not something older still on PATH".
if optiflow savings --help >/dev/null 2>&1; then
  say "    optiflow $(optiflow --version) — ok"
else
  say "    WARNING: 'optiflow' resolves to an OLD build:"
  say "      $(command -v optiflow)"
  say "    Something on your PATH is shadowing the install. Run:"
  say "      hash -r && type -a optiflow"
  exit 1
fi

say ""
say "Done. Try:"
say "  optiflow savings --watch"
say ""
if [ "$removed_any" -eq 1 ]; then
  say "An alias was removed from your shell config, but it is still active in"
  say "THIS shell — a script cannot unset an alias in the shell that ran it."
  say "Run 'unalias optiflow; hash -r', or just open a new terminal."
  say ""
fi
say "Note: the CLI only READS the savings ledger. The plugin's hooks WRITE it,"
say "so update the plugin too (/plugin in Claude Code) or the ledger stays empty."
