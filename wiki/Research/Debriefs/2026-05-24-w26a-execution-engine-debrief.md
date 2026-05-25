---
date: 2026-05-24
bundle: w26a-execution-engine-decomp
pr: "#130"
issue: "#76 (partial)"
status: shipped
---

# Execution Retro: W26-A execution-engine.ts decomposition

**Budget:** ~90 min (plan target) | **Actual:** ~55 min wall-clock for execute phase (after plan write)

## Outcomes

- **Issues closed:** none yet — #76 stays open until W26-D ships. PR #130 marks "Partial: #76".
- **Issues descoped:** Task 2 (inline agent-loop while-body extraction) deferred — ≤1500 LOC target for execution-engine.ts already met (1378 final) without it; carried the highest replay-determinism risk.
- **Net test delta:** 0 (runtime 811/0/1 = baseline; replay 24/0 = baseline; build 38/38 = baseline).
- **Net LOC delta:** execution-engine.ts: 1656 → 1378 (-278 / -16.8%). Two new modules (snapshot-final.ts +46, execute-stream.ts +234). pipeline.ts +3 (export annotation).
- **`as any` delta:** 6 → 4 in execution-engine.ts (-2 via `resolveModelName`).

## What worked

- **Read-before-write paid off immediately.** The first read of `engine/pipeline.ts` revealed that `runPhase` + `runObservablePhase` already existed there — the engine's inline closures were duplicates from an incomplete W23 refactor. Plan was rewritten on the spot (Task 1 became "kill duplication" instead of "extract new file") and shipped -122 LOC with a single one-line `Edit` + one helper export. Pivot saved ~30 min vs the originally-planned extract-with-parity-test path.
- **PhaseDeps already constructed.** The engine's `executeCore` builds a `deps: PhaseDeps` object at line 547 (W23 vintage) with `hooks`, `obs`, `eb`, `state` all populated. Routing `guardedPhase` through `pipeline.runObservablePhase(ctx, phase, body, deps)` cost one line. No new factory, no new dep struct, no closure-deps audit.
- **Replay determinism gate per task caught nothing — which is the win.** Running `bun test packages/replay/` after each commit cost ~250ms and removed all anxiety about ordering / event-emission side effects. The gate exists; use it cheaply.
- **Descope-before-execute beats descope-after.** Stopping after Task 3+4 verified we'd already cleared the ≤1500 target. Skipping Task 2 was a 0-cost decision with positive expected value (avoided the audit-heavy closure-deps extraction whose worst case is breaking the inline ReAct path in subtle ways).
- **Cherry-pick of plan onto bundle branch** kept plan + impl together in one PR, satisfying the "every PR has its plan visible" hygiene without polluting `main` with un-pushed plan commits.

## What didn't

- **Plan's `2026-05-24` baseline assumed 1676 LOC; actual was 1656.** Plan was written off a stale measurement (~20 LOC drift between read at plan-time and bun build-cache state at execute-time). Targets were all 20 LOC off but the goal (≤1500) was still hit comfortably. Lesson: capture baseline at branch creation, not at plan write.
- **Dead-import cleanup wasn't planned but was required.** Task 4 left `Option`, `Queue`, `FiberRef`, `RunControllerRef` unused. Build would have stayed green (TS warns only) but it's cosmetic debt. A 5th micro-commit closed it. Plan should list "dead-import sweep" as an explicit Task N+1 for any file with extractions of ≥100 LOC.
- **`defaultModel: unknown` schema bit me on first `resolveModelName` implementation.** I typed the helper param as `defaultModel?: string` — DTS build failed with TS2345 because `ReactiveAgentsConfig.defaultModel` is `Schema.optional(Schema.Unknown)`. Fixed with widening + runtime `typeof` check. Lesson: when writing a new helper that touches `ReactiveAgentsConfig.<field>`, grep the schema's actual Schema type before writing the param type.
- **Replay tests are fast but not actually exercising executeStream extensively.** All 24 replay tests run in 250ms — they pin layer-override semantics + tool-result freezing but probably wouldn't catch all event-ordering regressions from a re-architecting of the FiberRef forkDaemon chain. The Task 4 extraction was conservative (verbatim copy of the body) for exactly this reason.

## Skill improvements (to apply on next pass)

1. **Add a "Pre-Task 0" step to W26-x plans: scan target file for duplicates of helpers in sibling modules (`engine/`, `agent/`, `builder/`).** This W26-A pass discovered ~130 LOC of duplication that the plan didn't predict. A pre-scan grep like `grep -l "<helper-name>" packages/runtime/src/engine/` for each closure-helper found in the host file would surface these in 30 seconds. Add to execute-backlog skill Phase 1 SCAN as well — "if file has been touched by a multi-step refactor wave (W23-W25), check whether 'extract X' is actually 'delete duplicate-of-extracted-X'".
2. **Capture baseline at branch creation, not at plan-write.** The 20-LOC drift between plan write and execute kickoff didn't bite hard this time but could mask a real regression (e.g., if the file had grown by 100 LOC between plan and execute, the target wouldn't have been met without Task 2). Codify in `execute-backlog` skill Phase 3.5 baseline-capture: "use the numbers you record HERE in the plan doc, even if plan was written earlier."
3. **Always include a dead-import sweep as the final commit of any extraction-heavy bundle.** Cheap (1 commit), reduces churn in next person's mental model, prevents the "is this unused or am I missing a usage?" cognitive load on review.

## Process inflation guard (HS-18/22/31 lesson)

- Did any unit's verified-by claim turn out to be inflated? **No.** Issue #76's "4 files >1500 LOC" claim was verified by `wc -l` at branch creation: builder 2726, runtime 2083, execution-engine 1656, reactive-agent 1578. All ≥1500 confirmed. The drift since 2026-05-21 (file went from 1676 in the plan to 1656 at execute) was 20 LOC of unrelated work in the interim, not inflation.
- Did the extraction reveal any hidden bugs? **No** — but it killed 2 `as any` model-coercion sites that were latent bug-bait (the runtime path that fed `selectedModel` as a string vs the reasoning path that fed `{ model: "..." }` was masked by the `as any` cast — `resolveModelName` makes the shape variance explicit).

## Next actions

- [ ] PR #130 awaits review + merge.
- [ ] After merge: kick off W26-B (builder.ts decomposition, 2726 LOC) per master plan. Write `2026-05-24-w26b-builder-decomposition.md` (or dated next) at kickoff.
- [ ] Apply Skill improvements above to `execute-backlog` SKILL.md inline before next bundle.
- [ ] Comment on #76 with W26-A landing summary.
