#!/usr/bin/env bash
# Dialect-blindness guard (2026-08-05). The harness computes a model `dialect`
# (native-fc | text-parse | none); the prompt-assembly must USE it, not assume a
# lowest-common-denominator prose model. This script fails CI if the assembly
# regresses to dialect-blindness.
#
# Instance #2 (shipped): a native-FC model reads its tools from the FC `tools`
# array, so the in-prompt tool reference is a redundant SECOND copy — a fixed
# token tax (measured: Gemini kernel overhead +469% -> +278% when skipped). The
# in-prompt reference must be gated on dialect, and the assembly dialect must NOT
# be hardcoded.
#
# Usage: bash scripts/check-dialect-aware.sh
# Exit 0 if the invariant holds; 1 with detail otherwise.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SP="$ROOT/packages/reasoning/src/assembly/stages/system-prompt.ts"
FKS="$ROOT/packages/reasoning/src/assembly/from-kernel-state.ts"
fail() { echo "❌ $1"; echo ""; exit 1; }

# Invariant 1: the assembly dialect is threaded, not hardcoded native-fc.
[ -f "$FKS" ] || fail "missing $FKS"
# Match the object-literal hardcode `dialect: "native-fc",` (trailing comma) —
# NOT the param's type annotation `dialect: "native-fc" | "text-parse" | ...`.
if grep -qE 'dialect:[[:space:]]*"native-fc"[[:space:]]*,' "$FKS"; then
  fail "from-kernel-state.ts hardcodes dialect:\"native-fc\" — the assembly is
dialect-blind again (every model gets the in-prompt tool reference). Thread the
real \`context.toolCallingDriver.mode\` instead."
fi

# Invariant 2: the in-prompt tool reference is gated on dialect.
[ -f "$SP" ] || fail "missing $SP"
if ! grep -qE 'capability\.dialect' "$SP"; then
  fail "system-prompt.ts no longer consults capability.dialect — the in-prompt
tool reference must be skipped on native-FC (the FC \`tools\` array is the
interface). Re-add the \`dialect !== \"native-fc\"\` gate around buildToolReference."
fi
if ! grep -qE 'dialect\s*!==\s*"native-fc"' "$SP"; then
  fail "system-prompt.ts consults dialect but the buildToolReference gate
(\`dialect !== \"native-fc\"\`) is gone — native-FC models will get the redundant
in-prompt tool copy again."
fi

echo "✅ Dialect-aware invariant holds — assembly dialect is threaded (not"
echo "   hardcoded) and the in-prompt tool reference is skipped on native-FC."
exit 0
