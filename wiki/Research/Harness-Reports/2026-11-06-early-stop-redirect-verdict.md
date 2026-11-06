---
type: experiment
status: complete
created: 2026-11-06
tags: [harness, h3, long-horizon, verdict, reactive-intelligence, early-stop, tool-failure-redirect, plan9]
---

# Live verdict: S2a near-cap early stop (78ac7bd79) and tool-failure redirect (fa3e33b7b)

Live before/after check of two RI fixes. Both fixes had only zero-token verification before this run. Code under test: `fa3e33b7b` (every result file records this `gitSha`). HEAD moved to `1887b4ba3` during the run. That commit is docs-only: `git diff fa3e33b7b 1887b4ba3 -- packages apps` is empty. `packages/**` stayed clean before every chunk.

Models: local Ollama `cogito:8b`, `qwen3:4b`. Each chunk ran in the foreground (`timeout 590`, `--budget-sec 560`). All 22 cells ran. None was inconclusive.

Artifacts (tmp, not committed): `/home/tylerbuell/.claude/jobs/eaddf328/tmp/verdict-s2a-redirect/`
- results: `h3-todo.json` (10 cells), `lh-cogito.json` (6), `lh-qwen.json` (6)
- activation counts: `analyze.ts` (zero tokens, reads trace JSONL) produces `act-{before,after}-*.jsonl`
- verdicts: `verdict-s2a.txt`, `verdict-s2b.txt`, `verdict-redirect.txt`; attribution: `attr-after-todo.txt`, `attr-after-lh.txt`

## Verdicts

| Fix | Activations | Outcome | Verdict |
|---|---|---|---|
| S2a: the near-cap early stop reads progress (`78ac7bd79`) | 2 inferred stand-downs (cogito), 0 "Approaching maxIterations" fires in 10 runs (before: 3/10) | `harness:premature-stop` 2→0, `harness:tool-call-dropped` 0→2. Solved count unchanged: cogito 0/5→0/5, qwen 5/5→5/5 | **No change (shifted).** The fix works, but the iteration cap drops the batch the extra turn produced |
| Redirect: nudge first (`fa3e33b7b`) | 1 run fired: 1 nudge, then 1 stop (before: 2 runs, 5 dispatches, all stops, 0 nudges) | Redirect-dropped batches 2→0. Solved count unchanged: 0/12→0/12 | **Partial activation, no measurable lift.** Nudge-first fired once. The escalation misfired on a turn with no tool call |
| Redirect: no stop on a switched batch (`fa3e33b7b`) | 0 (no run had a pending batch that dropped the failing tool after a streak) | n/a | **Void.** The mechanism never fired |
| S2b check: `loop_resolution` on cogito re-reads | terminate on re-read: 8 fires in 5/5 runs before, 0 after. Still fires as `block` in 3/5 runs | `harness:loop-after-work` 3→0 | **S2b is gone at HEAD as a run-ender.** Build nothing |

Noise: one run is a Bernoulli trial. k=5 per tier on h3-todo-heavy and k=3 per cell on long-horizon give a standard error of about 20-30pp on pass rate. No solved-count change in this run is distinguishable from noise. The mechanism-level evidence comes from per-trace timelines, not pass rates. The before arms are not the parent commit. The h3 before arm is `94f0c9ea5`, about 104 commits before `78ac7bd79`; it includes `3436229a0` and other changes. The LH before arm is `afbac9af7`. Cell-level deltas therefore mix every change in between. Only the activation timelines below tie a delta to a fix.

## Fix 1: S2a near-cap early stop (h3-todo-heavy, k=5 x 2 tiers)

Before: `wiki/Research/Harness-Reports/2026-11-06-94f0-targeted-h3/results-{cogito-8b,qwen3-4b}.json` (spike-pack cohort `94f0c9ea5`, the latest pre-`78ac7bd79` SHA with both tiers at k=5).

| Tier | Before solved / mean acc / mean tokens | After solved / mean acc / mean tokens |
|---|---|---|
| cogito:8b | 0/5 / 0.57 / 11,823 | 0/5 / 0.40 / 11,099 |
| qwen3:4b | 5/5 / 1.00 / 17,934 | 5/5 / 1.00 / 17,259 |

Activation (`act-before-todo.jsonl`, `act-after-todo.jsonl`):
- Before: "Approaching maxIterations" terminated 3/10 runs. Two were cogito failures at iter 13 of 14 with progress in 3 near-cap iterations: `01M6Q83PG3QMPENNYM5PBRY6Y5`, `01M6Q8783MNJRB0YX82W5NXX3T`. One was a qwen run that solved anyway (`01M6Q7QMTK8JGRMM0K45YJSAW9`).
- After: 0 fires in 10 runs. Two cogito runs reached iter 13 with evidenceDelta > 0 in 3 near-cap iterations: `01M6RJ8PPFT2YCG6QPDPHTTYBX` and `01M6RJAKMRK0NKA2ZP8YBFDQJC`. That is the same trajectory the before runs had, so the stand-down held. These 2 activations are inferred: the stand-down emits no event (see the instrument gap below). No qwen run reached the near-cap window (last iteration ≤ 11).

What happened in the activated runs: the fix bought one more think turn (iter 13). In both runs that think emitted the missing deliverable (`file-write out-6.txt`). The loop then exited on the cap before act ran: 14 think calls = `maxIterations` 14, and `runner.ts:739-744` checks `llmCalls < maxIterations`. The batch was dropped, the run ended `max_iterations`, and accuracy stayed 0.83 and 0.67. `rax-diagnose attribute` now tags both runs `harness:tool-call-dropped`. The stop moved from the RI early stop to the cap, and the extra think costs tokens without effect. The two cogito runs at accuracy 0.00 (`01M6RJCATQEEC7JDEJVGBFMAY8`: end_turn at it=3; `01M6RJJZNA4RDWAQ7W1MR8YEW5`: stall at it=5) never reached the near-cap window, so S2a played no part in them.

`h3/verdict.ts` reports: `INERT · harness:premature-stop 2→0 · pass 5/10 → 5/10 · mechanism dispatcher_early_stop fired 3/10 → 0/10 · new harness reasons: harness:tool-call-dropped 0→2`. INERT here is an instrument artifact: the fix is a suppression, and a suppression shows up only as a missing fire.

### S2b at HEAD (same cohort)

Before (all 5 cogito runs predate `3436229a0`): `loop_resolution` `repeated-tool-call` on `file-read` re-reads, terminate in 5/5 runs (8 fires). After: it fires on `file-read` re-reads in 3/5 cogito runs, every time as `block` (the exit gate denies it and the run continues). One run ended on `loop_resolution` terminate, on a repeated `file-write`, not a re-read (`01M6RJGMDEZQR03CMQ96HP38ZG`, acc 0.50). `verdict.ts`: `SHIFTED · harness:loop-after-work 3→0`. The re-read termination from the spike pack does not reproduce at HEAD. Do not touch `loop-detector.ts`. The data cannot say which of the ~104 intervening commits removed it.

## Fix 2: tool-failure redirect (long-horizon lh-pipeline-stages + lh-1, k=3 x 2 tiers)

Before: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/lh-a0/results.json` (A0, `afbac9af7`, the matching 12 cells). Cell timeout: cogito 240 s in both arms. qwen ran at 240 s before and 360 s after, per the brief. Neither arm had a timed-out cell.

| Cell | Before solved / acc / mean tokens | After solved / acc / mean tokens |
|---|---|---|
| cogito lh-1 | 0/3 / 0,0,0 / 43,520 | 0/3 / 0,0.11,0 / 46,148 |
| cogito lh-pipeline-stages | 0/3 / 0,0.10,0.10 / 15,218 | 0/3 / 0.10,0,0.10 / 14,946 |
| qwen lh-1 | 0/3 / 0.11 x3 / 57,772 | 0/3 / 0.11,0,0.11 / 69,828 |
| qwen lh-pipeline-stages | 0/3 / 0.20 x3 / 29,869 | 0/3 / 0.20 x3 / 19,762 |

Activation (`act-before-lh.jsonl`, `act-after-lh-{cogito,qwen}.jsonl`):

| | Before (12 runs) | After (12 runs) |
|---|---|---|
| Runs where the redirect fired | 2 (both cogito) | 1 (qwen) |
| Dispatches: nudge / early-stop | 0 / 5 | 1 / 1 |
| Run-ending redirect stops | 2 | 1 |
| Batches dropped by a redirect stop | 2 (`01M6REXPKJXWABQ9WB081BTBCR`: 4 file-writes + recall after file-read failures; `01M6RFRCKH4284VV2GYBDV0WAA`: same-tool file-write) | 0 |
| Switched-batch stand-down | n/a | 0 activations |

In the after arm, cogito had no failing-tool streak at all: 1 of 6 runs had any tool failure, and those failures were not consecutive in one tool. The model behaved differently on this sample, so the before arm's 2 drops cannot be credited to the fix.

The one after-arm fire (`01M6RKA3KHF937NA4QV45HWMZR`, qwen lh-pipeline-stages r0) went like this. Two `file-write pipeline.json` calls failed (iters 3-4). Iter 5 dispatched `append-system-nudge`, which confirms nudge-first live. The iter 5 think made no tool call; the model complied. At iter 6 the evaluator fired again anyway and escalated to `early-stop`: `"file-write" failed 2 times; redirect nudge was ignored`. The stop's claim is false. Cause: `pendingToolNames` is omitted when the batch is empty (`reactive-observer.ts:285`), and the evaluator stands down only when the field is defined (`tool-failure-streak.ts:25`). A turn with no tool call therefore looks like "still calling the failing tool". Harm in this run was small: the model was already trying to end (the exit gate blocked `end_turn` at iter 6), and accuracy stayed at 0.20 like the other qwen cells. The terminal reason is wrong, though (`dispatcher_early_stop` instead of `end_turn`).

`h3/verdict.ts`: `SHIFTED · harness:tool-call-dropped 2→1 · pass 0/12 → 0/12 · mechanism dispatcher_early_stop fired 2/12 → 1/12 · new harness reasons: harness:stall-after-work 0→1`. The one remaining `tool-call-dropped` is a different mechanism (next section). After-arm attribution (`attr-after-lh.txt`): model 10/12, harness 2/12.

## New finding: a terminate after think drops the pending batch (3 sites)

Across this run, the same defect class appears at three terminate sites. Each time, a terminate fires between think and act, and the batch the model just emitted never runs:

1. **Iteration cap**: 2 runs, both S2a activations. `packages/reasoning/src/kernel/loop/runner.ts:739-744` exits the loop when `llmCalls` reaches `maxIterations` after a think, before act. `packages/reasoning/src/kernel/loop/exit-gate.ts:600-632` (`proposeCapExit`) then hands off. The paid-for think's `file-write` is discarded.
2. **switching_exhausted**: 1 run (`01M6RJS0XDX5YDS9TRXFRB6RQ1`, cogito lh-pipeline-stages). RI `switch-strategy` fired with switching off. `packages/reasoning/src/kernel/loop/turn-guard-operations.ts:343` proposed `switching_exhausted`, and the exit gate accepted it right after a think whose batch was `file-write report.md`. That batch was the corrective step after repeated `pipeline.json` reads.
3. **tool-failure redirect**: before `fa3e33b7b`. That commit fixed it inside the one handler (`pendingToolNames`).

This is the second instance of the class after the redirect fix. Per the boundary-first rule, fix it at the boundary, not with a fourth per-site guard. Candidate: the terminal path (exit gate / loop guard) runs or accounts for a pending native tool batch (`state.meta.pendingNativeToolCalls`) before it accepts a non-hard terminate. For the cap, the alternative is to stop issuing a think whose batch can never run. That design choice belongs to the kernel warden. Spike first: count pending-batch-at-terminate across the 930-trace spike corpus before building.

## Instrument gaps

- The S2a stand-down emits no event (`packages/reactive-intelligence/src/controller/early-stop.ts:75` returns `null`). `verdict.ts` therefore calls the fix INERT, and activation can only be inferred from the near-cap trajectory. A suppression needs a traced "stood down (progress)" decision to be gate-countable under the Plan 9 rule.
- `verdict.ts --mechanism tool-failure-redirect` matches nothing. The redirect is visible only as `intervention-dispatched` / `decision-evaluated` with `decisionType`, which the activity keys do not include. I used `dispatcher_early_stop` as a proxy.

## Next actions (pending approval)

1. kernel-warden: one boundary fix for "terminate drops the pending batch" (anchors above). Spike the trigger frequency first.
2. reactive-intelligence owner (kernel-warden, per `de98ef141`): make the redirect evaluator stand down on a no-tool turn (`tool-failure-streak.ts:25`, `reactive-observer.ts:285`). Pass an explicit empty `pendingToolNames` (or a `thinkHadNoToolCalls` flag), so that "no batch" is not read as "unknown". Small and pinned by the one live misfire.
3. reactive-intelligence: trace the S2a stand-down as a decision event.
4. After (1), re-run this probe at the same cells. S2a can show lift only once the cap stops dropping its extra turn.
