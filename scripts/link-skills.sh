#!/usr/bin/env bash
# Symlink all .agents/skills/* into .claude/skills/ for Claude Code discovery.
# Safe to re-run: skips existing valid symlinks, replaces broken ones.
#
# Symlinks are RELATIVE (../../.agents/skills/<name>). Found 2026-09-03: all
# 35 were committed with the absolute path of one contributor's checkout
# baked in (git stores a symlink's target text as its blob content) — dangling
# for every other clone location, contributor, or CI runner. Relative targets
# survive a clone anywhere.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/.agents/skills"
DEST="$REPO_ROOT/.claude/skills"
REL_TARGET_PREFIX="../../.agents/skills"

mkdir -p "$DEST"

linked=0
skipped=0
replaced=0

for skill_dir in "$SRC"/*/; do
  name="$(basename "$skill_dir")"
  target="$DEST/$name"
  rel_target="$REL_TARGET_PREFIX/$name"

  if [[ -L "$target" && "$(readlink "$target")" == "$rel_target" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  if [[ -L "$target" ]]; then
    rm "$target"
    replaced=$((replaced + 1))
  fi

  ln -s "$rel_target" "$target"
  linked=$((linked + 1))
done

echo "Linked: $linked  Replaced: $replaced  Skipped (up-to-date): $skipped"
echo "Target: $DEST"
