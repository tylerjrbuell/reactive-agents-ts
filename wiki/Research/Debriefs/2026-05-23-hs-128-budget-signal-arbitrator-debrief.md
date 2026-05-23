---
type: debrief
status: completed
created: 2026-05-23
feature: hs-128-budget-signal-arbitrator
wardens: [kernel-warden, runtime-warden]
verdict: PASS
tags: [harness-convergence, audit-fresh-lens, tier-0, pillar-6, multi-warden, pilot]
related:
  - "[[2026-05-23-harness-convergence]]"
  - "[[2026-05-23-primitive-audit-fresh-lens]]"
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
  - "[[2026-05-23-hs-117-llm-exchange-stream-wiring-debrief]]"
  - "[[2026-05-23-hs-113-capability-scoped-instrumentation-debrief]]"
---

# Debrief — HS-128 BudgetSignal → Arbitrator pre-guard + `.withBudget()` API (2026-05-23)

## What
Single-commit landing (`3db49f4a`, +1086 / -4 across 17 files) wiring **BudgetSignal as a first-class Arbitrator input**. Pre-intent-switch guard at top of `arbitrate()` returns `{ action: 'exit-failure', terminatedBy: 'budget_exceeded' }` when `ctx.budget?.status === 'exceeded'`, dominating every `TerminationIntent` variant. New `.withBudget({ tokenLimit?, costLimit?, warningRatio? })` builder method plumbs limits end-to-end: builder → `RuntimeOptions` → config → `executeRequest` → `StrategyFn` → `KernelInput` → `state.meta.budgetLimits` → `computeBudgetSignal` → Arbitrator. `BudgetSignalCollectedEmitted` AgentEvent variant added for trace observability.

## Why
Audit G-A Tier 0 (highest leverage). `grep -n "BudgetSignal\|CostSignal\|budgetExceeded" packages/reasoning/src/kernel/capabilities/decide/` returned **zero matches** despite North Star v5.0 Pillar 6 + Optimal Execution Algorithm §1 step 6 declaring BudgetSignal as one of six Arbitrator inputs (audit doc lines 155-160). Budget enforcement happened solely via `compose/killswitches/budget-limit.ts` side-channel — a parallel termination path bypassing the canonical single decider mandated by FIX-18 / Stage 5 W4. Phase 3 #123 single-Arbitrator effort was blocked: an arbitrator that can't see cost isn't *single*. First Tier 0 disposed from the fresh-lens audit (line 248).

## How
**First multi-warden coordinated landing of the pilot.** Three concurrent surfaces, three authorities:

- **kernel-warden** (×1, status=complete, confidence=0.85) — `arbitrator.ts` types + pre-guard, `kernel-state.ts` `KernelInput.budgetLimits`, `runner.ts` `state.meta` seed via `transitionState` mirroring `initialMessages` pattern, `diagnostics.ts` emit helper, 17 co-located regression tests asserting pre-guard dominance over `agent-final-answer` / `max-iterations` / `kernel-error` variants.
- **runtime-warden** (×1, status=partial-shipped) — `builder.withBudget()` chainable method (throws when neither limit supplied), `RuntimeOptions.budgetLimits`, `runtime-construction.ts` plumb, 6 builder tests. Correctly flagged the kernel-side strategy-input wire as out-of-authority FU rather than reaching into `packages/reasoning/`.
- **Main-thread synthesizer** — `core/event-bus.ts` AgentEvent variant, `strategy-registry.ts` + `reasoning-service.ts` input shape, `reactive.ts` + `direct.ts` `kernelInput` propagation. Bridge between the two warden surfaces (plan-execute / ToT / reflexion / code-action wire deferred — minimal v0.11 activation = reactive + direct only).

`compose/killswitches/budget-limit.ts` left UNCHANGED per audit spec — side-channel preserved as fallback for kernels constructed outside the standard runtime; deprecation deferred to v0.12.

## Outcome
- `bunx turbo typecheck @reactive-agents/reasoning`: 8/8 green; `@reactive-agents/core`: green.
- `bun test packages/reasoning`: **1229 / 0 / 2980 expects** (+17 new `arbitrator.budget.test.ts`).
- `bun test packages/runtime`: **817 / 1 skip / 0 / 1492 expects** (+6 new `builder-with-budget.test.ts`).
- 2 PRE-EXISTING runtime typecheck errors (`runtime-construction.ts:337`, `tests/think-context.test.ts:40`) — ablation-verified unrelated via `git stash`; tracked as FU-5.
- End-to-end activation path live: `.withBudget()` → Arbitrator pre-guard verdict. Issue #128 closed. Audit G-A Tier 0 disposed. Pillar 6 mission target landed at canonical decision point.

## Surprises
- **runtime-warden's `partial-shipped` status was the correct call, not a shortfall.** Warden completed its full authority slice + flagged the kernel-side strategy wire as FU rather than reaching across the authority boundary. This is the pilot working as designed: the gap surfaced as a *coordination artifact* (something main-thread must synthesize) instead of an *authority violation* (warden silently reached). Pilot-positive signal — confirms warden boundaries correctly externalize cross-cutting work to a synthesizer layer.
- **kernel-warden ablation-verified the 2 unrelated runtime typecheck errors via `git stash`.** Warden voluntarily ran an ablation it wasn't asked for to disambiguate pre-existing vs introduced regressions. Suggests `kernel-warden` SOP has internalized "don't take credit / don't take blame for code you didn't touch" — an emergent discipline beyond the brief.
- **Confidence 0.85, not 0.9+, despite all-green tests.** Warden self-graded down for the same reason as HS-117: known incomplete artifact (4 of 6 strategies un-wired). Consistent pattern across pilot — wardens cap confidence at 0.85 when the kernel-side change is correct but the runtime-wide activation is partial.

## Lessons / What we'd do differently
- **Multi-warden coordination requires a main-thread synthesizer role; document it in pilot SOP.** HS-128 needed three surfaces edited atomically (kernel + runtime + core schema + cross-package input shape). Neither warden could complete the chain alone — and that's correct: their authority bounds correctly externalized the bridge work. Add to pilot doctrine: "When ≥2 wardens are dispatched for one feature, main-thread owns the bridging edits (cross-package input shapes, schema variants in core, strategy-registry plumbing). Wardens do not coordinate peer-to-peer." This was implicit in HS-113/HS-117 (single-warden + main-thread test add); HS-128 makes it explicit for N≥2.
- **`partial-shipped` deserves a first-class status, not a degraded `complete`.** runtime-warden's UpwardReport status was the most useful signal of the day — it surfaced the FU before main-thread had to discover it. Promote `partial-shipped` from ad-hoc note to canonical UpwardReport status alongside `complete` / `rework` / `inconclusive`, with required field `out-of-authority-followups: []`.
- **Pre-intent-switch guard placement is the architectural insight to codify.** Putting BudgetSignal *before* the `switch (intent.kind)` instead of as another intent variant means budget dominates every termination path automatically — no enumeration risk if a new `TerminationIntent` variant is added later. Add to convergence doctrine: "Cross-cutting Arbitrator signals (budget, safety, identity) belong as pre-guards, not as intent variants." Same pattern will apply to G-J identity-through-A2A when shipped.
- **Audit-fresh-lens Tier 0 → landed in one day.** From audit doc creation to commit landed: ~6 hours. Suggests audit-doc → GH issue → multi-warden dispatch is a fast path when leverage is clear; should be the default disposition route for future Tier 0 audit items.
- **Playbook held otherwise** — zero out-of-scope edits across both wardens, zero retries, both UpwardReports faithful to actual code shipped, ablation discipline emergent.

## Anchors
- Commit: `3db49f4a`
- Arbitrator pre-guard: `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts` (BudgetLimits + BudgetSignal + `computeBudgetSignal` + pre-guard at top of `arbitrate()`)
- Regression suite: `packages/reasoning/src/kernel/capabilities/decide/arbitrator.budget.test.ts` (17 tests, +284 LOC)
- Runner seed: `packages/reasoning/src/kernel/loop/runner.ts:+35` (transitionState `meta.budgetLimits`)
- KernelInput type: `packages/reasoning/src/kernel/state/kernel-state.ts:+36`
- Builder API: `packages/runtime/src/builder.ts:+69` (`withBudget` chainable)
- Builder tests: `packages/runtime/src/__tests__/builder-with-budget.test.ts` (6 tests, +83 LOC)
- AgentEvent variant: `packages/core/src/services/event-bus.ts:+20` (`BudgetSignalCollectedEmitted`)
- Strategy wire: `packages/reasoning/src/strategies/reactive.ts:+3` + `direct.ts:+3` (kernelInput propagation)
- Audit context: `wiki/Research/2026-05-23-primitive-audit-fresh-lens.md` §G-A (lines 155-160, recommendation line 248)
- Pilot log: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md:38-68`
- Issue: [#128](https://github.com/tylerjrbuell/reactive-agents-ts/issues/128)
