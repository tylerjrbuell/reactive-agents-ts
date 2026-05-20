#!/usr/bin/env bash
# Symlink all .agents/skills/* into .claude/skills/ for Claude Code discovery.
# Safe to re-run: skips existing valid symlinks, replaces broken ones.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/.agents/skills"
DEST="$REPO_ROOT/.claude/skills"

mkdir -p "$DEST"

linked=0
skipped=0
replaced=0

for skill_dir in "$SRC"/*/; do
  name="$(basename "$skill_dir")"
  target="$DEST/$name"

  if [[ -L "$target" && "$(readlink "$target")" == "$skill_dir" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  if [[ -L "$target" ]]; then
    rm "$target"
    replaced=$((replaced + 1))
  fi

  ln -s "$skill_dir" "$target"
  linked=$((linked + 1))
done

echo "Linked: $linked  Replaced: $replaced  Skipped (up-to-date): $skipped"
echo "Target: $DEST"
