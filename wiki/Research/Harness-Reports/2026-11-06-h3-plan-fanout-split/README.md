---
type: harness-report
status: complete
created: 2026-11-06
tags: [h3, plan-execute, plan-fanout-split, bonsai, verdict]
---

# H3 targeted rerun: plan-fanout-split (af71e15b3) on h3-plan-only

Mechanism under test: `splitFanOutProducers` (`packages/reasoning/src/strategies/planning/fanout-split.ts`). At plan validation it gives each producer step one copy per distinct whole-output file target. It emits `guard-fired{guard:"plan-fanout-split", outcome:"redirect"}`. It targets the bonsai H3 defect from ledger entry 26: 5/5 h3-plan-only failures.

## Activation (read first)

| Tier | Runs | `guard:plan-fanout-split:redirect` fired |
|---|---|---|
| bonsai-2:27b | 3 | **3/3** |
| qwen3:4b | 3 | 0/3 |
| cogito:8b | 3 | 0/3 |

The mechanism ran only where the planner fanned out (bonsai). The qwen3:4b and cogito:8b planners emitted one analysis step per file in all 6 runs. So the split had nothing to do there.

## Setup

- Code: dev HEAD `d864d50a3` (contains `af71e15b3`), isolated worktree `/home/tylerbuell/.claude/jobs/eaddf328/tmp/wt-h3`. The main checkout had uncommitted reasoning/core/trace WIP, so it was not used. `@reactive-agents/reasoning` dist was rebuilt in the worktree. The dist contains the guard.
- Flags: `--task h3-plan-only --k 3 --budget-sec 585 --cell-timeout-sec 150 --start-margin-sec 100`. Cell cap matches the baselines.
- Baseline arm: no toggle exists for the split (it is unconditional in `repairGeneratedPlan` / blueprint). The before-arm is therefore the prior results: bonsai `2026-11-06-bonsai-27b-full-h3` at `b52d3f9f5` (ledger entry 26), and qwen3:4b/cogito:8b `2026-11-06-6a6a-batch-full-h3` at `6a6a7f4d5`.
- Confound: the before and after arms differ by every commit in between, including the Phase 4 typed-parts work, not only the split. For bonsai the attribution still holds: the guard fired in 3/3 runs, and each split plan wrote the correct per-file content. For the other tiers, nothing is attributable to the split.
- Ollama: no models resident at start. Tiers ran one at a time.
- Traces (local only): `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-fanout/traces-{bonsai,qwen3-4b,cogito-8b}/`.

## Verdicts (verbatim `h3/verdict.ts`, `--reason model:had-evidence-wrong-output --mechanism plan-fanout-split`)

The fan-out failures were labelled `model:had-evidence-wrong-output` in the baseline (entry 26 notes this undercounts harness). That label is the targeted reason here.

bonsai-2:27b:
```
FIXED · model:had-evidence-wrong-output 5→0 · pass 0/5 → 3/3 (+100pp, RESOLVABLE) · mechanism plan-fanout-split fired 0/5 → 3/3
  activity changed: guard:plan-fanout-split:redirect 0/5→3/3; guard:terminal_decision:terminate 5/5→3/3; requirement:artifact-produced@task-text 5/5→3/3; requirement:question-answered@floor 5/5→3/3; requirement:tool-coverage@required-tools 5/5→3/3
```

qwen3:4b + cogito:8b (regression guard):
```
INERT · model:had-evidence-wrong-output 6→4 · pass 4/10 → 1/6 (-23pp, within noise) · mechanism plan-fanout-split fired 0/10 → 0/6 (never ran: no delta is creditable to it)
```

Per tier: qwen3:4b `INERT · 1→1 · pass 4/5 → 1/3 (-47pp, within noise)`; cogito:8b `INERT · 5→3 · pass 0/5 → 0/3`.

Pooled, all 3 tiers (context only, not booked): `IMPROVED · 11→4 · pass 4/15 → 4/9 (+18pp, within noise) · fired 0/15 → 3/9`.

## Failures on the non-firing tiers (not the split)

`rax-diagnose attribute --all`: harness=0, model=4, environment=1.

- qwen3:4b run0: the plan had one producer per file. The analysis step returned the wrong low-stock list (it included SKU-024, and summary.md omitted it). Failed check: `low-stock.txt is exactly the sorted SKUs below 10`. This is model compute.
- qwen3:4b run2: timed out at 150 s (`environment:run-aborted`). The plan-execute `completeStructured` planning call ran 99 s and emitted 13855 output tokens before any step executed. This is a planner-call runaway, the same family as the bonsai thinking runaway (entry 26). It is a candidate for a separate pass, not this one.
- cogito:8b runs 0-2: correct plan shape. The analysis steps got `low-stock` and `totalUnits` wrong (score 0.667 every run). In run0 the planned `file-write` steps had no `path` arg. In run1 the plan called a non-existent `sort` tool. All three are model-level.

The qwen3:4b drop (4/5 to 1/3) is inside the noise band and has 0 activations, so it cannot be blamed on the split. One of its 3 cells is a timeout.

## Ledger

Entries 28 (bonsai, `fixed`, status `adopted`) and 29 (qwen3:4b + cogito:8b, `inert`) in `improvement-ledger.json`. Entry 27 is the loopProgressAware (2f) gate verdict, booked as `reject` by the gate and hand-marked `validity: void-no-activation` (fired 0/38). The ledger schema has no validity field (`packages/benchmarks/src/ledger.ts:67-86`).

## Next

- KEEP the split. It is decisive on the tier that fans out, and inert (harmless) on tiers that do not. Cross-tier evidence of *effect* exists on one tier only, because only one tier produces the shape.
- Candidate SELECT for a later pass: an output-token runaway on the plan-execute structured planner call (qwen3:4b run2). Confirm across more traces before acting.
