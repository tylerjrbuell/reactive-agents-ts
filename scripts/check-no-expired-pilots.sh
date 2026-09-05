#!/usr/bin/env bash
# Pilot-expiry guard.
#
# The 9-warden team-ownership program declared "Pilot 2026-05-23 → 2026-06-15"
# in its own frontmatter/prose and required an empirical evaluation before that
# date to canonicalize or revert. The evaluation never ran; the pilot sat
# expired for 3 months with no decision, because nothing but a human re-reading
# 11 files would ever notice (see wiki/Decisions/2026-09-03-warden-pilot-ratified.md,
# which finally closed it out). A status fact sitting only in prose is the
# disease this whole check-*.sh lane exists to cure.
#
# Rule: any file under .claude/agents/ or .agents/skills/ that declares a
# "Pilot <YYYY-MM-DD> → <YYYY-MM-DD>" window must have an end date that is
# still in the future. An expired, undecided pilot is a build failure, not a
# thing to notice later. Once a pilot is ratified or reverted, the pilot
# language should be removed entirely (see the 11-file precedent above) — this
# check has nothing to say about files that no longer mention "Pilot".
#
# This script rides the auto-globbed scripts/check-*.sh CI lane (ci.yml:85),
# so it needs no separate workflow wiring.
#
# Usage: bash scripts/check-no-expired-pilots.sh [ROOT] [TODAY]
#   TODAY  override for the current date, YYYY-MM-DD (fixture testing only)

set -e

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
TODAY="${2:-$(date +%Y-%m-%d)}"

fail=0

while IFS= read -r line; do
  file="${line%%:*}"
  rest="${line#*:}"
  end_date="$(echo "$rest" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} *→ *[0-9]{4}-[0-9]{2}-[0-9]{2}' | sed -E 's/.*→ *//')"
  [ -z "$end_date" ] && continue
  if [[ "$end_date" < "$TODAY" ]]; then
    echo "❌ check-no-expired-pilots: $file — pilot window ended $end_date, today is $TODAY."
    echo "   Ratify (remove pilot language) or revert (remove the file) — do not leave it undecided."
    fail=1
  fi
done < <(grep -rnE 'Pilot [0-9]{4}-[0-9]{2}-[0-9]{2} *→ *[0-9]{4}-[0-9]{2}-[0-9]{2}' \
  "$ROOT/.claude/agents" "$ROOT/.agents/skills" 2>/dev/null || true)

if [ "$fail" -eq 1 ]; then
  exit 1
fi

echo "✅ check-no-expired-pilots: no expired pilot windows in .claude/agents or .agents/skills"
