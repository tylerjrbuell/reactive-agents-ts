#!/usr/bin/env bash
# Harness mechanism switches must be read from the CARRIED, resolved config —
# never by calling an env resolver at a call site.
#
# Task 3 (W3, 2026-08-27) migrated nineteen call sites off zero-argument resolvers so
# that two agents in one process can hold different harness configs and a
# sub-agent can inherit its parent's. A single re-added direct call silently
# restores the process-global read for that mechanism, and nothing else in the
# suite would notice: the value is usually correct, because usually there is
# only one agent in the process.
#
# harness-config.ts is the ONE legal caller — it is the env layer's consumer.
# (Deliberately spelling out "RA underscore star" env vars nowhere in this
# comment or below, so this file itself never trips check-ablatable.sh's grep.)
set -euo pipefail
cd "$(dirname "$0")/.."

RESOLVERS='lazyDisclosureEnabled|toolDiscoveryEnabled|toolIndexEnabled|toolIndexMaxEntriesFlag|verboseRulesEnabled|stableToolSurfaceEnabled|recencyBudgetCharsOverride|toolResultBudgetCharsOverride|thoughtContinuityEnabled|toolObserveSymmetryEnabled|rationaleAuditEnabled|treeOfThoughtExploreBudgetMs|assemblyDebugEnabled|promptDumpPathPrefix'

STRAYS=$(grep -rnE "\b($RESOLVERS)\(" packages apps --include=*.ts \
  | grep -v '/dist/' \
  | grep -v '\.test\.' \
  | grep -v '/benchmarks/' \
  | grep -v 'reasoning/src/harness-flags\.ts' \
  | grep -v 'reasoning/src/harness-config\.ts' \
  || true)

if [ -n "$STRAYS" ]; then
  echo "FAIL: a harness env resolver is called outside harness-config.ts:"
  echo "$STRAYS"
  echo ""
  echo "Read the mechanism off the carried ResolvedHarness instead"
  echo "(input.harness / inputs.harness / c.harness). Calling the resolver here"
  echo "restores the process-global read that .withHarness() exists to remove."
  exit 1
fi
echo "OK: every harness mechanism resolves through the carried config."
