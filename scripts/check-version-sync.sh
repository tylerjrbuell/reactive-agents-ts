#!/usr/bin/env bash
# Version lockstep guard.
#
# scripts/release.ts's own docstring claims "Drift is structurally impossible:
# one `version` var stamps every package" — but that's only true for the
# instant the script runs. Nothing previously verified the stamp actually
# landed and stayed landed, so `VERSION` and 34 `packages/*/package.json`
# drifted apart silently (found 2026-09-03: VERSION read 0.15.0 while every
# package.json still read 0.10.6 — 5 minor releases of drift on the exact
# files npm publishes from).
#
# Rule: every package's `version` field must equal the root `VERSION` file,
# byte-for-byte. No baseline/ratchet — this is binary, not a count to shrink.
#
# This script rides the auto-globbed scripts/check-*.sh CI lane (ci.yml:85),
# so it needs no separate workflow wiring.
#
# Usage: bash scripts/check-version-sync.sh [ROOT]

set -e

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"

if [ -z "$VERSION" ]; then
  echo "❌ check-version-sync: $ROOT/VERSION is empty or missing"
  exit 1
fi

fail=0
count=0

for pkg_json in "$ROOT"/packages/*/package.json; do
  [ -f "$pkg_json" ] || continue
  count=$((count + 1))
  pkg_version="$(grep -m1 '"version"' "$pkg_json" | sed -E 's/.*"version":\s*"([^"]*)".*/\1/')"
  if [ "$pkg_version" != "$VERSION" ]; then
    pkg_dir="$(basename "$(dirname "$pkg_json")")"
    echo "❌ check-version-sync: packages/$pkg_dir is $pkg_version, VERSION file is $VERSION"
    fail=1
  fi
done

if [ "$count" -eq 0 ]; then
  echo "❌ check-version-sync: found no packages/*/package.json — pattern drift?"
  exit 1
fi

if [ "$fail" -eq 1 ]; then
  echo ""
  echo "Fix: bun scripts/release.ts $VERSION --no-publish   (stamps versions, no npm touch)"
  exit 1
fi

echo "✅ check-version-sync: $count packages match VERSION=$VERSION"
