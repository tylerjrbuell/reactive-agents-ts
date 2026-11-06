---
type: ablation
status: complete
created: 2026-11-06
tags: [ablation, lift-gate, loop-progress-aware, plan-9, h3, void, no-activation]
---

# Ablation re-run: progress-aware loop resolution (2f) on `h3-todo-heavy`. VOID: 0 activations

**Warden:** ablation-warden
**SHA:** `9ae6a59ff0fce6e174cbc5da9be539c268b15af5` (local `dev` HEAD; scratch worktree, detached; core/reasoning/trace dist rebuilt). The SHA is recorded in the results file.
**Previous run:** [[../2026-11-05-loop-progress-aware/README]] was void too, with 0/38 activations on the `h3-lh` suite.

## Activation count (read this first)

**2f fired 0 times in 3 pilot runs** (cogito:8b, `h3-todo-heavy`, arm a1, k=3). The brief's stop rule applies: there is no full matrix and no gate verdict. The comparison is **void**. It is not evidence of no effect.

An activation is `guard-fired {guard: loop_resolution, outcome: block, reason: progress_since_last_loop}`, the event `redirectRepeatAfterProgress` emits in `packages/reasoning/src/kernel/loop/runner-helpers/loop-progress.ts`. Each `loop_resolution` event was paired with its exit-gate decision by `gateDecisionFor` / `guardEndedRun` from `packages/trace/src/guard-run-end.ts` (the gate-decision-aware reader from 70360971b).

| Run | Acc | terminatedBy | 2f fired | Loop verdicts (iter: outcome/reason/gate) | Exit that followed |
|---|---|---|---|---|---|
| 0 | 0.83 | `harness_deliverable` | 0 | it6: block/harness_synthesis/**deny-once** | `dispatcher_early_stop` handoff |
| 1 | 0.33 | `controller_early_stop:dispatcher_early_stop` | 0 | it6: block/harness_synthesis/**deny-once** | model accept, then `dispatcher_early_stop` accept |
| 2 | 0.83 | `harness_deliverable` | 0 | it9: block/harness_synthesis/**deny-once** | `dispatcher_early_stop` handoff |

`run-started.config` shows `loopProgressAware: true` in all 3 traces, so the switch reached the kernel. The mechanism was armed and never reached.

## Why it did not fire

2f acts only on a **second** pattern-(a) loop verdict that follows ledger progress (see the reach note in `loop-progress.ts`, ce8eaa7a8). In every pilot run the first loop verdict used up the shared deny-once nudge. The next soft exit then came from **`dispatcher_early_stop`**, not from a second loop verdict, so the gate accepted or handed it off and the run ended. 2f had nothing to act on.

**The motivating shape no longer reproduces at HEAD.** Here are the same task and tier at `94f0c9ea5` (the default arm, traces under `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-94f0/traces-cogito-8b/`):

| SHA | Runs | Runs with 2 loop verdicts |
|---|---|---|
| `94f0c9ea5` (motivating) | 5 | 3 (runs 1, 3, 4) |
| `9ae6a59ff` (this pilot, a1) | 3 | 0 |

Something changed between the two SHAs, and now the dispatcher early-stop proposes its exit before a second loop verdict can fire. The likely cause is the exit-gate / guard-event work in 70360971b or the guard ordering under Plan 8. This pilot does not attribute the change. The defect 2f was built for (a second loop verdict ending a run with work outstanding) may have moved to a different guard. On this evidence the remaining failure surface is `dispatcher_early_stop` ending a run with 1 to 4 of 6 files still outstanding.

## Gate

Not run. The brief's rule is: if the pilot shows 0 activations, stop. A booked line would be `rax eval gate ... --activations 0`, which books void-no-activation (37064b6aa). The ledger was not written. The parent or harness-warden books it.

## Recommendation

- **2f stays OPT-IN.** Two suites have now shown 0 activations (0/38 on `h3-lh`, 0/3 here).
- **Do not run a third 2f ablation until a trace shows a second loop verdict at HEAD.** A cheap check: scan existing default-arm H3 traces at the current SHA for runs with 2 or more `loop_resolution` events. Find none, and 2f is unreachable on today's guard ordering. Then it is a candidate for removal under the Anti-Scaffold Principle (kernel-warden's call, not a gate verdict).
- **kernel-warden / harness-warden:** look at `dispatcher_early_stop` firing right after a denied loop verdict while outputs are still outstanding. That is the surface where the motivating loss now occurs. If 2f's idea (progress since the last soft exit means continue) is right, it may belong in the exit gate's shared deny logic and not in the loop-specific branch. That would also cover the "exit from another guard" case that the 2f docstring already says it misses.

## Method notes

- `run-h3.ts` accepts `--arm` only with `--suite long-horizon`, so it cannot put 2f on the frozen H3 task `h3-todo-heavy`. A thin driver outside the repo (`/home/tylerbuell/.claude/jobs/eaddf328/tmp/ablate-2f-rerun/run-arm.ts`) calls the exported `runH3`. For a1 it sets the exported `H3_NO_SWITCH_VARIANT` slot to `{ tools: true, reasoning: true, harness: { loopProgressAware: true } }` (variant id `ra-default+2f`) and passes `noSwitch: true`. a0 would be the unchanged `H3_VARIANT`. The arms differ only in `config.harness`. No package source was edited.
- The cell timeout was 150 s (the H3 default) and the chunk ran under `timeout 590`, in the foreground. All 3 cells finished in 11 to 15 s.
- Shared Ollama: `bonsai-2:27b` was resident at the start. This warden did not load it and did not touch it.

## Artifacts

- Results: `results-cogito_8b-a1.json` (this dir)
- Traces: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/ablate-2f-rerun/traces/cogito_8b/ra-default_2f/h3-todo-heavy/run{0,1,2}/`
- Driver and activation counter: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/ablate-2f-rerun/{run-arm.ts,activations.ts}`
