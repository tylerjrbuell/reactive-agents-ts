---
type: experiment
status: complete
created: 2026-11-06
tags: [harness, h3, targeted-rerun, tool-gate, refusals, loop-detector]
---

# Targeted H3 at 94f0c9ea5: h3-todo-heavy and rw-7 (2026-11-06)

Targeted rerun of the two cells hit by the 6a6a defect: a gate refusal was counted as a tool failure, and required calls were deferred one per turn. Fix under test: `94f0c9ea5` (a gate refusal is not a tool failure; required calls run the same turn). It also carries `2e4cfe86d` (maxCallsPerTool on the run envelope) and `26647f27b`; neither sets a cap by default.

Setup: tasks `h3-todo-heavy,rw-7`, k=5, qwen3:4b then cogito:8b (tiers in sequence, never in parallel). Runner flags match 6a6a: `--k 5 --budget-sec 560 --cell-timeout-sec 150`. Run from the isolated worktree `wt-h3`. HEAD was `94f0c9ea5` at start and end. The lockfile did not change since 6a6a. `@reactive-agents/reasoning` was rebuilt and resolved inside the worktree. Chunks: qwen 2, cogito 1. All 20 cells were measured, with no timeouts.

Before = `2026-11-06-6a6a-batch-full-h3` (same cells only). Results: `results-qwen3-4b.json`, `results-cogito-8b.json`. Traces stay in scratch: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-94f0/traces-*`. Ledger entry 25.

## Verdict (verbatim)

```
INERT · harness:tool-call-dropped 6→0 · pass 0/20 → 5/20 (+25pp, within noise) · mechanism tool-gate fired 12/20 → 0/20 (never ran: no delta is creditable to it); new harness reasons: harness:premature-stop 0→2, harness:loop-after-work 0→3
  activity changed: guard:tool-gate:block 12/20→0/20; guard:dispatcher_early_stop:terminate 10/20→3/20; guard:exit_gate:block 11/20→6/20; guard:loop_resolution:terminate 2/20→5/20; guard:deliverable_decision:block 11/20→9/20; guard:exit_gate:terminate 11/20→9/20
```

The `INERT` label does not mean the fix did nothing. The fix removes the tool-gate deferral, so the `--mechanism tool-gate` key cannot fire after it. Read the verdict as follows: the targeted reason went 6 to 0, and the gate block went 12 to 0. The pooled pass gain (+25pp) is within noise because the Wilson intervals overlap. The per-tier qwen todo-heavy result (0/5 to 5/5) is disjoint: 0-43% vs 57-100%.

## Results

| tier | task | before (6a6a) | after (94f0) | tokens before → after | cause labels (after) |
|---|---|---|---|---|---|
| qwen3:4b | h3-todo-heavy | 0/5 | **5/5** | 20707 → 17934 | none:3, success-with-warning:2 |
| qwen3:4b | rw-7 | 0/5 | 0/5 | 13911 → 16384 | wrong-answer:5 |
| cogito:8b | h3-todo-heavy | 0/5 | 0/5 | 10260 → 11823 | loop-after-work:5 |
| cogito:8b | rw-7 | 0/5 | 0/5 | 12184 → 11855 | verifier-reject:4, wrong-answer:1 |

Counts per tier (runs, before → after):

| | qwen3:4b | cogito:8b |
|---|---|---|
| guard:tool-gate:block | 9/10 → 0/10 | 3/10 → 0/10 |
| guard:dispatcher_early_stop:terminate | 6/10 → 1/10 | 4/10 → 2/10 |
| harness:tool-call-dropped | 2 → 0 | 4 → 0 |
| guard:loop_resolution:terminate | not changed | 2/10 → 5/10 |

Expectations from the brief:
- todo-heavy recovers toward the a698 5/5 (qwen): **yes**, 5/5.
- rw-7 no longer early-stopped: **yes**. qwen rw-7 has 0 early stops and 0 gate blocks in all 5 runs. Every run executed all its fix writes (3, 3, 3, 3, 6). Pass stays 0/5 because the written content is wrong. rax-diagnose attributes all 5 to `model:had-evidence-wrong-output` (decisive). Finding 2 of the 6a6a report is resolved: the defect was masking a model failure, not a pass.

## rax-diagnose attribute --all

- qwen3:4b: 10 runs, 5 failed. harness=0, model=5. All 5 are `model:had-evidence-wrong-output` (rw-7).
- cogito:8b: 10 runs, 10 failed. harness=5, model=5. rw-7: `model:ignored-guidance` 4, `model:had-evidence-wrong-output` 1. h3-todo-heavy: `harness:loop-after-work` 3, `harness:premature-stop` 2.

## Finding: cogito h3-todo-heavy ends on the local-tier loop detector

cogito emits one `file-write` per turn and re-reads the source file between writes. Two identical `file-read` calls in a row trip loop pattern (a), `sameToolCallRun 2/2`. The local-tier threshold is 2 (`packages/reasoning/src/kernel/loop/runner-helpers/tier-guards.ts:42`, `maxSameToolDefault: 2`). The check is `packages/reasoning/src/kernel/capabilities/reflect/loop-detector.ts:156-169`. `loop_resolution` then terminates through harness synthesis, while writes are still making progress.

- runs 1, 3, 4: terminated at 3, 5 and 3 of 6 artifacts (`guard-fired#933`, `#2096`, `#2570`).
- runs 0, 2: reached iteration 13/14 with 5 of 6 written. The run stopped before `out-6.txt` (`harness:premature-stop`). The one-write-per-turn pace plus re-reads used up the iteration budget.

This was 0/5 before too (verifier-reject 3, loop-after-work 2), so it is not a regression from 94f0. It is the next harness reason on this cell. Pattern (a) looks only at the last N actions. It does not consider that distinct writes landed between the repeats. A redundant re-read during progress is model thrash, but ending the run for it at N=2 throws away the work in progress. This is a candidate for its own cycle and is not part of this fix.

## Next (one per cycle)

1. Keep 94f0. It removes the targeted defect on both tiers. qwen todo-heavy has a disjoint recovery. No harness reason rose on qwen.
2. Candidate for the next cycle (kernel-warden): loop pattern (a) at the local-tier threshold 2 terminates runs that are still producing artifacts. Option: count an identical repeat as a loop only if no new artifact or evidence landed since the first call. Verify with a targeted rerun, `--task h3-todo-heavy` on cogito:8b plus qwen3:4b as a guard, `verdict.ts --reason harness:loop-after-work`.
