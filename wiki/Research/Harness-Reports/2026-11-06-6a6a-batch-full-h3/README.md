---
type: experiment
status: complete
created: 2026-11-06
tags: [harness, h3, plan-9, after-measurement, diagnosis, tool-gate, refusals]
---

# H3 after the Plan 9 batch, at 6a6a7f4d5 (2026-11-06)

Full H3 run: 12 tasks, k=5, qwen3:4b + cogito:8b. Runner flags match 77b6 (`--k 5 --budget-sec 560 --cell-timeout-sec 150`, one `--out` per tier). Run from the isolated worktree `wt-h3` at `6a6a7f4d5`. HEAD stayed fixed for all 120 cells (checked at start and end), and both results files record `gitSha 6a6a7f4d5`. `@reactive-agents/reasoning` resolved inside the worktree. The lockfile did not change since 77b6.

Before = the 77b6 run (`2026-11-05-77b6-phase1-close-full-h3`, 62/120). This is an after-measurement, not a new baseline. Results: `results-qwen3-4b.json`, `results-cogito-8b.json`. Traces stay in scratch: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-6a6a/traces-*`. Ledger entry 24.

Commits under test since 77b6: `0c8a20027` (one assessment per pass), `7e69360e7` (recovery steering reads run-wide evidence), `3231565a8` (runaway retry with thinking off), `3864c1bd5` (2d: one compact-and-retry on overflow), `77a526dd4` (Ollama stream honors maxTokens), `6a2b76c47` (2b: final answer is an exit proposal), `af2515de0` (auto per-tool call budget dropped), `dce77b195` (every refused call answered), `6a6a7f4d5` (trace: an answered refusal is not a dropped call), plus simplicity cleanups.

Verdict line (verbatim):

```
SHIFTED · harness:tool-call-dropped 8→6 · pass 62/120 → 63/120 (+1pp, within noise) · mechanism tool-gate fired 0/120 → 16/120; new harness reasons: harness:stall-after-work 3→4, harness:evidence-truncated 0→1
  activity changed: guard:tool-gate:block 0/120→16/120; guard:dispatcher_early_stop:terminate 5/120→13/120; guard:terminal_decision:terminate 113/120→119/120; requirement:question-answered@floor 113/120→119/120; requirement:tool-coverage@required-tools 113/120→119/120; guard:loop_resolution:terminate 13/120→7/120
```

## Results

| | Before (77b6d6122) | After (6a6a7f4d5) |
|---|---|---|
| pass, both tiers | 62/120 | 63/120 (+1pp, within noise) |
| qwen3:4b | 36/60 (mean 8410 tok) | 37/60 (mean 10751 tok, +28%) |
| cogito:8b | 26/60 (mean 6301 tok) | 26/60 (mean 6092 tok) |
| harness:tool-call-dropped | 8 | 6 |
| qwen environment:run-aborted (cell timeouts) | 7 | 1 |
| no-trace cause labels (chunk logs, both tiers) | 7 | 1 |
| verifier-reject cause labels (both tiers) | 6 | 17 |
| guard:dispatcher_early_stop:terminate | 5/120 | 13/120 |

Expectations from the brief:
- qwen h3-todo-heavy back to ~5/5: **no**, it is 0/5 on both tiers. See finding 1.
- tool-call-dropped back near 1: **partly**, 8 to 6. All 6 are h3-todo-heavy and share the finding-1 mechanism.
- fewer qwen cell timeouts: **yes**, 7 to 1.
- runaway-exhausted replacing timeouts: **no**. No trace contains it.
- 2b adding turns/tokens: qwen mean tokens +28%. qwen h3-todo-heavy went 10889 to 20707 and cogito rw-3 went 6496 to 15461. Not isolated to 2b; this run cannot separate the commits.

## Per-task table (after)

| tier | task | solved | rate | Wilson 95% | pass^5 | tokens | LLM calls | dur | cause labels |
|---|---|---|---|---|---|---|---|---|---|
| qwen3:4b | rw-2 | 0/5 | 0% | 0%-43% | 0.00 | 25023 | 5.8 | 76s | stall-after-work:3,wrong-answer:1,loop-after-work:1 |
| qwen3:4b | rw-3 | 0/5 | 0% | 0%-43% | 0.00 | 11522 | 3 | 45s | wrong-answer:5 |
| qwen3:4b | rw-6 | 3/5 | 60% | 23%-88% | 0.00 | 9542 | 3 | 48s | verifier-reject:3,wrong-answer:2 |
| qwen3:4b | rw-7 | 0/5 | 0% | 0%-43% | 0.00 | 13911 | 3.8 | 78s | wrong-answer:3,verifier-reject:1,no-trace:1 |
| qwen3:4b | rw-9 | 5/5 | 100% | 57%-100% | 1.00 | 7990 | 4.2 | 31s | none:2,success-with-warning:2,loop-after-work:1 |
| qwen3:4b | ab-trap-4 | 5/5 | 100% | 57%-100% | 1.00 | 0 | 0 | 0s | unexplained:5 |
| qwen3:4b | ab-trap-5 | 5/5 | 100% | 57%-100% | 1.00 | 4705 | 3.8 | 20s | unexplained:5 |
| qwen3:4b | h3-plan-only | 4/5 | 80% | 38%-96% | 0.00 | 24519 | 9.4 | 78s | none:4,wrong-answer:1 |
| qwen3:4b | h3-todo-heavy | 0/5 | 0% | 0%-43% | 0.00 | 20707 | 5.8 | 76s | wrong-answer:3,verifier-reject:2 |
| qwen3:4b | h3-required-tools | 5/5 | 100% | 57%-100% | 1.00 | 9978 | 4.6 | 38s | none:5 |
| qwen3:4b | h3-continuation | 5/5 | 100% | 57%-100% | 1.00 | 1620 | 2 | 6s | none:5 |
| qwen3:4b | h3-exact-value | 5/5 | 100% | 57%-100% | 1.00 | 2280 | 2 | 9s | none:5 |
| cogito:8b | rw-2 | 0/5 | 0% | 0%-43% | 0.00 | 9843 | 5.6 | 22s | stall-after-work:2,wrong-answer:2,verifier-reject:1 |
| cogito:8b | rw-3 | 0/5 | 0% | 0%-43% | 0.00 | 15461 | 7.2 | 30s | wrong-answer:3,verifier-reject:1,unexplained:1 |
| cogito:8b | rw-6 | 3/5 | 60% | 23%-88% | 0.00 | 7122 | 5.8 | 34s | verifier-reject:2,wrong-answer:1,success-with-warning:1,none:1 |
| cogito:8b | rw-7 | 0/5 | 0% | 0%-43% | 0.00 | 12184 | 9.4 | 33s | verifier-reject:4,wrong-answer:1 |
| cogito:8b | rw-9 | 3/5 | 60% | 23%-88% | 0.00 | 4603 | 4.6 | 14s | none:3,wrong-answer:1,unexplained:1 |
| cogito:8b | ab-trap-4 | 5/5 | 100% | 57%-100% | 1.00 | 0 | 0 | 0s | unexplained:5 |
| cogito:8b | ab-trap-5 | 5/5 | 100% | 57%-100% | 1.00 | 1367 | 3.4 | 5s | unexplained:4,tool-failure:1 |
| cogito:8b | h3-plan-only | 0/5 | 0% | 0%-43% | 0.00 | 4819 | 4.8 | 13s | wrong-answer:5 |
| cogito:8b | h3-todo-heavy | 0/5 | 0% | 0%-43% | 0.00 | 10260 | 8.8 | 16s | verifier-reject:3,loop-after-work:2 |
| cogito:8b | h3-required-tools | 0/5 | 0% | 0%-43% | 0.00 | 4321 | 5.6 | 12s | wrong-answer:4,never-engaged:1 |
| cogito:8b | h3-continuation | 5/5 | 100% | 57%-100% | 1.00 | 1354 | 2.4 | 5s | none:5 |
| cogito:8b | h3-exact-value | 5/5 | 100% | 57%-100% | 1.00 | 1767 | 2.6 | 6s | none:5 |

## rax-diagnose attribute --all

- qwen3:4b: 60 runs, 26 failed. harness=5, model=20, environment=1. Reasons: had-evidence-wrong-output 13, fabrication-vetoed 7, stall-after-work 3, tool-call-dropped 2, run-aborted 1.
- cogito:8b: 60 runs, 35 failed. harness=6, model=27, unattributed=2. Reasons: had-evidence-wrong-output 14, fabrication-vetoed 8, tool-call-dropped 4, ignored-guidance 4, stall-after-work 1, evidence-truncated 1, never-engaged 1.

## Findings

### 1. A deferred required call is counted as a tool failure, and the run is stopped before the deferral is honored (10/120 runs, both tiers)

Mechanism, in order:
1. `file-write` is not parallel-batch-safe (`packages/reasoning/src/kernel/capabilities/decide/tool-gating.ts:255`). Each write is its own batch.
2. The gate runs only `requiredBatches[0]` per turn. It refuses the rest with "one batch of required-tool calls runs per turn. Call it again next turn." (`tool-gating.ts:404-407`).
3. Since `dce77b195` each refusal is answered as a `tool_result` with `isError: true` (`packages/reasoning/src/kernel/capabilities/decide/tool-call-refusals.ts:153`).
4. The streak counter treats every error `tool_result` as a failure of that tool (`packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:239-248`). N deferred writes become an N-long failure streak.
5. `tool-failure-streak` fires (`packages/reactive-intelligence/src/controller/evaluators/tool-failure-streak.ts:16`). The dispatcher early-stops with `"file-write" failed N times; redirect nudge was ignored`. That happens in the same turn the model was told to call again next turn.

Trace example (qwen h3-todo-heavy run1, `01M6Q3F6Z90Q97DB1C4JMAG9S2`):
- seq 189: the model emits all 6 correct writes.
- seq 195-199: 5 deferrals.
- seq 210: out-1 is written.
- seq 212-214: `tool-failure-redirect` fires, then `dispatcher_early_stop`.
- seq 223: the model re-emits the 5 writes. They never run (seq 233).
- seq 270: harness handoff, score 0.167.

The same pattern hits qwen rw-7 (all 5 runs: 3 fix writes, 1 runs, 2 deferred, early stop, score 0.33), qwen todo-heavy runs 1-2 and cogito todo-heavy runs 1, 3 and 4.

This is a harness defect, not model behavior: the model emitted the right calls and the right values.

### 2. Instrument gap: rax-diagnose labels the rw-7 cases model

4 of the 5 qwen rw-7 runs score `model:had-evidence-wrong-output` or `model:fabrication-vetoed` at divergence seq 431/646. The real cause is that deferred writes were cut off by the early stop. The todo-heavy cases come out as `harness:tool-call-dropped` only because the model re-emitted the calls. So the harness share is undercounted: 11 attributed, at least 15 real.

### 3. The remaining h3-todo-heavy failures are model value errors

qwen runs 0, 3 and 4 wrote all six files with wrong values (run0: 34 in every file). They are correctly attributed to the model. They still churn through 13-22 gate deferrals each, which is likely part of the +88% token cost on that cell.

### 4. Watch item: verifier-reject 6 to 17

The rise is spread across rw-6, rw-7, rw-3 and todo-heavy. 2b (final answer as an exit proposal) is the likely contributor. This run does not isolate it.

## Next fix (one per cycle)

kernel-warden: a gate refusal must not count as a tool failure. The refusal answer needs to be distinguishable from a real tool error (for example a `refused` marker on the refusal `tool_result`), and `reactive-observer.ts:239-248` must skip it in the streak. Verify with a targeted rerun: `--task h3-todo-heavy,rw-7` on both tiers, `verdict.ts --reason harness:tool-call-dropped --mechanism tool-gate`.

Follow-up, not this cycle: whether a turn should run every deferred non-parallel-safe required call in sequence instead of one per turn. That would also cut the churn tokens.
