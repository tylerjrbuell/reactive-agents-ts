---
type: debrief
status: completed
created: 2026-05-23
feature: hs-120-learn-capability
warden: kernel-warden
verdict: PASS
tags: [harness-convergence, audit-fresh-lens, tier-1, phase-1-only, 10-capability-model, pilot]
related:
  - "[[2026-05-23-harness-convergence]]"
  - "[[2026-05-23-primitive-audit-fresh-lens]]"
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
  - "[[2026-05-23-hs-128-budget-signal-arbitrator-debrief]]"
---

# Debrief — HS-120 LearningPipeline seam (Phase 1, 2026-05-23)

## What
Single-commit landing (`a8dfc581`, +330 / -0 across 4 files) creating `packages/reasoning/src/kernel/capabilities/learn/`. New `LearningPipeline` Effect `Context.Tag` service with single `write(observations, decisions, outcome)` method; `NoopLearningPipelineLayer` as default; kernel runner wires the post-iteration snapshot boundary via `Effect.serviceOption` + `Effect.forkDaemon`; per-iter delta cursors slice steps/decisions to only the new appends. **Phase 1 = seam only.** Phase 2 (SkillStore / CalibrationStore / MemoryStore writers) deferred to follow-up dispatches.

## Why
Audit G-D Tier 1 ([fresh-lens audit](2026-05-23-primitive-audit-fresh-lens.md) §G-D lines 176–180, recommendation line 251). The 10-capability model (North Star v5.0 §3.1) names `learn` as a kernel capability — but `kernel/capabilities/learn/` did not exist. 8 of 10 directories shipped; recall (G-C / #129) + learn (this PR) were the gap. Compounding-intelligence (M6 skills + M7 calibration + M10 memory writes) had no per-iter consolidation seam — bandit logic, skill synthesis, calibration writes were scattered across `reactive-intelligence/`. Closes Optimal Execution Algorithm step 10 *surface*; behavior arrives in Phase 2.

## How
**Single kernel-warden dispatch ×1** (status=success, confidence=0.85, authority-bounds-honored=true). Three warden autonomous decisions justified inline:

- **`Context.Tag` class-style** — mirrors `PromptServiceTag` canonical pattern (`service-utils.ts:33`) rather than the ad-hoc style. Cited inline via JSDoc.
- **`Effect.forkDaemon` write wrapper at `runner.ts:1494-1525`** — mirrors `tool-execution.ts:526` precedent for memory writes; honors the "MUST NOT delay kernel main loop" constraint so Phase 2 SkillStore disk flush / MemoryStore vector ops can't block subsequent iters.
- **`prevStepCountForLearn` / `prevDecisionLogCountForLearn` delta cursors** — separate from loop-detector's counters so the two systems don't couple; each write receives only the `[prevCursor..currentCount]` slice, not the full history.

`Outcome.success = (state.status === 'done')` passed mid-loop with JSDoc warning that success is only authoritative on terminal iter — Phase 2 consumers can ignore mid-loop `success=false` and only attribute on the final write. All 5 load-bearing invariants preserved (loop-detector streak, single termination owner, two-records discipline, no LLM re-verify, qwen3 thinking opt-in).

## Outcome
- `bunx turbo typecheck @reactive-agents/reasoning`: 8/8 green.
- `bun test packages/reasoning`: **1233 / 0** (was 1229; +4 new `learning-pipeline.test.ts` covering noop layer, absent-layer no-error, captured-arg writer, once-per-iter invariant).
- `runner.ts` diff: +42 LOC, purely additive. No existing logic touched.
- Issue #120 Phase 1 closed. Audit G-D Tier 1 disposed. North Star §4.3 directory now exists.

## Surprises
- **Three architectural design decisions made *autonomously* by kernel-warden without escalation.** `forkDaemon`-wrapping, delta cursors, and class-style `Context.Tag` were not specified in the MissionBrief — warden chose each by referencing existing canonical patterns (cited inline in JSDoc with file:line precedents). This is the pilot working better than designed: rather than asking for clarification or making silent calls, the warden picked defensible patterns and *documented the citation in the code*. Pilot-positive signal — emergent SOP discipline beyond brief.
- **Confidence capped at 0.85 despite all-green tests + zero out-of-scope edits.** Same pattern as HS-117 and HS-128: warden self-grades down when shipped artifact is a known partial (seam-only, Phase 2 writers absent). Consistent across pilot — confidence ≤0.85 when the slice is correct but the activation is partial.
- **Zero consumers shipped, and that was the right call.** Resisting the temptation to also ship one Phase 2 writer "for completeness" preserved the audit's Tier-1 plan and kept the change reviewable. The follow-up dispatch list (six items in the close-comment) is the externalized work-graph.

## Lessons / What we'd do differently
- **"Seam-only Phase 1" is a powerful architectural-thinning move; codify it.** Ship the directory + `Context.Tag` + `Noop*Layer` default with **zero consumers**, then dispatch Phase 2 writers separately. This pattern: (a) closes the 10-capability model directory gap immediately and cheaply (+42 LOC to `runner.ts`, no risk surface), (b) externalizes the real work-graph to follow-up issues with clear authority boundaries (memory-warden for MemoryStore, RI-warden for SkillStore/CalibrationStore, runtime-warden for `.withLearning()` builder), (c) honors the [North Star §9 "scaffold without callers" anti-pattern](2026-05-23-harness-convergence.md) by giving every new seam a default `Noop` implementation that the kernel can actually invoke — the seam is exercised by every kernel run, not just by tests. Add to convergence doctrine: future audit-detected directory gaps (e.g., G-C recall) should default to seam-only Phase 1 unless a writer is trivially in-scope.
- **JSDoc precedent-citation as warden SOP.** Every autonomous decision in this PR cited the file:line it mirrored. Promote from emergent practice to canonical pilot output requirement: when a warden makes an unbriefed architectural choice, the JSDoc *must* cite the existing pattern it mirrors. Makes review fast; makes Phase 2 wardens' job easier.
- **Audit Tier 1 → seam-shipped same day.** From audit doc creation to commit landed: ~5 hours. Confirms audit-fresh-lens Tier 1 dispatch is a fast path when the recommended action is "create surface."
- **Playbook held otherwise** — zero out-of-scope edits, zero retries, UpwardReport faithful to actual code shipped, follow-ups enumerated with correct warden routing.

## Anchors
- Commit: `a8dfc581`
- Context.Tag service: `packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.ts:98-103`
- Noop default layer: `packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.ts:116-119`
- Runner wire site (forkDaemon): `packages/reasoning/src/kernel/loop/runner.ts:1494-1525`
- Regression suite: `packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.test.ts` (4 tests, +156 LOC)
- Barrel: `packages/reasoning/src/kernel/capabilities/learn/index.ts`
- Audit context: `wiki/Research/2026-05-23-primitive-audit-fresh-lens.md` §G-D (lines 176-180, recommendation line 251)
- Pilot log: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md:38-62`
- Issue: [#120](https://github.com/tylerjrbuell/reactive-agents-ts/issues/120)
