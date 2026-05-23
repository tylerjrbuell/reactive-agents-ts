---
type: debrief
status: completed
created: 2026-05-23
feature: hs-115-required-tool-nomination
warden: kernel-warden
verdict: PASS
tags: [harness-convergence, anti-scaffold, comprehend-capability, nominator, pilot]
related:
  - "[[2026-05-23-harness-convergence]]"
  - "[[2026-05-23-primitive-audit-fresh-lens]]"
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
  - "[[2026-05-23-hs-116-controller-decision-classification-debrief]]"
  - "[[2026-05-23-hs-129-recall-capability-phase1-debrief]]"
---

# Debrief — HS-115 Required-Tool Nomination at Comprehend Boundary (2026-05-23)

## What
Single-commit landing (`9d7bb884`, +563/-4 across 5 files) wiring `nominateRequiredTools(task, availableTools)` at the `kernel/capabilities/comprehend/` boundary in `task-intent.ts`. Pure regex/keyword classifier — no LLM call — covering 5 semantic categories (math/compute, web-search, http-fetch, file-write, file-read), confidence floor 0.5 at source, phantom-name guard restricting emits to names present in `availableTools`. Output seeded into `KernelMeta.nominatedTools` via dynamic-import (avoids module cycle) at `runner.ts:550-564`, consumed same-commit by `effectiveRequiredTools(state, input)` helper in `act/guard.ts` — fallback fires only when `input.requiredTools` is empty AND nomination confidence ≥0.7, at both `duplicateGuard` and `repetitionGuard` reqTools assignment sites. 17 co-located tests added.

## Why
Audit G-E flagged tool-nomination as a declared-but-sourceless surface — North Star §9 anti-scaffold F4 (nominator declared with no source) plus F5 (tool-inject controller variant exists but signal source incomplete). Both anti-scaffolds had to close together since F5's consumer was waiting on F4's emitter. Issue [#115](https://github.com/tylerjrbuell/reactive-agents-ts/issues/115) tasked closure with the explicit doctrine constraint: emitter and at least one consumer must land in the same commit, no scaffold-without-callers.

## How
**kernel-warden dispatch, dispatch #7 of the pilot.** Authority manifest covers `packages/reasoning/src/kernel/**`, all 5 edited files in scope. Three notable choices:

- **Pure regex/keyword nominator, no LLM.** Same precedent as `extractOutputFormat` co-located in `task-intent.ts` — deterministic, zero token cost, runs every iter-start cheaply. Confidence floor (0.5) baked at source so guard threshold (≥0.7) is reachable only by multi-signal matches.
- **Same-commit emit+consumer.** Nominator writes to `state.meta.nominatedTools`; `effectiveRequiredTools(state, input)` helper consumes via fallback. Closes F4 emitter + F5 consumer atomically — no intermediate commit where the surface exists declared-but-dead. North Star §9 invariant preserved.
- **No input mutation.** Fallback path returns a derived value; `input.requiredTools` is never written. Preserves the kernel-state immutability invariant that input-derived sites cannot leak into provider/runtime layers.

Out-of-scope deferred explicitly: `packages/core/**` event-bus schema variant (main-thread); `packages/reactive-intelligence/**` tool-inject consumer wire (Phase 2 RI-warden). Both flagged in commit body.

## Outcome
- `bun test packages/reasoning`: **1257 pass / 0 fail** (was 1240; +17 new). 17-test breakdown: 8 nominator unit + 3 guard-integration + 6 supporting.
- Typecheck clean across reasoning package.
- LOC src 262 (≤300 cap; full-with-tests 563).
- Audit G-E disposed; anti-scaffolds F4 + F5 closed simultaneously.
- kernel-warden confidence **0.88**, authority-bounds-honored=true, zero cross-package edits, zero retries.

## Surprises
- **Phantom-name guard caught a real regression-class at test-time, not theoretical.** The test `does not emit a name absent from availableTools` was added defensively — and it would have fired without the explicit `availableTools.includes(name)` filter. A naive keyword match (e.g., task contains "search" → emit `"web-search"`) would happily nominate tool names the runtime never registered, surfacing later as silent guard misfires on non-existent tools. Worth promoting to North Star §9 anti-pattern vocabulary: "nominator that emits beyond its source-of-truth" is a distinct scaffold-flavor from "nominator without consumer" — both produce dead signal but at different layers.
- **Defensive optional-chain caught partial-state breakage during test setup.** Test fixtures that stubbed `state.meta` without `nominatedTools` would crash a strict `state.meta.nominatedTools.tools` access. The helper's `state?.meta?.nominatedTools?.tools` chain absorbed this. Codify: state-reader helpers in `kernel/**` should default-defensive on `meta.*` since partial-state is the norm for unit tests and the runtime can legitimately enter consumer sites before all meta fields populate.
- **Same-commit emit+consumer discipline forced a cleaner API than sequential commits would have.** Drafting both sides simultaneously revealed that `effectiveRequiredTools(state, input)` reads better as a single helper than as scattered guard-site inlines — because the call sites needed identical fallback logic, the helper emerged naturally instead of being retrofitted. Sequential commits (emitter first, consumer later) would have invited copy-paste at the two guard sites. Pilot positive: §9 same-commit invariant produces better factoring, not just better doctrine.

## Lessons / What we'd do differently
- **Pure-classifier nominators belong at comprehend boundary, not at decide.** Audit G-E originally framed nomination as a controller-decide concern. Landing it at comprehend (alongside `extractOutputFormat`) means the signal is available to every downstream capability — guards, decision evaluators, future RI tool-inject — without each having to re-derive it. Codify: any task-derived signal that >1 capability consumes belongs at comprehend, period.
- **Confidence floor at source + threshold at consumer is a cleaner pattern than centralized config.** Nominator emits 0.5–1.0; guard requires ≥0.7. Two free knobs, easy to reason about, no global config needed. Apply to future signal-emitter/consumer pairs: float the threshold at the consumer where the cost-of-action is known, never at the emitter where it isn't.
- **Phase 2 followups filed correctly.** RI-warden tool-inject consumer wire (closes the F5 controller path); telemetry counter for nomination-fallback fire-rate (lets future ablation measure whether the ≥0.7 threshold is too tight/loose without re-instrumenting). Both correctly routed off the kernel-warden authority surface.
- **Playbook held otherwise** — single dispatch, zero re-spawns, zero out-of-scope edits, authority bounds honored, ablation-style verification of the phantom-name guard via test-corpus expansion.

## Anchors
- Commit: `9d7bb884`
- Nominator: `packages/reasoning/src/kernel/capabilities/comprehend/task-intent.ts:330` (`nominateRequiredTools`) + `:210` (`NominatedTool` type)
- State surface: `packages/reasoning/src/kernel/state/kernel-state.ts:123` (`KernelMeta.nominatedTools`)
- Runner seed: `packages/reasoning/src/kernel/loop/runner.ts:550-564` (post-`extractOutputFormat`, pre-budgetLimits)
- Consumer helper: `packages/reasoning/src/kernel/capabilities/act/guard.ts:45` (`effectiveRequiredTools`)
- Fallback sites: `packages/reasoning/src/kernel/capabilities/act/guard.ts:130,197` (duplicateGuard + repetitionGuard)
- Tests: `packages/reasoning/tests/kernel/capabilities/comprehend/task-intent.test.ts` (17 tests, +301 LOC)
- Pilot log entry: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md:38-66`
- UpwardReport confidence: **0.88** (kernel-warden, dispatch #7)
- Issue: [#115](https://github.com/tylerjrbuell/reactive-agents-ts/issues/115)
