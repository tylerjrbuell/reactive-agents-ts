---
type: experiment
status: complete
created: 2026-11-05
tags: [harness, h3, plan-9, after-measurement, diagnosis, tool-budget]
---

# H3 after Plan 9 Phase 1 close, at 77b6d6122 (2026-11-05)

Full H3 run: 12 tasks, k=5, qwen3:4b + cogito:8b, cell timeout 150 s, same runner flags as the baseline (`--k 5 --budget-sec 560 --cell-timeout-sec 150`, one `--out` per tier). Run at `77b6d6122` from an isolated worktree. HEAD stayed fixed for all 120 cells, and both results files record that sha. `@reactive-agents/reasoning` resolved inside the worktree. Task hashes are identical to the baseline, so the grader did not change.

Before = the a698 baseline (`2026-11-05-a698-baseline-full-h3`, 64/120). This is an after-measurement, not a new baseline. Results: `results-qwen3-4b.json`, `results-cogito-8b.json`. Traces stay in scratch: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-77b6/traces-*`. Ledger entry 23.

Commits under test since a698: `1b08d6958` (evidence-staleness reads post-act progress), `301617e9f` (plan step held to its own tools; an abstained step fails), `3385baf59` (thinking runaway not retried at a bigger budget), `61843730d` and `54bfad4f6` (a repeat-call warning is not progress; a blocked call is not called), `0f9a7efff` and `77b6d6122` (run-wide tool evidence), plus the run-scope work (`fc99e0de9`, `d0a3b6503`) and the unified failure taxonomy (`37f00864c`).

Verdict line: `SHIFTED · harness:false-veto 3→1 · pass 64/120 → 62/120 (-2pp, within noise); new harness reasons: harness:stall-after-work 2→3, harness:tool-call-dropped 1→8`. The before count of false-veto is 3, not the 6 in the baseline README. The unified taxonomy (`37f00864c`) now labels the 3 rw-6 fabrication vetoes `model:fabrication-vetoed`, which fixes instrument finding 1 of the baseline.

## Results

| | Before (a698ff4cb) | After (77b6d6122) |
|---|---|---|
| pass, both tiers | 64/120 | 62/120 (-2pp, within noise) |
| qwen3:4b | 38/60 | 36/60 |
| cogito:8b | 26/60 | 26/60 |
| harness-attributed failures (verdict.ts, unified taxonomy) | false-veto 3, subpass-abstained 4, stall-after-work 2, tool-call-dropped 1 | false-veto 1, subpass-abstained 0, stall-after-work 3, tool-call-dropped 8 |
| tokens, qwen, completed runs (trace llm-exchange sum) | 527,924 (55 runs) | 504,579 (53 runs), -4.4% |
| tokens, qwen, all traces incl. timed-out | 615,458 | 642,883 (+4.5%) |
| tokens, cogito (trace llm-exchange sum) | 329,606 (59 runs); 362,963 incl. 1 timeout | 378,083 (60 runs, 0 timeouts), +4.2% on all traces |
| LLM calls per completed run, qwen | 4.22 (232/55) | 3.58 (190/53) |
| LLM calls per completed run, cogito | 4.85 (286/59) | 5.35 (321/60) |
| cell timeouts (environment:run-aborted) | qwen 5, cogito 1 | qwen 7, cogito 0 |

Token sums dedupe events by `seq`. This matters because timed-out traces write each event twice. Timed-out traces now carry their events, so the "all traces" rows include their spend. The completed-run rows match the baseline README's method.

Per task (solved/5, before → after):

| task | qwen3:4b | cogito:8b |
|---|---|---|
| ab-trap-4 | 5 → 5 | 5 → 5 |
| ab-trap-5 | 5 → 5 | 5 → 5 |
| h3-continuation | 5 → 5 | 5 → 5 |
| h3-exact-value | 5 → 5 | 5 → 5 |
| h3-plan-only | 0 → 4 | 0 → 0 |
| h3-required-tools | 4 → 5 | 0 → 0 |
| **h3-todo-heavy** | **5 → 0** | 0 → 0 |
| rw-2 | 0 → 0 | 0 → 0 |
| rw-3 | 0 → 0 | 0 → 0 |
| rw-6 | 5 → 2 | 2 → 2 |
| rw-7 | 0 → 0 (timeouts 5 → 3) | 0 → 0 (timeouts 1 → 0) |
| rw-9 | 4 → 5 | 4 → 4 |

The one change outside noise is qwen h3-todo-heavy, 5/5 → 0/5. The Wilson intervals are 57-100% and 0-43%, which are disjoint. qwen h3-plan-only 0 → 4 just overlaps (0-43% vs 38-96%). qwen rw-6 5 → 2 is inside noise: 2 reports miss the "asymptotic complexity" check (model content), and 1 run timed out.

## The three targeted defects

| defect | reason | before | after | evidence |
|---|---|---|---|---|
| H1: staleness veto reads a pre-act assessment (`1b08d6958`) | `harness:false-veto` | 3 (qwen rw-9 run1, run3; todo-heavy run2) | 1 | qwen rw-9 is 5/5 now. The only false-veto left is cogito h3-exact-value run3 (`01M6Q0KDR8HS4BWDG39KY0MAJC`). The grader passed it, but `stall_deliverable 4/4` then `output-is-model-authored` set the run status to failure. The cell still counts as solved. |
| H2: composite plan step inherits parent requiredTools (`301617e9f`) | `harness:subpass-abstained` | 4 | 0 | qwen h3-plan-only 0/5 → 4/5. The fifth run is a cell timeout: an 83 s planning call (`01M6PXNGSC1PRTZGZV5JBZ4ZFE`). |
| H3: max_tokens recovery escalates a thinking runaway (`3385baf59`) | qwen rw-7 cell timeouts | 5 | 3 | The retry no longer jumps to a 31k budget. It now runs at 7,200 and ends `end_turn` after 42-45 s. The time still goes to the first runaway, about 100 s at `tokensOut 13200` against `maxTokens 7200` (`01M6PXEKXN771DSXHVNWZQDJ5H` seq 69). See remaining defect 2. |

All three targets dropped. The verdict is SHIFTED, not FIXED, because `tool-call-dropped` rose from 1 to 8. That rise is a regression from `0f9a7efff`, ranked first below.

## Remaining harness defects (ranked by leverage, one decisive trace each)

1. **The auto per-tool budget now binds, and it refuses calls silently. h3-todo-heavy is unsolvable on both tiers (8 of 10 runs `harness:tool-call-dropped`; qwen 5/5 → 0/5).** `buildAutoMaxCallsPerTool` (`packages/runtime/src/engine/util.ts:206`) gives each required tool `minCalls + 2` calls per run. h3-todo-heavy declares `file-read` and `file-write` as required with no quantities, so each tool gets 3. The task needs 6 reads and 6 writes. Before `0f9a7efff`, the native-FC no-resolver fallback re-dispatched every call the gate had refused, so this budget never bound. `0f9a7efff` closed that bypass on purpose (`packages/reasoning/src/kernel/capabilities/reason/dispatch-think-response.ts:727`). The budget filter in `gateNativeToolCallsForRequiredTools` (`packages/reasoning/src/kernel/capabilities/decide/tool-gating.ts:291-297`) now drops calls with no `guard-fired` event and no observation for the model. The gate also keeps only `requiredBatches[0]` when it steers toward missing required tools (`tool-gating.ts:345`), and drops the rest of the batch silently too.
   - Qwen trace `01M6PXT79VR2F0WF7MFFE2TMP4` (run1). Iter 0: the model emits 6 reads, and 4 run (batch cap). Iter 1: it emits `file-read(notes-5)`, `file-read(notes-6)` and 6 writes. Only `file-write(out-1)` runs, because the reads are over budget and the write is the first required batch. Iter 2: 5 writes run, and the reads are dropped again. `notes-5` and `notes-6` are never read. The model writes guessed values, and the hidden check fails on `out-5.txt is 58` and `out-6.txt is 108`. The run ends `success`.
   - Cogito trace `01M6PZXKTQ702MXMXRJ1662NDN` (run0). Single calls. The model re-emits `file-read(notes-4)` at seq 1325, 1342 and 1357, and none of them runs. With no signal, it loops until `dispatcher_early_stop` (activity 1 → 5 runs across the suite). The run ends `failure` with 3 of 6 outputs.
   - In the baseline, 2 qwen runs also lost calls, but those calls were re-dispatched later.
   - Fix direction (one coordinated change): size the auto budget from the compiled contract (distinct targets or deliverable count), or drop the auto budget and keep only user-set `maxCallsPerTool`. Also make every budget or batch refusal emit `guard-fired` plus an observation the model sees. Owner: runtime-warden for `util.ts`, reasoning/kernel-warden for `tool-gating.ts` and `dispatch-think-response.ts`. The refusal signal is the part that generalizes: a silent drop is wrong at any budget.
2. **The output cap does not bound thinking on qwen3:4b via Ollama, so one runaway still takes most of a 150 s cell (7 qwen timeouts, up from 5).** Every timed-out run has one think call that streams 13,200 tokens out against `maxTokens 7200`, with empty content and about 55-63k thinking characters, for 96-100 s. Examples: rw-7 run1 `01M6PXEKXN771DSXHVNWZQDJ5H` seq 69, rw-6 run2 `01M6PY1GEV9HQ83DEDMVTDZ4XP` seq 606, h3-todo-heavy run2 `01M6PYDCSKV19262EBHR3YNCD4` seq 820. rw-7 run0 `01M6PWVHXWTJ78SGME6T3HJAHJ` thinks for 96 s and ends `end_turn` with no max_tokens stop, so the runaway detector never fires. `3385baf59` stopped the budget escalation, which is the H3 fix. It did not cap the first burst. Timeouts moved from rw-7 to other tasks: rw-7 3, rw-2 1, rw-6 1, h3-todo-heavy 1, h3-plan-only 1. The plan-only one is a slow planner, not thinking. Fix direction: enforce a thinking budget at the provider, or abort a stream on thinking length or wall time. The main checkout has uncommitted edits in `packages/llm-provider/src/thinking/resolve.ts`, which may target this. Owner: provider-warden. Anchor: `packages/reasoning/src/kernel/capabilities/reason/thinking-runaway.ts`, which detects the runaway only at `max_tokens`.
3. **Stall after work on qwen rw-2 (`harness:stall-after-work`, 2 → 3, within noise; confidence `probable`).** The model reads the data and writes the full analysis as prose 4 times ("## Primary Cause ..."), but never calls `file-write(analysis.md)`. `loop_resolution` fires, then `stall_deliverable 4/4`. Harness synthesis follows, and the verifier rejects it (`output-is-model-authored`). Trace `01M6PWNHQY0TP7V4AFV4QMQQV9`, guard seq 113. The guidance after the first prose answer does not turn it into a write. This is borderline model-attributed and is not chased here.

## Other observations

- `signal:other@head-truncation-guard` went from 5 to 0 runs. `guard:strategy_delivery_gate:block` went from 4 to 1. Neither is chased.
- Cogito spends more LLM calls per run (4.85 → 5.35). Nearly all of the rise is h3-todo-heavy at 12.6 calls per run, where the model re-emits refused calls (defect 1).
- Instrument: `run-h3.ts` labels the 7 qwen timed-out cells `no-trace`, but their traces exist and `rax-diagnose` reads them (`environment:run-aborted`). The report's cause column undercounts what attribution can see.
- Instrument (unchanged from baseline): timed-out traces still write every event twice. Any reader that sums events must dedupe by `seq`.

## Model-attributed (not chased)

qwen: 13 of 26 failures are model-attributed (7 `fabrication-vetoed`, 6 `had-evidence-wrong-output`), plus 7 `environment:run-aborted`. cogito: 30 of 37 (18 `had-evidence-wrong-output`, 7 `ignored-guidance`, 4 `fabrication-vetoed`, 1 `never-engaged`), plus 1 unattributed (rw-9 run2, no tool evidence before the answer). rw-2 and rw-3 stay at 0/5 on both tiers, as before.
