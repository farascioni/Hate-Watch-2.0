#!/usr/bin/env bash
# Makes this machine's Claude Code user settings match the repo's: ~/.claude/settings.json, ~/.claude/CLAUDE.md
# and the subagents in ~/.claude/agents. A file that differs is kept beside its new copy as <name>.before-<time>.
# Run on each machine after a pull:  bash claude-config/install.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dst="$HOME/.claude"
stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dst/agents"
put() { # put <file in this repo> <installed file>
  if [ -f "$2" ] && ! cmp -s "$1" "$2"; then cp "$2" "$2.before-$stamp"; fi
  cp "$1" "$2"
}
put "$here/settings.json" "$dst/settings.json"
put "$here/user-CLAUDE.md" "$dst/CLAUDE.md"
for f in "$here"/agents/*.md; do put "$f" "$dst/agents/$(basename "$f")"; done
echo "Claude Code settings in $dst now match $here"
