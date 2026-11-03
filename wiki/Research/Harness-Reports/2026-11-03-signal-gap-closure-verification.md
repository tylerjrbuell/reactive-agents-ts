---
type: harness-report
status: complete
created: 2026-11-03
tags: [harness-report, trace, signal-gap-closure, verification]
---

# Signal gap closure verification, 2026-11-03

After-state of `2026-11-03-trace-signal-confirmation.md` gaps. Same probe (`probe.ts`, shapes a-i), plus new `probe2.ts` (strategy cells) and `check2.ts` under `wiki/Research/Prototypes/signal-confirmation-2026-11-03/`. Models: llama3.2:3b (n=2 on a,b,c,d,g; n=1 else), qwen2.5-coder:7b (n=1), gemma4:26b (a, i). Local Ollama only, no frontier. 29 cells, 30 trace files (plan/verifier shapes write an extra `llm-direct.jsonl`). Traces: `wiki/Research/Harness-Reports/2026-11-03-signal-gap-closure-traces/` (small).
Caveat: n tiny, models stochastic. These are signal-presence checks, not rates. "Before" = the earlier report (no re-run of old code, no code was changed by me). Run on dev HEAD with current src (bun exports condition).

## Per-gap table

| # | Gap (earlier rank) | Verdict | Evidence |
|---|---|---|---|
| 5 | strategy-switched iter -1 | FIXED | 6/6 switches stamped iter 2-4 (b-stall llama r0 iter 2, c-required x2, d x2, g r0). 0 `iter:-1` on switch events. |
| 6 | outcome.verdict self-contradiction | PARTIAL | `outcome.deliverable {outcome,reason,accepted}` and `outcome.verifierVerdict {verified,failedChecks}` now separate (g-contract llama r1: deliverable pass `harness-authored-verified-artifact`, verifierVerdict verified:false). BUT `outcome.verdict` still `accepted:true` with summary "final-answer: failed at output-is-model-authored" on that run. Explained by siblings, still odd on its face. |
| 4 | outstanding ids on override | FIXED (reactive) | a-clean llama x2: `terminal_status_override.metadata.outstanding:["answer","output-is-model-authored"]`; d-toolproto qwen `["artifact:./sum.txt","tool:file-write"]`; g-contract qwen same style; same ids in `run-completed.outcome.outstanding`. Reflexion veto: see residual R3 (empty). |
| 9 | terminal_decision.finalStatus | FIXED (reactive) | present on every reactive terminal_decision: completed / partial / abstained / failed. `status` still "done" on partial/abstained (legacy vocabulary), finalStatus is truthful. Exceptions: b-stall llama r0 (`status:"thinking"`, `terminatedBy:null`, authority `none-recorded`, finalStatus partial while run failed), plan-execute/ToT emit no / odd terminal_decision, see R2. |
| 3 | plan-posture turn vetoed by contract-coverage | FIXED | f-plan llama + qwen: `run-completed.status=success`, outcome `completed`, authority model-final, no `terminal_status_override`, `analyzeCause` = none/decisive (earlier both were plan-posture-veto failure). Output "10 checks passed". `config.posture:"plan"` still recorded. NOTE: I checked ending status only; "planRecorded" I could not find as a named field in the trace; absent from `run-completed.outcome`. Treat the planRecorded half as UNVERIFIED. |
| 2 | provider error on llm-exchange | FIXED | e-badmodel: `llm-exchange.response {stopReason:"error", error:{class:"LLMError", message:"Model ... not found locally. Run: ollama pull ..."}}`; `run-completed.outcome.errorClass:"LLMError"`; terminal_decision metadata `errorClass:"LLMError"`; `run-completed.error` carries "LLM stream failed at iteration 0". Cause = provider-error/decisive. |
| 2b | stream-error class | NOT TESTED | could not produce an in-band stream error with local Ollama cheaply (no fault injection without editing src). |
| 8 | run-aborted.reason | FIXED | i-timeout gemma: `run-aborted {causeClass:"interrupt", reason:"timeout", error:"fiber interrupted"}` (earlier: indistinguishable from terminate). Cause label still `incomplete-trace/interrupt`, see R5. |
| 10 | verifier verdict source/iteration | FIXED (reactive) | `source:"kernel"` + `source:"runtime"` on every terminal; runtime iter == kernel iter (a-clean llama 5/5, g r0 7/7, c 5/5). 0 `iter:-1`. Exception: ToT runtime verdict iter 13 vs kernel 3 (no kernelIteration on ToT path; fallback). Plan-execute: only a runtime verdict, no kernel one. |
| 7 | outcome present on non-reactive | PARTIAL | present on all 4 (plan-execute-reflect, reflexion, ToT, blueprint) with `authority`, `status`, `terminatedBy`. blueprint fully populated and consistent. plan-execute and ToT: `deliverable:null, verifierVerdict:null, verdict:null`, `outcome.success:false` + `status:partial` while `run-completed.status:"success"` and result.success true. reflexion inverse: `outcome.success:true,status:completed` while run-completed failure (veto). All three are real contradictions, see R1. |
| 1 | source=kernel on kernel verdicts | FIXED | every kernel verdict carries `source:"kernel"`. |
| 11 | origin gateway/scheduled/Cortex | NOT TESTED | needs gateway/Cortex run; cell all `origin:"user"`. Skipped per brief (do not touch Cortex servers). |
| 12 | kernelIteration | PARTIAL | consumed via verifier stamp (reactive runtime iter exact). Not on strategy-switched events and absent on ToT/plan-execute. |

## Cause per cell (`rax-diagnose cause` / analyzeCause)

Cohort tally over the new dir (26 trace files): decisive=25 probable=1 insufficient-trace=0. Earlier set under the same classifier: 24 runs, decisive=23 probable=1 insufficient=0.

| Cell | Cause | Conf | Blind check |
|---|---|---|---|
| a-clean gemma | none | decisive | right |
| a-clean llama r0,r1 | stall-after-work | decisive | right (stall_deliverable 4/4, artifacts 4-5, veto) |
| a-clean qwen | never-engaged | decisive | right (0 tool calls, abstained) |
| b-stall llama r0 | budget-cap | decisive | right (iter 4/4 capped:true, evidenceDelta>0) |
| b-stall llama r1 | none | decisive | OK (early stop, verified) |
| b-stall qwen | none | probable | WRONG-LOOKING: kernel+runtime verdict verified:false (`output-not-fabricated-listed-entities`, "likely invented"), accepted via `advisory-softfail`. A fabricated-entities success is labelled "none". Should be a verifier-overridden/advisory-softfail cause. |
| c-required llama r0 | none | decisive | OK this time (web-search returned results; env changed, not code) |
| c-required llama r1 | loop-after-work | decisive | right |
| c-required qwen | never-engaged | decisive | right (0 calls, early_stop_ungrounded) |
| d-toolproto llama r0,r1 | none | decisive | OK |
| d-toolproto qwen | never-engaged | decisive | right |
| e-badmodel | provider-error | decisive | right |
| f-plan llama, qwen | none | decisive | right |
| f-plan `llm-direct.jsonl` x2 | incomplete-trace | probable | WRONG-LOOKING: direct chat path legitimately writes no run-started/completed. Not an incomplete trace. |
| g-contract llama r0 | none | decisive | OK |
| g-contract llama r1 | stall-after-work | decisive | OK (success via artifact) |
| g-contract qwen | never-engaged | decisive | right (5 llm calls, 0 tool calls, abstained) |
| h-verifier x3 (+llm-direct x2) | none / incomplete-trace(llm-direct) | decisive | right for runs |
| i-timeout gemma | incomplete-trace/interrupt | decisive | WRONG-LOOKING: `run-aborted.reason:"timeout"` is available; cause should be `timeout`/aborted, not "incomplete-trace". |
| s-plan-execute llama | terminal-mislabel | decisive | RIGHT (real bug: status success vs outcome.success=false) |
| s-reflexion llama | terminal-mislabel | decisive | RIGHT (real: veto without override event) |
| s-ToT llama | terminal-mislabel | decisive | RIGHT (real: deliverable_decision=block but status success) |
| s-blueprint llama | stall-after-work | decisive | right |

Mapping vs earlier 24 labels: plan-posture-veto x2 -> none (intended fix); tool-failure x3 (c-required web-search "no results") not reproduced because web-search live now (env, not code); never-engaged 4 -> 4; stall-after-work 3 -> 4; provider-error 1 -> 1; incomplete-trace(aborted) 1 -> 1. New: terminal-mislabel x3 (non-reactive strategies), budget-cap x1.

Real corpus `cause --all --real`: 100 runs; decisive 49 / probable 51 / insufficient 0. Mix: none 55, never-engaged 12, provider-error 9, terminal-mislabel 5, incomplete-trace 4, tool-protocol 3, satisfiability-abstain 3, bookkeeping-loop 2, loop-after-work 2, stall-after-work 2, tool-failure 1, verifier-reject 1, unexplained 1. No earlier real-corpus tally was ever recorded in the wiki (grep clean), so a before/after mix change CANNOT be reported; this is the baseline. 51% probable is mostly `none/success` runs (likely no verifier evidence) - not decomposed here.

## Non-success runs: root cause readable from trace alone?

Decisively readable (SUFFICIENT): a-clean llama x2, a-clean qwen, b-stall llama r0, c-required llama r1 / qwen, d qwen, e-badmodel, g qwen, blueprint. Residual:

| Run | Status | Missing signal | Emit site |
|---|---|---|---|
| s-reflexion llama | PARTIAL | run failed via `runtime-success-veto:outstanding-criteria`, but `outcome.outstanding:[]`, no `terminal_status_override`, kernel verdict verified:true. Reader cannot tell which criterion vetoed. Result: success=false, outcome says completed. | runtime veto path; reflexion result assembly (strategy-level outcome builder) |
| s-plan-execute llama | PARTIAL | `run-completed.status=success`, `outcome.success=false/partial`, no terminal_decision, no kernel verdict, `tool-call-start` x5 stamped iter -1, `deliverable`/`verifierVerdict` null. | plan-execute outcome builder; tool-call-start stamping on plan path |
| s-ToT llama | PARTIAL | deliverable_decision=block (harness fallback unauthored) but status success + result.success true; reactive/blueprint path vetoes same case to failure. | ToT terminal gate (veto not applied) |
| b-stall llama r0 | PARTIAL | terminal_decision after strategy switch: `status:"thinking"`, `terminatedBy:null`, authority `none-recorded`; error text says "6 attempted, 14 succeeded" (impossible). | post-switch terminal_decision emission; error-summary counter |
| i-timeout | PARTIAL | cause label wrong though `reason:"timeout"` exists (classifier side, not emit) | `packages/trace/src/cause.ts` aborted branch |
| b-stall qwen (success) | PARTIAL | success on fabricated list; cause "none". classifier cannot see advisory-softfail as risk | cause.ts + verifier evidence set (audit rank 5 still missing: `{inspectedChars, matchedValue}`) |

INSUFFICIENT: none.

## Behaviour regression check (task 4)

Same shapes, same terminal status as the earlier report except: f-plan failure -> success (intended). Differences that are NOT code-attributable: c-required llama r0/ (web-search now returns results, so success; earlier "no results"), d llama r1 F->T, b-stall llama r0 T->F (max_iterations after reactive->plan-execute switch), llama run-to-run variance at n=1. No evidence of an unintended regression, but b-stall llama r0 failing after a strategy switch is worth one more sample before dismissing (terminal_decision there is malformed, see R2). a-clean llama x2, qwen abstain, g-contract, h, e, i: identical status.

## Ranked residual gaps

1. R1 Non-reactive strategy outcome contradictions (plan-execute, ToT success while `outcome.success=false`; reflexion failure while outcome success). User-visible: ToT reports success on a harness-fallback the reactive path rejects. Emit: strategy result builders in `packages/reasoning/src/strategies/` and the runtime outcome roll-up. kernel-warden / runtime-warden.
2. R2 terminal_decision malformed or absent on plan-execute (none), and after a strategy switch (`status:"thinking"`, `authority:"none-recorded"`, `terminatedBy:null`). tool-call-start iter -1 on plan-execute.
3. R3 Reflexion veto: `outstanding` empty and no `terminal_status_override` on a veto-to-failure.
4. R4 `outcome.verdict` (accepted:true + "failed at ..." summary) still self-contradicts when deliverable_decision overrides; derive summary from the deciding gate.
5. R5 `analyzeCause`: aborted runs labelled `incomplete-trace` (use `run-aborted.reason`); `llm-direct.jsonl` flagged incomplete (direct chat path); advisory-softfail success on verifier-rejected output labelled `none`. trace owner.
6. R6 "6 tool call(s) attempted ... 14 succeeded" counter bug in the budget-cap error text (b-stall llama r0).
7. R7 Untested: stream-error class, origin gateway/scheduled/Cortex, planRecorded field, `iterationCap.capped:true` was exercised once (b-stall llama r0) and is correct.
8. R8 `terminal_decision.status:"done"` still on abstained/partial (finalStatus is the truth; legacy field stays).

## Verdict

Intended closures LAND on reactive live runs: strategy-switched iter, outstanding ids, finalStatus, plan-posture fix, provider errorClass on exchange + run-completed, run-aborted.reason, verifier source/iteration. outcome.verdict contradiction is PARTIAL. Outcome-on-every-strategy is PARTIAL: present everywhere, but plan-execute, ToT and reflexion contradict their own run-completed status (3 of 4 non-reactive cells flagged by the classifier as terminal-mislabel, which verified as real). Stream-error and origin gateway/scheduled are untested. No intended-behaviour regression found. Next dispatch: kernel-warden/runtime-warden for R1-R3, trace owner (no warden) for R5; then re-probe.
