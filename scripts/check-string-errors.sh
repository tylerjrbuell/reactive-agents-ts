#!/usr/bin/env bash
# Quality program — string-throw ceiling ratchet (plan Task 2).
#
# Why: 299 `new Error(` sites in packages/*/src bypass the repo's own
# Data.TaggedError convention (CODING_STANDARDS.md: "NEVER use throw";
# effect-ts-patterns: tagged errors only). A big-bang conversion is forbidden
# (public rejection identity + 129-site repo-wide instanceof exposure — 43 in
# runtime+reasoning alone — audit 2026-10-22
# item 3). The drain path is a ratchet: baseline pinned, growth FAILS, shrink
# FAILS-until-edited (deliberate ledger law, same as check-file-size.sh /
# check-orphans.sh). Every future file-touch converts its sites opportunistically
# and the number only moves down.
#
# Metric (documented honestly): raw grep count of `new Error(` in
# packages/**/src/**/*.ts excluding *.test.ts / *.spec.ts. Occurrences inside
# comments/strings are counted; accepted tradeoff (AST-walking like
# console-ceiling.test.ts is a bun-test, not a bash CI-lane script; the number
# is a DIRECTION not a target, so comment inflation is noise-free enough).
#
# Usage: bash scripts/check-string-errors.sh [SCAN_DIR]
#   SCAN_DIR  tree root holding package dirs (default: <repo>/packages).
#             The mutation test points it at a /tmp fixture tree.
#
# Rides the auto-globbed CI lane; pinned red-on-cut by
# packages/reasoning/tests/enforcement-scripts-string-errors.test.ts.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_DIR="${1:-$ROOT/packages}"

# RATCHET: may only SHRINK, by deliberate edit, with the reducing PR citing the
# conversion. Captured 2026-10-22.
#
# Edit history: 299 captured (tree @ 66ca4f186+). Raised to 300 same day:
# GH #262 (08458a4f3) netted +1 SITE IN src (the durable-tool-effect observer
# failure wrapper; its other 4 new Error sites live in .test.ts files and are
# metric-exempt). Attributed deliberate raise; the gate's PR-tree check missed
# it only because the merge-chain polled checks before the rerun registered.
STRING_ERRORS_BASELINE=300

# Task 3 twin ledger: `instanceof Error|*Error` OCCURRENCES (one line may carry
# two matches; 129 occurrences / 128 lines at capture). These are the rejection-
# identity consumers that make mass error-type conversion unsafe (audit 2026-10-22
# item 3 + the full inventory committed at wiki/Research/Audit-Reports-2026-10-22/
# instanceof-error-inventory.md). D3 converts framework-internal sites and this
# number follows; new identity-dependencies are forbidden without review.
# Captured 2026-10-22; may only SHRINK by deliberate edit, same law as above.
INSTANCEOF_BASELINE=129

# SCAN-EMPTY guard.
COUNTED="$(find "$SCAN_DIR" -path '*/src/*' -name '*.ts' ! -name '*.test.ts' \
  ! -name '*.spec.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null)"
if [ -z "$COUNTED" ]; then
  echo "❌ check-string-errors: SCAN-EMPTY — no *.ts files under $SCAN_DIR — a guard that cannot fail is theater."
  exit 1
fi

COUNT=$(printf '%s\n' "$COUNTED" | xargs grep -hoE "new Error\(" 2>/dev/null | wc -l | tr -d ' ')
IO_COUNT=$(printf '%s\n' "$COUNTED" | xargs grep -hoE "instanceof (Error|[A-Za-z]*Error)" 2>/dev/null | wc -l | tr -d ' ')

FAIL=0

if [ "$COUNT" -gt "$STRING_ERRORS_BASELINE" ]; then
  echo "❌ check-string-errors: string-throw pool GREW to $COUNT (baseline $STRING_ERRORS_BASELINE). Mint a Data.TaggedError in the package's errors.ts instead — 'NEVER use throw' (CODING_STANDARDS.md)."
  FAIL=1
elif [ "$COUNT" -lt "$STRING_ERRORS_BASELINE" ]; then
  echo "❌ check-string-errors: string-throw pool SHRANK to $COUNT but the baseline is still $STRING_ERRORS_BASELINE. Update the baseline to $COUNT (the ledger may only shrink by deliberate edit) — good work, now make it visible in the ledger."
  FAIL=1
fi

if [ "$IO_COUNT" -gt "$INSTANCEOF_BASELINE" ]; then
  echo "❌ check-string-errors: instanceof pool GREW to $IO_COUNT (baseline $INSTANCEOF_BASELINE). New rejection-identity dependencies widen the Phase-2 conversion blast radius — prefer _tag dispatch or a type guard from the owning package's errors module."
  FAIL=1
elif [ "$IO_COUNT" -lt "$INSTANCEOF_BASELINE" ]; then
  echo "❌ check-string-errors: instanceof pool SHRANK to $IO_COUNT but the baseline is still $INSTANCEOF_BASELINE. Update the baseline to $IO_COUNT (the ledger may only shrink by deliberate edit) — good work, now make it visible in the ledger."
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "✅ check-string-errors: $COUNT string-throw sites at baseline $STRING_ERRORS_BASELINE; $IO_COUNT instanceof sites at baseline $INSTANCEOF_BASELINE."
exit 0
