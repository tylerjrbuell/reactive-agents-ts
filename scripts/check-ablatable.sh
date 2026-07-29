#!/usr/bin/env bash
# check-ablatable.sh — A-tier gate 3 (Task 15 ablatability audit, 2026-07-28).
#
# Every RA_* env flag that gates a default-on MECHANISM must be resolved
# through exactly one named resolver, not read directly at a use site. Direct,
# multi-site reads are how RA_LAZY_TOOLS came to gate three independent
# mechanisms at three sites in two directions, which made F3 unmeasurable for
# months: there was no way to turn discovery off while leaving the pruning
# that creates the need for discovery in place. A flag with N direct-read
# sites has N places to silently diverge in meaning; a flag with one resolver
# has one.
#
# The canonical resolver for the reasoning/runtime harness is
# packages/reasoning/src/harness-flags.ts. Two flags could not route there
# without introducing a package cycle (packages/a2a and packages/tools both
# sit OUTSIDE the reasoning dependency edge — see the audit report), so they
# get their own local resolver file instead: packages/a2a/src/flags.ts and
# packages/tools/src/flags.ts. Those two files are excluded from the STRAYS
# scan for the same reason harness-flags.ts is: they ARE the resolver, not a
# stray read of it.
#
# Everything else excluded below is NOT a mechanism killswitch in the F3
# sense — no accuracy/token lift to measure, nothing to ablate independently —
# and is excluded with its own reasoning, per audit report
# wiki/Research/Audit-Reports-2026-07-28/ablatability.md. Widen this list only
# with a comment saying why; do not silence a genuine mechanism read.
set -euo pipefail
cd "$(dirname "$0")/.."

STRAYS=$(grep -rn -a 'process\.env\.RA_' packages --include=*.ts \
  | grep -v '/dist/' \
  | grep -v '\.test\.' \
  | grep -v '/benchmarks/' \
  | grep -v 'reasoning/src/harness-flags\.ts' \
  | grep -v 'a2a/src/flags\.ts' \
  | grep -v 'tools/src/flags\.ts' \
  | grep -v 'a2a/src/server/http-server\.ts' \
  | grep -v 'health/src/service\.ts' \
  | grep -v 'judge-server/src/index\.ts' \
  | grep -v 'llm-provider/src/providers/gemini\.ts' \
  | grep -v 'runtime/src/errors\.ts' \
  | grep -v 'trace/src/recorder\.ts' \
  || true)

if [ -n "$STRAYS" ]; then
  echo "FAIL: RA_* flags read outside a named resolver:"
  echo "$STRAYS"
  echo ""
  echo "Route the read through a named resolver (harness-flags.ts for"
  echo "reasoning/runtime; a2a/src/flags.ts or tools/src/flags.ts for those"
  echo "packages, which cannot import harness-flags.ts without a cycle) so the"
  echo "mechanism can be ablated independently of every other mechanism. If"
  echo "this genuinely is not a mechanism switch (deployment config, debug-only"
  echo "diagnostics, retention housekeeping), widen the exclusion list above"
  echo "WITH a comment explaining why — do not silence a real mechanism read."
  exit 1
fi

echo "OK: every RA_* mechanism flag resolves through a named resolver."
