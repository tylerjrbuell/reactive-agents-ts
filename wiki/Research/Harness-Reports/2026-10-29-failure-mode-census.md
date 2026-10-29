---
type: harness-report
status: complete
created: 2026-10-29
tags: [harness-report, failure-modes, census, signals, guards, root-cause]
warden: harness-warden
script: wiki/Research/Prototypes/failure-census-2026-10-29/
---

# Failure-mode census, 2026-10-29

Rule-based classifier (no LLM) over every trace the framework wrote. Reusable: `python3 wiki/Research/Prototypes/failure-census-2026-10-29/census.py` then `tables.py`. Rules R01-R35 are listed in `RULES` in `census.py`. Per-run records, chains and aggregates: `.../failure-census-2026-10-29/out/{runs.jsonl,chains.md,summary.json}`.

## 0. Read this first: the evidence base is thin and is being destroyed

| fact | number |
|---|---|
| Unique runs found (deduped by runId, 6 sources) | 5,857 |
| Real-model runs (non-test provider/model) | **151** (2.6%) |
| Synthetic (`test-model`, `test`, `nimble`, `m`, ...) | 5,706 (unit tests / gate scenarios) |
| Real runs from one cogito:8b benchmark batch (`packages/benchmarks/benchmark-traces`) | 33 (22% of real; 22 of the 31 failures) |
| Real runs by tier | local ollama ~128 (gemma4:e4b 55 from the forge app, cogito:8b 33, others <10 each); frontier 23 (sonnet 8, gpt-4o-mini 6, gemini-flash 5, gpt-4o 2, grok-4 2) |
| Cortex DB (`~/.cortex/cortex.db`) | 48 events, 0 runs, 0 chat turns. Nothing to mine. Other cortex DBs: empty / no `cortex_runs` rows |

**Finding F0 (new, highest evidence-hygiene priority): the trace of record is gone.** `01M64DD47R0WD5BTS433GN20YX` was readable at the start of this mission and had been deleted from `~/.reactive-agents/traces/` before I finished. Cause: `packages/trace/src/recorder.ts:37-67` `pruneTraceDir` (max files / max age, oldest-mtime first) runs on every layer init, and unit tests write ~2,900 synthetic traces into the SAME `~/.reactive-agents/traces` directory as the user's real runs. Real-model traces in the live dir fell from 39 to 13 during this mission. The 40 other real runs I could use survive only because a copy of an older `.reactive-agents` is in the Trash. Everything below about the trace of record comes from my read of it before it vanished (section 2) plus two same-task reruns that landed later (`01M64EH60CZ2QNDW4YNYECS33R`, `01M64EJTQX0H7QBXY428DDEJ7S`).

Other instrumentation gaps seen in the data: 14 of 14 real `arbitrator.ts:890` signals and 12 runs total were emitted **without a `signalId`**, so their rendering and effect cannot be traced (older emitter, cogito:8b batch). 3 failed runs match no rule.

## 1. Trace of record, causal chain (read before purge)

Task: plan-only ("Plan first and do not carry out any step yet ... record each on my to-do list ... wait for my go-ahead") + crypto prices. gemma4:e4b, ollama, 5 iterations, 4,884 tokens, `status=success`, `terminatedBy=harness_synthesis`.

| step | saw | did | harness acted | root |
|---|---|---|---|---|
| it0 | tools web-search, crypto-price, todo; env-update "user edited your to-do list (+0,-4)" | `todo add` x4 items (correct) | none | none |
| it1 | pendingGuidance `actReminder`: "you have what you need ... give your final answer now" (after only a todo add) | called `crypto-price` (executed the plan despite plan-only) | none | **GUIDANCE/posture**: actReminder and the plan-only instruction contradict; nothing enforces plan-only |
| it2 | same | `todo add` again with `id:1` and the same 4 items: "Skipped 4 duplicate item(s)" | none | **bookkeeping**: model, not harness, owns todo state; dup-skip result gives no progress feedback |
| it3 | prompt 1,113 tok vs `numCtx` 8192 with a 7,200 output budget | `todo add` (id:2) again, tools `todo,crypto-price` DROPPED on the wire | head-truncation-guard fired (`droppedToolNames:[todo,crypto-price]`, 0 history dropped) | **BUDGET**: output reserve ate the window; small prompt lost tools. Window 32768 in projection vs 8192 in the guard (two resolvers disagree) |
| it4 | nothing new | `todo add` a 4th time | `stall_deliverable` (consecutiveStalled 4, `source:model_synthesis`) then `terminal_decision:harness_synthesis` | **FALLBACK**: stall guard ships a model synthesis |
| deliver | | | verifier: 10/10 checks passed incl. `output-not-continuation-intent` | output = "...I will now update the todo list and provide the final answer." with **no table**; `answer` requirement stayed `declared`; run reported success |

Mechanisms in one run: plan-only unenforced, actReminder contradiction, todo-add loop, tool drop, stall fallback, verifier miss, success with requirement outstanding.

Status at HEAD (`dev`): `quality-utils.ts` `detectContinuationIntent` already has a third shape quoting this trace; `15143c57d`/`4bffd6864` rework the truncation guard (clamp output first; same effective num_ctx). Plan-posture work is uncommitted in the working tree. The two reruns (`01M64EH60C...`, `01M64EJTQX...`) still show plan-only violated (R16), actReminder co-rendered with the plan-only task (R17/R29), 3 todo adds and 0 closes (R15), and the head-truncation signal opened but never rendered (R30). So the plan-only and signal-render gaps are live at the commit that produced those reruns; the verifier/truncation items I could not re-test on traces.

## 2. Classifier output: failure mode x model x count x % of runs (real runs, n=151)

FM ids from `wiki/Architecture/Specs/02-FAILURE-MODES.md`. `P-FM-n` are **proposals only**. Note `wiki/Failure-Modes/FM-*.md` reuses ids with different meanings (e.g. FM-D1 = infinite loops there, premature termination in the spec); I follow the spec.

| rule | FM / proposal | runs | % | models (count) | example run ids |
|---|---|---|---|---|---|
| R13 strategy switch | FM-D2 | 20 | 13.2 | cogito:8b 17, gemma4:latest 1, qwen3.5 1, gemma4:e4b 1 | becebaaf-5f1e-4670-a244-39e984af35b9 |
| R13b switch did not recover | FM-D2 | 16 | 10.6 | cogito:8b 15, gemma4:latest 1 | 01M213G1ZFBT3YVV8TJ5KP8YZ2 |
| R03 identical tool call repeated | FM-B1 | 17 | 11.3 | cogito:8b 9, qwen3.5 3, gpt-4o-mini 2, gemma4:latest 1 | 01M566ZYAN56CHS60F3TSNVW16 |
| R18 guidance pile-up (errorRecovery+loopDetected+requiredToolsPending in one think) | P-FM-7 | 17 | 11.3 | cogito:8b 13, gemma4:latest 4 | 1531a30f-bebf-4946-b04f-2ecf64f2d2a0 |
| R35 failure with zero tool calls over >=2 iters | FM-A1/A2 | 16 | 10.6 | cogito:8b 16 | 01M213JA5MV5RVYQA96VV44JT8 |
| R28 compaction / result truncation | FM-F1 | 13 | 8.6 | cogito:8b 6, bonsai-2:27b 4, gemma4:e4b 2, cogito:14b 1 | 01M5687F92HP9RT0TM756T8BDD |
| R25 arbitrator grounded-terminal-gate redirect | FM-D1 | 11 | 7.3 | cogito:8b 11 | 01M213GVNS4J6ZNKSG27974GM1 |
| R19b tool errors, environment (ENOENT, traversal, service down) | FM-B1 | 11 | 7.3 | cogito:8b 3, gpt-4o-mini 3, qwen3.5 2, gemma4:latest 1 | becebaaf-... |
| R05 no-progress streak >=3 | FM-B2/D1 | 8 | 5.3 | cogito:8b 5, gemma4:latest 2, gemma4:e4b 1 | a832faaa-81c6-45d3-8212-cd829c08d86d |
| R07 stall_deliverable terminal | P-FM-2 | 8 | 5.3 | cogito:8b 6, qwen3.5 1, bonsai-2:27b 1 | 01M566ZYAN56CHS60F3TSNVW16 |
| R09 status vs verifier disagree | FM-E1 | 7 | 4.6 | cogito:8b 4, bonsai-2:27b 2, cogito:14b 1 | 01M5A4PJGKGC48DZQ308BG80EG |
| R19 tool errors, schema/arg (missing param, enum, unknown tool) | FM-A2/B1 | 6 | 4.0 | cogito:8b 4, qwen3.5 1, bonsai-2:27b 1 | 01M5B7Q81Z2T4N0XFDZJ1JJWND |
| R14 success with `answer` unsatisfied (ledger) | P-FM-5 | 5 | 3.3 | cogito:8b 5 | 01M21424DB7ZVAVVA52J9WHEEJ |
| R22 abstained (honest give-up) | FM-E1 | 5 | 3.3 | gemini-flash 3, gpt-4o 1, gpt-4o-mini 1 | 01M565T1WS1JTMD3FFH9TMMJEV |
| R02 tool call as text in content | FM-A2 | 4 | 2.6 | cogito:8b 4 | 01M2148F99932BAQDYM800Z95A |
| R08 harness_synthesis / harness_deliverable terminal | P-FM-2 | 4 | 2.6 | qwen3.5 2, gemini-flash 1, bonsai 1 | 01M565RY2D5MPFN52MRSHM6P72 |
| R10 continuation sentence delivered as answer | P-FM-3 | 4 | 2.6 | qwen3.5 2, cogito:8b 2 | 01M5671VSJVRE68HC5P49T8V6N |
| R10b ... while verifier check passed | P-FM-3 | 4 | 2.6 | same 4 | same |
| R26 repeated-identical-failure guard | FM-B1 | 3 | 2.0 | gpt-4o-mini 2, cogito:8b 1 | 01M63S6WRN4T2X1FKVXYD5NCB8 |
| R29 contradictory guidance in one think | P-FM-7 | 3 | 2.0 | gemma4:e4b 2, qwen3.5 1 | 01M64EH60CZ2QNDW4YNYECS33R |
| R11 scaffold leak in output | FM-E2 | 2 | 1.3 | bonsai 1, cogito:8b 1 | 01M5B8DBT5CVNZPYARV3C0HDPC |
| R16 plan-only violated | P-FM-6 | 2 | 1.3 | gemma4:e4b 2 | 01M64EJTQX0H7QBXY428DDEJ7S |
| R21 max_iterations / budget | FM-B2 | 2 | 1.3 | gpt-4o-mini 2 | 01M63S6WRN8J03BGK435PX6F6V |
| R12 head-truncation-guard fired (dropped todo+crypto-price in the rerun too) | P-FM-4 | 1 | 0.7 | gemma4:e4b 1 | 01M64EJTQX0H7QBXY428DDEJ7S |
| R15 todo adds, never closed | P-FM-1 | 1 | 0.7 | gemma4:e4b 1 | same |
| R17 actReminder before any evidence tool | P-FM-7 | 1 | 0.7 | gemma4:e4b 1 | 01M64EH60CZ2QNDW4YNYECS33R |
| R34 called a tool not on the surface | FM-A2 | 1 | 0.7 | cogito:8b 1 | 01M2157MSEK47NCZCF58SMFMEX |

Not observed in the surviving real corpus (zero): R04 todo-add-repeat (only in the lost trace of record; 0 of 6 synthetic todo cases show it), R12b/R12c as separate hits beyond the rerun, R20 llm_error (30 llm_error runs exist but all synthetic), R23 empty-success, R24 window/num_ctx mismatch (needs HTG metadata; one hit lost with the trace).

terminatedBy (real): end_turn 34, final_answer 11, abstained 5, awaiting-approval 3, harness_synthesis 3, dispatcher_early_stop 2, max_iterations 2, harness_deliverable 1, **None 90** (old cogito/forge traces predate the field; 66 success, 24 failure). Status: 31 failure / 120 success. Tokens/run (real, n=142): median 6,580, p90 18,164, max 70,732, total 1.45M. Synthetic median 168.

Tool errors (real): path-not-found 14, missing-required-param 11, write-guard-refusal 3, enum 2, traversal 2, service-unavailable 2, sub-agent-failed 2, cli-exit 1, hallucinated-tool 1. Schema/arg class = 14 of 36 errors; the rest are environment.

Synthetic corpus (5,706, for path coverage only): abstained 314, success+empty output 158, max_iterations 58, low_delta_guard 58, harness_deliverable 47. These are scripted failure scenarios, not frequencies.

## 3. Signal lifecycle (harness-signal-injected -> signal-rendered -> signal-effect)

Real corpus has only **20 signals in 12 runs**; the effect events exist for a handful. Honest numbers:

| origin | opened | rendered | never rendered | no signalId | effect |
|---|---|---|---|---|---|
| arbitrator.ts:890 applyGroundedTerminalGate | 14 | unknown | unknown | **14** | untraceable |
| loop/iterate-pass.ts:710 repeated-identical-failure | 4 | 3 | 0 | 1 | remediated 1, rendered but no effect event 2 |
| head-truncation-guard | 1 | 0 | **1** | 0 | never rendered (the dropped-tools notice never reached a prompt) |
| runner.ts | 1 | 0 | 1 | 0 | never rendered |

`run-completed.signals` tally (real): opened 3, rendered 3, remediated 1, unobserved 2, ignored 0, contradicted 0, ambiguous 0. Synthetic (scenarios): opened 10, rendered 10, ignored 3, unobserved 7. Synthetic effectiveness by origin: arbitrator opened 13 / rendered 6 / ignored 4 / never rendered 7.

Conclusions I can defend: (a) no signal in the real data was observed as **contradicted**; (b) **ignored** only in the synthetic arbitrator scenarios; (c) the large effectiveness signal is not "ignored", it is "**unknowable**": 14/20 real signals have no id, 2 had no effect classification (`unobserved`), 2 never reached a prompt. Per-origin remediation rates cannot be computed from this corpus; do not cite any. Instrumentation gaps to fix: arbitrator signal id (R33), HTG signal render (R30), `unobserved` classification for iterate-pass (R31).

Co-rendered sets per think (pendingGuidance keys plus signals), real: `{errorRecovery, loopDetected, requiredToolsPending}` in **61 thinks / 17 runs** (cogito:8b, gemma4:latest); `{errorRecovery, arbitrator signal}` 14; `{actReminder, head-truncation-guard}` 1 (the rerun); `{actReminder, gatherDedup}` 1. Conflicts found by rule: execute-vs-stop (actReminder with a requiredTools/arbitrator "go" signal) 1; plan-only vs go/stop nudge 2 (both gemma4:e4b reruns). So contradictions are rare in the data; **redundant stacking is the common case** (the 3-key pile-up is the loop-detected state, re-rendered every think).

## 4. Root-cause clusters (root assigned by upstream-first priority; degraded = failure or a degrading flag; n=151, 57 degraded)

"Touched" = runs with at least one degrading flag in that cluster (a run can touch several). "Non-bench" excludes the 33-run cogito:8b batch (n=118).

| rank | cluster (mechanism) | touched | % of all runs | % non-bench | % of degraded (57) |
|---|---|---|---|---|---|
| 1 | Tool-call protocol / engagement / healing / bookkeeping (R01-04, R15, R19, R34, R35) | 37 | 24.5 | 8.5 | 64.9 |
| 2 | Guard stack + strategy-switch history (R05-07, R13b, R25, R26) | 33 | 21.9 | 5.9 | 57.9 |
| 3 | Terminal / fallback deliverable sites (R07, R08, R09, R10, R11, R14, R22) | 21 | 13.9 | 10.2 | 36.8 |
| 4 | Guidance composition (R16-18, R29) | 20 | 13.2 | 5.9 | 35.1 |
| 5 | Instrumentation / evidence gaps (R30, R31, R33, R27) | 15 | 9.9 | 2.5 | 26.3 |
| 6 | Budget / window resolvers (R12, R21, R24) | 3 | 2.0 | 2.5 | 5.3 |

Root mechanism (single, upstream-first) over the 57 degraded: tool engagement 16 (all cogito:8b batch), identical-call repeat 9, abstained (honest) 5, arg/schema 5, text/shape tool call 4, verifier disagree 3, unclassified 3, plan-only unenforced 2, guidance stack 2, no-progress-to-guard 2, stall fallback 2, others 1 each. Caveat: the 16 "tool engagement" are one model on one batch.

Cross-model: cogito:8b carries 22 of 31 failures (66% failure rate, benchmark tasks with required tools). gemma4:e4b (55 runs, user-facing app) fails 2 but its quiet problem is the **success that was not a delivery**, which my output-text rules catch only in 4 runs overall. Frontier models: 7 failures of 23 (gemini-flash 3, gpt-4o-mini 3, gpt-4o 1), 5 of them honest abstains and 2 max-iter on impossible-task probes. Sonnet/haiku show none of the loop classes.

## 5. Top 3 clusters: the single boundary that removes the class

**A. Terminal / deliverable boundary (13.9% of runs; 10.2% of non-bench; mechanism proven).**
All 5 real R14 cases (success with `answer` unsatisfied) AND the lost trace of record terminated through `stall_deliverable` -> `terminate(...)` with `harness_synthesis` or `harness_deliverable`. The ledger writes `answer: satisfied` only in `recordTerminalVerdict` (`packages/reasoning/src/kernel/ledger/emit.ts:92-95`), and the stall paths terminate without consuming a verdict: `loop/runner-helpers/stall-deliverable.ts:381-405` calls `verifyAndEmit` and explicitly ignores the result ("the verdict isn't consumed here"), then `terminate()` at `:400-404`; the fast-escalate branch at `:225-240` does the same. One change: make every `terminate()` that carries a deliverable go through the one terminal gate (`runner-terminal-verify-gate.ts:215-250`) which consumes the verdict, writes verdict+requirement transitions, and stamps provenance on the deliverable, so a fallback can never be `success` while `answer` is `declared`. Removes R14 (5), R07/R08 success-with-no-delivery (up to 12 runs), the continuation-delivered cases that took the fallback path (2 of 4). Estimated 8-14% of runs. Domain warden: kernel-warden.

**B. Guidance composition from typed state (13.2% of runs, 5.9% non-bench; high severity on the user's own runs).**
Anchors: `packages/reasoning/src/context/guidance.ts:55` (requiredToolsPending renderer), `kernel/capabilities/reason/think.ts:194` (`actReminder: pending?.actReminder`), `kernel/capabilities/act/conversation-assembly.ts:187,243` (the two `actReminder` producers: "progress"/"finish now" text emitted from message history, independent of run posture or todo state). One change: render guidance in one function from `{posture, requirementsOutstanding, evidenceToolsUsed, loop state}` with a precedence rule (plan-only suppresses actReminder and requiredTools "go"; actReminder is suppressed until at least one non-meta evidence tool has run). Removes R16, R17, R29 (3 runs) and collapses the R18 pile-up (17 runs, 61 thinks) into one line. Estimated 8-13% of runs (R18 is cogito/gemma local, partly benchmark-driven). Domain warden: kernel-warden (plan-posture is uncommitted work in `packages/runtime`/`core`; runtime-warden for the posture type).

**C. Tool-call protocol + bookkeeping (24.5% of runs but 8.5% non-bench; two distinct causes).**
(i) Todo/bookkeeping: harness should own the checklist. `packages/tools/src/skills/todo.ts:255` accepts `add` of an already-present list and answers with prose ("Skipped 4 duplicate"), which a small model reads as "try again"; in the trace of record it re-added 4 times. One change: an `add` that duplicates the open list returns the list with an explicit "already recorded, next: <step>" and the checklist seeding becomes harness-side (`runtime/src/chat/todo-seed.ts` is already modified in the working tree). Evidence is thin: 1 real rerun + the lost trace; synthetic 6/5,706. (ii) Tool engagement / identical-call repeats: 16 R35 + 17 R03 + 6 R19 runs. Anchor is the think-response dispatch, `kernel/capabilities/reason/dispatch-think-response.ts` (~:746 area; not read in depth, domain warden to confirm), where text/shape tool calls, repeated identical calls and arg errors should map to one typed recovery. Estimated 8-15% of runs (non-bench 8.5%, bench-inflated to 24.5%). Domain warden: tools-warden (todo), kernel-warden (dispatch).

Guard arbitration (rank 2 by touched share) is mostly the same runs: R13b/R25 are 15 and 11 cogito:8b batch runs; without the batch it is 5.9%. It folds into A (stall_deliverable is a guard acting alone) and B.

## 6. Hypotheses H1-H6 against the evidence (ranked by affected-run share)

| rank | hypothesis | affected (all / non-bench) | verdict | why |
|---|---|---|---|---|
| 1 | H2 harness-owned bookkeeping + tier-adaptive scaffolding | 37 runs, 24.5% / 8.5% | **REFINES** | Bookkeeping proper (todo) is 1 real run + the lost trace: too small to rank. The mass is tool engagement/healing on small local tiers (cogito:8b zero-tool failures, repeat calls, arg errors). Keep "tier-adaptive scaffolding", demote "bookkeeping" to a targeted fix. Single-batch dominated. |
| 2 | H5 guard arbitration (guards acting alone) | 33 runs, 21.9% / 5.9% | **REFINES** | stall_deliverable acts alone and bypasses the verdict/ledger (cluster A, mechanism proven). Strategy-switch no-recover (16) and arbitrator redirects (11) are cogito:8b-batch dominated and cannot be generalised. |
| 3 | H3 one deliverable/terminal boundary with provenance | 21 runs, 13.9% / **10.2%** | **CONFIRMS** | Strongest: 6 of 6 known success-with-answer-outstanding runs share one unguarded terminate path; the highest non-bench share of any cluster; 2 of the 4 continuation-as-deliverable runs ended via harness_synthesis (the other 2 have no terminatedBy). Fixable at one call-site family. |
| 4 | H1 single-voice guidance from typed state | 20 runs, 13.2% / 5.9% | **REFINES** | The common failure is redundant stacking (61 thinks with the same 3 keys), not contradiction (3 runs). The plan-only/actReminder contradiction is real and reproduced twice on the user's flagship model, so severity high, volume low. |
| 5 | H6 trace -> replay regression | evidence base itself: 98% of traces synthetic, 20 signals / 14 untraceable, trace of record deleted | **CONFIRMS (strongly, and it blocks the rest)** | Without a protected corpus the other five cannot be verified. Needs: separate real-run trace dir from test output (or exempt real providers from prune), keep failing runs, stamp signalId on all emitters. |
| 6 | H4 one resource-budget resolver | 3 runs, 2.0% / 2.5% | **REFINES (low share, high severity)** | In the run of record the guard dropped tools on a 1,113-token prompt because the 7,200 output reserve plus prompt exceeded num_ctx 8192, and projection used window 32768 vs guard 8192. Silent total loss of tools is catastrophic but I found it in 1 of 151 runs (the other in the rerun). Likely already addressed by `15143c57d`/`4bffd6864`; verify by replay, do not prioritise on volume. |

Order for dispatch: H3 (terminal boundary) first, then H6 (evidence protection) in parallel because it is cheap, then H1/H2 together on the plan-posture + todo + engagement slice.

## 7. Caveats

- n=151 real runs, 22% from a single benchmark batch, 38% from one app (forge, gemma4:e4b, 57 runs, mostly successful chat). Cluster shares swing by 2-3x with and without the batch (shown above). No confidence intervals are meaningful; treat <5-run counts as anecdotes.
- Selection bias: kept runs are probes and dev sessions, skewed to failure scenarios; frontier models are mainly impossible-task probes, so their abstain/max-iter counts are not failure rates.
- Pruning bias: surviving real traces are those not yet pruned or those saved in the Trash. The failure I was asked about was deleted mid-mission, so its numbers are from my own read, not re-computed by the script.
- Rule limits: R10 is a last-sentence regex (4 hits; earlier looser draft produced 18 false hits on "let me know ..."); R14 only applies to traces whose ledger records any `satisfied` (older traces never do); R35 treats "zero tool calls" as engagement failure even when the task needed none; `terminatedBy` is absent in 90 older traces, so terminal-site attribution misses them; root assignment is upstream-first priority order, not causal proof; "degraded" includes any flagged success. Synthetic (test-model) runs are reported separately and excluded from all shares.
- Not done: no per-iteration `llm-exchange` request-message-order audit beyond tool-surface vs called-tool (R34, 1 hit; surface events missing in old traces); no replay confirmation of any boundary claim; `dispatch-think-response.ts` anchor unverified.

## 8. Proposed new FM ids (proposals only; not added to the catalog)

| id | name |
|---|---|
| P-FM-1 | Model-owned checklist: add repeated, never closed |
| P-FM-2 | Fallback deliverable sites deliver without the terminal gate (stall_deliverable / harness_synthesis) |
| P-FM-3 | Continuation sentence shipped as the answer (detector narrow; third shape since patched) |
| P-FM-4 | Output reserve vs window: tools dropped on a small prompt; two window resolvers disagree |
| P-FM-5 | Success with `answer` requirement unsatisfied |
| P-FM-6 | Plan-only / posture instruction not enforced |
| P-FM-7 | Guidance stacking and contradiction in a single think |
| P-FM-8 | Signal lifecycle untraceable (no signalId, never rendered, unclassified effect) |
| P-FM-9 | Evidence loss: real-run traces pruned by test-generated traces |
