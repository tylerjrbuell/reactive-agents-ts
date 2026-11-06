---
type: harness-report
status: complete
created: 2026-11-06
tags: [spike, trigger-census, h3, plan-9, 2c, zero-token, s1, s2, s3, s4]
---

# Spike pack: trigger frequency of S1-S4 over every H3 trace from 2026-11-04 to 2026-11-06

Zero model tokens. The scan reads only the trace JSONL that the H3 result files point to. It answers the owner rule "spike before build" for four candidate mechanisms: S1 post-delivery waste, S2 cap-cutoff-with-progress (the Plan 9 2c trigger), S3 stale pre-act assessment, and S4 wrong-content writes.

## Verdict (read first)

| Spike | Failed runs flippable (upper bound, open at HEAD) | Token share | Verdict |
|---|---|---|---|
| S2 cap-cutoff-with-progress | cogito 13 in the window (6 on the current cohort), qwen 0, bonsai 0 | negligible (adds at most 1 iteration) | **Build a narrow fix only for S2a (RI overflow early-stop). Do not build 2c.** Re-measure S2b at HEAD before any build. |
| S3 stale pre-act assessment | 0 for the guards S3 names; the one real S3-family defect (9 runs) is already fixed | none | **Don't build.** S3b (failed code-execute credited as evidence) is a cheap optional correctness fix with no flip path. |
| S4 wrong-content writes | 0 harness-shaped at HEAD (18 in the window, all from 2 defects already fixed) | none | **Don't build.** The rest is model content. |
| S1 post-delivery waste | 0 by construction | redundant calls are 1.3-3.4% of solved-run tokens | **Don't build.** The 20-33% "post-delivery" share is almost all the one closing answer call. |

Ranked by failed runs flippable: S2 > S4 (fixed) ≈ S3c (fixed) > S3b = S1 = 0. Ranked by token savings: S1 (at most 3.4%) > the others (≈0). Only S2 clears the bar (≥3 failed runs on a tier), and it clears it on one tier and one task (cogito, `h3-todo-heavy`).

## Corpus

- Source: every `results*.json` / `after*.json` cell under `wiki/Research/Harness-Reports/2026-11-0{4,5,6}-*/`, deduplicated by `traceFile`. There are 978 cells and 930 have a trace on disk. The other 48 are deleted scratch dirs or `error` cells with no trace.
- Tiers: qwen3:4b 409 runs (146 failed), cogito:8b 447 (288 failed), bonsai-2:27b 74 (26 failed). **No frontier tier ran in the window.**
- "Current cohort": runs on SHAs that contain `61843730d` (a repeat-call warning is not progress) and `1f8754a27` (strategy switching opt-in). That is 77b6 and later: qwen 145, cogito 139, bonsai 74. For qwen and cogito, the latest full-suite run is `6a6a7f4d5`. Later runs are targeted (`94f0c9ea5` todo-heavy/rw-7, then the plan-only probes).
- `bonsai` stands in for the small tier. qwen and cogito are the mid tiers.

## Instrument faults found and fixed before counting (hand-checked against one trace each)

1. **plan-execute runs hold several sub-kernels under one runId.** Some sub-kernels run in parallel. Their `iter` labels restart at 0 and interleave (`01M6Q0GVT19BG0WQVX31T43HJ8`). v1 matched a guard to a parallel sub-kernel's assessment. S2 and S3 now run only on single-kernel runs. Plan runs are excluded from S2 and S3 (qwen 93, cogito 89, bonsai 22).
2. **The post-act assessment of the act at iter i is labeled i+1** (`01M6Q0GVT…` seq 379 → 384). All ordering now uses `seq`, not `iter`.
3. **The acting-pass assessment is computed before the tool runs and carries the previous delta forward** (`01M6PKHSES1WK5J85CS8TE8MKD` seq 1108, delta=1 with no tool yet). Progress is now "a new substantive tool result after the last LLM call". A re-read annotated `[Already done — do NOT repeat` does not count as new.
4. **rw-7 writes TypeScript.** `${x}` there is not a template leak. In code files, only `{{from_step` counts.
5. **S2 v1 ended its window at the first `terminate` proposal.** The exit gate can deny that proposal (`01M6Q5DEVYKNHMT0NRXY77P40F`: `loop_resolution` denied, then `dispatcher_early_stop` accepted). `s2.ts` anchors on the final `terminal_decision` instead. It also requires deliverables still missing at the cut (`dM>0`) before it calls a run flippable.

## Per-tier table (current cohort; whole window in parentheses)

### S1 post-delivery waste (solved runs; anchor = last successful substantive tool call)

| tier | solved runs anchored | post-delivery calls (% of their calls) | post-delivery tokens (% of their tokens) | redundant beyond one closing call | runs with redundant calls |
|---|---|---|---|---|---|
| qwen3:4b | 73 (205) | 85, 24.6% (227, 23.5%) | 143,554, 20.1% (375,783, 19.0%) | 12 calls / 23,109 t = **3.2%** (2.0%) | 8 (17) |
| cogito:8b | 32 (100) | 33, 27.7% (105, 24.9%) | 30,964, 28.7% (102,169, 25.7%) | 1 / 1,409 t = **1.3%** (1.8%) | 1 (4) |
| bonsai-2:27b | 39 | 39, 32.2% | 72,251, 32.9% | **0** | 0 |

- By terminal path, solved runs, current cohort: `model-continued` (the model's final answer turn) is 64/32/29 calls (qwen/cogito/bonsai). plan-execute `terminal-synthesis` is 18/1/10 calls. The `verify` LLM is 3/0/0. **Exit-gate deny, verifier reject, reflect and strategy switch after delivery: 0 calls on solved runs.** Strategy switch was 37 cogito calls in the whole window (35 in failed runs). It is 0 since switching became opt-in.
- The earlier census figure of "32% of calls" reproduces as 20-33% of tokens. But on solved runs, at least 90% of that is the one closing answer, which the run needs. The only lever left is making that closing call cheaper (a smaller context at close). That is a projection optimization, not a post-delivery mechanism.
- **Failed runs are a different failure, not waste.** Post-last-tool tokens are qwen 43.4%, cogito 26.9%, bonsai 23.4%. These are mostly runs that write the deliverable as prose while the exit gate denies the end turn. Example: `01M6Q47YG0CECZHXHXYCTVWPTM` (qwen rw-2) never calls `file-write`, writes the analysis in text 4 times, and burns 17.9k tokens on `exit-gate-deny` turns.
- Decisive ids: `01M6Q3B8TZ64VWSNTBRZQJDH34` (qwen h3-plan-only, solved: 3 near-identical closing answers plus a synthesis after the last write, +3 calls / 7.4k t). `01M6Q47YG0CECZHXHXYCTVWPTM` (failed-run prose loop above).

### S2 cap-cutoff-with-progress (single-kernel runs; `s2.ts`)

Trigger: the run ends at a cap or harness stop guard, a new substantive tool result landed in the last 2 think passes, and requirements are outstanding. Flippable: failed, and deliverables are still missing at the cut.

| tier | analyzable | strict cap ends (max_iterations / budget / abort) | extended cap ends (+ dispatcher, loop, stall, low-delta, quota) | triggered | triggered and failed | flippable | flippable, open at HEAD |
|---|---|---|---|---|---|---|---|
| qwen3:4b | 112 (316) | 0 (0) | 18 (43) | 5 (11) | 3 (3) | 2 (2) | **0** (both are fixed gate-deferral kills) |
| cogito:8b | 110 (358) | 1 (2) | 33 (90) | 12 (21) | 11 (18) | 9 (16) | **6 (13)** |
| bonsai-2:27b | 52 | 4 (cell interrupts) | 13 | 1 | 1 | 0 | **0** |

- **Strict caps never flip anything.** Across 930 runs, `max_iterations` ended 2 runs and budget ended 0. The bonsai interrupts are cell timeouts with dM=0. The 2c premise ("max_iterations failure on the default path") does not occur in this corpus.
- All 13 open cogito cases are `h3-todo-heavy`. In each one, every failed check is an unwritten `out-N.txt` (2 old runs have one extra failure). There are two sub-triggers:
  - **S2a (5 failed runs, 3 one-file-away):** the RI overflow early-stop "Approaching maxIterations (iter=13, max=14) with flat trajectory". It fires while the ledger shows one new file per pass and dM=1. It cuts the one iteration that would write the last file. Ids: `01M6Q83PG3QMPENNYM5PBRY6Y5`, `01M6Q8783MNJRB0YX82W5NXX3T` (both `94f0c9ea5`, failed=1, the only failed check is the missing file), plus `01M6PKY4W207F7J1VXV751PAN7`, `01M6MB4DGRX0HKWSY2MMBRBTZX`, `01M6MBHSCJ7D8D46JZGWYWF45X`.
  - **S2b (8 failed runs):** `loop_resolution` pattern (a) `repeated-tool-call` fires on cogito's habit of re-reading each `notes-N.txt` once, with dM 1-4. Decisive id: `01M6Q85K5CEQ4RBTQM2GPKVHY4` (seq 1008 handoff, 4 files missing). Every S2b run predates `3436229a0`, which changed the duplicate-call note that told cogito "Give FINAL ANSWER" while 5/6 deliverables were unwritten. No cogito `h3-todo-heavy` run exists after `3436229a0`, so S2b is **unverified at HEAD**.
- The progressAwareExit (PAE) ablation (2026-11-06) recorded 0 grants on `h3-todo-heavy`. This spike does not establish why. `loop_resolution` is one of PAE's proposers, so S2b may be within its reach. S2a is an RI `dispatcher_early_stop`, which is not a PAE proposer.

### S3 stale pre-act assessment (single-kernel runs)

Trigger: a progress-reading guard fires or vetoes after an act in the same pass (no LLM call in between) whose result was new substantive evidence. The "S3 named" column counts the guards the brief names: low_delta_guard, F3 repeated-identical-failure, stall_deliverable, loopDetected guidance, required_tool_quota, zero_evidence_stand_down. `loop_resolution` and `dispatcher_early_stop` are counted in "progress-guard fires" but not in "S3 named".

| tier | progress-guard fires | stale | stale, failed runs | S3 named guards: stale / fires | gatherDedup (gathering-phase guidance): stale / fires | S3b notice credited as evidence: runs (failed) | S3c gate deferral read as tool failure: failed runs |
|---|---|---|---|---|---|---|---|
| qwen3:4b | 32 (71) | 6 (10) | 6 (6) | **0/8** (0/20) | 1/2 (3/30) | 6 (0); window 13 (0) | 6, all `6a6a7f4d5` |
| cogito:8b | 65 (176) | 7 (13) | 6 (10) | **0/33** (0/98) | 0/12 (0/37) | 3 (3); window 9 (9) | 3, all `6a6a7f4d5` |
| bonsai-2:27b | 21 | 0 | 0 | **0/13** | 0/15 | 0 | 0 |

- **The guards S3 names never fired stale on any tier, in either cohort.** The current-cohort stale hits are all `dispatcher_early_stop` (9 gate-deferral kills = S3c, 3 cogito near-cap stops = S2a) plus one `loop_resolution` in a solved run. The pre-act staleness defect from 2026-11-05 (`packages/reasoning/src/kernel/loop/iterate-assessment-seam.ts:166-181`, `staleIterationsAtTurnBoundary`) shows no residue.
- **S3c is real and already fixed.** `tool-gate` deferred 5 of 6 batched writes ("one batch of required-tool calls runs per turn"). The RI streak counter read those deferrals as "file-write failed 5 times", and `tool-failure-redirect` ended a run whose synthesis held all 6 correct values. Ids: `01M6Q3F6Z90Q97DB1C4JMAG9S2`, `01M6Q5P6FK5869F4Y20372VCA5`. `94f0c9ea5` fixed it ("a gate refusal is not a tool failure; required calls run the same turn"). The traces after 94f0 have 0 `tool-gate` blocks.
- **S3b (open, low value):** `code-execute` returns `executed:false` as a successful call (`[Code execution failed: ENOENT…]`), and the next assessment credits `evidenceDelta=1`. Id: `01M6Q2XYQPD7HXHRR4V7JE0BT4` seq 1227 → 1228. A second id: `01M6Q0EMVYHJ2C32TZGR6V7SG3` (cogito rw-7). This can only delay stall guards. It cannot turn a failed run into a pass.

### S4 wrong-content writes (failed runs with an `ok:true` write to a file whose grader check failed)

| tier | failed runs with a wrong `ok:true` write | harness-shaped (template literal / flattened), current | harness-shaped, window | attribution of those runs (current) |
|---|---|---|---|---|
| qwen3:4b | 39/52 (115/146) | **0** | 11 (all flattened, h3-plan-only, pre-fix SHAs) | model:had-evidence-wrong-output 26, fabrication-vetoed 10, harness:tool-call-dropped 3 |
| cogito:8b | 56/87 (171/288) | **0** | 3 (flattened) | model:had-evidence-wrong-output 40, fabrication-vetoed 9, unattributed 3, other 4 |
| bonsai-2:27b | 18/26 | 4 | 4 (2 keyed-ref literal, 2 `:summary` flatten) | model:had-evidence-wrong-output 11, unattributed 4, other 3 |

- All 18 harness-shaped runs in the window come from two defects that are fixed at HEAD: keyed `from_step` refs written literally (`8ebf0929b`, plan-ref normalize) and `:summary` refs flattening whole-content args (`46c4d7c15`). The qwen plan-only runs on the later SHAs (14 runs on `d864d50a3` and later) show 0. The bonsai current-cohort 4 predate `8ebf0929b` / `46c4d7c15`.
- Decisive ids: `01M6R728BXFAF801MGDHA5N2H3` (bonsai, `:summary` flatten, which the plan-ref-normalize report also confirms by hand). `01M6QWZVMVD36K77TEPH6PSNNP` (bonsai, literal keyed ref in low-stock.txt). `01M6KJN47H1DMP362A6CEJPQS2` (qwen, flattened plus literal `{{from_step:s2:totalUnits}}`, checked by hand).
- What remains is model content (wrong numbers, wrong analysis). The attributor already labels most of it `model:*`. No harness mechanism targets it.

## Recommended dispatch

1. **S2a: dispatch the `reactive-intelligence` domain warden, with the kernel warden for the caller side.** The overflow branch of the RI early-stop judges "spinning" from entropy shape alone (`packages/reactive-intelligence/src/controller/early-stop.ts:56-80`). The progress-aware stand-down (`phase === "synthesize"`, `early-stop.ts:28`) gets its input only under the long-horizon profile (`packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:298-300`). Fix: on the default path, suppress the overflow early-stop when the latest post-act assessment shows new evidence and deliverables are missing. This reuses a signal the run already computes and adds no new mechanism. Verify on `h3-todo-heavy`, cogito and qwen, k=5, before/after.
2. **S2b: no build. Re-measure first.** Run one cogito `h3-todo-heavy` k=5 at HEAD to see whether `3436229a0` removed the re-read loop before anyone touches `packages/reasoning/src/kernel/capabilities/reflect/loop-detector.ts:150-170`.
3. **2c (cap lifecycle and handoff fact): don't build on this evidence.** Its trigger (a max_iterations or budget end during progress) flipped 0 runs in 930.
4. **S3b (optional, low priority): dispatch the kernel warden.** `packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:396-406` reports a failed execution as a successful call, and `packages/reasoning/src/kernel/assessment/progress-arbiter.ts:149` credits it.

## Artifacts (scratch, zero tokens)

`/home/tylerbuell/.claude/jobs/eaddf328/tmp/spike-pack/`:
- `collect.ts`: cells from the result JSONs → `cells.json`.
- `survey.ts`, `survey2.ts`: event-kind and field census.
- `scan.ts` (v3): per-run S1/S3/S4 plus attribution → `runs.jsonl`.
- `s2.ts`: S2 v2 → `s2-runs.jsonl`, `s2.txt`.
- `s3c.ts`: S3c → `s3c.txt`.
- `summarize.ts`: tables → `sum-all.txt`, `sum-current.txt`.
- `timeline.ts`: one-trace hand-check viewer.
