#!/usr/bin/env bash
# Control-plane invariant (2026-08-08-control-plane-vs-meta-tools).
#
# THE INVARIANT: the provider function-calling array is a DOMAIN-ONLY channel.
# No harness-control affordance (a META_TOOLS member / scope:"harness" tool —
# terminate / discover / recall) may occupy a native-FC tool slot: there the
# harness reads control from the response shape (no-tool-call = the `end_turn`
# terminal), so a harness tool is pure token tax + misuse temptation. Text-parse
# models KEEP the sentinels (they cannot signal control by shape).
#
# The wire array is built ONCE, in think.ts, from `gatedToolSchemas`. This guard
# fails CI if that build site stops filtering harness-scope tools on native-FC,
# so the leak (dialect-blindness #1) cannot silently return.
#
# Usage: bash scripts/check-domain-only-fc.sh
# Exit: 0 if the invariant is enforced at the wire-build site; 1 otherwise.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
THINK="$ROOT/packages/reasoning/src/kernel/capabilities/reason/think.ts"
SCHEMA="$ROOT/packages/reasoning/src/kernel/capabilities/attend/tool-formatting.ts"
fail=0

# 1. The ToolSchema carries the scope field (the mechanical distinction).
if ! grep -q 'scope?: "domain" | "harness"' "$SCHEMA"; then
  echo "FAIL: ToolSchema lost the scope:\"domain\"|\"harness\" field ($SCHEMA)." >&2
  fail=1
fi

# 2. The wire-build site filters harness-scope tools on native-FC.
#    Both markers must be present: the native-FC discriminator AND the filtered
#    array feeding the llmTools map.
if ! grep -q 'wireToolSchemas' "$THINK"; then
  echo "FAIL: think.ts no longer builds a filtered wireToolSchemas — the FC array" >&2
  echo "      may include harness tools on native-FC (control-plane leak)." >&2
  fail=1
fi
if ! grep -q 'mode === "native-fc"' "$THINK"; then
  echo "FAIL: think.ts wire-build site lost the native-fc discriminator." >&2
  fail=1
fi
# 3. llmTools must map wireToolSchemas, NOT the raw gatedToolSchemas (the leak).
if grep -q 'const llmTools = gatedToolSchemas.map' "$THINK"; then
  echo "FAIL: llmTools maps gatedToolSchemas directly — the native-FC filter was" >&2
  echo "      bypassed; harness tools reach the wire again." >&2
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: FC array is domain-only on native-FC (control-plane invariant enforced)."
fi
exit "$fail"
