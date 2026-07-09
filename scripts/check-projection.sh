#!/usr/bin/env bash
# Meta-loop Phase 4c (D1) — Projector single-authority invariant guard.
#
# "What the model sees" is rendered ONCE, by the Projector (packages/reasoning/
# src/assembly/), the LAST node of the meta-loop DAG. The projector walks the
# append-only EventLog + ResultStore + the upstream DAG nodes (contract, ledger,
# assessment) and emits the provider-facing window (systemPrompt + messages).
# The render-side twin of the gateway's call-side invariant: no ONE ELSE may
# assemble the main reasoning window.
#
# This script fails CI if the two provider-window CONSTRUCTORS appear outside the
# projector home:
#   1. `toLLMMessages(` — the sole conversion of a projected thread into the
#      provider `messages` array (message-array building).
#   2. `renderStandingFrame(` — the standing-frame render authority
#      (priorContext + handoff + contract.outstanding; system-prompt construction).
# Every legacy consumer is grandfathered below and the list SHRINKS each wave.
# Mirrors check-run-contract.sh / check-termination-paths.sh / check-llm-gateway.sh.
#
# NOTE (shrinking list): auxiliary single-shot LLM calls (strategy synthesize /
# classify / extract via `gatewayComplete`, which build their OWN small prompts
# inline rather than the main reasoning window) are a SEPARATE class the policy
# compiler (Wave G) folds into the projector. They are NOT matched here because
# this invariant guards the MAIN window assembly — the projector's D1 domain.
#
# Usage: bash scripts/check-projection.sh
# Exit: 0 if the invariant holds; 1 with the offending lines if violated.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEARCH_DIR="$ROOT/packages/reasoning/src"

# The projector's home — the SANCTIONED owner of provider-window assembly.
ALLOWED_FILES=(
  "assembly/"
)

# Grandfathered legacy call sites (meta-loop Phase 4c snapshot). Each is a
# pre-existing consumer of the projector's output; later waves fold them in.
# DO NOT ADD to this list — new window assembly belongs in assembly/. The list
# must SHRINK, never grow.
GRANDFATHERED=(
  "kernel/capabilities/reason/think.ts"   # the sanctioned projector consumer: project() → toLLMMessages() + guidance/driver/rationale tail
)

# Build a single grep -v exclude pattern from allowed + grandfathered lists.
EXCLUDE=""
for f in "${ALLOWED_FILES[@]}" "${GRANDFATHERED[@]}"; do
  EXCLUDE+="${EXCLUDE:+|}$f"
done

# Any provider-window constructor CALL outside the sanctioned/grandfathered set.
#  - drop the allowed owner (assembly/) + grandfathered sites
#  - drop *.test.ts / *.spec.ts (they assert about assembly, never own it)
#  - drop comment lines (code after `path:lineno:` starts with // or * or /*)
HITS="$(grep -rn -E '\b(toLLMMessages|renderStandingFrame)\(' \
  --include='*.ts' "$SEARCH_DIR" 2>/dev/null \
  | grep -E -v "$EXCLUDE" \
  | grep -E -v '\.(test|spec)\.ts:' \
  | awk -F: '{ code=$0; sub(/^[^:]*:[0-9]+:/, "", code); gsub(/^[ \t]+/, "", code);
              if (code !~ /^(\/\/|\*|\/\*)/) print $0 }' \
  || true)"

if [ -n "$HITS" ]; then
  echo "❌ Projector invariant violated. Provider-window assembly outside packages/reasoning/src/assembly/:"
  echo ""
  echo "$HITS"
  echo ""
  echo "Render the model's window through the Projector (assembly/project.ts → project())"
  echo "instead of assembling systemPrompt/messages locally. If this is a sanctioned"
  echo "legacy site, it must be added to the GRANDFATHERED list in this script WITH a"
  echo "migration note — but prefer routing it through the projector."
  exit 1
fi

echo "✅ Projector invariant holds — provider-window assembly confined to assembly/ + grandfathered think.ts."
exit 0
