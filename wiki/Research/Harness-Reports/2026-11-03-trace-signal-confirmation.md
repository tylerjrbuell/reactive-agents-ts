---
type: harness-report
status: complete
created: 2026-11-03
tags: [harness-report, trace, debuggability, signal-confirmation]
---

# Trace signal confirmation, 2026-11-03

Confirms items 1-5 of `Audit-Reports-2026-11-03/debuggability-recovery-knobs.md` §5 on real runs.
Models: local Ollama only. `gemma4:e4b` and `gemma4:12b` are NOT installed. Used `llama3.2:3b` (n=2), `qwen2.5-coder:7b` (n=1), `gemma4:26b` (n=1, 2 shapes; memory-limited). No frontier arm (not needed; `.env` exists, no key used). 24 cells, 21 kernel runs plus 2 plan-posture chat turns plus 1 timeout.
Probe: `wiki/Research/Prototypes/signal-confirmation-2026-11-03/{probe.ts,check.ts}`. Traces (1.3 MB): `wiki/Research/Harness-Reports/2026-11-03-signal-confirmation-traces/<shape>__<model>__r<n>/{trace/,cell.json,result.json}`.
Evidence is raw kernel JSONL read via `loadTrace` + `analyzeRun` (`packages/trace`). n is tiny: these are presence/correctness checks, not rates.

## Verdict

Signals are present and correct. Root-causing from trace alone: **SUFFICIENT for 17 of 21 kernel runs, PARTIAL for 4 (a-clean llama x2, b-stall qwen, bad-model), INSUFFICIENT for 0**; the 2 plan-posture turns and the aborted run are PARTIAL. `analyzeRun` still assigns **no cause** (no `cause` field on `RunAnalysis`; 0/21); its only output is `failureModes`, which was `overlap-storm` on 10/21 (4 of them successes) and empty on 11. The cause classifier of audit §1.5 is the remaining gap, no longer the signals. 17 of 21 is my blind judgment per the table below, not a measured rate.

## Signal checklist

| # | Signal | Verdict | Evidence |
|---|---|---|---|
| 1 | `run-started.config {mechanisms,builder,env}` populated | PASS 21/21 (+3 chat/plan runs) | 30 mechanism keys, builder summary, `env: {}`. Plan runs add `config.posture:"plan"`. |
| 1b | config secret-free | PASS | Regex scan (sk-/Bearer/AIza/api_key) over all 24 trace files: 0 hits. Caveat: `env` was `{}` in every run, so env-override capture is NOT exercised. |
| 2 | `run-started.origin` | PASS-weak | `"user"` on 21/21. Non-user origins (goal-judge, title-gen) not exercised. |
| 3 | `run-completed.outcome.authority` + `kernelAuthority` | PASS | `authority` 21/21. `kernelAuthority` present only when a veto replaced the kernel verdict (6 runs: gate-verdict, contract-coverage, abstention) which is the right semantics. Authorities seen: model-final, guard:dispatcher_early_stop, stall-deliverable, loop-resolution, gate-verdict via runtime-success-veto:outstanding-criteria, error, abstention. |
| 4 | `terminal_decision` authority + `iterationCap` | PASS | 21/21, `iterationCap {counter,observed,threshold,llmCalls,capped}`. `capped:true` never exercised (dispatcher_early_stop fires one iteration before the cap in every shape). |
| 5 | `terminal_status_override` guard-fired | PASS, 6 fires | a-clean llama x2 (gate-verdict), d-toolproto llama r1 (label-disagreement), d-toolproto qwen (contract-coverage), plan turns x2 (contract-coverage). All 6 truthful (`labelsDisagree:true`, kernelMinted vs final). Plan-turn fires are correct to the code but wrong for the user, see gap 3. 2 un-disclosed disagreements remain: abstained runs have `terminal_decision.status:"done"` and final `failure` with no override (a-clean qwen, g-contract qwen). |
| 6 | Guard evidence `{counter,observed,threshold}` on the ending guard | PASS | stall_deliverable `{consecutiveStalled 4/4}`, dispatcher_early_stop `{iteration 7/8}` plus `evaluatorReason`, loop_resolution `{sameToolCallRun 2/2}`. |
| 7 | `wire-request` facts | PASS 21/21 | one per think; provider, numCtx, numCtxSource, outputBudget, toolsShipped with provenance present; also emitted for the failed bad-model call. |
| 8 | Iteration stamps | PARTIAL | `tool-call-end` and `verifier-verdict` iter sane on all runs (no -1; verifier iter <= last iteration). **`strategy-switched` still `iter:-1` on 3/3 switches** (d-toolproto llama r0/r1, g-contract llama r0). Emit site: `packages/reasoning/src/kernel/state/kernel-hooks.ts:230` (`onStrategySwitched` omits `iteration: state.iteration`; normalizer `packages/trace/src/normalize.ts:225` falls back to -1). |
| 9 | `provider` not "unknown" | PASS | `ollama` on run-started and every llm-exchange. |
| 10 | `verifier-verdict` source/iteration | PASS | Kernel verdict (no source) plus `source:"runtime"` verdict on every terminal. Check severity (`warn`/`escalate`) is present on kernel verdicts only; runtime verdict checks carry no severity. |
| 11 | signalId pairing | PASS | rendered/injected 13/14 (the 1 miss: bad-model run died before render). effect/rendered 10/13 = 77%; remainder legitimately unobserved. Effect events carry `observedTool,response,detail`. |
| 12 | `run-aborted` sentinel | PASS | Present on the timeout cell (`causeClass:"interrupt"`, `error:"fiber interrupted"`, `durationMs`), absent on all 23 other cells. Weakness: reason says "interrupt", not "timeout"; `withTimeout(2500)` is indistinguishable from `terminate()`. |

## Per-run table

Blind answer from trace alone. S = sufficient, P = partial.

| Cell | result.success / run-completed.status | Ended by (trace) | Authority | Blind verdict |
|---|---|---|---|---|
| a-clean gemma4:26b r0 | T / success | end_turn | model-final | S. 3 iters, 2 ok tool calls, "10 checks passed". |
| a-clean llama r0, r1 | F / failure | harness_deliverable via stall_deliverable 4/4 | runtime-success-veto:outstanding-criteria (kernel: gate-verdict) | P. Chain readable (stall -> harness fallback -> `output-is-model-authored` escalate -> veto). Output "hello sig" was correct and is labeled failure; `outcome` does not name WHICH criterion is outstanding (answerSatisfied:false only). r1 runtime verdict shows `tier1-nli relevance 0.00` as a failing check: a false-negative veto, readable only by digging checks. |
| a-clean qwen r0 | F / failure | abstained | abstention | S. Model produced no tool call, abstention reason in `error`. Override missing (see 5). |
| b-stall gemma, llama r0, r1 | T / success | dispatcher_early_stop (iter 3/4, "flat trajectory") | guard:dispatcher_early_stop | S for "why it ended". P for correctness: marked success though trajectory was flat; honesty label "claimed-success (unverified)". Intended shape (stall_deliverable / max_iterations) NOT reproduced; the dispatcher stops one iteration before the cap. |
| b-stall qwen r0 | T / success | llm_end_turn, 0 tool calls | model-final | P. Verifier rejected (`output-not-fabricated-listed-entities`, severity warn, verified:false x2) yet success via `deliverable_decision` reason `advisory-softfail`; `outcome.verdict` says `accepted:true` with summary "failed at ...". Readable, but contradictory on its face. |
| c-required llama r0, r1, qwen r0 | F / failure | controller_early_stop_ungrounded (iter 4-5 of 6) | guard:dispatcher_early_stop | S. `web-search` `tool-call-end ok:false` with the "no results" error on every call, 2 redirect signals injected/rendered/effect-paired, 1 requirement outstanding. |
| d-toolproto llama r0 | T / success | dispatcher_early_stop 7/8 | guard | S. Loop detected -> strategy-switched (iter -1 bug), 4 of 7 tool calls failed on `language:"python"`. |
| d-toolproto llama r1 | F / failure | dispatcher_early_stop 7/8 | guard (override label-disagreement) | S. 7/7 tool calls ok:false, same arg error repeated. |
| d-toolproto qwen r0 | F / failure | llm_end_turn | runtime-success-veto (kernel: contract-coverage) | S. No tool calls, plan text only, requirement unmet. |
| e-badmodel (llm error) | F / failure | llm_error | error | P. `run-completed.error` has the full message and terminal_decision `llm_error`, but the `llm-exchange` for the failed call records `response.content:""`, `stopReason:"end_turn"`, `durationMs:48` with no error field and no error class. |
| g-contract llama r0 | T / success | harness_deliverable via loop_resolution | loop-resolution | S. `contract-compiled` shows `artifact:./out.txt`; `deliverable_decision` reason `harness-authored-verified-artifact` explains the accept. Both verifier verdicts verified:false (`output-is-model-authored`), overridden by the artifact. |
| g-contract llama r1 | T / success | harness_deliverable via stall_deliverable 4/4 | stall-deliverable | S, same as r0. |
| g-contract qwen r0 | F / failure | abstained | abstention | S. |
| h-verifier x3 | T / success | end_turn / llm_end_turn | model-final | S, but no verifier block was reproduced (answered directly in 1 iteration, "10 checks passed"). |
| f-plan llama, qwen (chat plan turn) | n/a / failure | end_turn / llm_end_turn | runtime-success-veto (kernel: contract-coverage) | P. `config.posture:"plan"` recorded; `tool-surface-resolved` says "hidden: withheld by plan posture"; then terminal_decision `done`/model-final/"10 checks passed" is overridden to failure by contract-coverage. See gap 3. |
| i-timeout gemma r0 | n/a (run threw) | run-aborted | none | P. Sentinel present, cause says only "interrupt". No `run-completed`, so `analyzeRun` has `status` undefined and still labels it `honest-failure`. |

A plain chat turn on the direct path (no tools) writes only `llm-direct.jsonl` with no run-started/run-completed. Posture is documented as a no-op there; the user cannot tell from the trace which path a turn took beyond `runId:"llm-direct"`.

## Done-vs-failed disagreement (task 4)

- `run-completed.status` vs `result.success`: **0/21 disagree**. The audit's feared "run-completed success while result.success=false" was NOT reproduced; both are derived from the final status. I could not reproduce a hard verifier block that flips only one of them (h-verifier answers passed outright).
- `run-completed.status` vs `verifier-verdict.verified`: **3/21 disagree** (b-stall qwen; g-contract llama r0, r1). Exact evidence, g-contract llama r1: kernel verdict seq iter 4 `verified:false`, runtime verdict `source:"runtime"` `verified:false`, `deliverable_decision {outcome:"pass", reason:"harness-authored-verified-artifact", chosen:"tool-artifact", accepted:true}`, `run-completed.status:"success"`, `outcome.verdict.accepted:true` with `summary:"final-answer: failed at output-is-model-authored ..."`. Contrast a-clean llama r1: the same failing check and same `harness_deliverable` produced `deliverable_decision {outcome:"block"}` and failure, because there was no artifact contract. The policy difference is explained by `deliverable_decision` but the rolled-up `outcome.verdict` shows the rejecting summary next to `accepted:true`.
- `result.terminatedBy` vs `run-completed.terminatedBy`: **15/21 differ.** The public result coarsens (`end_turn`, `max_iterations`) while the trace is precise (`controller_early_stop:dispatcher_early_stop`, `harness_deliverable`, `llm_end_turn`). Worst case: c-required reports `max_iterations` on a run that ended at iteration 4-5 of 6 by early stop. The trace is right; the user-facing field misleads.
- Three status vocabularies coexist: `terminal_decision.status` (done|failed), `run-completed.status` (success|failure), `outcome.status` (completed|partial|failed|abstained). `terminal_decision.status:"done"` is emitted for 17 runs including ones that end in failure.

## analyzeRun vs the 13-rule taxonomy (§1.5)

`analyzeRun` assigns a cause on **0/21** (field does not exist). Hand-applying the rules to these traces, signals now present make these deterministic: 1 (run-aborted vs missing run-completed, plus `causeClass`), 2 (llm_error + `error`), 4 (`terminal_status_override` and verdict-vs-status), 6 (b-stall qwen: 0 tool calls, tools visible), 7/8 (d-toolproto: strategy-switched reason, repeated `ok:false`), 9 (a-clean llama: stall_deliverable with totalArtifacts>0), 11 (a-clean llama r1: deliverable_decision block). Rule 12 (`budget/cap`) could not be tested: no run reached `capped:true`. Rule 3 (satisfiability-abstain) untested; abstentions here came from the model, not the preflight guard. Rule 13 needs cohort mode. Estimated 8 of 13 rules computable now; none implemented.

## Remaining gaps, ranked

1. **No `cause` classifier** in `analyzeRun` (`packages/trace/src/analyze.ts:541`); `failureModes` emits `overlap-storm` on 4 successful runs and misses all real causes. Dispatch: trace/diagnose owner (no warden in the table; parent decide). Highest value now that signals exist.
2. **Provider error not on the exchange**: failed `llm-exchange` records `stopReason:"end_turn"` and empty content, no error class (audit rank 4 not landed). Emit: the llm-exchange publisher for the failed stream (provider-warden / kernel-warden for `llm_error` path in `runner.ts`).
3. **Plan posture x contract is posture-blind**: plan turns hide `file-write` yet the compiled contract still requires `tool:file-write`, so every plan turn is vetoed to failure by `contract-coverage` after `terminal_decision` said "done". Needs a posture-aware contract or a posture-labelled terminal outcome (kernel-warden, contract compile).
4. **Outstanding criteria not named** in `outcome` / `terminal_status_override` metadata (a-clean llama: correct output labeled failure; reader must inspect verifier checks). Add `outstanding: [ids]` to the override metadata.
5. **`strategy-switched` iter = -1**: `packages/reasoning/src/kernel/state/kernel-hooks.ts:230` omits `iteration`.
6. **`outcome.verdict` contradicts itself** (`accepted:true` + "failed at ..." summary) when `deliverable_decision` overrides the verifier. Carry the decision reason and the verifier verdict as separate fields.
7. **`result.terminatedBy` coarsening** (15/21) loses the precise terminator; expose it or document it.
8. **`run-aborted.causeClass`** cannot say timeout vs terminate vs user abort; `analyzeRun` labels aborted runs `honest-failure`.
9. **`terminal_decision.status:"done"` on failures** and 2 abstention runs with no override.
10. **Untested here** (cannot call them PASS): env-override capture in `config.env`, non-user `origin`, `iterationCap.capped:true`, a hard verifier block flipping a label, `tool-call-unresolved` on llama3.2:3b (shape d showed repeated-tool-call and arg errors, not unresolved calls), guidance/`model-saw` (audit rank 9, not landed: I could answer "what the model saw" only from `tool-surface-resolved`, `harness-signal-injected.contentPreview` and `projection-rendered`, not the composed prompt).

## Method caveats

Small n, small local models; two of the intended failure shapes (stall_deliverable-only, max_iterations cap) were pre-empted by dispatcher_early_stop at iteration cap-1. `a-clean` was deliberately a "clean success" shape but llama3.2:3b hit stall_deliverable in 2/2, which gave the veto evidence. Per-cell tmpdir isolation (`REACTIVE_AGENTS_TRACE_DIR`); no other processes were touched.
