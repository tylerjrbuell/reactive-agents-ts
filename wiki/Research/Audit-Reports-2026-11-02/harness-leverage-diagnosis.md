---
type: audit-report
status: draft
created: 2026-11-02
tags: [harness, leverage, diagnosis, kernel, simplification, trace-corpus]
plan: "[[../../Planning/Implementation-Plans/2026-11-02-harness-convergence]]"
---

# Harness leverage diagnosis (2026-11-02)

Question: why does the harness (reasoning kernel + runtime) underperform its complexity, and what should be streamlined first? Read-only. Evidence tags: **[V]** verified in source or trace this pass, **[C]** taken from a cited report, **[H]** hypothesis, **[U]** unverified.

## 0. Evidence base and its limits (read first)

- Sources read: the 2026-10-29 failure-mode census, tracing/mechanism audit, plan-posture probe, text-tool-call root-cause + after-fix reports, 09, 02, the 2026-07-12 state audit, the simplification plan, the 2026-07-28 composite rebaseline and flag-inertness reports, the 2026-10-28 todo-guidance ablation.
- Live corpus `~/.reactive-agents/traces` (path from `packages/trace/src/paths.ts`): 2,538 files, **70 real-model runs** (rest are tests). 31 have tool calls. 25 files carry `signalId` (commit 21340860d). **Zero traces contain the new `wire-request` fact yet [V]**, so every wire claim below is derived from older fields (`llm-exchange.toolSchemaNames`, `tool-surface-resolved`, head-truncation signal metadata), not from the new instrument.
- Selection bias is large: many recent runs are my owner's own probes ("Analyze the umami stats ... keep a todo list") on gemma4, grok-4, haiku, gpt-oss. Counts are descriptive, not rates. n is far below any confidence interval. Bench cells are Bernoulli (SE ~13pp at n=5).
- **Retracted figure:** the "555-640% harness overhead" in project memory is void (pre-`2f97ca1e` token accounting, see [[../Harness-Reports/2026-07-28-corrected-composite-rebaseline]]). Corrected: 2.4x tokens / 2.6x cost vs inline on haiku, one 3-tool task, n=3 [C]. Do not cite the old number.
- Complexity is not itself evidence of failure. LOC and guard counts below are context; each ranked item needs its own causal link.

### Complexity census [V, grep on `dev`]

| Measure | Value |
|---|---|
| `packages/reasoning/src` LOC / `kernel/` non-test LOC | 78,242 / 41,816 (273 kernel files incl. tests) |
| Files >800 LOC (non-test) | 13: kernel-state 1,473; iterate-pass 1,315; reflexion 1,209; act 1,193; tree-of-thought 1,113; plan-execute 987; tool-execution 962; runner 951; diagnostics 946; verifier 856; arbitrator 850; tool-observe 841; adaptive 826 |
| Strategies LOC (8 files) vs the default | 7,709 total; `reactive.ts` is 484 |
| `terminate(` call sites | 22 non-comment calls in 19 files (audit counted ~20) |
| Distinct `terminatedBy` literals | 16 |
| `emitGuardFired` sites / `emitHarnessSignalInjected(` sites | 23 / 8 here (audit counted ~14 incl. other dirs) |
| `makeStep("harness_signal")` sites; `openSignal`/`injectSignal` users | 17; 16 |
| `PendingGuidance` string fields | 9 (+ `pendingSignals`), written/read in 20 files |
| Prompt text channels in one think | system prompt, driver instructions, rationale block, tool index, checklist system line, trailing guidance user message, env update, checklist reminder, `prompt.guidance` hook, harness_signal steps in history (`think.ts:521-587`) |
| Independent steer/terminate deciders | ~20: loop detector, stall, low-delta, repetition guard, head-truncation, strategy switch, pace terminal, terminal gate, grounded gate, 6 `think-guards`, control plane, preflight, verifier, quality gate (audit D2/D5) |

## 1. Ranked root causes

Rank = (estimated effect on reliability/cost) x (strength of evidence). None of these has an ablation yet; "confirmed" below means the mechanism is verified, not that fixing it is shown to lift accuracy.

### R1. Terminal and deliverable decisions are not one funnel (reliability; mechanism PROVEN)

- **Evidence.** Census cluster A: 21 runs (13.9% of real runs, **10.2% non-bench**); all 5 real "success with `answer` unsatisfied" runs ended through `stall_deliverable` -> `terminate()` ignoring the verdict (`loop/runner-helpers/stall-deliverable.ts:381-405`, "the verdict isn't consumed here") [C]. Audit D1/D2/D8: 6 `assembleDeliverable` sites, 5 `passthroughOutputDeliverable`, ~12 `sentinelDeliverable` literals, two source vocabularies [C]. This pass, post-10-29 real traces [V]: `deliverable_decision` guard = `block` in 9 runs; **5 of those 9 ended `status=success` via `terminatedBy=harness_deliverable`** (e.g. `01M6FDA26WTA47P1NGC1124C4V`: verdict "output assembled by harness fallback ... model never produced a synthesized final answer", yet `run-completed.status=success` and the output reads as a coherent report). The other 4 blocks are `failure/end_turn`.
- **Mechanism.** Labels (`status`, `terminatedBy`, verdict, ledger requirement) are set by different sites; nothing reconciles them, so a run can be "success" while its own gate said "block". For users this is false confidence; for the loop it means a late fallback can replace a model synthesis that might have been fine, or ship a weak one with success.
- **Leading designs.** One terminal state machine; completion = model emits a final message with no tool calls, optionally checked by deterministic verifiers (tests, schema, file exists), failure reported as such (Claude Code / Codex / OpenCode loops end on "no more tool calls"; evaluator-optimizer verification is a separate, explicit step) [well-known public pattern; no repo substantiation of their internals].
- **Test.** Replay-only, zero tokens: assert over the trace corpus + goldens the invariant `status=success => no deliverable_decision=block && ledger answer satisfied`. Pre-state: 5/9 violate (above). Change: route every deliverable-carrying `terminate()` through `runner-terminal-verify-gate.ts` (kernel-warden). Gate: invariant violations 0 on corpus; red-on-cut test = the `stall_deliverable` golden must fail without the gate. Not a default-on mechanism question (it is a correctness fix), so lift rule N/A; require no accuracy regression on 2 tiers.

### R2. The model owns the checklist, and bookkeeping churn is the largest consumer of tool calls and feeds the stall guard (cost + reliability; NEW evidence)

- **Evidence [V].** Over the 31 real post-10-28 runs that made tool calls: **80 of 131 tool calls (61%) are `todo`**; 17 runs used it; **all 5 `stall_deliverable` fires in this slice are in todo runs, 0 in non-todo runs**. Examples: `01M6FFZ2KV6ARZW9NNDE2A2NEP` grok-4, 11 of 11 calls are `todo`, `status=failure`; `01M6FDA26WTA47P1NGC1124C4V` haiku, 9 of 16 calls `todo` (the two-per-iteration `todo` pairs in iters 2-6), 75,221 tokens, ended `harness_deliverable`; `01M6FE475YPG73YTFMPT9CJQE8` grok-4, 53,270 tokens. Prior: 2026-10-28 ablation, pooled A1 (systemLine) +32% tokens, 0/40 "consistent" checklists, over-planning 5/10 on controls [C]; census R15 todo adds never closed [C].
- **Mechanism [V].** `nextStalledCount` (`assessment/guard-adapters.ts:88-96`) resets only on new deliverable artifacts; a `todo` call is a non-artifact iteration, so a model busy updating its list accrues stall count (threshold 4 when RI is active, `iterate-pass.ts:959-975`). The guard then takes over a run that was legitimately close to done. The harness already has a display-side `checklist-inferred` event; the model-facing list is still model-edited state (audit D6, L1).
- **Caveat.** Corpus is skewed by tasks that literally ask for "a todo list" and by Cortex chat (checklist default-on). It proves the interaction exists, not its population rate. The sibling plan-posture work (Plan 7) was necessary because of this coupling.
- **Leading designs.** A todo/plan is first-class state that is cheap to update: Claude Code's TodoWrite sends the whole list in one call and the harness re-renders it as a reminder; it does not count against progress or deliverable accounting (public behavior; exact internals [U]). Codex has a plan tool with the same shape. Both let the model update the list in the same turn as real tool calls.
- **Test.** (a) Instrument-only: count `todo` share and stall-fires-in-todo-runs on the next 50 real runs across 2 tiers. (b) Arm B vs A on a fixed multi-step task set: meta-tool calls excluded from `consecutiveStalled`, and checklist state derived from the ledger (harness-owned, model gets read-only render; `todo` tool kept as optional). Metrics: deliverable rate, tokens/run, stall-guard fire rate. Default-on only if >=3pp and <=15% tokens on 2 tiers; the token leg should *improve*. A1 evidence says the model-owned variant must stay opt-in regardless.

### R3. Tool-schema payload dominates the prompt, and window resolvers disagree (cost + tool loss; wire facts not yet traced)

- **Evidence [V].** Umami runs ship **25-26 tools every call** (`01M6FDA26W...`, gemma4:12b `01M6FD30CN...` 25, grok `01M6FE475Y...` 26); `tool-surface-resolved.reasons` = 24 `allowed-floor` + 2 `meta-floor`, i.e. every allowed MCP tool is a floor, none pruned by relevance. On `01M6FD30CN...` iteration 0: system prompt 534 chars, one user message, yet **corrected prompt = 2,532 tokens at num_ctx 8192**, so ~90% of the prompt is tool schemas [derived; schema bytes not recorded, scoreboard lists this as a measurement GAP]. The head-truncation guard fired **17 times across 7 real runs** (all num_ctx 8192, output clamped to ~5.5k). Census: guard dropped `todo`+`crypto-price` on a 1,113-token prompt, projection window 32,768 vs guard 8,192 [C]. 09 vetting already removed model-driven discovery as pure cost (`discover-tools`) [C]; haiku composite shows `prune+discover` = 14.3 calls/22 iterations vs inline 4/5 on a 3-tool task [C].
- **Mechanism.** MCP servers with dozens of tools put all schemas on the wire every iteration. On 8k-context local models that leaves little room, forces output clamps, and (in the older trace) silently removed tools. Three resolvers decide the window (audit D3).
- **Leading designs.** Small core tool set; MCP/deferred tools loaded on demand by name (Claude Code's ToolSearch/deferred-tools; this very session lists tools by name and loads schemas on demand); single computed wire budget. [public design]
- **Test.** The commit 21340860d `wire-request` fact is the instrument; run the 5-task umami/MCP set on 2 tiers, record `toolsShipped`, schema tokens/req, `numCtxSource`. Then ablate harness-side relevance selection (not model-driven): keep top-k tools by task/ledger match plus a one-line index of the rest. Lift rule applies; must not drop required tools (red-on-cut: a golden where the needed tool is rank > k). Do not conclude before the instrument shows schema tokens; the 90% above is an inference.

### R4. Many harness voices, and the signal ledger cannot say whether any of them worked (reliability; PARTIAL evidence)

- **Evidence.** Census: redundant stacking is the common case (`{errorRecovery, loopDetected, requiredToolsPending}` in 61 thinks / 17 runs); real contradictions are rare (3 runs) but hit the flagship model [C]. Plan-posture needed a mute-everything branch (`think.ts:587-589`: `planPosture ? planPostureGuidanceText() : ...`) because no composer orders sources; 12/12 plan runs then showed one coherent guidance line [C]. This pass [V]: in real traces with `signalId`, **43 signals opened, 1 has a `signal-rendered` event**; 13 `signal-effect` events: 11 `ambiguous`, 1 `ignored`, 1 `remediated`. 22 are `environment-update`, 17 `head-truncation-guard` (informational, never rendered). So the effectiveness of nearly all steering text is unknowable, not shown negative.
- **Mechanism.** 9 guidance fields + 4 other text channels with no precedence and no accounting. The one place it was solved (posture) was solved by deletion at render.
- **Leading designs.** One stable system prompt; a single channel for dynamic harness reminders (Claude Code attaches reminders as tagged blocks on the user turn); everything else is a tool result. [public pattern, internals U]
- **Test.** Replay lane already exists (zero-token). Step 1: `composeGuidance` that assigns each pending field an owner and drops fields whose condition is already true elsewhere; byte-diff vs HEAD on goldens. Step 2 (live, 2 tiers): arm "single-line guidance (required-tools + error-recovery only)" vs HEAD on the census failure tasks. Hypothesis to refute: guidance stacking costs accuracy. If goldens show no divergence and live shows <3pp, treat guidance pile-up as cosmetic and delete the lowest-use fields instead of building a composer.

### R5. Default path carries unmeasured mechanisms; no arbiter among ~20 steering sites (simplify; evidence is a measured vacuum)

- **Evidence.** Ledger: 6 lift measurements, 0 cleared the bar (1 reject, 3 opt-in, 2 underpowered); last entry 2026-07-26 [V]. Corrected overhead 2.4x tokens/2.6x cost vs inline, one task, n=3, ~9.4x the 15% ceiling; on that task prune+discover used 4.4x the iterations of inline for identical 3/3 correctness [C]. Flag sweep: 16 INERT, 1 LIVE, 5 untestable on a 4-golden corpus ("corpus poverty", `RA_VERBOSE_RULES` cannot be seen by replay) [C]. Strategy switching is default-on: census R13 20 runs (13.2%), R13b 16 did not recover, 15 of 16 on one cogito:8b batch [C]. Strategy code is 7.7k LOC vs 484 for `reactive`. The real corpus shows what ran, not what helped: I found no sweep that attributes accuracy to any of these on current HEAD [U: not exhaustively searched].
- **Mechanism.** Mechanisms were added "beside mechanisms" (09 §0 admits the pattern); each guard acts alone (audit D5). Cost accrues on every run; benefit is anecdotal.
- **Leading designs.** Claude Code / OpenCode style: one loop, a short list of hard limits (iteration cap, token budget, user abort), permission gates, context compaction, and explicit sub-agents. No strategy ladder or mid-run strategy switch. Evaluation decides what stays. [public pattern; their exact guard counts U]
- **Test.** Do not delete from taste. (1) Re-run bare vs lean vs full composite on HEAD, 2 tiers, >= 3 task shapes, n >= 5 per cell, with billed-token accounting (the 07-28 instrument). (2) Per default-on mechanism, ablate with a flag in a fixed task set; candidates: strategy switching, low-delta/evidence-staleness switch, `discover-tools`, assessment-derived pace bands. Rule: no >=3pp lift AND <=15% tokens => opt-in or delete. (3) Extend the golden corpus first (the sweep is blind with 4 goldens).

### R6. Small-tier tool-call protocol still ends runs on call-shaped text (reliability on <=4B; narrow)

- **Evidence [C].** Root-cause report: unresolved text calls were treated as `final_answer`; after fixes F1/F2 and the kernel gaps (c649605c5), llama3.2:3b fresh-session shaped finals went from 5/5 to 0/5 on 12x15 and text-history 8/10 to 0/10; but the required-tools arm is **still 5/5 shaped** (max_iterations, the honest terminal never reached). Only llama3.2:3b leaks; qwen3:4b and Nemotron-3.5-Bolt-E4B never did. Census: 8.5% of non-bench runs touch the tool-protocol cluster; the 24.5% headline is one cogito:8b batch.
- **Mechanism.** Strike counters are derived from steps and reset on strategy switch; text-shaped thoughts are delivered as trailing synthesis. This is R5 (state reset on switch) showing up at the protocol layer.
- **Leading designs.** Provider-side constrained/structured tool-call decoding where available; otherwise one reprompt then hard stop; no mid-run strategy change on a protocol fault. [public pattern]
- **Test.** The after-after probe set (`probe.ts llama3.2:3b fresh 5 2,3,5` and `required-tools-arm.ts`) rerun after persisting strikes across switches; success = zero shaped finals incl. required-tools arm. Low priority by volume; do it because it is a bounded fix, not because it moves a headline.

### R7. No frozen real-task eval gates harness changes (process; blocks verification of R1-R6)

- **Evidence.** Real runs are 2.6% of the census corpus (151 of 5,857) [C]; the live dir now has 70 of 2,538 files [V]. The previous trace of record was pruned by test traces; `paths.ts` now routes test runs to a per-process temp dir [V], which fixes the leak but not the corpus size. The only reliability measurement, pass^8 = 0% on 3 real-world tasks, dates from 2026-07-11 and was never re-run [C]. Real-model scoreboard rows from 2026-10-13 exist only for local qwen/llama; the frontier rungs were blocked on API credit [C].
- **Leading designs.** Eval-driven development: a frozen task suite with pass^k, rerun on every harness change, versioned results (Anthropic's guidance on evals and tau-bench-style pass^k are public; 09 W5 already names tau-bench as open).
- **Test / deliverable.** A 12-20 task suite (5 existing real-world tasks + the census failure shapes), 2 local tiers + 1 frontier, pass^k, CI-triggered nightly on the local tier; every Plan 8 cut must cite it. This is a missing piece, not a mechanism to ablate.

## 2. Hypotheses I checked and the evidence does not support (yet)

- "The kernel is too big, therefore it fails." Size correlates with cost (R5) but no failure in the census was traced to LOC; failures cluster at three boundaries (terminal, guidance, tool protocol). Shrinking for its own sake is metric-gaming.
- "Guidance contradictions are the main failure." Census says stacking is common, contradiction rare (3 runs). Severity high on the plan flow only. Keep as R4 with a refutation arm.
- "Memory or compaction is the leak." Memory is default-off; compaction (R28) touched 13 runs but is mostly cogito:8b batch. No evidence it is a top-3 cause.
- "Sub-agent isolation is the missing piece." Sub-agents shipped in v0.14 (fork into parent fiber tree). No trace evidence in this pass either way; do not prioritise.
- "Guards are a net loss." Only the `low_delta_guard` was ever measured (killed 11/12 mid-progress) [C]; one sample is not a base rate.

## 3. Candidates by type

**Delete / simplify (existing mechanism, no measured lift; each needs a flag-off ablation before deletion):**

| Candidate | Why | Evidence strength |
|---|---|---|
| Mid-run strategy switching (default-on) | R13b 16/20 non-recover; resets counters; protocol fault amplifier | weak (one batch) |
| `discover-tools` escape hatch | 09 vetting: pure cost; +iterations on haiku composite | moderate |
| Guidance fields with zero observed render (head-truncation notice, env-update default) | 1 of 43 signals rendered | moderate (accounting) |
| Parallel deliverable paths (`passthrough`, `sentinel` literals, `finalizeOutput` vocab) | R1 funnel | strong |
| Model-owned `todo` add/done as default state | R2 | moderate |
| Assessment/contract scaffolding in the default path | fixed ~3.3k-token tax at 08-05 (local +99%, cloud +469% on an older instrument) [C]; not re-measured on HEAD | weak until R5 composite rerun |
| 5 of 8 strategies as separately-maintained loops (reflexion/ToT/plan-execute/adaptive/blueprint = 4.9k LOC) | only `reactive`/`direct` have a default role | weak; no per-strategy lift data [U] |

**Missing pieces:**

| Candidate | Why |
|---|---|
| Harness-owned checklist derived from the ledger (R2) | removes the biggest tool-call consumer |
| Relevance-selected tool surface for MCP floors (R3) | schema tax; avoids model-driven discovery |
| One terminal gate with provenance (R1) | status/terminatedBy/verdict reconcile |
| One guidance composer or deletion (R4) | single voice |
| Frozen real-task suite with pass^k (R7) | cannot verify anything else |
| Wire-budget resolver (one `ResolvedWireParams`) (R3) | D3; partly traced by 21340860d |
| Recorded tool-schema bytes in `llm-exchange` | scoreboard GAP; cost attribution blind |

## 4. Order of attack (see [[../../Planning/Implementation-Plans/2026-11-02-harness-convergence]])

1. R7 + the instrument pass (cheap, unblocks everything). 2. R1 (proven mechanism, no ablation needed). 3. R2 stall-accounting fix (small, invariant-testable) and R3 measurement, then their ablations. 4. R5 composite + per-mechanism sweep, which gates all deletions. 5. R4 and R6 after the corpus can see them.

Items that change a default (R2 arm B, R3 selector, R4 composer if it alters text, any R5 removal that changes behavior) go to `ablation-warden`: 2 tiers, >=3pp lift, <=15% token overhead, billed tokens.

## 5. Honest limits

- Wire claims (R3) wait on the first traces with `wire-request`. Schema-token share is an inference.
- R2 population rate is unknown; the trace slice is probe-heavy.
- "Leading harness" comparisons use public behavior only; internals of Claude Code, Codex and OpenCode are not in this repo and are marked as such.
- I did not run any live model this pass.
