---
type: research
status: current
created: 2026-11-18
tags: [golden-run, iterations, slack, hooks, batching, h3, rax-diagnose]
---

# Where the golden run's "extra iterations" come from, and where the slack really is

Read-only diagnosis of six golden-run traces and the v0.18 H3 qwen3:4b traces from the in-flight v0.19 regression check. No live model runs and no framework source edits were made for it. Zero-token evidence: `iter-probe.ts` (scripted provider) and `classify.ts` (trace classifier), both in this folder.

## Verdict

**The loop does not keep going after the work is done.** In all 6 golden runs, the run ends on the first no-tool turn after the last file-write. `exit_gate=end_turn` is followed by `deliverable_decision=pass (verified)` and `terminal_decision=terminate`. There are no post-done turns, no repeated identical calls, no verifier re-prompts and no reissued tool calls. Real kernel turns are 3 to 5, not 9 to 13.

Three things make the run *look* slow and messy:

1. **`metadata.iterations` counts reasoning steps, not iterations.** `packages/runtime/src/engine/phases/agent-loop/reasoning-post-think.ts:213-216` overwrites `ctx.iteration` with `ctx.metadata.stepsCount` ("Update iteration to reflect actual reasoning steps"). `packages/runtime/src/engine/execute-result-assembly.ts:169` then publishes it as `iterations`. One tool turn adds 3 steps (thought, action, observation). The kernel's real count (`react-kernel.ts:294`, `iterations: state.iteration`) is dropped at `strategies/substrate/strategy-run.ts:541`, which forwards only `stepsCount` and `llmCalls`. Of the 71 "iterations" reported across the 6 runs, 45 (63%) are this inflation.
2. **The docs replay mis-assigns tool calls to `act` ticks.** `apps/docs/scripts/generate-golden-run.ts:205-229` zips the N-th `act before` hook to the N-th tool call and assumes "same count". The runtime actually fires `act before` once per call (`act.ts:795`, before execution), once more per turn (`act.ts:944`, *after* the calls already ran), and once more after the kernel ends (`reasoning-post-think.ts`, engine `fireActObserveHooks`). In the committed gemma capture, the real tool steps sit on hooks #1, #3 and #5 (16,321 / 24,646 / 36,697 ms). The generator uses #1, #2 and #3, which puts `file-write ./report.md` at 16,719 ms, the same millisecond as the search's observe. **That is the "report.md written in the same step as the search".** The real write happened 8 s later, in its own turn. The "repeated bare act/observe rows after the work is done" are hooks #4 to #7: the per-turn `act before` duplicates plus the engine's post-kernel synthetic block, which fires within 10 ms with no tool call.
3. **Hook lifecycle noise.** `bootstrap` fires twice (engine and kernel `runner.ts:641`). `complete:after` fires before `complete:before`, because the kernel fires `after complete` at `terminal-pipeline.ts:133` before the engine's complete phase. A think/act/observe block also fires after the kernel completes. None of this costs tokens, but all of it lands on the home page.

No write-before-evidence happened. In all 6 runs, every file-write is in a later turn than the first search result (16/16 tool calls checked). No guard is needed (spike-before-build).

## Zero-token confirmation

`bun wiki/Research/Harness-Reports/2026-11-18-extra-iterations/iter-probe.ts` runs a scripted scenario (toolCall a, toolCall b, final text) through `.withTestScenario()` and records hooks.

| Run | `iterations` | `stepsCount` | `llmCalls` | `act:before` hooks for 2 calls |
| --- | --- | --- | --- | --- |
| 1 | 8 | 8 | 3 | 5 |
| 2 | 7 | 7 | 3 | 5 |

The step count varies by one harness step between runs. `iterations === stepsCount` holds in both, and `iterations` is never 3. The hook sequence also shows `complete:after` before `complete:before`, and `think:after act:before act:after observe:before observe:after` after `complete:after`.

## Iteration-by-iteration: the six golden runs

Turn = one kernel think `llm-exchange` (trace `purpose=think`). "post" = the memory-extraction call after the terminal decision (`purpose` is unset on that exchange, an instrument gap).

| Run (model) | Turns | Labels (classify.ts) | Reported "iterations" |
| --- | --- | --- | --- |
| 01M7NS4F (gemma4:e4b, committed 11-17) | 4 | search > write report > write data (split, batchable) > final answer | 10 |
| 01M7P2AH (gpt-oss) | 5 | search > search (independent, batchable) > write > write (split) > final | 13 |
| 01M7P2ED (gemma4:12b) | 5 | search > search Saturn (dependent: first result lacked a count, productive) > write > write (split) > final | 13 |
| 01M7P2GD (qwen3:14b, committed 11-18) | 3 | search > 2 writes in one turn > final | 9 |
| 01M7P30G (cogito:14b) | 3 | 3 searches in one turn > 2 writes in one turn > final | 13 |
| 01M7P33N (qwen3:14b rerun) | 3 | 3 searches in one turn > 2 writes in one turn > final | 13 |

Gemma4:e4b trace evidence (`golden-run-2026-11-17/success-trace.jsonl`):

- seq 36: turn 0 calls web-search. Outstanding: both artifacts, `tool:file-write`, `answer`.
- seq 62: turn 1. Guidance says "You have tool results above. ... give your final answer now". Both artifacts are still outstanding. The model writes report.md. Its thought quotes the nudge, then uses Saturn = 146 "from general knowledge" instead of searching again.
- seq 87: turn 2. Outstanding: data.json and answer. The model writes data.json; its thought says "I will execute the two file-write calls sequentially".
- seq 113: turn 3. Outstanding: `answer` only. The model gives the final answer (`end_turn`). Then seq 118 `exit_gate pass end_turn`, seq 125 kernel verifier pass (11 checks), seq 126 `deliverable_decision pass verified`, seq 127 `terminal_decision terminate`.
- seq 145: memory extraction ("You are a memory extraction assistant"), 17.8 s, 1,705 tokens.
- seq 156: runtime verifier pass. seq 157: run-completed.

The other five follow the same shape. Each ends at `exit_gate` on the turn after the last write (`gpt-oss` seq 141/146, `gemma4:12b` 141/146, `qwen3:14b` 92, `cogito` 100/104, `qwen3:14b` rerun 106/111).

### Overhead share, golden (6 runs, 32 LLM calls, 47,357 tokens, 1,164 s of LLM time)

| Category | Count | Share of calls | Tokens | Time |
| --- | --- | --- | --- | --- |
| Duplicate bootstrap / strategy-select | hook-only, 0 LLM calls | 0% | 0 | ms |
| Think-only turn with no action | 0 | 0% | 0 | 0 |
| Repeated identical act | 0 of 16 tool calls | 0% | 0 | 0 |
| Re-prompt from guidance or verifier | 0 extra turns (verifier passed first time 6/6) | 0% | 0 | 0 |
| Post-done loop | 0 | 0% | 0 | 0 |
| Wasted or reissued tool call | 0 | 0% | 0 | 0 |
| Independent calls split across turns (3 writes, 1 search) | 4 turns | 12.5% | 8,274 (about 5,300 saveable input) | 51.5 s |
| Final-answer turn after the last write (contract `answer` floor) | 6 turns | 18.8% | 12,427 (26%) | 400 s (34%; qwen3 rerun alone 322 s re-deriving the task with 10 tool schemas attached) |
| Post-run memory extraction (`.withMemory()`) | 6 calls | 18.8% | 7,154 (15%, counted in `tokensUsed`) | 182 s (16%) |
| Productive (new evidence or a deliverable) | 16 turns | 50% | 19,502 | 530 s |

Display-only slack, not in the table: 45 of 71 reported "iterations" (63%) and 5 of 7 `act` rows on the docs replay.

## Is it harness-wide? H3 v0.18, qwen3:4b, k=5

Source: `~/h3-traces-v019check/v018-qwen3-4b/` (read-only; 33 of 35 cells finished). The `dev` arm had only 2 finished traces at report time and is not analyzed. H3's own `iterations` field counts kernel turns (todo-heavy shows 13), so the H3 metrics are not affected by the `stepsCount` bug.

93 think turns plus 27 non-think calls (22 `synthesize` calls are the plan-only strategy's own plan generation, not loop slack, and are not classified). 286,577 tokens.

| Slack | Evidence | Size |
| --- | --- | --- |
| One call per turn where calls are independent | `h3-todo-heavy` run0/3/4: 13-14 turns = 6 x (file-read turn, file-write turn) + final. 3 turns would do: read all, write all, answer. | about 30 of 93 turns (32%), 10.0-11.5k input tokens and 38-77 s per run |
| ...which caused aborts | todo-heavy run1/run2: `rax-diagnose cause` = `aborted/abort` at 180,022 ms. Each was still serial at 3 and 5 turns, 30-43 s per turn. | 2 of 5 todo-heavy cells lost (likely recoverable with batching, unconfirmed) |
| Recovery re-prompt after a correct abstention | `ab-trap-5` 5/5. Turn 1 answers "./ledger.json does not exist". Guidance "Recovery required: prior tool path failed (file-read). Retry file-read ... Do not finalize yet. (1/1)" (`recovery-steering.ts:150-153`) forces turn 2, which repeats the answer verbatim, then the run abstains. | 5 turns (5.4%), about 1.5-2k tokens each |
| Thinking runaway to `max_tokens` with empty output | todo-heavy run4 and required-tools run4, turn 0: `stopReason=max_tokens`, out=7,200, content empty, no call | 2 turns, 14,400 tokens (5%) |
| Repeated identical act / post-done loop | none in 33 traces | 0 |

So the dominant slack is the same as in the golden run, and larger: independent calls are issued one per turn. The golden task loses 1 turn from it. A fan-out task (6 files) loses 10 turns and, under a wall-clock cap, the run.

## Levers, ranked by total slack removed

| # | Lever | Exists? | Saves | Owner | Zero-token pin test |
| --- | --- | --- | --- | --- | --- |
| 1 | **Report real iterations.** `metadata.iterations` = kernel turns, from the kernel result's `iterations` (forward it through `strategy-run.ts:541`). Delete the overwrite at `reasoning-post-think.ts:213-216`. `stepsCount` stays steps. Also audit the other `ctx.iteration` readers, which inherit the step count: `telemetry-emit.ts:206-207` (`realIterations`), `reasoning-harness-hooks.ts:228` (`withMinIterations` counts steps, so the floor is met early), `memory-flush.ts:72` fallback. | Mis-wired | Displayed iterations 10 to 4 (gemma) and 9 to 3 (qwen): 63% of the reported number. Also explains the 11-17 failed run's "7 iterations under a cap of 2". | runtime-warden (+ kernel-warden for the `strategy-run.ts` forward) | `iter-probe.ts` shape as a runtime test: scripted `[toolCall a, toolCall b, text]` expects `metadata.iterations === 3`, `stepsCount === 7 or 8` (assert `> iterations`), `llmCalls === 3`. Add `withMinIterations(3)` with a 1-tool scenario: expect 3 kernel turns, not 1. |
| 2 | **Invite batching of independent calls.** When calibration says `parallelCallCapability: "reliable"`, tell the model that independent calls (several reads, several writes once the data is in hand) go in one turn. The natural place is the "Outstanding requirements" block when 2 or more artifacts are open. | Exists, not wired. Calibration measures it (gemma4:e4b, qwen3:14b and cogito:14b are all `reliable`; the probe prompt literally says "call BOTH in the same response"), but it only feeds blueprint (`calibration.ts:7`). The only batching hint, `buildToolElaborationInjection` (`tool-gating.ts:241`), has no caller, and its write branch says "Avoid batching with other mutating calls". 0 hits for "batch" on the todo-heavy wire. The kernel already executes multi-call turns (`planNextMoveBatches`, `act.ts:317`); qwen3 and cogito used it. | Golden: 4 of 26 turns (15%), about 5.3k input tokens, 51 s. H3: about 30 of 93 turns (32%), 10-11k tokens per todo-heavy run, plus 2/5 cells aborted at the cap. Needs a live A/B (ablation-warden, at least 2 tiers) before default-on. | kernel-warden (projection / guidance) | Seam test on `project()`: state with a search observation, 2 open artifact requirements and calibration `reliable` expects the rendered wire to contain the batching line. With `sequential-only` it is absent. A second test pins that `buildToolElaborationInjection` is either called or deleted. |
| 3 | **Wrap-up turn when only `answer` is open.** All artifacts and tools are satisfied, so the next turn sends no tool schemas, disables thinking, caps `maxTokens`, and uses guidance that names the written files and asks for a short summary. `wrap-up-reserve.ts` already does "tools are not available on this turn" for the budget case; reuse it. Skipping the turn entirely with a harness-authored summary would save a whole turn, but it trades output honesty (`harnessAuthoredOutput`), so it is not recommended for v0.19. | Partly (wrap-up reserve, budget-only) | No turn saved. Golden final turns are 34% of LLM time (400 s); the qwen3 rerun's final turn alone took 322 s re-deriving the task. Input tokens drop by the tool-schema share. | kernel-warden | Seam test: assessment with `outstanding=["answer"]` and both artifact requirements met expects the next wire request with `toolSchemaNames` empty (or final-answer only), thinking off and the bounded `maxTokens`. |
| 4 | **Take memory extraction off the run's critical path.** It runs inside `memory-flush` before `complete`. It adds one LLM call per run and is counted in `tokensUsed` and `duration`. | Exists, synchronous | 15% of golden tokens, 16% of golden time. Not an iteration. | runtime-warden (memory-flush) + memory owner | Scripted run with `.withMemory()` and a slow scripted extraction expects `agent.run()` to resolve before extraction completes (or expects `metadata.duration` to exclude it), and expects the extraction `llm-exchange` to carry `purpose: "memory-extract"` (today it is unset). |
| 5 | **Fix the hook lifecycle.** One `act before` per call, fired before execution. On the batch path it fires per batch *before* `executeToolAndObserveBatch` (today `act.ts:944` fires after the calls ran). Also: one bootstrap, `complete:before` before `complete:after`, and no synthetic act/observe after the kernel ends (or give them a distinct phase name). Side finding, **unconfirmed and security-relevant**: on the parallel-batch path, a `before act` killswitch hook (`requireApprovalFor`-class via `.compose`) runs only at `act.ts:944`, after the calls executed, so it cannot block them. Block-mode approval inside `executeToolAndObserve` is unaffected. | Mis-wired | Display only (0 tokens). Removes the "bare act/observe rows" and makes the docs replay correct without generator heuristics. | kernel-warden (`act.ts`, `terminal-pipeline.ts`, `runner.ts` hooks) + runtime-warden (engine wrapper phases) | Scripted `[toolCalls a,b in one turn, text]` with a `before act` hook that aborts and records order: expects neither handler invoked. Scripted 2-call serial run: expects exactly 2 `act:before`, each before its handler, `complete:before` before `complete:after`, and no act/observe hook after `complete:after`. |
| 6 | **Docs replay: pair act rows by evidence, not by position.** Have the capture record the tool name from the hook ctx (`state.meta.pendingToolCalls`, already stashed at `act.ts:790-792` and `:940-942`), or match each `act before` timestamp to its action-step timestamp. | Mis-wired | Fixes the "out of order" picture now, before lever 5 lands | docs-warden (`apps/docs/scripts/generate-golden-run.ts`) + harness-warden (`capture-golden-run.ts` records the name) | `apps/docs/tests/golden-run.test.ts`: fixture hook log with 2 `act before` per call expects the timeline tool rows at the action-step times (16,321 / 24,646 / 36,697 for the committed run) and in toolCalls order. |
| 7 | **Make the answer-now nudge contract-aware.** `conversation-assembly.ts:243-264` sends "give your final answer now" after the first tool result whenever `reqTools` is empty, even with artifact requirements open (6/6 golden runs). When artifacts are outstanding, say "write the outstanding files" instead. | Mis-wired | No turns saved. A quality fix: gemma4:e4b cited this nudge and filled Saturn from memory instead of searching (gemma4:12b, which ignored it, searched and was grounded). | kernel-warden | Seam test: state with a successful tool result, `reqTools=[]` and an open `artifact-produced` requirement expects `actReminder` not to contain "final answer now" and to name the open artifact. |
| 8 | **Do not force a retry after a not-found on the task's own path.** Route ENOENT on a path named in the task to the "deliver what you have" arm instead of "Retry ... Do not finalize yet". | Partly (broken-tool arm exists) | 5.4% of H3 turns (ab-trap-5, 5/5). This is a tradeoff: the retry rescues mistyped paths, so measure before changing it. | kernel-warden | `recovery-steering` unit test: one failed `file-read` with ENOENT on a task-named path expects no "Do not finalize yet". A different error class keeps today's text. |
| 9 | **Thinking runaway.** Turn 0 thinks to `max_tokens` (7,200) with empty output. Cap thinking separately from answer tokens, or on empty-content `max_tokens` retry once with thinking off. | Unknown, not checked | 5% of H3 tokens, 2 turns | provider-warden (Ollama thinking budget) | Scripted provider turn `{stopReason:"max_tokens", content:"", toolCalls:[]}` expects the next request to change the thinking or budget setting, not repeat the same request. |

Not a lever: write-before-evidence (0 occurrences). One bootstrap and no separate strategy-select save no LLM calls; they belong under lever 5 as display fixes only.

## What the target becomes

The "at most about 6 iterations, no repeated identical act" target is **already met** on real kernel turns (3-5 per run, 0 repeats). With lever 1 the home page shows 4 (gemma4:e4b) or 3 (qwen3:14b). With levers 5 and 6 the replay shows search, then write, then write, in the right turns, with no trailing bare rows. Lever 2 is the one real harness-wide efficiency gain: it takes golden runs to 3 turns and todo-style fan-out from 13 to about 3, and it needs an ablation before default-on.

## Limits

- 6 golden traces on 5 models, plus 33 H3 traces on one model (qwen3:4b, v0.18). The dev arm of the regression check was unfinished and not read.
- Savings for levers 2 and 3 are upper-bound estimates from the traces, not measured. Lever 2 depends on models taking the invitation (calibration says they do in isolation).
- The batch-path killswitch-ordering finding (lever 5) is from reading `act.ts`, not from a test.
- `classify.ts` labels gemma4:12b's second search "serial-search (maybe batchable)". By hand it is dependent (productive) and is counted that way above.

## Reproduce

```
bun wiki/Research/Harness-Reports/2026-11-18-extra-iterations/iter-probe.ts
bun wiki/Research/Harness-Reports/2026-11-18-extra-iterations/classify.ts <trace.jsonl>...
bun packages/diagnose/src/cli.ts cause <trace.jsonl>
```

Golden traces: `../golden-run-2026-11-17/success-trace.jsonl` and `~/.reactive-agents/traces/{01M7P2AHX2ZF5P4Y259J7ZPW5M,01M7P2EDKMMHADN8BN8RBHS4XQ,01M7P2GDQN71G63JCSVWTT2JK2,01M7P30GP7YRDRXG7VPAH37J8T,01M7P33NGDXTA4DG387C2RSWVP}.jsonl`. `rax-diagnose cause` and `attribute` on both committed traces: `cause=none status=success`, `not-failed (decisive)`.
