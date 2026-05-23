---
type: debrief
status: completed
created: 2026-05-23
feature: hs-113-capability-scoped-instrumentation
warden: kernel-warden
verdict: PASS
tags: [harness-convergence, phase-1, capability-scoped, pilot]
related:
  - "[[2026-05-23-harness-convergence]]"
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
  - "[[project_harness_convergence_sweep_2026_05_23]]"
---

# Debrief — HS-113 Capability-Scoped Instrumentation (2026-05-23)

## What
Extended `kernel-state-snapshot` emission from inner-kernel-only to all outer-loop strategies. Three-part landing (commit `6af922cb`):

1. **Schema** — `AgentEvent.KernelStateSnapshotEmitted` gains optional `outerLoopName?: string` + `outerIter?: number` (`packages/core/src/services/event-bus.ts:980-991`).
2. **Helper** — `emitKernelStateSnapshot` accepts narrow local `KernelStateLike` (12 fields) instead of full `KernelState`; existing 3 runner.ts sites unchanged via structural assignability (`packages/reasoning/src/kernel/utils/diagnostics.ts:23-46,80`).
3. **Emit sites** — 4 new outer-loop boundaries: plan-execute (refinement-while + reflect block), tree-of-thought (BFS depth for-loop), reflexion (improve-while).

## Why
Per sweep-2026-05-23-qwen3-14b §F1, plan-execute / tree-of-thought / reflexion emitted **zero** `kernel-state-snapshot` events because the helper required full `KernelState`. Strategies running their own outer loops had no compatible state shape to hand in → capability-scoped observability surface was empty for >50% of strategy runs. Closes F1 anti-scaffold ("declared event without consumers for half the call paths") per harness-convergence spec §6 Issue 1.2. North Star §9 anti-pattern: "scaffold without callers."

## How
Routed `kernel/utils/diagnostics.ts` edits through `kernel-warden` (first dispatch of the team-ownership pilot). Strategy emit sites + core schema main-thread per pilot scope table (strategies/ and core/ not warden-gated).

**Two warden dispatches**, both success / confidence ≥0.9 / authority-bounds-honored:

- **#1 — signature opening:** added optional `outerLoopName?` / `outerIter?` params (+7/-1 LOC, 1211/1211 tests).
- **#2 — shape opening:** narrowed `args.state` from `KernelState` to `KernelStateLike` so outer-loop callers (which lack full kernel state) can pass minimal aggregate counters (+46/-9 LOC, 576/576 kernel tests).

The re-spawn was **scope progression** (signature → shape), not retry. Pilot log entry: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` lines 38-59.

## Outcome
- `bunx turbo run typecheck --filter=@reactive-agents/reasoning` 8/8 green.
- `bun test packages/reasoning` 1211 pass / 0 fail / 2928 expects.
- 4 new emit sites covering all 3 outer-loop strategies.
- F1 anti-scaffold closed; capability-scoped observability now consistent across runKernel and outer-loop strategies.
- Issue #113 closed.
- First pilot dispatch logged with zero out-of-scope edits, zero retries.

## Surprises
- **Issue #113 spec listed 5 emit-site coordinates but no helper-signature change.** Yet the helper signature was the actual blocker — outer-loop callers had no `KernelState` to pass. Spec under-specified the precondition; only surfaced once dispatch #1 tried to compile a call site.
- **Two warden dispatches landed without re-spawn cost being a "retry."** Dispatch #1 (signature) and dispatch #2 (state shape) were sequential refinements of scope, not corrections of a failure. Pilot's `agent-spawns: 2` would naïvely read as a re-spawn penalty under the dev-contract metric — but neither dispatch failed authority bounds or required rework.

## Lessons / What we'd do differently
- **Phase 1 specs should pre-declare expected helper signature changes** alongside emit-site coordinates so wardens can size dispatch scope on first spawn. Add a checklist line to the harness-convergence issue template: "Does any downstream helper need a wider/narrower arg type to admit the new caller?"
- **The re-spawn metric needs a "scope-progression" exclusion.** Distinguish (a) warden returns REWORK and re-dispatches against same goal vs (b) warden returns PASS and next dispatch advances a strictly larger scope. Only (a) counts against the ≤1.5 re-spawn pilot threshold. Otherwise pilots get penalized for honest incremental landing — a perverse incentive toward over-scoped single dispatches.
- **Structural assignability is the right escape hatch when widening helper inputs.** Defining `KernelStateLike` locally (only the fields the helper reads) kept the 3 existing `runner.ts` call sites untouched while admitting minimal aggregate counters from strategies. Cheaper than synthesising a full `KernelState` at each new call site.
- **Playbook held otherwise** — kernel-warden authority bounds, MissionBrief/UpwardReport flow, and main-thread handling of strategies/ + core/ all worked first-shot. No process change needed for those paths.

## Anchors
- Commit: `6af922cb`
- Schema: `packages/core/src/services/event-bus.ts:980-991`
- Helper: `packages/reasoning/src/kernel/utils/diagnostics.ts:23-46,80`
- Emit sites: `packages/reasoning/src/strategies/plan-execute.ts` (+39), `tree-of-thought.ts` (+16), `reflexion.ts` (+16)
- Evidence source: `wiki/Research/Harness-Reports/sweep-2026-05-23-qwen3-14b.md` §F1
- Pilot log: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md:38-59`
- Issue: [#113](https://github.com/tylerjrbuell/reactive-agents-ts/issues/113)
