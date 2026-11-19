---
type: experiment
status: pre-registered
created: 2026-11-18
tags: [zoo, live-validation, predictions, refusal-refund, pending-write, suite-v2, h3]
---

# Refusal refund + write-after-paired-read + suite-v2 pilot: pre-registered predictions (addendum 7)

Written BEFORE any live cell. PREDICTIONS.md through -6 unchanged.

Build: HEAD `41830f49a703`. Contains `57d8f073b` (an all-refused duplicate round does not spend iteration budget, bounded to 3 in a row) and `777abc4d2` (refuse a write whose paired input is read in the same round). Working tree: only the benchmarks sim shape/test edit (`pending-write.ts`, `shape-pending-write.test.ts`). `packages/reasoning/dist/index.js` sha256 `d75dbf0fdd3f1cb0132cbd7c229e8c5a063e504728412aa152125f242738a0a2`, contains `refusal_refund` (1). Sim/bench resolve reasoning from `src` (sim header: "kernel source: packages/reasoning/src last changed at 41830f49a (HEAD 41830f49a), clean"). Single supervisor. Cell timeout 180 s (todo-heavy, exact-value), 300 s (suite-v2 pilot and its rw-2 control; same on both arms). Env `RA_ACT_OR_ANSWER=0 RA_LEAN_FINAL_TURN=0 RA_PARALLEL_TOOL_HINT=0`, default arm, runner `src/spikes/h3-extra-tiers.ts`.

DEVIATION recorded: `ollama ps` is NOT clean. `mimo-v2.6:latest` (6.7 GB, llamacpp, 100% GPU) is loaded by a process outside this mission (a dev stack, `server/index.ts`, is running); it is not mine to stop. Specs use `allowContention: true`. Latency may rise; a timeout rise on one tier is read as contention before it is read as a harness effect.

Zero-token precursor: shape 9 updated. `pending-write-stubborn-cap14` now completes all six exact at the live cap 14 (more think turns than the cap: only the refund buys them); new `pending-write-endless-reread` (30 re-reads) ends within cap + 3 refunds with out-6 unwritten (the 3-refund bound holds). Sim test 4/4 pass.

## Part 1: cogito:8b, default arm

Baseline (addendum 6, `132ae5515`): h3-todo-heavy 1/10; cause A 2, cause E 3 (runs 4, 6, 8), cause B 2 (runs 0, 5), C/D 2; E+B = 5 runs.

| Cell | k | Baseline | Predicted |
| --- | --- | --- | --- |
| h3-todo-heavy cogito:8b | 10 | 1/10 | solved 2-5/10 (point guess 3); cause E runs 0-1; cause B runs 0-2; refusal_refund granted in 4-8 runs |
| h3-exact-value cogito:8b | 5 | 5/5 | >= 4/5 |
| h3-todo-heavy gemma4:e4b | 5 | 5/5 | >= 4/5 |

Classification as in addendum 6 (from `file-read`/`file-write` order and write contents): A lag, B placeholder/dependent write in one batch, C write before read, D arithmetic on derived output, E iteration budget (all written values correct, last pair missing at max_iterations). Refunds counted from `refusal_refund` guard events in the trace.

### Decision rule (todo-heavy, cogito; from the brief)

- Confirmed: solved >= 3/10 AND (E + B runs) <= 2 of 10.
- Refuted: otherwise.
- If E+B <= 2 but solved < 3, "mechanically confirmed, not sufficient": rank the remaining causes (A, C, D) with zero-token shapes.
- If solved <= 3/10 after this cycle, rank remaining causes and state whether to stop iterating on this task.

No-regression: exact-value >= 4/5 and gemma todo-heavy >= 4/5; below that is flagged, failing runs read before attribution.

## Part 2: suite-v2 pilot (lever pilot, plan section A3; gate pre-registered in `wiki/Planning/Implementation-Plans/2026-11-19-suite-v2-and-headline-measurement.md` line 62 and checklist line 249)

Cells: cogito:8b and qwen3:4b, tasks `rw-2-calc`, `rw-3-calc`, `h3-plan-only-calc`, k=5, default arm. Control: frozen `rw-2` k=5 on the same SHA (lever A/B), both tiers.

Frozen baselines (v0.19, default arm, no lever): cogito rw-2 floor, rw-3 4/10, plan-only floor; qwen3:4b rw-2 floor, rw-3 2/10.

Gate (verbatim from the plan): keep the v2 tasks only if the lever visibly engages (a `code-execute` call before the figure write in at least a third of runs, read from `tool-call-start` events) AND at least one task leaves the floor. If `rw-2-calc` stays 0/5 with `code-execute` called, the failure is the second step (spotting the stock-out), not arithmetic; the task is kept but classified "floor" and does not count toward discriminative power. Checklist: `code-execute` engaged on at least a third of runs on at least one calc task, else the calc tasks are kept but labelled floor.

Operationalisation (fixed now): a run "engages" if it has >= 1 `tool-call-start` for `code-execute` BEFORE the first `file-write` of the figure (for tasks with no file-write: before the final answer). Engagement rate = engaged runs / runs, per task per tier. "Leaves the floor" = a calc task with >= 1/5 solved on a tier where its frozen source task is at floor, or a >= 2-run gain over the frozen source on a non-floor task. Approval blocking: a `code-execute` call whose result is an approval-required/denied/blocked error.

Predictions: engagement >= 1/3 on at least one calc task on at least one tier (cogito: 60% credence; qwen3:4b: 50%); approval blocks code-execute in 0 runs (70% credence; if it does, the lever is not reaching the model and that is the finding); at least one calc task leaves the floor: 40% credence; `rw-2-calc` 0-1/5 on both tiers (the second step is the known open problem). Verdict words: lever engaged / not engaged; tasks kept / kept-as-floor.

Power: k=10 Bernoulli SE 13-15pp, k=5 SE ~20pp; one model per family. No KEEP claims; verdict words confirmed / refuted / underpowered.
