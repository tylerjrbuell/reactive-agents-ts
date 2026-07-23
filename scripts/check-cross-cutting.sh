#!/usr/bin/env bash
# Cross-cutting cascade invariant guard (design spec §4.4 / 09-UNIFIED-PROGRAM §6).
#
# The RunEnvelope (kernel/envelope/run-envelope.ts) is the ONE run-wide carrier
# for the seven cross-cutting harness concerns (approvalPolicy, approvalDecision,
# interactionResponse, grounding, fabricationGuard, stallPolicy, taskContract).
# Before the cascade these were hand-declared on every strategy's own input
# interface and threaded by hand at N call sites — the exact "silently dropped
# wherever one is missed" defect class the cascade exists to end. Its integrity
# depends on four things holding at once:
#
#   1. No strategy input interface re-declares an envelope field — by name, via
#      `Pick<KernelInput, …>`, or by `extends`-ing a bundle that carries them.
#   2. No `KernelInput` is hand-authored outside the canonical assembly module
#      (kernel/state/build-kernel-input.ts) and the sanctioned sites below —
#      neither as an annotated literal nor via an `as KernelInput` cast, which
#      turns the compiler off for exactly the fields this gate protects.
#   3. RunEnvelope is provided at exactly the two sanctioned seams: production
#      (services/reasoning-service.ts) and test (provideTestEnvelope in
#      run-envelope.ts itself). A second provision site is two competing sources
#      of truth for one run.
#   4. Every `ReasoningService.execute` request carries an `envelope`, built by
#      the ONE config→envelope mapper (runtime/src/engine/run-envelope-config.ts).
#      A request without one runs with the harness disarmed.
#
# ── 2026-07-23 hardening (review finding I2) ────────────────────────────────
# A review demonstrated all three original checks passing on an 18-line file
# that violated all three, and found one PRODUCTION site already evading check 2
# (`react-kernel.ts` — a hand-authored literal closed with `as KernelInput`,
# since rewritten to compose `buildKernelInput` + `mergeRunEnvelopeIntoKernelInput`
# so no cast remains). Every pattern below now runs against COMMENT-STRIPPED
# source, so prose describing a violation no longer trips (or masks) the gate.
#
# This script fails CI if any of the four break. Mirrors check-ledger-writes.sh
# / check-run-contract.sh; discovered + run by the CI "Enforce architectural
# invariants" step (`for s in scripts/check-*.sh`) and by
# packages/reasoning/tests/enforcement-scripts.test.ts.
#
# Usage: bash scripts/check-cross-cutting.sh
# Exit: 0 if all four invariants hold; 1 with the offending lines if violated.

set -euo pipefail
cd "$(dirname "$0")/.."
FAIL=0

STRATEGIES_DIR="packages/reasoning/src/strategies"
REASONING_SRC="packages/reasoning/src"
FIELDS='approvalPolicy|approvalDecision|interactionResponse|fabricationGuard|stallPolicy|grounding|taskContract'

# Emit "file:line:text" for every COMMENT-STRIPPED line matching $1 across the
# source roots in $2.. — test files, dist and node_modules excluded.
#
# Comment stripping is what makes these patterns non-evadable in the other
# direction too: the old check 2 false-positived on prose that merely quoted a
# `const x: KernelInput = {` line.
strip_and_grep() {
  local pattern="$1"
  shift
  local out="" f hit
  while IFS= read -r -d '' f; do
    hit="$(sed -E -e 's#//.*$##' -e 's#/\*.*$##' -e 's#^[[:space:]]*\*.*$##' "$f" \
      | grep -nE "$pattern" | sed "s#^#${f}:#" || true)"
    if [ -n "$hit" ]; then out+="$hit"$'\n'; fi
  done < <(find "$@" -name '*.ts' \
    ! -path '*/dist/*' ! -path '*/node_modules/*' \
    ! -name '*.test.ts' ! -path '*__tests__*' ! -path '*/tests/*' \
    -print0 2>/dev/null)
  printf '%s' "$out"
}

# ── Check 1/4: strategy input interfaces must not re-declare envelope fields ──
# Three shapes, because a review evaded the first with the other two:
#   (a) a named optional field         — `readonly approvalPolicy?: …`
#   (b) a Pick bundle                  — `extends Pick<KernelInput, "approvalPolicy" | …>`
#   (c) ANY `interface X extends Y`    — this is EXACTLY the pre-cascade
#       `StrategyHitlRails` pattern (a shared bundle a strategy still had to
#       remember to forward), and the extended name is arbitrary, so it cannot
#       be matched by name. No strategy interface extends anything today; if a
#       genuinely unrelated base is ever needed, add it to
#       ALLOWED_INTERFACE_BASES with a comment saying why it cannot carry a
#       cross-cutting field.
ALLOWED_INTERFACE_BASES=()
DECLS="$(strip_and_grep "^[[:space:]]*(readonly[[:space:]]+)?($FIELDS)\??:" "$STRATEGIES_DIR")"
PICKS="$(strip_and_grep "Pick<[[:space:]]*KernelInput[[:space:]]*,[^>]*\"($FIELDS)\"" "$STRATEGIES_DIR")"
EXTENDS="$(strip_and_grep "^[[:space:]]*(export[[:space:]]+)?interface[[:space:]]+[A-Za-z0-9_]+[[:space:]]+extends[[:space:]]" "$STRATEGIES_DIR")"
if [ ${#ALLOWED_INTERFACE_BASES[@]} -gt 0 ]; then
  BASES_RE="$(IFS='|'; echo "${ALLOWED_INTERFACE_BASES[*]}")"
  EXTENDS="$(printf '%s' "$EXTENDS" | grep -E -v "extends[[:space:]]+($BASES_RE)\b" || true)"
fi
CHECK1="$(printf '%s\n%s\n%s\n' "$DECLS" "$PICKS" "$EXTENDS" | grep -v '^$' | sort -u || true)"
if [ -n "$CHECK1" ]; then
  echo "FAIL (1/4): strategy input interface re-declares (or re-bundles) a cross-cutting field"
  echo "(the RunEnvelope is the only carrier):"
  echo ""
  echo "$CHECK1"
  echo ""
  echo "Remove the field from the strategy's input interface — it rides RunEnvelope"
  echo "(packages/reasoning/src/kernel/envelope/run-envelope.ts) and is merged onto"
  echo "KernelInput by runKernel. A re-declared field — named, Pick-ed, or inherited"
  echo "from a shared 'rails' bundle — is exactly the 'silently dropped at one of N"
  echo "boundaries' defect class this gate exists to end."
  FAIL=1
else
  echo "OK (1/4): no strategy re-declares, Pick-s or inherits a cross-cutting field."
fi

# ── Check 2/4: no hand-authored KernelInput outside sanctioned sites ──
# Sanctioned:
#   - kernel/state/build-kernel-input.ts — the canonical assembly module
#     (buildKernelInput; returns a KernelInput, doesn't match these shapes
#     today, but stays listed so it can never accidentally be flagged).
#   - strategies/reactive.ts / strategies/direct.ts — reference strategies
#     that assemble the ReAct-kernel's first-pass KernelInput directly.
#   - kernel/loop/runner-helpers/strategy-switch.ts — strategy-switch handoff:
#     spreads an ALREADY-assembled `priorInput` (envelope fields already merged
#     by runKernel) with two field overrides (priorContext, requiredTools). It
#     never hand-authors a cross-cutting field.
#
# `as KernelInput` / `satisfies KernelInput` are flagged alongside the annotated
# literal: a cast is strictly WORSE than the literal this check was written for,
# because it silences the compiler on the very fields at issue. react-kernel.ts
# was that site on the real tree until 2026-07-23; it now composes
# `buildKernelInput` + `mergeRunEnvelopeIntoKernelInput` and needs no exemption.
ALLOWED_KERNEL_INPUT_SITES=(
  "kernel/state/build-kernel-input.ts"
  "strategies/reactive.ts"
  "strategies/direct.ts"
  "kernel/loop/runner-helpers/strategy-switch.ts"
)
EXCLUDE=""
for f in "${ALLOWED_KERNEL_INPUT_SITES[@]}"; do
  EXCLUDE+="${EXCLUDE:+|}$f"
done
LITERALS="$(strip_and_grep ':[[:space:]]*KernelInput[[:space:]]*=[[:space:]]*\{|(as|satisfies)[[:space:]]+KernelInput\b' \
  "$REASONING_SRC" | grep -E -v "$EXCLUDE" || true)"
if [ -n "$LITERALS" ]; then
  echo "FAIL (2/4): hand-authored KernelInput outside the sanctioned assembly sites:"
  echo ""
  echo "$LITERALS"
  echo ""
  echo "Assemble via buildKernelInput() (kernel/state/build-kernel-input.ts) instead"
  echo "of hand-building a KernelInput literal, and never close one with"
  echo "'as KernelInput' — a hand-built literal can omit a cross-cutting field with"
  echo "no compiler signal, and the cast removes the signal entirely. If this is a"
  echo "genuinely sanctioned site, add it to ALLOWED_KERNEL_INPUT_SITES in this"
  echo "script WITH a comment explaining why it cannot silently drop an envelope field."
  FAIL=1
else
  echo "OK (2/4): no hand-authored KernelInput outside the sanctioned sites."
fi

# ── Check 3/4: RunEnvelope provided at exactly the two sanctioned seams ──
# Sanctioned:
#   - kernel/envelope/run-envelope.ts — provideTestEnvelope (the test seam).
#   - services/reasoning-service.ts — the ONE production provision site, at the
#     strategy-dispatch boundary.
#
# Four shapes, because a review evaded the original with the last three:
#   (a) Effect.provideService(eff, RunEnvelope, …)          — same line
#   (b) the same call once Prettier wraps `RunEnvelope,` onto its own line
#   (c) Layer.succeed(RunEnvelope, …) / Layer.succeed(\n RunEnvelope, …)
#       — the idiom this codebase uses elsewhere (reasoning-service.ts:173/182)
#   (d) provideTestEnvelope(…) called from PRODUCTION code — it is exported
#       from the package index, so it is reachable, and using it outside a test
#       is a second production provision site wearing a test-helper's name.
# `apps/` is scanned too: a provision site there was previously invisible.
PROVIDE_ROOTS=(packages apps)
PROVIDES_SAMELINE="$(strip_and_grep 'provideService\([^)]*RunEnvelope|RunEnvelope\.of\(|Layer\.succeed\([[:space:]]*RunEnvelope|(^|[^A-Za-z0-9_])provideTestEnvelope\(' \
  "${PROVIDE_ROOTS[@]}")"

PROVIDES_MULTILINE=""
while IFS= read -r -d '' file; do
  hit="$(awk -v file="$file" '
    /provideService\(|Layer\.succeed\(/ { lastProvide = NR }
    /^[ \t]*RunEnvelope,[ \t]*$/ {
      if (lastProvide != "" && (NR - lastProvide) <= 6) {
        print file ":" NR ": " $0
      }
    }
  ' "$file" 2>/dev/null || true)"
  if [ -n "$hit" ]; then
    PROVIDES_MULTILINE+="$hit"$'\n'
  fi
done < <(find "${PROVIDE_ROOTS[@]}" -name '*.ts' \
  ! -path '*/dist/*' ! -path '*/node_modules/*' \
  ! -name '*.test.ts' ! -path '*__tests__*' ! -path '*/tests/*' \
  -print0 2>/dev/null)

PROVIDES="$(printf '%s\n%s\n' "$PROVIDES_SAMELINE" "$PROVIDES_MULTILINE" \
  | grep -v '^$' \
  | grep -v 'kernel/envelope/run-envelope.ts' \
  | grep -v 'services/reasoning-service.ts' || true)"

if [ -n "$PROVIDES" ]; then
  echo "FAIL (3/4): RunEnvelope provided outside the two sanctioned seams:"
  echo ""
  echo "$PROVIDES"
  echo ""
  echo "RunEnvelope must be provided at exactly one production site"
  echo "(services/reasoning-service.ts, the strategy-dispatch boundary) plus the"
  echo "test seam (provideTestEnvelope in kernel/envelope/run-envelope.ts). A"
  echo "second provision site is two competing sources of truth for the same run."
  FAIL=1
else
  echo "OK (3/4): RunEnvelope provided only at the two sanctioned seams."
fi

# ── Check 4/4: every reasoning execute request carries an envelope ──
# The cascade moved the drop site UP, it did not delete it: three runtime
# builders each re-enumerated the config→envelope mapping by hand, and each
# ended in `as unknown as ReasoningExecuteRequest`, so the compiler checked
# nothing about `envelope` (review I3). They now all call
# `buildRunEnvelopeFromConfig` (runtime/src/engine/run-envelope-config.ts).
#
# Two rules:
#   (a) a file that calls `<something>reasoning<something>.execute(` must
#       reference the canonical mapper (or be entirely exempt);
#   (b) each INLINE execute-request literal must carry `envelope:` — or an
#       `ENVELOPE-EXEMPT:` marker within ±6 lines naming why not. The one
#       exemption today is the verify JUDGE pass, whose "task" is a verdict
#       prompt, not the user's deliverable.
EXECUTE_ROOTS=(packages/runtime/src apps)
EXEC_FAILS=""
while IFS= read -r -d '' file; do
  stripped="$(sed -E -e 's#//.*$##' -e 's#/\*.*$##' -e 's#^[[:space:]]*\*.*$##' "$file")"
  if ! printf '%s' "$stripped" | grep -qE '[Rr]easoning[A-Za-z._]*\.execute\('; then continue; fi
  if ! grep -q 'buildRunEnvelopeFromConfig\|ENVELOPE-EXEMPT' "$file"; then
    EXEC_FAILS+="$file: calls a reasoning execute() without using buildRunEnvelopeFromConfig"$'\n'
  fi
  hit="$(awk -v file="$file" '
    { line[NR] = $0 }
    /\.execute\(\{/ { calls[NR] = 1 }
    END {
      for (n in calls) {
        found = 0
        for (i = n - 6; i <= n + 95 && i <= NR; i++) {
          if (i < 1) continue
          if (line[i] ~ /envelope:/ || line[i] ~ /ENVELOPE-EXEMPT/) { found = 1; break }
        }
        if (!found) print file ":" n ": inline execute request without an envelope"
      }
    }
  ' "$file" 2>/dev/null || true)"
  if [ -n "$hit" ]; then EXEC_FAILS+="$hit"$'\n'; fi
done < <(find "${EXECUTE_ROOTS[@]}" -name '*.ts' \
  ! -path '*/dist/*' ! -path '*/node_modules/*' \
  ! -name '*.test.ts' ! -path '*__tests__*' ! -path '*/tests/*' \
  -print0 2>/dev/null)

EXEC_FAILS="$(printf '%s' "$EXEC_FAILS" | grep -v '^$' || true)"
if [ -n "$EXEC_FAILS" ]; then
  echo "FAIL (4/4): a ReasoningService.execute request is built without a RunEnvelope:"
  echo ""
  echo "$EXEC_FAILS"
  echo ""
  echo "Build it with buildRunEnvelopeFromConfig(config, extras) from"
  echo "runtime/src/engine/run-envelope-config.ts — the ONE config→envelope mapping."
  echo "A request with no envelope runs with .withApprovalPolicy() / .withContract()"
  echo "/ .withGrounding() / .withFabricationGuard() / .withStallPolicy() DISARMED."
  echo "If the pass genuinely must not carry one (a judge pass, whose output is a"
  echo "verdict and not the user's deliverable), put an 'ENVELOPE-EXEMPT:' comment"
  echo "at the call site saying why."
  FAIL=1
else
  echo "OK (4/4): every reasoning execute request carries an envelope."
fi

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "Cross-cutting cascade invariant VIOLATED — see failures above."
  exit 1
fi

echo ""
echo "Cross-cutting cascade invariants hold."
exit 0
