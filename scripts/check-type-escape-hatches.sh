#!/usr/bin/env bash
# Type-escape-hatch ratchet guard.
#
# `as any` / `@ts-ignore` / `@ts-expect-error` are places where a human
# manually overrides the type checker — each one is a spot where TypeScript
# can no longer catch a wrong-shape bug at compile time. Found 2026-09-03:
# 69 total across packages/*/src, 84% of them (30 + 28) concentrated in
# `reasoning` and `runtime` — the kernel loop and execution engine, the two
# packages where a type error becoming a runtime bug is costliest.
#
# Rule: per-package count vs BASELINE below, ratcheted like check-orphans.sh's
# ORPHAN_BASELINE — may only SHRINK. A package exceeding its baseline FAILS. A
# package not listed here that gains its first escape hatch FAILS (baseline 0).
# Deleting an escape hatch and forgetting to lower its baseline is caught by
# the opposite direction too (see --tighten below) so the baseline can't drift
# stale upward by accident.
#
# This script rides the auto-globbed scripts/check-*.sh CI lane (ci.yml:85),
# so it needs no separate workflow wiring.
#
# Usage: bash scripts/check-type-escape-hatches.sh [ROOT]
#        bash scripts/check-type-escape-hatches.sh --tighten   (print exact
#          current counts in BASELINE format, to paste in after a cleanup)

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATTERN='\bas any\b|@ts-ignore|@ts-expect-error'

# RATCHET: may only shrink. Packages absent here have an implicit baseline of 0.
declare -A BASELINE=(
  [reasoning]=30
  [runtime]=28
  [testing]=4
  [reactive-intelligence]=4
  [benchmarks]=2
  [tools]=1
)

count_for() {
  local pkg="$1"
  [ -d "$ROOT/packages/$pkg/src" ] || { echo 0; return; }
  grep -rE "$PATTERN" "$ROOT/packages/$pkg/src" --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l | tr -d ' '
}

if [ "${1:-}" = "--tighten" ]; then
  for p in "$ROOT"/packages/*/; do
    name="$(basename "$p")"
    n="$(count_for "$name")"
    [ "$n" -gt 0 ] && echo "  [$name]=$n"
  done
  exit 0
fi

fail=0
for p in "$ROOT"/packages/*/; do
  name="$(basename "$p")"
  actual="$(count_for "$name")"
  baseline="${BASELINE[$name]:-0}"
  if [ "$actual" -gt "$baseline" ]; then
    echo "❌ check-type-escape-hatches: packages/$name has $actual (as any/@ts-ignore/@ts-expect-error), baseline is $baseline"
    fail=1
  fi
done

if [ "$fail" -eq 1 ]; then
  echo ""
  echo "Either remove the new escape hatch(es), or if genuinely justified, raise this"
  echo "script's BASELINE for that package with a one-line reason in the comment."
  exit 1
fi

echo "✅ check-type-escape-hatches: no package exceeds its baseline (run --tighten to see current counts)"
