---
type: debrief
status: shipped
created: 2026-10-20
tags: [runtime, decomposition, builder, execute-backlog, warden]
---

# Debrief — runtime-builder-decomp (GH #218 / HS-248)

**Bundle:** `execute-backlog` singleton pass on #218 (runtime's largest exported-API file).
**Merged:** PR #257 → `dev`, merge `878461bac` (2026-10-20), CI 5/5 green.

## What shipped

`packages/runtime/src/builder.ts`: **3,348 → 2,222 LOC (−1,126)**, public surface bit-identical, zero behavior change. The file had regrown 3,081 → 3,348 since the sweep date — fourth data point that monolith big-gravity pulls additions into the class file (W26-B trimmed it −241 once; it regrew; #217 hit the same 3,112→3,303).

| Module | Contents | LOC |
|---|---|---|
| `builder/build/build-agent.ts` | `build()` orchestration body | 258 |
| `builder/build/build-effect.ts` | `buildEffect()` generator + `warnIfImplicitTestProvider()` (live `BuilderState` view; the single `self`→`BuilderRuntimeStateView` cast moved with it) | 333 |
| `builder/withers/identity-surface.ts` | identity/name/persona/system-prompt/environment | 235 |
| `builder/withers/quality-guardrails.ts` | guardrails/verification/grounding/judgment | 247 |
| `builder/withers/horizon-contract.ts` | long-horizon/contract/durable/interaction | 216 |
| `builder/withers/observability-exporters.ts` | observability/tracing/cortex/logging | 179 |
| `builder/withers/model-reliability.ts` | model/pricing/circuit-breaker/rate-limit | 231 |
| `builder/withers/capability-progress.ts` | memory/skills/learning/RI | 243 |
| `builder/withers/validation-testing.ts` | test-scenario/validation | 65 |

Pattern: the #217 / `wither-applies.ts` shape — 61 `with*` bodies became thin `applyWithX` delegates over per-call `asBuilderState(this)` views (live-read of mutable class state); full public-contract JSDoc moved verbatim into modules, delegates keep 3-4-line pointer docs; all overload sets verified identical (`withMCP` 5, `withHarness` 3, `withModel` 3, `withReactiveIntelligence` 3).

## Contract-coupled bodies that stayed (warden's documented calls)

1. `withMCP` dispatch + 100-line first-overload JSDoc — 4-overload set and string-scaffolding dispatch are contractually coupled; W26-B's `applyWithMCP` already owns the object-form body; extraction would have bought no LOC under budget.
2. `withOutputSchema` — return type is `ReactiveAgentBuilder<A>` via inline cast; a move would net-new a module-side cast site (violates the zero-new-cast success criterion).
3. `_assertRuntimeStateViewShape` — the compile-time drift guard for `BuilderRuntimeStateView` is only legal/meaningful inside the class body (private-field access + TS2339 enforcement).
4. Public head (`BudgetLimits`, `QuickOptions`, `QUICK_KEYED_PROVIDERS`, `resolveQuickBuilder`, `ReactiveAgents`) — public re-export surface.

**Decomposition boundary rule (new, amend-target for the skill):** in builder-class decompositions, extract verbatim body clusters only; overloaded contract families and compile-time drift guards are load-bearing *on* the class and stay. "Convert every method" is not the end-state — "zero surface change + LOC cap + zero behavior change" is.

## Verification (parent, all deterministic)

- tsc `--noEmit -p packages/runtime` rc=0; downstream typecheck 29/29.
- Runtime suite: **1,677 pass / 7 skip / 0 fail across 309 files = exact baseline**.
- Cast-ceiling 2/2, counters flat (raw grep +1 is a comment line; the ceiling test's own counter is authoritative).
- Zero new `throw`/`as any` — all 8 moved-module throw sites byte-match origin.
- Scope: 1 modified + 9 new files; `index.ts` untouched.

## Process notes

- runtime-warden via general subagent (harness deviation, standing convention), confidence 0.92, retries 0/2. Pilot log updated.
- No changeset: decomposition without API/type/behavior change (#217 precedent).
- Micro-debt carried (documented on the issue + modules): `BuilderState` view extended with 17 comment-marked fields so extracted bodies see live class state — class fields remain source of truth; view drift is theoretically silent, partially mitigated for `build-effect` by the retained `_assertRuntimeStateViewShape` guard.

## Next

Only remaining p1: **#219** (`kernel/capabilities/reason/think.ts`, 2,135 LOC → kernel-warden dispatch). p2 seeds: #221 execution-engine, #220 arbitrator, #222 iterate-pass+runner.

## Artifacts

- Plan: `wiki/Planning/Implementation-Plans/2026-10-20-runtime-builder-decomp.md` (baseline inside)
- Commits: `baacf9257` (plan) · `d74ccc56c` (refactor) · merge `878461bac`
