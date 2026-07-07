#!/usr/bin/env bash
# Overhaul Phase 1 (pillar 2) — LLM gateway invariant guard (2026-07-07).
#
# Every direct model call in the reasoning layer must flow through
# kernel/llm-gateway.ts (gatewayComplete / gatewayStream) so the gateway is
# the ONE place output budgets are decided. Before Phase 1, twelve call sites
# hardcoded flat maxTokens literals — the root cause behind the qwen3:14b
# empty-turn starvation (fix waves B2/P1, 2026-07-07).
#
# Authorized raw-call owners:
# - packages/reasoning/src/kernel/llm-gateway.ts     (the gateway itself)
# - packages/reasoning/src/kernel/observable-llm.ts  (wraps the inner LLMService;
#   its inner.complete/inner.stream are the service being decorated, not a call site)
# - *.test.ts                                        (tests exercise services directly)
#
# Known non-gateway surfaces (deliberate, not violations):
# - llm.completeStructured in structured-output/pipeline.ts — the native
#   structured path; its budget is the same caller-resolved value the gateway
#   receives as budgetTokens on the fallback path.
# - runtime.ts MemoryLLM bridges — passthrough adapters for the memory layer's
#   own request shape; no budget decision is made there.
#
# Usage: bash scripts/check-llm-gateway.sh
# Exit: 0 if invariant holds; 1 with the offending lines if violated.

set -euo pipefail
cd "$(dirname "$0")/.."

violations=$(
  grep -rn -F -e ".complete({" -e ".stream({" packages/reasoning/src --include="*.ts" \
    | grep -v ".test.ts" \
    | grep -v "kernel/llm-gateway.ts" \
    | grep -v "kernel/observable-llm.ts" \
    | grep -v "completeStructured({" \
    || true
)

if [[ -n "$violations" ]]; then
  echo "LLM gateway invariant VIOLATED — raw .complete()/.stream() outside kernel/llm-gateway.ts:"
  echo "$violations"
  echo
  echo "Route new call sites through gatewayComplete/gatewayStream (kernel/llm-gateway.ts)."
  exit 1
fi

echo "LLM gateway invariant holds: no raw .complete()/.stream() outside the gateway."
