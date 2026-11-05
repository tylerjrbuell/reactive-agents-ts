#!/usr/bin/env bash
# Warden team lint: tylerjrbuell/wardens `warden doctor --strict` over .claude/wardens.yaml + .claude/agents/.
#
# Fails on: unknown or mistyped keys in wardens.yaml, owned-path overlaps between domain
# wardens, expired pilot windows, declared wardens with no agent file, agents that look
# like wardens but aren't declared, ownership-map owners with no warden, and primer
# anchors (`path:line`) that no longer resolve.
# Primer rot motivated this: on 2026-11-05 doctor found 5 dead anchors across the
# 10 wardens, plus a memory-warden invariant anchored to a file deleted months
# earlier (wiki/Architecture/Design-Specs/2026-11-05-wardens-pack-design.md).
#
# The CLI is a single zero-dependency file, fetched at a pinned commit. If the
# fetch fails (the repo is private, or the runner is offline), this check SKIPS
# with a warning instead of failing every CI run. Set WARDENS_CLI=/path/to/warden.mjs
# to use a local copy.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WARDENS_SHA="d578ad0096dd65bde104f9e80a9fd2bc80246649"
CLI="${WARDENS_CLI:-}"

if [ -z "$CLI" ]; then
  CLI="$(mktemp -d)/warden.mjs"
  auth=()
  [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  if ! curl -fsSL "${auth[@]}" -H "Accept: application/vnd.github.raw" \
      "https://api.github.com/repos/tylerjrbuell/wardens/contents/bin/warden.mjs?ref=$WARDENS_SHA" -o "$CLI" 2>/dev/null; then
    echo "⚠ check-wardens: SKIPPED — could not fetch the wardens CLI @ ${WARDENS_SHA:0:7} (repo private or offline)."
    exit 0
  fi
fi

node "$CLI" doctor --strict --root "$ROOT"
