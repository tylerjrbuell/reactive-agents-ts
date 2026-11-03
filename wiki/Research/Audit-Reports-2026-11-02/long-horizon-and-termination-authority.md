---
type: audit-report
status: draft
created: 2026-11-02
tags: [harness, long-horizon, termination, stall, assessment, run-contract, goal-supervisor, ablation-design]
plan: "[[../../Planning/Implementation-Plans/2026-11-02-harness-convergence]]"
extends: "[[harness-leverage-diagnosis]]"
---

# Long-horizon problem solving and termination authority (2026-11-02)

Docs-only, read-only pass on `dev`. No model was run. Evidence tags: **[V]** verified in source this pass, **[C]** cited from a filed report, **[H]** hypothesis, **[U]** unverified. Extends the diagnosis (R1-R7) and Plan 8; does not repeat them.

## 0. Bottom line

1. The owner's read is half right. The architecture is not "too rigid by design": the right spine exists (RunContract -> Ledger -> Assessment -> pace/control). It is **mis-wired by a gate**: the assessment is computed on every run, but every consumer that would make guards progress-aware is behind `horizon !== undefined` (`.withLongHorizon()`), so the default path still runs on the *old* progress currencies (new artifact files, token delta, iteration count) [V]. Long runs are governed by short-run constants.
2. "Termination decided by model prose" is real only for contract-poor tasks. When the contract has no deterministic post-condition (open research/analysis), the exit is the lexical `llmEndTurn`/`finalAnswerRegex` evaluator [V]. Tasks with a file or tool deliverable are already ledger-gated.
3. The first move is not new design. It is a measured, owner-gated promotion that already exists (evidence-delta reset, +41.7pp @ +8.6% tokens on one task [C]) plus K2 (meta calls do not count as stall). Everything else needs the eval in section 5 first, because **the trace corpus contains no long run** (section 2.3).

## 1. Keep-going vs stop: inventory [V unless noted]

Per-iteration order in `runIterationPass` (`loop/iterate-pass.ts`); outer cap in `runner.ts:763-768`. "Det" = deterministic over harness state; "Model" = decided by model prose or a model-called tool; "Heur" = statistical/heuristic.

| # | Mechanism | Site | Input signal | Class | Owner of verdict | On the typed spine? |
|---|---|---|---|---|---|---|
| 1 | Outer cap: `iteration < maxIterations` AND `llmCalls < maxIterations` | `runner.ts:766-767`; default 10 `runtime/src/types.ts:991` | counters | Det | runner -> arbitrator `max-iterations` intent | no, ad hoc; not tied to progress |
| 2 | Run budget meter (`budget_exceeded`) | arbitrator `:225`, plan 2026-10-05 | tokens/cost vs limits | Det | arbitrator | partly: reads `meta.budgetLimits` |
| 3 | Pause/stop checkpoint | `iterate-pass.ts:392` | RunController | Det (user) | runner | n/a |
| 4 | Zero-evidence stand-down (default-on) | `:439`, seam `iterate-assessment-seam.ts:119-195` | `health.iterationsSinceEvidence`, flail signature | Det + lexical flail test | iterate-pass `terminate("abstained")` | YES, reads assessment |
| 5 | Adaptive recompile (cadence 3) | `:470-498` | assessment | Det | policy compiler | YES; opt-in `.withAdaptiveHarness()` |
| 6 | Pace actions: economize/triage/terminal synthesis | seam `:225-288`, `assessment/pace-actions.ts` | `pace.band` (burnRatio) | Det | iterate-pass | YES; **only if horizon on** |
| 7 | Arbitrator + oracle evaluators (end_turn, final-answer, content-stable, entropy, RC early-stop) | `decide/arbitrator.ts`, `termination-signals.ts:402-415` | model text/no tool call, entropy | **Model/Heur** | arbitrator (claims sole authority, M9) | gate only if `postConditions.length>0` (`arbitrator.ts:520`) |
| 8 | Grounded-terminal redirect | `:599-642` | ledger grounding | Det | arbitrator gate | partly |
| 9 | Low-delta guard | `:644-707` | token delta (legacy) / evidenceDelta (horizon only) | Det over tokens | iterate-pass `terminate("low_delta_guard")` | **no by default** |
| 10 | Auto-checkpoint | `:711`, `iterate-guard-seams.ts` | context pressure | Det | fires **once per run** (`autoCheckpointed` carrier) | no |
| 11 | RI entropy observer / dispatcher early-stop / strategy switch | `:719-786` | entropy trajectory | Heur | dispatcher, then arbitrator veto | no (RI services) |
| 12 | F3 repeated-identical-failure | `:816-934` | steps | Det (arg-varying exemption horizon-only) | iterate-pass | partly |
| 13 | Stall counter + stall-deliverable | `:953-1016`, `guard-adapters.ts:88` | new **artifacts** (legacy) or evidenceDelta (horizon only); threshold 2, RI 4 | Det | `runStallDeliverableStep` -> `terminate("harness_deliverable")`, verdict not consumed (R1) | **no by default** |
| 14 | ICS nudge, oracle `pulse readyToAnswer` gate (2 nudges then forced exit) | `:1026-1116` | `pulse` tool output | **Model-reported** | iterate-pass | no |
| 15 | Loop detector -> strategy switch -> `resolveDetectedLoop` | `:1127-1216` | steps patterns (thought repeats, same tool) | Det | iterate-pass; switch resets counters `:771-777` | no |
| 16 | Required-tools in-loop guard + post-loop final check | `:1232-1267`, `runner.ts:887` | tools called | Det | iterate-pass / runner | via requirements partly |
| 17 | Forced abstention, deliverable promotion, verifier gate, quality gate | `runner.ts:807-912` | ledger/contract | Det + checker | runner post-loop | YES (terminal gate) |
| 18 | Engine continuation passes (`minIterations`, custom termination, verify-retry) | `runtime/.../reasoning-harness-hooks.ts:223-385` | output text, verifier | Model/checker | engine hook; folds prior answer into one user message (`continuationGoal`, :74) | ledger absorbed (`absorbedLedgerMetadata`), plan state not |
| 19 | Goal supervisor `pursueGoal`/`evaluateGoal` | `runtime/src/goal/` | segment output vs regex/must-include/rubric; `progressed` | Det tier1 + judgment tier2 | supervisor | **separate vocabulary** (not RunContract) |
| 20 | `.withLongHorizon()` scaling | `horizon-profile.ts:69-87` | maxIterations | Det constants | scales #9,#12,#13,#14,#15 literals | knob, not a mechanism |

Decision order (text diagram), one pass:

```
[cap?] -> pause/stop -> ASSESS(contract x ledger x budget)
 -> zero-evidence stand-down -> (recompile) -> (pace actions: horizon only)
 -> recall -> THINK/ACT  --inside think--> arbitrator(intents) -> terminal gate(if postConditions)
 -> grounded redirect -> low-delta -> checkpoint(once) -> RI observer -> dispatcher stop/switch
 -> F3 -> lane -> stall(artifact|evidence) -> stall-deliverable -> ICS -> oracle gate
 -> loop-detect -> switch|recover|fail -> required-tools guard -> snapshot -> learn
post-loop: forced abstain -> required tools -> promote deliverable -> verifier gate -> quality gate
```

Observation: of 20 rows, 12 can end a run; **at least 6 call `terminate()` directly with a passthrough deliverable** (rows 4, 9, 13, 14, 15, 18-ish) rather than proposing to the arbitrator/terminal gate [V; consistent with diagnosis R1].

## 2. Where it is rigid or mis-wired for long horizons

### 2.1 Findings (each with the causal link)

- **F-A. Two progress currencies, the better one gated off.** `assess()` yields `evidenceDelta`, `iterationsSinceEvidence`, phase, requirement states every pass [V `assess.ts:308-481`]. Consumers: `nextStalledCount`, `nextLowDeltaCount`, F3 arg-variety, gathering phase, synthesize-phase veto all return the neutral/legacy value unless `horizonActive` (`guard-adapters.ts:55-139`). Default stall = "no new deliverable artifact"; default low-delta = "token delta < threshold". A research/debug run that gathers for 8 iterations accrues stall for each. This is the audit 02-#3 misfire, still live on the default path.
- **F-B. Pace is a function of the cap, not of work.** With no token/cost limits, `burnRatio = iteration/maxIterations` (`assess.ts:390-395`), so bands (economize 0.6, triage 0.8, terminal 0.95) are positions in a fixed 10-step corridor. And pace actions only run under horizon (`iterate-assessment-seam.ts:225`).
- **F-C. Hard cap ends success-in-progress.** Cap -> `max_iterations` failure (arbitrator `:231-237`). Terminal synthesis before the cliff exists (`budget_terminal`) but only under horizon [V]. Default 10 iterations [V]. No rule extends a run that is still producing evidence while budget remains.
- **F-D. Contract is prose-regexed; open tasks are lexically terminated.** Requirements come from `deriveDeliverablePaths`, writer-tool detection, `mustInclude`, and an always-present self-critique `answer` floor (`run-contract.ts:~380-445`). `contractEnforceable` is true only with post-conditions (`arbitrator.ts:520`). Horizon is a regex classifier defaulting to `short` (`task-horizon.ts`), so `horizon` and the guard profile depend on prose cues ("all N questions", Q-ids, "Phase N"). A long task phrased otherwise gets short-run guards unless the operator sets `.withLongHorizon()`.
- **F-E. Churn counted as stall.** Meta-tool iterations (`todo`, `brief`, `pulse`) are not artifacts and not substantive evidence (arbiter classifies META as non-substantive [V `assess.ts:315-317`]), so even the evidence-delta fix would NOT protect a todo-heavy iteration. K2 is therefore independent of, and complementary to, the evidence promotion.
- **F-F. Checkpoint/resume is not at segment boundaries.** Auto-checkpoint once per run [V]; durable runs/resume are crash and HITL oriented (`resumeState`, `runner.ts:306-335`). A strategy switch resets stall/redirect counters (`:771-777`) but ledger rides on [V]. Continuation passes carry a truncated prior answer plus absorbed ledger, not the plan state (`reasoning-harness-hooks.ts:61-80`).
- **F-G. The long-horizon driver is not in the agent path.** `pursueGoal` is consumed only by Cortex chat (`apps/cortex/server/services/chat-goal-service.ts`) [V by grep]; no `agent.pursue(...)` exists in `packages/runtime/src` [V by grep]. Its criteria (`regex`/`must-include`/`rubric` over segment output, `evaluate.ts:7-23`) and its `progressed` (`turn.evidence.toolResults>0 || checklistCompleted>0`, `chat-goal-service.ts:153`) differ from RunContract post-conditions and `assess().evidenceDelta`. Third and fourth "done" and "progress" definitions.
- **F-H. Plan state is model-owned.** `todo` is a ledger-backed advisory list; inferred progress (Plan 6) is display-only. Correct by design (advisory never counts toward done), but it means nothing in the loop knows "3 of 5 sections remain" unless the contract enumerates it.

### 2.2 Short-run constants (all [V] in `iterate-pass.ts`/`horizon-profile.ts`)
stall 2 (RI 4), consecutive thoughts 3, oracle nudges tier-fixed, redirect budget 1, controller-veto counters run-cumulative. `.withLongHorizon()` scales these to `max(2,10%)`, 5, 2, windowed 10, but is opt-in and never lift-measured (`ablation: []`) [C DEBT-REGISTER:222].

### 2.3 Quantification and what the sample cannot show
`~/.reactive-agents/traces`, top-level runs with `provider != test`: **73 runs**. Iterations (max assessed iter): 0-1: 44 runs; 2-3: 20; 4-6: 8; max **9** (1 run). Zero runs reached 10. `terminatedBy`: end_turn 44, llm_error 9, harness_deliverable 5, abstained 5, final_answer 4, awaiting-approval 3, max_iterations 2, dispatcher early-stop 1. Contract horizon: short 63, long 3, absent 7; the 3 long runs are grok-4 "Research the latest AI..." with 1-2 iterations (they exit before long-horizon behavior can appear). Evidence-delta strings for the deepest runs (`0000 1111 0055 00`) show 4-6 consecutive productive iterations for the `harness_deliverable` haiku/Nemotron runs, i.e. runs ended by the stall step while evidence was still arriving. **Cannot show:** any behavior beyond ~10 iterations, any `.withLongHorizon()` run, any segment/goal run, token growth per iteration at depth, or rates (n tiny, owner probes dominate). Do not extrapolate; section 5 exists to fix this.

## 3. What the harness should own (convergence, not new mechanisms)

Principle (consistent with the ratified meta-loop and prior filings, section 6): **guards propose, the gate disposes; progress has one currency; the model supplies only the next action and the synthesis.**

- **C1. One progress fold.** `RunProgress = {evidenceDelta, requirement transitions, artifact delta}` read from `assess()` by stall, low-delta, F3, pace, the goal supervisor's `progressed`, and (display) the checklist. Meta-only iterations contribute 0 and are excluded from stall accrual (K2). This is *promotion of existing code*, not new code: remove the `horizonActive` gate behind the lift decision, keep the env ablation seam (`REACTIVE_AGENTS_EVIDENCE_DELTA_RESET`, `guard-adapters.ts:36`) for the arm.
- **C2. One completion authority = arbitrator + terminal gate, fed by proposals.** Every direct `terminate()` reason in rows 4/9/13/14/15 becomes a *proposal* the gate resolves against contract x ledger (Plan 8 K1 is exactly this; extend its scope to the guard rows, and make "model said done" a proposal that the gate accepts when the contract is met). Success is `ledger requirements satisfied`; model prose is evidence, not authority, whenever any deterministic requirement exists.
- **C3. Richer deterministic contracts for open tasks.** Compile *checkable* sub-requirements from structure already parsed from the prompt: enumerated Q-ids/"N sections" (`classifyEnumeration`, `QUESTION_ID_RE`) -> one `OutputContains`-style requirement per item; artifact paths -> `ArtifactProduced`; "run the tests" -> `ToolCalled` plus exit-status predicate (new predicate kind: tool-result matcher such as exit 0). [H] Risk: regex false positives make the gate refuse legitimate answers; needs the Wave 1.5 corpus and a fail-open rule (a requirement that cannot be verified is `unverifiable`, never `blocking`).
- **C4. Budget-aware cap with progress extension, then segments.** Replace "fixed N iterations" by: soft cap N; at the cap, if `evidenceDelta>0` within the last k iterations AND requirements outstanding AND token/cost budget remains, grant one more *segment* of N/2; otherwise take the terminal-synthesis path (existing `forceTerminalSynthesis`, today horizon-only) instead of `max_iterations`. Boundary action = auto-checkpoint + ledger-based standing-frame handoff (the machinery Plan 4/goal spec already describes; no compaction of the ledger). Bound by the run budget meter (#231), so unbounded runs stay impossible. [H]
- **C5. Plan state from the contract, not the model.** The outstanding-requirements recitation (north-star 6a) already exists behind `showOutstanding:false`; the checklist for contract runs is a projection of requirement rows (spec primitive 2). Keep `todo` optional/advisory; do not promote model-owned todo guidance (REWORK, section 6).
- **C6. Unify the goal supervisor's verdict with the contract.** Replace `GoalCriterion` regex/must-include/rubric over output by `RunContract` requirements + terminal gate for tier 1, keeping the judgment checker as tier 2. Then `progressed = assess().evidenceDelta>0 || requirement transition`. This is the spec's own intent ("goal confirmed criteria compile into frozen RunContract requirements"); implementation drifted to a parallel vocabulary [V].

Public comparison (public knowledge only, internals **[U]**; I did not re-fetch sources this session):

| Pattern | Claude Code / Codex / OpenCode style | Anthropic long-running-agent guidance (as I recall it, medium confidence) | Here |
|---|---|---|---|
| Stop rule | no tool calls -> end; optional deterministic Stop/verification hooks | an initializer session writes a feature list (JSON, each item with a pass flag); coding sessions do one feature, leave the repo clean, update a progress file | C2/C3: the gate is our "Stop hook"; contract requirements are the feature list |
| Plan state | TodoWrite-style list re-rendered as reminder | immutable feature list, only the pass flag changes (model cannot rewrite criteria) | frozen RunContract; model cannot edit requirements (matches) |
| Long runs | context compaction + resumable sessions; iteration cap is generous or absent [U] | many incremental sessions with a progress file + git log as handoff | C4 segments + ledger handoff |
| Budget | token/permission limits, user abort | n/a | run budget meter |
Difference worth noting: those harnesses do not stack ~20 deciders; they have a few hard limits and an explicit verifier. That supports C2 (consolidate) but is not evidence that our guards are net-negative (R5 rule: only ablation can say).

## 4. Overlap with Plan 8 and minimal sequencing

| Item | Overlap | Notes |
|---|---|---|
| K1 terminal funnel | = C2 for deliverable-carrying exits | widen to guard rows 9/13/14 as proposals; no ablation (correctness) |
| K2 meta calls not stall | = F-E | keep; independent of C1 (section 2.1 F-E) |
| K3 strike persistence | unrelated | unchanged |
| T3 signal accounting | prerequisite to judging pace/triage steers | unchanged |
| S1 flag-off sweep | must include pace bands, stall legacy-vs-evidence, strategy switching | add horizon arms |
| S3 harness-owned checklist | = C5 | already REWORK-constrained; Wave 1.5 does not add it |
| T1/T2/T4 | orthogonal (tool surface, wire params, guidance text) | unchanged |
Conflicts: none structural. Risk: K1, K2 and C1 all edit `iterate-pass.ts` (1,315 LOC) and `guard-adapters.ts`; serialize.

**Minimal order.** (1) H3 + new long-horizon suite baseline (no source change). (2) K1, K2 (Plan 8). (3) Owner decision on evidence-delta promotion using the existing low-delta report plus the second-tier arm. (4) Wave 1.5 tasks W1.5-1..5 in the addendum. Ships without ablation: K1, K3, T2, T3, instrumentation, goal-vocabulary unification if behavior-preserving (replay-equivalence). Needs `ablation-warden`: evidence-delta default-on (stall + low-delta + F3), pace actions default-on, cap extension/segments, C3 derived requirements, any change to `horizonProfile` default.

## 5. Eval to confirm or refute "rigid design" before building

Constraint from prior filings: hand-rolled single-task probes already produced three void arm-sets; use the real long tasks [C DEBT-REGISTER:169]. Only `lh-1` and `rw-7` exist as `horizon:long` bench tasks [C :184].

- **Question.** Does the default path under-perform the same agent with progress-aware guards + progress-extended caps on tasks that need 15-40 iterations? (Refutation: lift <3pp or tokens >15% -> design is not the bottleneck; model/tool quality is.)
- **Tasks (12).** rw-4, rw-7, lh-1 (existing) + 9 new in four shapes, each with a deterministic grader (exit code, file exists + regex, answer contains N items): multi-file debug until `bun test` exit 0 (x3); enumerated research "answer all N questions" with a checkable per-item format (x3); gather-transform-write pipeline over 20+ tool calls (x2); plan-only distractor (x1, guards against over-extension).
- **Arms.** A0 HEAD default. A1 evidence-delta reset only (env seam). A2 A1 + K2. A3 `.withLongHorizon()` (never lift-measured). A4 A2 + cap extension/terminal synthesis (after built). `.withAdaptiveHarness()` excluded: INCONCLUSIVE and not re-proposed.
- **Tiers.** Local mid (qwen3:14b or cogito:14b), local small (gemma4:12b), one frontier (haiku-4-5). k >= 5 per cell, pass^k and mean graded score; Wilson intervals; no claim under ~26pp at n=5 per cell (Plan 8 rule); pool across tasks for the 3pp test. Frontier may be credit-blocked: say so, mark deferred.
- **Metrics.** correctness, iterations to done, billed tokens, `terminatedBy`, share of runs ended by a guard while `evidenceDelta>0` (the misfire rate), time-to-terminal, `max_iterations` rate with progress in last 3 iterations (the cap-cutoff rate). Pre-register thresholds. Instrument check: print tool surface and fire counts per arm before reading outcomes (guard must actually fire in A0 or the cell is void).
- **Zero-cost precursors.** Replay the corpus for the invariant "run ended by stall/low-delta/max_iterations with evidenceDelta>0 in the final 2 assessments"; extend the deterministic `low-delta-guard-misfire.test.ts` pattern to stall and cap.

## 6. Prior filings (searched `wiki/` per coordinator request) and how they change this

| Filing | Finding | Effect on recommendations |
|---|---|---|
| `Design-Specs/2026-10-28-plan-and-goal-primitives` (approved) | Already specifies: checklist = projection of contract x ledger, advisory items never count toward done, goals = contract + budget + segments, stall read from assessment, Phase 2 triage lift-gated, goals ship opt-in. | C4/C5/C6 are not new designs; they are unwired parts of it. Do not write another spec; amend this one. `agent.pursue` (Phase 3) is not in `packages/runtime/src` [V]. |
| `Research/Harness-Reports/low-delta-2026-07-27/RESULT.md`, DEBT-REGISTER:169 | Evidence-delta reset: haiku rw-7 n=12/arm, 0.000 -> 0.417 (+41.7pp), +8.6% tokens, p=0.00002; gpt-4o-mini inert (0 fires). Promotion left as owner decision. Three hand-rolled arm-sets VOID. | Promoted to item 1 of the sequence. The eval reuses rw-4/rw-7; no hand-rolled probes. Ablation-warden must rule whether an inert second tier satisfies "2 tiers". |
| `Decisions/2026-07-08-harness-meta-loop-ratified`, north-star 07-11, 09 | Ratified RunContract -> Ledger -> Assessment -> Control -> Actuators -> Projector; one-directional DAG; lift-gate discipline on E2/E3. Table row 6a: recitation default-on needs lift on rw-7/lh-1. | The "gate behind horizon" was deliberate lift-gate discipline, not an accident; the conclusion is "measure and promote", not "rewrite". |
| 09 C7 "one terminal truth" and Step 2; `M9 Termination Oracle`; `FM-D2` | Arbitrator is already declared sole authority (9 paths -> 2 gateways). | C2 is a tightening of an existing claim: the remaining violators are the guard `terminate()` sites. No new authority. |
| `Research/Audit-Reports-2026-07-12/00-STATE-OF-THE-FRAMEWORK` row 49 | Adaptive harness overhaul shipped; Phase-6 exit gate unmet, ablation INCONCLUSIVE n=1; re-cut never recorded as done. | Not recommended as a lever; excluded from arms. Any claim that it helps is unsupported (AGENTS.md says the same). |
| DEBT-REGISTER:222, :184 | `long-horizon-arm` has `ablation: []` (no lift verdict); only lh-1 + rw-7 are long bench tasks. | `.withLongHorizon()` stays opt-in; its value is unmeasured, hence arm A3 and the 9 new tasks. |
| `Harness-Reports/2026-10-28-todo-guidance-ablation` (REWORK) | todo guidance: 0/40-ish consistent checklists, +32% tokens pooled; stays opt-in. | Do not make the model own plan state or promote todo guidance; C5 stays harness-derived. K2 still valid (excludes churn, adds no text). |
| `Planning/.../2026-10-29-inferred-progress-and-environment-updates` (Plan 6) | Inferred checklist progress is display-side, advisory, never counts toward done. | Do not feed inferred checklist into termination; use ledger evidence only. |
| `Decisions/2026-07-29-lift-rule-cost-vs-tokens-amendment` | PROPOSED, not ratified. | Stay on the literal rule (>=3pp AND <=15% tokens, >=2 tiers). Cap extension costs more tokens by construction; expect to be judged per-completed-task cost only if the amendment is ratified. |
| 09 §7 flag verdicts / `2026-09-15-experimental-flag-verdicts` | 3 flags deleted as inert; corpus-poverty caveat for prompt-only mechanisms. | Pace-band and cap arms need live runs; replay cannot see them. |
| `Planning/.../2026-10-05-run-level-budget-meter` | Canonical budget meter exists. | C4 bounds extension by it rather than a new budget. |
| `Planning/.../2026-10-29-goals-loops-and-polish` (Plan 4, shipped on dev) | Goal = supervisor over chat turns; stall from facts; tier1 deterministic, tier2 judgment. | Basis for C6; the divergence from RunContract vocabulary is the finding. |

## 7. Honest limits
- No model run; the corpus has no run beyond 9 iterations; owner probes bias what exists.
- `llmCalls` semantics (which calls increment it) not verified; the dual cap at `runner.ts:766-767` is stated as read.
- C3 and C4 are hypotheses with explicit risks; nothing here has been ablated.
- Public-harness comparisons are from memory of public descriptions; internals unknown.
- Row counts of "direct terminate() sites" are from reading the files cited, not an exhaustive grep (Plan 8 census counted 22 sites).
