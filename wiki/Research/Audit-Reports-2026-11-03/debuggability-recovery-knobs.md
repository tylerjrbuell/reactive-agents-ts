---
type: audit-report
status: draft
created: 2026-11-03
tags: [harness, trace, debuggability, recovery, ablation, mechanism-registry, rax-diagnose, failure-taxonomy]
plan: "[[../../Planning/Implementation-Plans/2026-11-02-harness-convergence]]"
extends: "[[../Audit-Reports-2026-11-02/harness-leverage-diagnosis]]"
---

# Debuggability, recovery, and knobs (2026-11-03)

Docs-only. No source edits, no live model runs. Evidence tags: **[V]** verified this pass (trace read or grep), **[C]** cited from a prior filing, **[H]** hypothesis. Does not repeat the 10-29 tracing audit, the 11-02 diagnosis/long-horizon audits, or Plan 8; it tests them against real traces and answers three new questions.

Sample: `~/.reactive-agents/traces` (path from `packages/trace/src/paths.ts`) holds 2,547 files; 2,515 have a root `run-started`; **79 are real-model runs** (provider != test). Plus the 43-cell wire corpus (`wiki/Research/Harness-Reports/2026-11-02-wire-corpus/cells`, 4 gemma4 cells at 3 reps, includes the new `wire-request` fact). I read 14 failing or short runs in full (table 1.1) and ran `analyzeRun` (`packages/trace/src/analyze.ts:541`) on 12 of them.

## 0. Bottom line

1. **Q1: no, not decisively.** Of 14 sampled runs, the trace alone gave a decisive root cause for **5**, a partial one for **7** (cause inferable only with source knowledge, or a decision visible but not its inputs), and none for **2**. The existing analyzer produced a *cause* for 0 of 12 runs and any failure-mode tag for 2 of 12 (both `overlap-storm`, which is a symptom). The traces contain the facts for most cases; what is missing is **decision provenance** (thresholds vs observed values, who set the final label, which inputs a verifier saw) and **run configuration** (`run-started.config` is `{}` in 75 of 75 real runs, `normalize.ts:72`).
2. **Q2: the harness has ~25 distinct ways to end a run and only 3 families of real recovery.** In 79 real runs, 35 ended non-successfully (31 `failure`, 4 with no `run-completed`); recovery changed the outcome in at most 2 (strategy switch followed by success, 2 of 9 switched runs). The biggest unhealed give-ups are provider/config errors at iteration 0 (9 runs, 0 retried), verifier-reject-to-failure with no repair loop on the kernel path (4+11 runs), and guard-driven harness_deliverable after the work was done (5 runs). A typed per-failure-class `RecoveryPolicy` is feasible by composing actuators that already exist (section 2.4).
3. **Q3: the ablation surface covers prompt/tool-surface flags and 4 registered capabilities, not the guards.** Zero of ~14 give-up/steer guards have an off switch (section 3.2). A 1-table `MechanismRegistry` that converges `CapabilityRegistry` (4 entries), `harness-flags.ts` (11 flags), `HarnessConfig` (12 fields) and ad-hoc env reads (7 more) is the minimal change; recording it in `run-started.config` is a 10-line fix with the largest diagnostic payoff in this report.

## 1. Q1: Debuggability

### 1.1 Sample and per-run sufficiency (trace alone)

S = decisive from trace alone; P = partial (needed source or inference); N = not answerable.

| # | Run (model) | Outcome | Root cause I reached | Trace verdict | What was missing |
|---|---|---|---|---|---|
| 1 | `01M64EZXWP` qwen3.5 | failure, `max_iterations` at 6 LLM calls | Task "execute the todo list plan" had no referent; model looped `todo` (add, done, dup-add); loop detector switched strategy at iter 2 (`pattern=d`) | P | Cap value and counter at termination (default 10, `types.ts:991`; run ended at 6 exchanges); terminal-decision metadata `terminatedBy:null`; verifier verdict stamped `iter:15` vs loop iter 6 |
| 2 | `01M64F0BFT` qwen3.5 (title-gen) | failure/`abstained`, output "Execute Todo List Plan With Title" (correct) | Utility prompt run as a full agent run; loop detector fired "3 consecutive thinking steps, no tool calls" on a tool-less task; then labels disagree | P | `terminal_decision` says `loop_graceful`/`done`, verifier says 10 checks passed, `run-completed` says `failure`/`abstained`. Nothing names the site that overrode |
| 3 | `01M64FYK1G` Nemotron-E4B | success/`harness_deliverable`, 7 iters | Task completed (both todos done, message sent); model never emitted a final answer; stall guard fired at `consecutiveStalled:4` | S | Threshold (4 vs 2) not recorded; success-vs-`deliverable_decision:block` disagreement is visible but unlabelled |
| 4 | `01M64GFPC0` gemma4 umami | failure/`end_turn` | Model passed domain as `websiteId`, tool rejected; redirect `(1/2)` then loop-switch; recovered by iter 3; final answer rejected for "fabricated measurement '24 hours'/'300%'" | P | Verdict names the values but not the observation set it was compared against; "24 hours" is an echo of the prompt, so likely a false positive, **not provable from the trace** |
| 5 | `01M64FAGTC` gpt-5.6-sol (+8 more) | failure/`llm_error`, iter 0 | 400 "Function tools with reasoning_effort not supported" | S | Error is a string; no class (config-permanent vs transient), `provider:"unknown"` in 66/75 exchanges |
| 6 | `01M6FCTC1E` cogito:14b | failure/`abstained` at iter 0 (x3) | Goal-judge prompt ("You judge progress on a goal...") entered the kernel as a task; satisfiability preflight matched "open ... bug" -> required "create-ticket" action, `available=[(none)]` | S (what) / N (why a judge prompt is an agent task) | Caller identity (chat, goal-judge, title-gen) is not in the trace. 10 of 79 real runs are such utility prompts [V] |
| 7 | `01M6FCTC83` cogito:14b (goal segment 2) | failure/`end_turn`; "fabricated measurement 96%" | The numbers came from segment 1's tool results; this run's ledger has 0 tool calls, so the verifier saw no observations | P | No event says the evidence set was empty or that evidence belongs to a prior segment (inferred from `tool-call-end` count = 0) |
| 8 | `01M6FDA26W` haiku-4.5 umami | success/`harness_deliverable`, 75,221 tok | Work done by iter 5 (`evidenceDelta` 5); iters 6-7 only `todo done`; stall guard took over; `deliverable_decision:block` yet `success` | P | `band` is not a function of `burnRatio` (iter1 `economize` at 0.1, iter2 `green` at 0.2, iter4 `economize` at 0.4); hidden input unrecorded. Verifier `iter` 39 vs real 7 |
| 9 | `01M6FFZ2KV` grok-4 | failure/`end_turn` | Never engaged: 11 of 11 calls `todo`, `web-search` visible and never called; final answer fabricated ("500 ms") and correctly blocked | S | Fine as is; "never-engaged" is derivable (visible real tools > 0, real calls = 0) |
| 10 | `01M6FMC04N` gemma4:e4b, plan posture | failure/`max_iterations` | Posture left only `todo`+`final-answer`; model re-added semantically duplicate items (list grew 2 -> 7), never produced the "present the plan and stop" text | P | Rendered posture guidance text per think is not recorded; exact-duplicate check passes paraphrases |
| 11 | `01M6FMNY26` e4b x11 identical | failure/`end_turn` on "reply with the single word pong" | Task string embeds the whole history; contract compiled `artifact:./btc.txt` from the *old* turn; model echoed the old completion; kernel verifier verified, then a second (runtime tier1) verifier set failure | P | Requirement provenance (which text span created `artifact:./btc.txt`); which verifier owns the final status. `terminal_decision.status=done` vs `run-completed.failure` |
| 12 | `01M6FDKPEN` gemini-2.5-flash (+3) | no `run-completed` | Run ended mid-iteration | N | No abort/crash/timeout sentinel: cannot tell kill vs crash vs hang. 4 of 79 runs |
| 13 | wire cell `e4b U2 r0` | success, cell `pass:false` | Model had 25 tools incl. `list_websites`, asked the user for the website ID instead of looking it up; verifier `verified:true`, `deliver` | S (what) | Contract floor is `question-answered`; a clarifying question satisfies it. Nothing flags "0 tool calls, N shipped" |
| 14 | wire cells `e4b U2 r1`, `e4b U5 r2`, `12b U1 r0` | success, `pass:false` | Tools ran, results coherent; I cannot say what the grader wanted (one call used 2023 epochs against 2026 data) | N | Grader expectation lives outside the trace |

Tally: **S 5, P 7, N 2** over 14 (4 of the 14 rows bundle 2-9 runs of the same shape, so run coverage is larger than 14). I knew the source while reading; a reader without it would drop several S to P.

### 1.2 Cross-corpus facts behind the table [V]

- **Label disagreement:** `terminal_decision.status` vs `run-completed.status` disagree in **16 of 75** real runs (all "done" vs "failure": 11 e4b `end_turn`, 3 cogito `abstained`, 2 `loop_graceful`->`abstained`). The 10-29 audit's L6 is still live, and `terminal_decision` now carries `intent`, `verdictSummary`, `alternatives` (new since 10-29; 16 older runs lack `intent`), which makes the disagreement *detectable* but not *attributable*.
- **Config unrecorded:** `run-started.config` is `{}` in 75/75; `normalize.ts:72` only writes `{posture:"plan"}`. No flag, wither, env override, or profile reaches the trace, so "which run had which mechanisms" cannot be answered, and ablations cannot be audited post hoc.
- **Stamps:** `tool-call-end.iter` is `-1` in 131/131 events; `verifier-verdict.iter` and `strategy-switched.iter` use different counters (15, 21, 39 vs real 6-7). Any "iterations" derived from max(iter) is inflated (the diagnosis audit's "max 9" is probably the same artifact).
- **Provider:** `llm-exchange.provider` is `"unknown"` in 66 of 75 runs with exchanges (the `wire-request` guard-fired record has the real provider but appears only in the wire-corpus cells, 0 of the 79 live runs).
- **Signals:** `signal-rendered` in 1 run, `signal-effect` in 10 [V]; 22 of the 43 opened signals are `environment-update`.

### 1.3 What `rax-diagnose` / `analyzeRun` reports vs the raw trace [V]

`rax-diagnose` has 7 commands (`list, replay, replay-run, grep, diff, debrief, signals`) and 2 detectors (`signal-gap-detector.ts`, `leak-detector.ts`). `analyzeRun` (`analyze.ts:541`) returns honesty, interventions, pressure, cost, reasoning trajectory, tools, `failureModes`, `coverage` (blind spots), `wire`. Running it on 12 of the sample runs gave:

- `honesty.label`: `honest-failure` for all 9 failures (it reads `status`, so the run #11 mislabel and run #2's correct-but-failed title are both "honest-failure"); `claimed-success (unverified)` for the 2 stall runs.
- `failureModes`: only 5 modes exist in code (`overlap-storm`, `nudge-loop`, `recall-loop`, `runaway-tokens`, `max-iter-no-progress`, lines 249-270). Fired: `overlap-storm` x2 (runs 3, 8). Nothing fired for runs 1, 2, 4, 6, 7, 9, 10, 11.
- `coverage.blindSpots` lists what the trace lacked per run; this is the right mechanism and is the hook for section 1.5.

So the analyzer reports *interventions and costs*, not *why the run failed*. No classifier outputs a cause label.

### 1.4 Missing trace signals, ranked by diagnostic value

Value = (runs in the sample it would have turned from P/N to S) x (generality). Emit sites are file:line where verified, else the owning function.

| Rank | Signal | Emit site | Runs unlocked | Classifier use |
|---|---|---|---|---|
| 1 | **Run config + mechanism states in `run-started.config`**: wither set, profile, env overrides, effective value of every registry mechanism (section 3.3) | `trace/src/normalize.ts:72`; runtime stamps on `AgentStarted` at `runtime/src/engine/execute-agent-started.ts:~100` | all (75/75 blank) | makes every ablation auditable; `config-differs` joins |
| 2 | **Terminal authority**: `run-completed.authority` = which site set `status` (kernel terminal gate / runtime verifier gate / goal supervisor / error path) and the verdicts consulted | `run-completed` publisher; second verifier at `runtime/.../verification-quality-gate.ts:43` | 2, 3, 8, 11 (16/75 runs disagree) | `terminal-mislabel` is then a deterministic equality check |
| 3 | **Guard state at fire**: `{guard, threshold, observed, window}` for stall (`stall-deliverable.ts:236`), low-delta (`iterate-pass.ts:701`), F3 redirect, loop detector pattern, `max_iterations` (cap and llmCalls), pace band inputs | `emitGuardFired` metadata at the 23 sites | 1, 3, 8, 10 | `stall` vs `budget` vs `cap` distinguishes "stuck" from "ran out of corridor" |
| 4 | **Typed LLM error class** `{class: config|auth|quota|rate|timeout|context-overflow|unsupported-params|transient, retryable, retriesUsed}` + real provider on every exchange | provider `mapProviderError`; `llm_error` terminal at `runner.ts` | 5 (9 runs) | `provider-config` / `quota` / `context` classes; basis for `RecoveryPolicy` |
| 5 | **Verifier evidence set**: for each reject, `{inspectedChars, observationIds, matchedValue, candidateRef}` | `verifier-verdict` emit (`verify/verifier.ts`) | 4, 7, 9 | separates false-positive-fabrication from true fabrication, `context-loss` |
| 6 | **Abort/crash sentinel**: `run-aborted{reason: killed\|crash\|timeout\|unknown}` written on process exit hooks, or a `run-heartbeat` tail | recorder `close()` + `process.on("exit")` | 12 (4 runs) | `incomplete-trace` class instead of silent drop |
| 7 | **Caller identity / entry path** on `run-started`: `{origin: chat\|goal-judge\|title-gen\|segment\|user, parentConversationId}` | `AgentStarted` publisher | 2, 6, 7 (10 utility runs) | `misrouted-utility-prompt` (these should not hit the full kernel) |
| 8 | **Contract provenance**: per requirement `{id, source: regex-span\|writer-tool\|self-critique-floor, span, fromHistory: bool}` | `contract-compiled` emit (`contract/run-contract.ts`) | 11, 13 | `contract-pollution`, `weak-contract` (floor-only) |
| 9 | **Guidance composed per think** `[{field, chars, signalId}]` + posture guidance text hash | `think.ts:541-587` (10-29 P5) | 10 | `model-saw` question |
| 10 | **Single monotonic `iter`** on every event; fix `-1` and verifier counters | `diagnostics.ts` emit helpers | 1, 8 | iteration counts and ordering become trustworthy |
| 11 | **Band derivation**: `{band, burnRatioInputs, tokenRatio, thresholds}` on `assessment` | `assess.ts:390-395` | 8 | removes a contradiction the reader must resolve |
| 12 | Grader/expectation reference for benchmark cells (`expected`, `graderResult`) written next to the trace | bench runner, not kernel | 14 | the only way to explain `pass:false` with clean traces |

Most of rank 2-5 restate 10-29 P3/P7/P12; the new contributions are 1 (config), 4 (error class), 6 (abort sentinel), 7 (caller identity), 8 (provenance), 12 (grader), and the measured disagreement rate.

### 1.5 Failure-cause taxonomy computed from the trace [H, prose prototype]

Deterministic, ordered rules; first match wins; every rule reads fields that exist today unless marked (+N = needs rank-N signal). The output is a `cause` plus the `evidence` event ids, appended to `RunAnalysis` next to `failureModes`.

1. `incomplete-trace`: no `run-completed` (rule uses existing data; +6 distinguishes the sub-cause).
2. `provider-error`: `terminatedBy=llm_error`; sub-class from the error string today (regexes for `credit balance`, `no API key`, `not supported`, `413|too large`, `reasoning_effort`), exact via +4.
3. `satisfiability-abstain`: `satisfiability-preflight` guard present; flag `utility-misroute` when task prefix matches title/judge templates (+7 for exactness).
4. `terminal-mislabel`: `terminal_decision.status` != `run-completed.status`, or `verdict.verified && status=failure`, or `deliverable_decision=block && status=success` (all existing fields; 16 + 5 hits in the sample corpus).
5. `contract-pollution`: task begins with `--- Conversation history ---` and a requirement id matches text that occurs only before `--- Current message ---` (existing fields; +8 exact).
6. `never-engaged`: iterations >= 1, real (non-meta) tool calls = 0, visible real tools > 0, terminal = `end_turn`/`final_answer` (runs 9, 13; also catches "asked the user" success).
7. `tool-protocol`: `strategy-switched.reason` contains `consecutive-thoughts` or unresolved-call guard fired, or `tool-call-end.ok=false` repeated with same args (run 4 start).
8. `wrong-tool/arg`: first `ok=false` followed by a different tool/arg success (run 4).
9. `stall-after-work`: `stall_deliverable` fired AND `evidenceDelta>0` earlier AND last 2 iterations are meta-only (runs 3, 8); contrast `stall-no-progress` when evidenceDelta was 0 throughout.
10. `bookkeeping-loop`: meta-tool share >= 0.6 and `max_iterations`/low-delta/switch (runs 1, 10; census R15).
11. `verifier-reject`: `deliverable_decision=block` with reason; sub-tag `context-loss` when the run has 0 tool calls but the rejected values appear in history (run 7), else `fabrication`.
12. `budget/cap`: `max_iterations` or `budget_exceeded` with `evidenceDelta>0` in the last 2 assessments (`cap-cutoff`, long-horizon audit F-C); else covered by 10.
13. `model-incapable`: residual with `ok=true` tools, no guard involvement, and cross-tier comparison (same task passes on another model in the corpus). This label requires a comparison set and is only assignable in cohort mode (`trace/src/cohort.ts` exists).

Feasibility: **yes, now, for rules 1-6, 9, 10, 12** (9 of 13) using today's fields; I could assign a cause to runs 1, 2, 3, 5, 6, 8, 9, 10, 11, 13 by these rules (10 of 14). Rules 5, 7, 8, 11-sub, 13 improve with signals 4, 5, 7, 8. Risks: regex rules (2, 3) need goldens; `model-incapable` can only be a residual, never a positive finding, which keeps the classifier honest. Place it in `packages/trace/src/analyze.ts` beside `analyzeRun` (pure function, replay-testable on the 79-run corpus plus fixtures), expose through `rax-diagnose cause <run>` and `RunAnalysis.cause`; per Rule 5 of the research discipline, validate by hand-labelling the sample above and requiring >= 90% agreement before shipping.

## 2. Q2: Recovery

### 2.1 Every place a run ends badly [V unless noted]

Terminal reasons are `TerminateReason` (`kernel/loop/terminate-reason.ts`, 25 literals + 2 templates). Direct `terminate()` call sites (grep this pass): `iterate-pass.ts:443,701,781,1078`, `iterate-control-plane-seams.ts:100,172,243`, `iterate-run-ctl-checkpoint.ts:45`, `runner.ts:640,837`, `runner-post-loop-deliverable.ts:210`, `loop-resolution.ts:172,223,253,263`, `pace-terminal.ts:133`, `stall-deliverable.ts:236`, `dispatch-think-response.ts:545`, `unresolved-tool-call.ts:163`, `act.ts:287,324`. Plus the runtime error path (`llm_error`, `kernel_error`) and the runtime verification gate.

| Give-up | Site | Corpus count (79 real) | Recovery available? | Configured/typed? |
|---|---|---|---|---|
| `llm_error` (config, auth, quota, unsupported params, 413) | provider -> `runner.ts` terminal | **9** | Only `retryPolicy` (3x exp backoff, rate-limit + timeout only, `llm-provider/src/retry.ts:14`); `LLMContextOverflowError` is defined (`errors.ts:64`) but **never constructed or caught** anywhere (grep) | Policy fixed in code; `llm-retry.ts` in runtime has `maxRetries` for tools-level |
| `max_iterations` | arbitrator `max-iterations` intent; default 10 (`types.ts:991`) | 2 | Terminal synthesis (`pace-terminal.ts:133`, `budget_terminal`) exists but only under horizon [C 11-02 F-C] | `.withLongHorizon()` only |
| `stall_deliverable` -> `harness_deliverable` | `stall-deliverable.ts:236` | 5 | Delivers partial; success status despite `deliverable_decision:block` | threshold 2 (RI: 4); no knob |
| `abstained` (preflight, zero-evidence stand-down, forced) | `runner.ts:640,837`, `iterate-pass.ts:443` | 5 | None; abstain is final | none |
| verifier reject => `failed` (`deliverable_decision:block`, `chosen:none`) | arbitrator / `runner-terminal-verify-gate.ts` | 4 direct + 11 pong | Runtime path: `maxVerificationRetries ?? 1` (`verification-quality-gate.ts:43`) only when `enableVerification`; **kernel path has none** | runtime only |
| `loop_graceful` / loop-detected | `loop-resolution.ts:172-263` | 2 (both mislabelled) | Strategy switch first (9 runs switched), then terminate | `strategySwitching.enabled/maxSwitches` |
| `low_delta_guard`, `oracle_forced`, `switching_exhausted` | `iterate-pass.ts:701,1078,781` | 0 | Deliver passthrough | horizon-scaled only |
| `tool_call_unresolved` | `unresolved-tool-call.ts:163`, `loop-resolution.ts:253` | 0 | Strike counters; reset on switch [C R6] | none |
| `awaiting-approval/interaction` | `act.ts:287,324` | 3 (counted as success) | By design (HITL) | `interaction` autonomy modes |
| `budget_exceeded` / `budget_terminal` | arbitrator `:225`, `pace-terminal.ts` | 0 | Terminal synthesis (horizon) | run budget meter |
| No `run-completed` (kill/crash) | none | 4 | Crash-resume exists for durable runs (`resumeState`, `runner.ts:306-335` [C]) | `durable-facade.ts` opt-in |
| Context overflow / head-truncation | `prepare-think-gateway-call.ts` guard | 17 fires in 7 runs [C 11-02] | Clamps output, drops tools; never compacts and resumes | none |

### 2.2 Existing recovery mechanisms (reusable actuators)

1. **Strategy switch** (`loop-resolution`, `strategy-switch.ts`): 9 of 79 runs switched; outcomes: success 2, failure 6, unfinished 1. Resets 5 counters.
2. **Error-recovery redirect** (`repeated-identical-failure`, budget "(1/2)"): fired in run 4, recovered the tool path. Free-text guidance via `PendingGuidance.errorRecovery`.
3. **Runtime verify-retry** (`verification-quality-gate.ts`, default 1) and **continuation passes** (`reasoning-harness-hooks.ts:197-213`, folds prior answer + absorbed ledger).
4. **Healing pipeline** (`packages/tools/src/healing/`: tool-name, param-name, param-structure, path, judgment healers) on tool calls.
5. **Provider retry** (`retry.ts`, complete + stream-before-first-event only).
6. **Structured-output retry-once**, **crash-resume via ledger** (`resumeState`), **auto-checkpoint** (once per run), **terminal synthesis** (`pace-terminal.ts`, horizon-gated).
7. Not a recovery but a lever: **ask the user** (`awaiting-interaction`, `request_user_input` tool).

### 2.3 Biggest unhealed give-ups (ranked by count and fixability)

1. **Provider/config errors at iteration 0: 9 runs, 0 healed.** 4 are deterministic param-compat faults (gpt-5.6-* `reasoning_effort` with tools, x3; `tool calling` unsupported on allam-2-7b) that a one-field retry (`reasoning_effort:"none"` or `/v1/responses`, or drop tools) would clear; 2 are `413 Request too large` (qwen3.8-27b on 26 MCP schemas) that a tool-surface prune would clear; 3 are credit/key/model-id (only `ask-user`/`escalate-model` apply). The context-overflow class is dead code.
2. **Verifier-reject with no repair on the kernel path: 15 runs** (4 distinct + 11 pong). Run 4's answer was a likely false positive; run 7 lacked prior-segment evidence; run 9 was a never-engaged model. A kernel `verify-retry-with-guidance` (re-run synthesis with the rejected check named) is the existing runtime pattern moved into the loop.
3. **Stall guard after the work is done: 5 runs** deliver harness synthesis, labelled success, with the verifier saying the output is not model-authored. Healing = one forced model synthesis turn (`compact-and-synthesize`) before giving up, which `pace-terminal.ts` already does for budget.
4. **Never-engaged / clarifying-question as success: runs 9, 13** (+ the 24 history-wrapped runs unknown). No guard asks "tools visible, 0 used".
5. **Abstain false positives: 3 preflight, 2 loop_graceful**; abstain has no "second opinion" path.
6. **Silent aborts: 4 runs.**

### 2.4 Typed, user-composable `RecoveryPolicy` [H]

Principle (Rule 5, deterministic over LLM-driven): classification uses the section 1.5 taxonomy computed *inside* the run from the same deterministic facts; the policy only maps class to action. One new type, no new mechanism: each action reuses an existing actuator.

```
type FailureClass = "provider-config"|"provider-quota"|"provider-transient"|"context-overflow"
  |"tool-arg"|"tool-protocol"|"stall-after-work"|"stall-no-progress"|"bookkeeping-loop"
  |"verifier-reject"|"never-engaged"|"cap-cutoff"|"abstain-disputed"
type RecoveryAction =
  | { kind:"retry-with-guidance"; guidance: string; max: number }      // PendingGuidance + re-think
  | { kind:"adjust-request"; patch: "reasoning_effort-none"|"drop-tools"|"prune-tools" }
  | { kind:"switch-strategy"; to?: string }                           // strategy-switch.ts
  | { kind:"compact-and-resume" }                                     // auto-checkpoint + ledger handoff
  | { kind:"force-synthesis" }                                        // pace-terminal synthesis, any trigger
  | { kind:"replan" }                                                 // plan-execute-reflect, checklist from contract
  | { kind:"escalate-model"; to: ModelRef }                           // provider layer
  | { kind:"ask-user" }                                               // awaiting-interaction
  | { kind:"give-up" }                                                // today's behavior
type RecoveryPolicy = Partial<Record<FailureClass, readonly RecoveryAction[]>>  // ordered ladder
```

Design points:
- **Default = today's behavior** (`give-up` everywhere except the already-live redirect/strategy-switch/provider-retry rows), so adding the type changes no default and needs no lift gate; each *non-default* ladder entry is an opt-in that ablation-warden then measures.
- **Surface:** `.withRecovery(policy)` as the single new wither (replaces nothing; absorbs the scattered `maxVerificationRetries`, `strategySwitching`, `requiredTools.maxRetries` over time). Presets: `Recovery.none()`, `Recovery.standard()`, `Recovery.aggressive()` (HarnessProfile pattern).
- **Evidence:** every action emits `recovery-attempted{class, action, attempt, outcome}` and the run-level `recoveries[]` list lands in `run-completed`; policy appears in `run-started.config` (rank-1 signal).
- **Bounds:** global `maxRecoveries` per run plus the run budget meter, so ladders cannot loop; a recovery counts as an iteration for cap purposes unless `force-synthesis`.
- **Routing:** kernel-side actions (`retry-with-guidance`, `force-synthesis`, `switch-strategy`, `replan`) -> kernel-warden; `adjust-request`, `escalate-model` -> provider-warden; `.withRecovery` -> runtime-warden. Terminal funnel (Plan 8 K1) must land first so actions go through `terminate()`/arbitrator proposals rather than adding a 26th direct site.
- **Cheapest first slice (no kernel work):** provider-config class only: map the 4 deterministic 400s and the 413 to `adjust-request` once, using the typed error class (rank-4 signal). Measurable with zero live tokens by a fake-provider golden.

## 3. Q3: Knobs and ablatability

### 3.1 User-facing composition surface today [V]

| Surface | What it controls | Granularity |
|---|---|---|
| `ReactiveAgentBuilder` | 91 distinct `with*()` methods in `runtime/src/builder.ts` plus 13 wither files under `builder/withers/` | capability-level |
| `.withHarness({...})` | `HarnessConfig` 12 fields: `lazyDisclosure, toolDiscovery, toolIndex, toolIndexMaxEntries, verboseRules, recencyBudgetChars, toolResultBudgetChars, auditRationale, treeOfThoughtExploreBudgetMs, assemblyDebug, promptDumpPathPrefix, numCtxPolicy` (`runtime/src/harness-schema.ts:14`) | prompt/tool-surface only; **no guard fields** |
| `.withLeanHarness()` / `HarnessProfile.lean()/balanced()/intelligent()` | verifier no-op + strategy switching off (+RI, memory, skill persistence in the profile) (`builder.ts:1326`) | bundle; cannot isolate one mechanism |
| `.withLongHorizon()`, `.withAdaptiveHarness()` | scales guard constants to `maxIterations`; mid-run policy recompile | opt-in; `ablation: []` / INCONCLUSIVE [C] |
| `.withReasoning({enableStrategySwitching, maxSwitches, ...})` | strategy switching on/off | one guard |
| `loopDetection {maxSameToolCalls, maxRepeatedThoughts, maxConsecutiveThoughts}` (`kernel-state.ts:1208`) | thresholds of the loop detector | tune, not disable |
| `CapabilityRegistry` (`runtime/src/capabilities/registry.ts`) | 4 entries (`memory:147`, `reactive-intelligence:177`, `verifier:203`, `strategy-switching:228`) with cost signature, `liftEvidence`, owner | the only registry; narrow by design |
| Env: `harness-flags.ts` (11 resolvers) | `RA_LAZY_TOOLS, RA_TOOL_DISCOVERY, RA_TOOL_INDEX(+_MAX_ENTRIES), RA_VERBOSE_RULES, RA_RECENCY_BUDGET_CHARS, RA_TOOL_RESULT_BUDGET_CHARS, RA_RATIONALE_AUDIT, RA_TOT_EXPLORE_BUDGET_MS, RA_ASSEMBLY_DEBUG, RA_PROMPT_DUMP` | gated by `scripts/check-ablatable.sh` |
| Env, outside the resolver (7 mechanism-ish) | `REACTIVE_AGENTS_NOOP_VERIFIER` (`strategies/reactive.ts`), `REACTIVE_AGENTS_EVIDENCE_DELTA_RESET` (`guard-adapters.ts:36`), `RA_FABRICATION_GUARD` (`evidence-grounding.ts:108`), `RA_RECALL_GATE` (`think-guards.ts:625`), `REACTIVE_AGENTS_FORCE_TEXT_PARSE`/`TEXT_PARSE` (`runner.ts`), `RA_TOOL_OBSERVE_SYMMETRY`, `RA_THOUGHT_CONTINUITY` | each read at its use site; the check script excludes some by comment |

### 3.2 Mechanisms with NO off switch (cannot be ablated by flag) [V by grep of env + options in the owning files]

| Mechanism | Site | Evidence it is live |
|---|---|---|
| Satisfiability preflight | `runner.ts:608-640` | fired 3x in the sample, 3 false positives |
| Zero-evidence stand-down | `iterate-assessment-seam.ts:119-195`, `iterate-pass.ts:443` | default-on (11-02 table row 4) |
| Stall counter + `stall_deliverable` | `stall-deliverable.ts`, `guard-adapters.ts:88` | 5 runs; only horizon changes constants |
| Low-delta guard | `iterate-pass.ts:644-707` | legacy token-delta; evidence variant behind an env |
| F3 repeated-identical-failure redirect | `iterate-pass.ts:816-934` | fired in run 4 |
| Loop detector -> switch -> `loop_graceful` | `iterate-pass.ts:1127-1216`, `loop-resolution.ts` | 9 runs switched; thresholds tunable, no disable (switching has its own flag) |
| Head-truncation guard | `prepare-think-gateway-call.ts` | 17 fires / 7 runs |
| Plan posture | `kernel/policy/run-posture.ts` | per-request, not a mechanism flag |
| Environment-update signals | `reflect/environment-update.ts` | 22 of 43 signals |
| Checklist reminder / `todo` guidance | `reflect/checklist-reminder.ts` | default-on in chat |
| Terminal gate + grounded-terminal redirect, arbitrator evaluators | `decide/terminal-gate.ts`, `arbitrator.ts` | `RA_POST_CONDITIONS` flag was *deleted* (`arbitrator.ts:103`) |
| Verifier checks (individually) | `verify/verifier.ts`: `NOOP_VERIFIER` is all-or-nothing | `output-not-fabricated-measurement` caused 4 of the sampled rejects |
| Curator / projection compressions | `assembly/project.ts` | always on |
| Pace actions (economize/triage/terminal) | `iterate-assessment-seam.ts:225-288` | horizon-only (so "off" by default; no on switch outside horizon) |
| Provider retry policy | `retry.ts:14` | fixed 3 retries |

So the ablatability gate (Task 15) closed the *prompt/tool-surface flags*; it did not touch the *guards*, which are where the sampled failures come from. This confirms the 11-02 R5 vacuum from the opposite side: not only is lift unmeasured, most of the contested mechanisms cannot be turned off to measure it.

### 3.3 Minimal typed `MechanismRegistry` (converge, do not add)

One table in `packages/core` (leaf, so reasoning/runtime/trace all read it), seeded from the 4 `CapabilityRegistry` entries, the 11 harness flags, and the 15 rows in 3.2. No new env namespace: the existing flags and withers become **resolvers over this table**.

```
interface MechanismSpec<P = never> {
  id: MechanismId                      // "guard.stall-deliverable", "guard.loop-detector", "surface.lazy-tools", ...
  kind: "guard" | "steer" | "terminal" | "surface" | "assembly" | "capability"
  default: "on" | "off" | { on: P }    // default state; param type P when tunable
  owner: WardenOwner                   // reuse registry.ts type
  tierLift: Partial<Record<TierId, { deltaPp: number; tokenPct: number; evidence: string; at: string }>> | null
  legacyFlags?: readonly string[]      // env/wither names resolved through this spec
  verdict: "keep-default-on" | "opt-in" | "delete-candidate" | "unmeasured"   // derived from tierLift + lift rule
}
type MechanismState = { id: MechanismId; state: "on" | "off" | { on: unknown }; source: "default"|"wither"|"env"|"profile"|"bench-arm" }
```

Rules:
1. **Single resolver** `resolveMechanisms(builderConfig, env, profile): ReadonlyMap<MechanismId, MechanismState>` computed once per run (precedence: bench-arm override > wither > env > profile > default; same as `harness-config.ts` today). Kernel sites call `mech.on("guard.stall-deliverable")` from the resolved envelope (`RunEnvelope` already carries rails), not `process.env`.
2. **Every default-on mechanism has an entry or CI fails** (extend `check-ablatable.sh`: grep `emitGuardFired({ guard: "<id>"` and `terminate({ reason:` ids and require registry membership; this closes the "23 emit sites, 4 registered capabilities" gap mechanically).
3. **Trace:** the resolved map is written to `run-started.config.mechanisms` as `{id: state, source}` (plus `registryHash`). `analyzeRun` joins on it; cohort comparisons (`cohort.ts`) diff it. This is signal #1 of section 1.4.
4. **Verdict derives from the lift rule** (>= 3pp AND <= 15% tokens on >= 2 tiers): `tierLift: null` + default-on = `unmeasured`, which the existing ablation-warden CI check (M2.3) already treats as a flag. No new policy.
5. **Off must mean inert, not crash:** an off guard becomes a no-op proposal (`Proposal` not emitted), so Plan 8's "guards propose, gate disposes" funnel is the natural implementation point. Mechanisms that are *correctness* (terminal gate integrity, tool-policy choke point, path-traversal guard) are tagged `kind:"terminal"|"security"` with `ablatable:false`, so the registry is honest about what cannot be turned off.

Convergence map: `CapabilityRegistry` entries become `kind:"capability"` rows; `HarnessConfig` fields become `kind:"surface"|"assembly"` params; `withLeanHarness` / `HarnessProfile.lean()` become named presets over the table (set of ids -> off); `RA_*` flags stay as aliases through `legacyFlags`. Net new concepts: 1 table, 1 resolver, 1 trace field.

### 3.4 Ablation protocol hook points

1. **Arm definition:** `mechanismOverrides: Record<MechanismId, "on"|"off"|{on:P}>` on the bench cell spec (extends `packages/benchmarks`), resolved with source `bench-arm`; recorded in the trace (3.3-3).
2. **Instrument check before outcomes** (feedback_instrument_before_conclusion): runner asserts per arm that `mechanismFires[id]` (count of `guard-fired` with that id) is > 0 in the on-arm and 0 in the off-arm; a cell that fails this is void, not null.
3. **Rung 0 (zero tokens):** replay the golden + real corpus with the mechanism off (`packages/replay`); report control-flow divergence (existing rung-1 sweep), and now also the section 1.5 `cause` distribution before/after.
4. **Rung 2 (live):** ablation-warden matrix over `tier x task x arm`, k >= 5, billed tokens (07-28 instrument), pass^k; verdict written to `tierLift` and the spec `verdict` field (single source, replaces prose in reports).
5. **Void rules:** tool-surface per arm printed first (`wire-request.toolsShipped`); `registryHash` equal across arms except the toggled id.
6. **Priority ablations the table makes possible:** `guard.satisfiability-preflight` (3 false positives in sample), `guard.stall-deliverable` x `meta-calls-excluded`, `verifier.fabrication-check`, `guard.strategy-switch`, `steer.environment-update`, `steer.head-truncation-notice`.

## 4. What the sample cannot show

- **Population rates.** 79 real runs, most from the owner's own probes (todo-heavy umami/XRP/BTC prompts, 11 identical e4b reruns, 10 utility prompts). Counts are descriptive; "16 of 75 disagree" is a lower bound on a probe-skewed set, not a rate.
- **Correctness of outputs.** I judged no answer against ground truth; cell `pass:false` needs the (absent) grader. Runs 4 and 14 may be false positives or true misses.
- **Counterfactuals.** That a recovery action "would have healed" a run is a hypothesis; nothing here was re-run. In particular the `reasoning_effort` and 413 fixes are inferred from error text.
- **Long runs.** Deepest real run reached 7 true iterations (the "39" is a stamp artifact); no run exercises the long-horizon guards.
- **Classifier accuracy.** The 10-of-14 figure is me applying proposed rules by hand after seeing the answers; it is an upper bound until blind labelling.
- **Source-knowledge leakage.** I read kernel source for earlier audits; several S verdicts would be P for a fresh reader.
- **The 2,438 test traces and the record run `01M64DD47R...`** (still absent) were not used.
- **`wire-request` in live runs:** 0 of 79 live runs carry it (only wire-corpus cells), so live runs predate the instrument.

## 5. Prioritized change list

Ordered by (diagnostic or recovery value) / (cost), respecting existing sequencing (Plan 8: K1 terminal funnel first). Owner = warden that must be dispatched.

| P | Change | Why (evidence) | Cost | Owner / gate |
|---|---|---|---|---|
| 1 | Write `mechanisms`/wither/profile/env state into `run-started.config` (even before the registry: just resolved flags + builder withers) | 75/75 blank; prerequisite to every ablation | S | runtime-warden (`execute-agent-started.ts`) + trace `normalize.ts:72`; no lift gate |
| 2 | `run-completed.authority` + reconcile `terminal_decision` vs final status; fold the runtime verifier gate into the same record | 16/75 disagree; 5 more success-with-block | S/M | kernel-warden + runtime-warden; this is Plan 8 K1's trace half |
| 3 | Fix stamps: monotonic `iter`, real `provider`, `tool-call-end.iter` | 131/131 `-1`; 66/75 `unknown`; inflated iteration counts | S | kernel-warden + provider-warden |
| 4 | Guard-state metadata `{threshold, observed}` on the 5 terminal-capable guards + `max_iterations` cap/counter + band inputs | runs 1, 3, 8, 10 | S | kernel-warden |
| 5 | Typed `LLMError` class + `run-aborted` sentinel + caller `origin` on `run-started` | 9 + 4 + 10 runs | S/M | provider-warden, runtime-warden |
| 6 | Cause classifier `analyzeCause()` + `rax-diagnose cause`; hand-label the sample as the acceptance set | 0 of 12 runs got a cause today | M, no runtime risk | harness-warden dispatches; code in `packages/trace` (trace is not warden-owned; main thread) |
| 7 | `RecoveryPolicy` slice 1: provider-config `adjust-request` + dead `LLMContextOverflowError` wired to prune-tools | 9 unhealed iteration-0 failures; zero live tokens to test | M | provider-warden + kernel-warden; default unchanged, no lift gate for the type, ablation for any non-default ladder |
| 8 | `MechanismRegistry` in `packages/core`, migrate the 15 un-switchable mechanisms to resolvers one at a time (preflight, stall, low-delta, F3, head-truncation notice, environment-update first), extend `check-ablatable.sh` | 0 of ~14 guards switchable | M/L | ablation-warden (owns the table), kernel-warden for sites; feeds Plan 8 S1 sweep |
| 9 | Verifier evidence record (`inspected`, `matchedValue`) and kernel-path verify-retry-with-guidance | 15 runs rejected without repair; run 4 likely false positive | M | kernel-warden; opt-in until lift-gated |
| 10 | Contract provenance (`fromHistory`, source span) and history-stripping when compiling the contract from a wrapped task | run 11 (11 identical failures) | M | kernel-warden; correctness fix, replay-testable |
| 11 | Grader result next to bench traces | cells with `pass:false` and clean traces are unexplainable | S | harness-warden (bench runner) |

Items 1-5 are pure instrumentation (zero behavior change, replay-checkable) and unblock 6-9. Item 8 should not wait for a perfect schema: ship the table with 6 migrated mechanisms and the CI check, then widen. Everything that changes a default (7 beyond slice 1, 9, any mechanism flipped by the new sweep) goes through ablation-warden (>= 3pp, <= 15% tokens, >= 2 tiers).
