---
type: harness-report
status: complete
created: 2026-11-06
tags: [reactive-intelligence, controller, census, spike, h3]
---

# RI controller census (2026-11-06)

Census of every reactive-intelligence (RI) controller evaluator and intervention handler. It covers 966 recorded runs: 930 H3 traces from the spike pack plus 36 lh-a0 long-horizon traces. Tiers: qwen3:4b (427 runs), cogito:8b (465), bonsai-2:27b (74). No live model runs. Scripts and raw output: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/ri-census/` (`scan.ts`, `aggregate.ts`, `detail.ts`, `nearcap.ts`, `redirect-calls.ts`, `per-run.jsonl`, `*.txt`).

**Cohort caveat.** Every trace predates both of today's fixes. The lh-a0 traces are at `afbac9af7`, before `78ac7bd79`; all H3 traces are older. The census therefore shows pre-fix behavior for the near-cap early stop (`78ac7bd79`) and the tool-failure redirect (`fa3e33b7b`). No post-fix cohort exists.

## Bottom line

- Only 2 of 9 handlers change runs in practice: `early-stop` and `tool-failure-redirect`. Both act by stopping the run.
- `switch-strategy` acts occasionally. In 5 of its 13 dispatches, switching was disabled, and the request became an exit proposal.
- `temp-adjust` dispatches often but has no effect on any model call. It also uses up the shared 5-fire budget. In 2 runs that budget was gone when `early-stop` fired, so the early stop was suppressed.
- The other 5 cannot act or never fire: `compress` is arithmetically unreachable; `skill-activate` and `harness-harm` have no input or producer; `tool-inject` and `stall-detect` stay below their thresholds on every tier.

## Instrument

Trace chain per decision:

1. `ReactiveDecision` is recorded as `decision-evaluated`.
2. The handler result is recorded as either `intervention-dispatched` (with `patchKind`) or `intervention-suppressed` (with the dispatcher or handler reason).
3. A stop shows as `guard-fired` with guard `dispatcher_early_stop`. Its outcome is `block` (vetoed) or `terminate`.

Source: `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:316-555`, mapped by `packages/trace/src/normalize.ts:195-262`.

Checked by hand on 2 traces:
- `01M6RFRCKH4284VV2GYBDV0WAA` (cogito lh-1): 3 redirect decisions, each dispatched as `early-stop`. The first was vetoed (`block`), the third terminated the run, and the run went through handoff to failure. This matches `scan.ts`.
- `01M6Q5XQAP0SMM54NJYZ9HG0QV` (cogito h3-todo-heavy): 5 `temp-adjust` patches, then 14 `max-fires-exceeded` suppressions (12 temp-adjust, 2 early-stop at iter 13). The run ended at `max_iterations`. This matches.

Coverage: 95% of runs have `entropy-scored` events, so the controller ran in them. Only 89 of 966 runs produced any decision. Median iterations: qwen 3, cogito 5, bonsai 3.

Instrument gaps (they do not change the counts below):
- The outer-loop callers do not publish `ReactiveDecision`. These are `packages/reasoning/src/strategies/plan-execute/reflection-entropy.ts:123` and `tree-of-thought.ts:617`. Their decisions appear only as dispatched or suppressed events. This explains 3 stall-detect suppressions with no decision event, and about 4 cogito early-stop patches with no decision event.
- `InterventionDispatched.cost` carries the whole batch's `totalCost`, not the per-patch cost (`reactive-observer.ts:434-437`).
- `telemetry` is always `{}`, so handler telemetry (for example the temperature from/to) is lost.

## Per-mechanism table

"Acted" means at least one patch was applied. "Ended" means a `dispatcher_early_stop` guard terminated the run. "Task-matched" compares solve rates on the same tasks and tier, for runs where the mechanism acted versus runs where it did not.

| Mechanism (evaluator → handler) | Tier | Decisions (runs / events) | Acted runs (solved) | Patches applied | Suppressed | Ended run (solved) | Task-matched acted vs not | Run ids | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| early-stop (`controller/early-stop.ts` → `handlers/early-stop.ts`) | qwen3:4b | 20 / 23 | 24 (15) | early-stop 27 | 0 | 20 (14) | 15/24 vs 79/118 | `01M6KFPPBFC0Q3QB1M4TGRPSDK` (S), `01M6MKQVF4R387PPJSPR24KM46` (F) | working but low value; re-measure post-`78ac7bd79` |
| | cogito:8b | 22 / 34 | 26 (3) | early-stop 36 | max-fires 4 | 20 (3) | 3/26 vs 26/178 | `01M6KG3BSHNRSP1YM0T6GVNZE2` (F), `01M6KE17R4S5SZZ82VRFFF95RK` (S) | |
| | bonsai-2:27b | 1 / 1 | 1 (0) | early-stop 1 | 0 | 1 (0) | 0/1 vs 4/4 | `01M6QD4S2S7RJSGF925Q0T0MVE` | |
| tool-failure-redirect (`evaluators/tool-failure-streak.ts` → `handlers/tool-failure-redirect.ts`) | qwen3:4b | 6 / 12 | 6 (0) | early-stop 12, nudge 0 | 0 | 6 (0) | 0/6 vs 35/67 | `01M6Q2RJVH060XP1M2Y5FXT12E`, `01M6Q3F6Z90Q97DB1C4JMAG9S2` | misfiring pre-fix (fixed in `fa3e33b7b`); 2 residual defects (below) |
| | cogito:8b | 6 / 13 | 6 (0) | early-stop 13, nudge 0 | 0 | 6 (0); 3 vetoed once | 0/6 vs 2/58 | `01M6RFRCKH4284VV2GYBDV0WAA`, `01M6REXPKJXWABQ9WB081BTBCR` | |
| | bonsai-2:27b | 3 / 5 | 3 (0) | early-stop 5, nudge 0 | 0 | 3 (0) | 0/3 vs 1/5 | `01M6QTFXJ2E5H7FPG80P3QVAKR`, `01M6QVD4EF4R9BPYEESM7BH40Y` | |
| switch-strategy (`controller/strategy-switch.ts` → `handlers/switch-strategy.ts`) | qwen3:4b | 2 / 2 | 2 (0) | request-strategy-switch 2 | 0 | 0 | 0/2 vs 28/28 | `01M6KHDC4DHJHT3PAA53AR6N9G`, `01M6MWR2SJ628ZT2P71089CPD7` | misfiring when switching is disabled; otherwise unmeasurable |
| | cogito:8b | 7 / 7 | 7 (1) | request-strategy-switch 7 | 0 | 0 | 1/7 vs 56/164 | `01M6MBR4EYE2CDDMVNK8PFKB8X`, `01M6PMCE20R6A1M5Z3SW7N0Z79` (switching_exhausted) | |
| | bonsai-2:27b | 4 / 4 | 4 (4) | request-strategy-switch 4 | 0 | 0 (all 4 exited via `switching_exhausted`, then abstained) | 4/4 vs 0/1 | `01M6QANRRJTJ2BGFR7Z4MWAAW6`, `01M6Q9SFFXC9HP2MM5MJVW2KB6` | |
| temp-adjust (`evaluators/temp-adjust.ts` → `handlers/temp-adjust.ts`) | cogito:8b | 12 / 86 | 12 (0) | set-temperature 47 | max-fires 39 | 0 | 0/12 vs 2/52 | `01M6Q5XQAP0SMM54NJYZ9HG0QV`, `01M6PKHSES1WK5J85CS8TE8MKD` | **inert + misfiring + uses up budget** |
| | qwen3:4b, bonsai | 0 | — | — | — | — | — | — | |
| compress (`controller/context-compressor.ts` → `handlers/context-compress.ts`) | qwen3:4b | 6 / 27 | 0 | 0 | savings-below-cost 27 | 0 | — | `01M6MWT4X6PS9FZCE7K76NC4WT` | **dormant: unreachable by arithmetic; consumer deleted** |
| | cogito:8b | 2 / 9 | 0 | 0 | savings-below-cost 9, below-entropy 1 | 0 | — | `01M6MB8BTFY0DXBG80JP5QGF30`, `01M6MBNYM2Q2GV0F3B3ZPR3DVW` | |
| | bonsai-2:27b | 2 / 17 | 0 | 0 | savings-below-cost 17 | 0 | — | — | |
| stall-detect (`evaluators/stall-detect.ts` → `handlers/stall-detector.ts`) | all | kernel path 0; outer loop 3 | 0 | 0 | below-entropy-threshold 3 (qwen 2, cogito 1) | 0 | — | `01M6KJ1WK5RCNP7Z4EWXRPCGCX`, `01M6MB6JGGX1YABVQKEPWX6Z5K` | **dormant** (threshold contradiction) |
| tool-inject (`evaluators/tool-inject.ts` → `handlers/tool-inject.ts`) | all | 0 | 0 | 0 | 0 | 0 | — | — | **dormant** on local tiers; frontier unmeasurable |
| skill-activate (`evaluators/skill-activate.ts` → `handlers/skill-activate.ts`, `skill-loader.ts`) | all | 0 | 0 | 0 | 0 | 0 | — | — | **dormant: no input wired** |
| harness-harm (no evaluator → `handlers/harness-harm-detector.ts`) | all | 0 | 0 | 0 | 0 | 0 | — | — | **dormant: no producer** |

Read the task-matched columns as selection-biased. The mechanisms act on runs that are already long or failing. Bernoulli SE at these sizes is wider than most of the gaps.

## Findings per mechanism (trace evidence + static intent-vs-code)

### 1. temp-adjust: inert, misfiring, and uses up the shared budget

- **Inert.** Across all 12 runs, 0 of 47 applied `set-temperature` patches changed the temperature of a later model call. Every `llm-exchange` after a patch is still at 0.3. The final 0.2 calls come from terminal synthesis (`packages/reasoning/src/kernel/loop/terminal-synthesis.ts:56`). 62 cogito runs without temp-adjust also end at 0.2.
  - Root cause: the patch writes `carry.currentOptions.temperature` (`packages/reasoning/src/kernel/loop/turn-operations.ts:447-455`).
  - Think reads `params.context.input.temperature` (`packages/reasoning/src/kernel/capabilities/reason/prepare-think-gateway-call.ts:53`), and `t.currentContext` is never updated from `currentOptions`.
  - The only reader of `currentOptions.temperature` is the evaluator itself (`reactive-observer.ts:280`).
- **Wrong base, latent.** The handler reads `state.currentOptions?.temperature ?? 0.7` (`packages/reactive-intelligence/src/controller/handlers/temp-adjust.ts:11`). `KernelState` has no `currentOptions` field, so the base is always 0.7 and the target is always 0.6. If the temperature path were wired, this "lower the temperature" patch would **raise** H3's 0.3 to 0.6.
- **Fires on non-diverging runs.** The evaluator's rule is `shape === "diverging" || derivative > 0.05` (`evaluators/temp-adjust.ts:12`), so any shape qualifies once the derivative is above 0.05.
  - Example: `01M6Q5XQAP0SMM54NJYZ9HG0QV`. The composite was 0.377 at every iteration from 5 to 11, the reported derivative was 0.054 at every iteration from 5 to 13, and the run made a successful tool call every iteration.
  - In that run temp-adjust fired 17 times: 5 dispatched and 12 suppressed.
- **Uses up the budget.** `maxFiresPerRun: 5` is shared across all decision types and counts patches (`packages/reactive-intelligence/src/controller/intervention.ts:126`, `dispatcher.ts:231`).
  - In 7 runs, temp-adjust took all 5 slots.
  - In 2 of those runs (`01M6Q5XQAP0SMM54NJYZ9HG0QV`, `01M6PKHSES1WK5J85CS8TE8MKD`), the near-cap `early-stop` was then suppressed with `max-fires-exceeded`, and both runs ran to `max_iterations`. Both failed. The outcome was the same as early-stopped runs of the same task and tier, so the cost here was tokens, not solves.

### 2. compress: unreachable and write-only

- The evaluator sets `estimatedSavings = (contextPressure − 0.80) × 1000` (`controller/context-compressor.ts:18`). The handler applies only when savings > 600 (`handlers/context-compress.ts:13`). That needs `contextPressure > 1.4`.
- `contextPressure` is at most 1, because `utilizationPct` is clamped (`packages/reactive-intelligence/src/sensor/context-pressure.ts:81`) and the sensor rescales the value into [0,1] (`sensor/entropy-sensor-service.ts:211-216`).
- Maximum savings is therefore 200, and the handler can never apply. Traces agree: 54 decisions, 0 applied, 53 `savings-below-cost`.
- Even if it applied, the patch writes `meta.pendingCompressionRecommendation`. That field has had no reader since `279b61fb6` (2026-07-07), which deleted `applyMessageWindowWithCompact`.
- Adjacent: the HS-128 verbosity detector (`reactive-observer.ts:580-608`) writes the same dead field. It is outside this census, but it is write-only for the same reason.

### 3. skill-activate (+ skill-loader): no input

- The evaluator returns null without `availableSkills` (`evaluators/skill-activate.ts:8`).
- None of the three `evaluate()` callers passes `availableSkills` or `activeSkillNames`: `reactive-observer.ts:267-314`, `reflection-entropy.ts:123-141`, `tree-of-thought.ts:617`.
- `skill-loader.ts:7-10` also reads `process.cwd()/.agents/skills`. That is the contributor-skill tree of whichever repo is the cwd, not the agent's skill registry.
- Traces: 0 decisions. Skill activation already ships through another path (`dc8274fb`, 2026-08-06).

### 4. harness-harm: no producer

- No evaluator emits `decision: "harness-harm"`. `isHarnessHarmSuspected` and `isHarnessHarmConfirmed` (`handlers/harness-harm-detector.ts:15-25`) have only test callers.
- The handler, its mode entry (`intervention.ts:121`) and its bridge case (`dispatcher.ts:123-135`) are unreachable. Traces: 0.

### 5. tool-inject: dormant on these tiers

- The evaluator needs composite ≥ 0.5 on two consecutive scores (`evaluators/tool-inject.ts:19`).
- Across 3,807 `entropy-scored` events, 3 were ≥ 0.5 (all cogito) and 0 consecutive pairs were. That gives 0 decisions on all tiers.
- Static issue: when neither `recall` nor `web-search` is registered, it suggests `availableToolNames[0]` (`evaluators/tool-inject.ts:33`). That is whatever tool is registered first, with no relation to the gap.
- Unmeasurable on frontier models, which this corpus does not include.

### 6. stall-detect: dormant by a threshold contradiction

- The evaluator fires only when the composite is ≤ 0.20 on every step of its window (`evaluators/stall-detect.ts:3,41`).
- The dispatcher suppresses non-early-stop decisions below `adaptiveMinEntropy` (`dispatcher.ts:223`). That floor is:
  - 0.12 for local tier,
  - 0.25 for unknown tier,
  - 0.45 for frontier,
  - `highEntropyThreshold × 0.6` when calibrated (`reactive-observer.ts:46-57`),
  - 0.55 on the outer-loop paths, which pass no adaptive floor.
- Result: the tier windows for `mid`, `large` and `frontier` (`stall-detect.ts:4-9`) cannot dispatch, and only uncalibrated local runs can.
- Traces: 0 kernel-path decisions. 3 outer-loop decisions, all suppressed `below-entropy-threshold`.
- The kernel already has its own stall and loop guards (turn ops `stall` and `loop-detection`). Those produced 62 of the 70 strategy switches in this corpus.

### 7. switch-strategy: becomes an exit when switching is off

- If `strategySwitching.enabled` is false or exhausted, the guard does not continue the loop. It calls `proposeGuardExit(..., "switching_exhausted", ...)` (`packages/reasoning/src/kernel/loop/turn-guard-operations.ts:343`). An RI request to switch strategy therefore becomes a request to stop the run, and the evaluator has no evidence check.
- The evaluator does not know whether switching is enabled: `ControllerEvalParams` has no such field.
- Traces: 13 dispatches.
  - 8 led to a switch, and 1 of those 8 runs solved.
  - 5 led to `switching_exhausted`. 4 were bonsai ab-trap-5 runs that then abstained (scored solved, since abstention is the trap's correct answer). 1 was cogito rw-9, solved.
- The outcomes in these 5 were fine by accident. The path contradicts the handler's stated intent ("Switch reasoning strategy mid-run when current is stuck").

### 8. early-stop: almost entirely the near-cap branch, low value

- Branch split: 57 near-cap ("Approaching maxIterations") versus 1 converging (`01M6MTB6Y289ADZ195ZD99N0CA`, qwen rw-9, solved). The converging branch is effectively dormant.
- The near-cap branch fires at `iter = max−1` in most runs (13/14 on h3-todo-heavy). It saves at most one iteration before the hard `max_iterations` stop. The code comment says this itself (`controller/early-stop.ts:60-69`).
- It ended 41 runs, 17 of them solved. `rax-diagnose` attributions for these runs:
  - harness `premature-stop` 3, `tool-call-corrupted` 5, `tool-call-dropped` 2, `false-veto` 4 (solved anyway);
  - model 10;
  - environment 3.
- Near-cap comparison (`nearcap.txt`), runs that reached the same depth with vs without the stop:
  - qwen todo-heavy: 10/14 with, 6/6 without;
  - cogito todo-heavy: 2/11 with, 0/10 without;
  - qwen plan-only: 4/9 with, 21/44 without.
  - No consistent direction at this n.
- All of this is pre-`78ac7bd79`. That commit makes the branch stand down when the run is producing evidence, so a post-fix census is needed before deciding.

### 9. tool-failure-redirect: pre-fix defect confirmed; 2 residual defects post-fix

- Pre-fix: 15 runs, 30 dispatches, all early stops, 0 nudges, and 0 runs where the nudge text reached the model. Sequences: `EE` 13, `E` 1, `EEE` 1. Of these 15 runs, 0 solved, 15 were ended by RI and 3 were vetoed once. This matches the defect fixed in `fa3e33b7b`.
- **Residual A: the streak ignores arguments, but the nudge suggests changing them.**
  - The streak keys on tool name only (`packages/reasoning/src/kernel/capabilities/reflect/tool-failure-streak.ts:43-44`).
  - The evaluator re-fires whenever the pending batch still names the failing tool (`evaluators/tool-failure-streak.ts:25`).
  - The new nudge tells the model to try "different arguments, a different tool, or the next step" (`handlers/tool-failure-redirect.ts:39-45`).
  - So a model that follows the nudge with corrected arguments is early-stopped on the next pass.
  - Evidence (`redirect-calls.txt`): 6 runs have inspectable failing args. 1 was an identical retry (`01M6RGRWY90Z63GWXBQB4ESW5T`). 5 were changed calls: code-execute with new code each time in `01M6QTFXJ2E5H7FPG80P3QVAKR` and `01M6QTZS66904C5HRW3ZNFPG61`, file-write with new content in `01M6RFRCKH4284VV2GYBDV0WAA`, and same-batch parallel reads in 2 runs.
- **Residual B: the decision log counts suppressed decisions.**
  - The observer appends every decision to `controllerDecisionLog` before dispatch (`reactive-observer.ts:346-357`), including decisions the dispatcher then suppresses.
  - The handler counts log entries, not applied nudges (`handlers/tool-failure-redirect.ts:23`).
  - So if the first redirect is suppressed (entropy floor, max-fires, budget) and a later one is dispatched, that later one escalates straight to `early-stop` with "redirect nudge was ignored", though no nudge was ever sent.
  - It is latent in this corpus (0 redirect suppressions on local tiers). It becomes likely at the frontier floor of 0.45, and whenever temp-adjust has used up the budget.
  - `handlers/stall-detector.ts:42-45` has the same pattern.

## Ranked actions

**Fix (with evidence)**

1. **tool-failure-redirect residual A.** Key the re-fire on the identical call (name + args), or count only identical-call failures. Owner: kernel-warden (both anchors: `packages/reasoning/src/kernel/capabilities/reflect/tool-failure-streak.ts:43`, `packages/reactive-intelligence/src/controller/evaluators/tool-failure-streak.ts:25`). Evidence: 5 of 6 inspectable streaks were changed calls. The post-fix nudge invites exactly the behavior the evaluator then punishes. Verify with lh-a0 + H3 targeted reruns on rw-7, lh-1 and h3-todo-heavy at both tiers.
2. **tool-failure-redirect / stall-detect residual B.** Count applied nudges, not logged decisions. One option: log only dispatched decisions. Another: read `InterventionDispatched` history from state. Owner: kernel-warden (`packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:346-357`, `packages/reactive-intelligence/src/controller/handlers/tool-failure-redirect.ts:23`). Latent on local tiers; a static defect of the same class as `fa3e33b7b`.
3. **switch-strategy when switching is disabled.** Fall through (`next`) instead of `proposeGuardExit`, or do not evaluate when switching is off. Owner: kernel-warden (`packages/reasoning/src/kernel/loop/turn-guard-operations.ts:343`). Evidence: 5 of 13 dispatches became exits.

**Delete (dormant, inert, or no effect)**

4. **temp-adjust** evaluator + handler + `set-temperature` patch + `dispatcher-temperature` turn op. Inert (0 of 47), with a wrong base value, it fires on flat runs, and it uses up the fire budget. Wiring it instead would be a new mechanism that needs an ablation first; there is no evidence it would help.
5. **compress** evaluator + handler + `compress-messages` patch case. Unreachable by arithmetic and write-only. Also flag the verbosity detector's write to the same dead field.
6. **skill-activate** evaluator + handler + `skill-loader.ts`. No input is wired, and the loader reads the wrong directory.
7. **harness-harm** handler + mode + bridge case + `isHarnessHarm*`. No producer.
8. **stall-detect** evaluator + handler. Dormant because its trigger threshold sits below the dispatcher's suppression floor. The kernel's `stall` and `loop-detection` guards already cover this.
9. **tool-inject** evaluator + handler. 0 fires on 3 tiers, and its fallback pick is arbitrary. Delete, or park as off by default until a frontier trace shows it fires.

**Keep, re-measure**

10. **early-stop.** Run a post-`78ac7bd79` census of the near-cap branch. If it still saves ≤1 iteration and the comparison stays null, delete the near-cap branch. The hard `max_iterations` stop is one step later. The converging branch fired once in 966 runs and is also a delete candidate.

If 4–9 are deleted, RI's dispatch surface shrinks to early-stop, tool-failure-redirect and switch-strategy. Those 3 are the only mechanisms with evidence of acting. The shared `maxFiresPerRun` budget then stops being consumed by an inert mechanism.
