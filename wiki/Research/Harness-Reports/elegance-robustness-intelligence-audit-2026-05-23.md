---
tags: [audit, design-vision, elegance, robustness, intelligence]
date: 2026-05-23
companion: architecture-drift-analysis-2026-05-23.md, capability-mapping-2026-05-23.md, event-coverage-diff-2026-05-23.md
status: design-vision (cross-tagged to empirical state)
---

# Elegance / Robustness / Intelligence Audit

Companion to the drift analysis. Same data, different lens.

The drift analysis asks: **what shipped vs what was designed?**
This audit asks: **what would the elegant, robust, intelligent harness look like, and where do we already have signal that we're not there?**

Every claim below is tagged:
- 🟢 **SUPPORTED** by empirical evidence already in hand
- 🟡 **PENDING** evidence from running campaign step
- 🔵 **ASPIRATIONAL** — no signal yet; flagged for future probe design

---

## ELEGANCE — single-owner discipline, no parallel substrates, no scaffold debt

### E1 — One Arbitrator, not five 🟢 SUPPORTED

Current: 5 incident systems (RI / killswitches / verifier / healing / strategy-switch) each decide termination independently. **170 `state.status=` sites across 14+ files.**

Elegant: one pure function `Arbitrator(signals[], state) → Verdict` consumes signals from all five sources; only the Loop Controller calls it; only Loop Controller mutates state.status.

Evidence: drift analysis §"Conflict 1". Confirmed via grep.

### E2 — Capability-scoped instrumentation, not strategy-scoped 🟢 SUPPORTED

Current: `emitKernelStateSnapshot` lives at `runner.ts:672 / 1453 / 1592`. Only fires when strategy consumes `runKernel`. **Plan-execute's tool dispatch (L1077-1117) bypasses kernel act-phase → no emit.**

Elegant: emit at capability boundary (`act/`, `verify/`, `decide/`). Strategies inherit diagnostic uniformity regardless of outer-loop shape.

Evidence: capability mapping report. F1 in sweep.

### E3 — Single intervention substrate, not parallel pipes 🟢 SUPPORTED

Current: RI decisions (13 typed) + Compose tags (7 typed, 3 live). Different timing (sync transform vs async pub-sub), different shapes, near-zero overlap, 4 dead tags scaffolded but unfired.

Elegant: RI keeps internal decision logic (deciders); Compose pipeline becomes universal observation surface. RI decisions emit through `pipeline.transform(decision-tag, payload, ctx)` → external hooks observe / override / replace.

Evidence: event coverage diff. 4 dead tags confirmed.

### E4 — Strategy boilerplate extracted into harness-aware base 🟢 SUPPORTED

Current: each strategy file opens with ~65 LOC of `resolveStrategyServices` + `emitLog` + `planStoreOpt` boilerplate. Duplicated 5× across reactive/direct/reflexion/ToT/plan-execute.

Elegant: strategy = a thin contract `(input) → Effect<ReasoningResult>` with services injected. Common harness bookkeeping (eventBus emit, log helpers, store options, RI integration adapter) lives in a single `StrategyHarness` helper.

Evidence: capability mapping report — boilerplate % per strategy.

### E5 — Adjacent duplicate emits collapse to one emit per transition 🟢 SUPPORTED

Current: `runner.ts:1453` (post-iter snapshot) + `runner.ts:1592` (terminal pre-verifier snapshot) fire byte-identical events back-to-back on terminal iter. **Every reactive trace shows N+N duplicates.**

Elegant: snapshot fires once per state transition. Verifier reads same snapshot as trace consumer.

Evidence: sweep F2.

### E6 — Sync vs async event paradigm unified 🔵 ASPIRATIONAL

Current: EventBus is async pub-sub (delivers AgentEvents to RI, calibration, telemetry, OTel). Compose `pipeline.transform` is sync (must return value to caller). Trace recorder bridges from EventBus → JSONL.

Elegant: every observation goes through one stream; transformers are observers that may also replace value. Removes the "where do I subscribe?" cognitive cost.

Evidence: structural inspection only. No empirical signal yet — flagged for design-spec phase.

---

## ROBUSTNESS — no silent gaps, no false-promise APIs, no metadata loss

### R1 — `result.metadata.totalTokens` returns 0 while logs show real numbers 🟢 SUPPORTED (NEW finding from matrix run)

Cell 1 (t1-trivial × reactive × cogito:14b): log shows `[metric:tokens_used] 1617 tokens`, but `result.metadata?.totalTokens` returned 0 in cross-strategy matrix output.

Silent metadata loss → downstream consumers (telemetry, cost accounting, RunReport) get wrong numbers. **Trust differentiator violated.**

Fix shape: trace token threading from `[metric:tokens_used]` events into `ExecutionResult.metadata`. Find the wiring break in `engine/finalize/`.

### R2 — 4 dead Compose tags 🟢 SUPPORTED

`nudge.healing-failure`, `observation.tool-result`, `lifecycle.failure`, `control.strategy-evaluated`: registered in TagMap but no `pipeline.transform()` emit site. Users registering on them get pass-through silence.

Elegant fix (also resolves E3): wire emit sites for all 7. Or document the 4 as "v0.12 reserved" with compile-time warning. Either way, no scaffold without callers.

Evidence: event coverage diff.

### R3 — `ControllerDecision` advertises 13 variants, ~5 wired 🟡 PENDING (step 6 RI ablation surfaces this)

The 13-variant union (`packages/reactive-intelligence/src/types.ts:169-182`) includes decisions like `harness-harm`, `memory-boost`, `prompt-switch`, `skill-reinject`. **How many ever fire on a real run is empirically unknown until RI ablation runs.**

If <50% fire in failure-corpus across models → the variant union is partly dead-code. Prune or wire.

### R4 — Calibration 14 fields, ~5 consumers 🟢 SUPPORTED (per Phase 1 verdict)

M7 verdict: "🔄 IMPROVE — Activate ≥8 fields with lift evidence." Half the calibration knobs declared on the schema have no readers. **Same scaffold-without-callers pattern as R2/R3.**

Robust pattern: a calibration field is added only when its consumer is added in the same commit. Future audit lint: every schema field has a `git grep` hit count.

### R5 — Plan-execute synthetic kernel state is a rotting translator 🟢 SUPPORTED

`plan-execute.ts:667-686` constructs a fake `KernelState` shape from PER (plan-execute-reflect) outer-iter to feed the RI controller's score(). The RI contract is kernel-shaped. Plan-execute outer iters aren't kernel iters.

Risk: kernel state contract evolves → synthetic state silently drifts → RI signal degrades on plan-execute without anyone noticing. **No test pins the synthetic shape.**

Robust fix: either (a) generalize EntropySensor contract beyond `kernelState`, or (b) document the adapter explicitly + add a contract test.

### R6 — Triple compression uncoordinated 🟢 SUPPORTED (per memory `project_running_issues`)

Three compression stages (stash, curator, patch) may all fire on the same conversation. Curator is the sole prompt author per ContextCurator design but the other two stages still mutate `state.messages`. Coordination is by timing.

Robust fix: name one compression owner per phase; others become advisers that emit recommendations the owner consumes.

### R7 — No soft-required-tool extraction 🟢 SUPPORTED (sweep F5)

Task: "use `recall` to fetch full data." Agent: ignores, uses `find`, claims "no 7th result." Verifier passes. **The framework offered a tool by name and the model declined; the harness didn't notice.**

Robust fix: prompt-text parsing extracts named tool nominations into `softRequiredTools`. Verifier check: when claimed-impossible without invoking nominated tool, reject.

### R8 — F8 thinking-mode regression invisible 🟡 PENDING (step 7 tier expansion needed for cross-model repro)

78s think on qwen3:14b retrieval probe. Can't tell if thinking-mode regressed (W7 was supposed to make it opt-in) because `llm-exchange` events not wired.

Robust fix: wire emitLLMExchange at provider adapter boundary. Auto-detect thinking-mode markers. Surface as `provider.thinking-mode-active` warning.

---

## INTELLIGENCE — the agent reasons better, not the harness intervenes harder

### I1 — Arbitrator that integrates entropy + evidence + claim-coverage 🔵 ASPIRATIONAL

Current entropy signal is one proxy. **Failure mode it misses (FM-C1):** stable-confident-wrong (low entropy + claim of impossibility despite available recovery). RI threshold suppression blocks intervention exactly when most needed.

Intelligent: composite signal `confidence × evidence-quality × claim-coverage`. Stable + low evidence + claim of "I can't" → escalate, not early-stop.

Pending: needs labeled dataset of confident-wrong vs uncertain-right traces. Probe to design.

### I2 — Required-tool nomination from task text 🟢 SUPPORTED (sweep F4/F5)

Tasks frequently say "use X to do Y." Agent declines. Verifier passes. Auto-extract nominations → soft-required → verifier check.

This is small-scope but **adds a robustness layer that compounds**: the more agents respect explicit task hints, the less prompt-engineering users do.

### I3 — `learn/` capability that closes the iter loop 🟢 SUPPORTED (capability mapping)

PlanStore, reflexion's critique history, ToT path scoring each implement learn-shaped state. Different shapes, different owners, no coordination, no per-iter consolidation.

Intelligent design: `Learn(observations, decisions, outcomes) → MemoryWrite + CalibrationUpdate + SkillRefine` — one capability fires per iter, writes to three sinks. M6/M7/M10 each become a sink.

Pending Q3a/c from campaign — empirical lift signal needed to gate the capability investment.

### I4 — Multi-strategy meta-routing replaced by capability composition 🟢 SUPPORTED (capability mapping)

Adaptive currently picks one of 7 strategies based on heuristics. **Each strategy reimplements outer-loop.**

Intelligent: strategies expressed as declarative phase compositions over shared capability set. Adaptive routes phases (BFS-explore, critique-loop, plan-wave-execute) into a per-task pipeline instead of routing the whole strategy.

Equivalent runtime semantics, much smaller LOC, capabilities and observability shared.

Caveat: capability mapping showed <30% mappable. Genuine algorithmic divergence (BFS, critique) must remain primitive — they're capabilities themselves, not commodity wirings.

### I5 — Verifier as multi-check pipeline, not single boolean 🟢 SUPPORTED (sweep F4)

Current verifier emits `{verified: bool, checks[]}`. The bool collapses 6 checks. Output passes if any combination passes.

Intelligent: verifier emits per-check severity ladder (`pass | warn | reject | escalate`). Loop Controller decides what each severity triggers: warn → log; reject → retry; escalate → human or strategy-switch.

Currently `verified=true` regardless of confidence in the underlying checks. **Loss of nuance.**

### I6 — Confidence/evidence trajectory as a first-class observation 🔵 ASPIRATIONAL

Entropy tracks composite uncertainty. **No signal tracks "evidence accumulating?"** Is the model citing more tool observations over iter? Less? Same five tokens recycled?

Intelligent: per-iter evidence-mass signal (e.g., bytes of tool output referenced in latest thought / total bytes available). Combined with entropy → diagnose stuck-loop vs converging-correctly vs confidently-wrong.

Pending: needs per-iter trace mining; flagged for probe design phase.

### I7 — Skills compound across sessions, not just within 🟢 SUPPORTED (M6 verdict)

M6 verdict: "🔄 IMPROVE — within-session learning works, no cross-session persistence." Skill state lives in agent instance memory. Restart → forgets.

Intelligent: skill state writes to SQLite (already proposed in Phase 1.5). Cross-session recall queries skill registry. **Compounding intelligence** trait actually compounds.

### I8 — Trace events feed prompt context (self-aware harness) 🔵 ASPIRATIONAL

Harness emits structured trace events. **The agent doesn't see them.** Trace consumers are external.

Intelligent: a `harness-self-observation` channel feeds key trace events (intervention-suppressed, verifier-rejected, loop-detected) into the next thought's context: "you previously stalled at iter 2 because composite entropy fell below threshold. Consider whether the current approach is correct."

This is the "agent becomes aware of the harness around it" move. Pending: design + safety analysis (avoid meta-recursion failure modes).

---

## Cross-tag summary

| Move | Evidence state | Where to land it |
|---|---|---|
| E1 Single Arbitrator | 🟢 SUPPORTED | morph spec Phase 3 |
| E2 Capability-scoped emit | 🟢 SUPPORTED | morph spec Phase 1 (cheap) |
| E3 Compose subsumes RI surface (bridge) | 🟢 SUPPORTED | morph spec Phase 1 |
| E4 Strategy boilerplate extracted | 🟢 SUPPORTED | morph spec Phase 2 |
| E5 Collapse adjacent emits | 🟢 SUPPORTED | morph spec Phase 1 |
| E6 Sync/async unification | 🔵 ASPIRATIONAL | post-v1.0 |
| R1 totalTokens=0 wiring | 🟢 SUPPORTED (new) | spot fix or Phase 1 |
| R2 Dead Compose tags | 🟢 SUPPORTED | morph spec Phase 1 |
| R3 ControllerDecision union prune | 🟡 PENDING (step 6) | post-ablation |
| R4 Calibration fields prune | 🟢 SUPPORTED | M7 Phase 1.5 work |
| R5 Synthetic kernel state translator | 🟢 SUPPORTED | morph spec Phase 2 |
| R6 Triple compression coordination | 🟢 SUPPORTED | own work item |
| R7 Soft-required tool extraction | 🟢 SUPPORTED | morph spec Phase 2 |
| R8 LLM-exchange wiring | 🟡 PENDING (step 7) | morph spec Phase 1 |
| I1 Composite confidence signal | 🔵 ASPIRATIONAL | post-Arbitrator (Phase 3+) |
| I2 Required-tool nomination | 🟢 SUPPORTED | own work item, low cost |
| I3 `learn/` capability | 🟡 PENDING (Q3a/c) | morph spec Phase 2 |
| I4 Capability composition routing | 🟢 SUPPORTED | post-morph spec |
| I5 Multi-severity verifier | 🟢 SUPPORTED | morph spec Phase 2 |
| I6 Evidence trajectory signal | 🔵 ASPIRATIONAL | post-v1.0 |
| I7 Cross-session skill persistence | 🟢 SUPPORTED | M6 Phase 1.5 |
| I8 Self-aware harness | 🔵 ASPIRATIONAL | post-v1.0 |

---

## Pattern detected — "scaffold without callers"

R2 (4 dead Compose tags), R3 (13 RI variants vs ~5 wired), R4 (14 calibration fields vs ~5 consumers): **same anti-pattern shipped three times.**

Type-system declares surface > runtime fires. Users autocomplete on capabilities that silently no-op.

**Robust principle for v0.12+:** every declared surface element MUST have a `git grep` hit demonstrating an emit site / consumer in the same commit. Lint rule. Doc convention. The framework's first promise is "no false surface."

---

## Top elegance/robustness/intelligence triage

Read this with the morph spec next to it. Each of these is a candidate for Phase 1 (no behavior change, raises floor):

1. **R1** totalTokens metadata wiring (find break, fix, regression test) — silent data loss; high trust impact.
2. **E5** collapse adjacent snapshot emits — trace bloat halved; F6 auto-resolves.
3. **E2 + R2** capability-scoped emit + light up 4 dead Compose tags — closes F1, F4-indirect, R2 in one work item.
4. **I2** soft-required tool extraction — directly addresses FM-C1; ~50 LOC.
5. **R8** wire `emitLLMExchange` at provider boundary — unblocks F8 diagnosis + future tier work.

That set is ~5 commits, no architectural risk, ~40-60% of the sweep findings closed as side effects, AND it materially raises elegance + robustness floor. Doesn't preclude or commit to morph Phases 2/3 (Arbitrator + Strategy re-platform).

---

## One principle to anchor the morph spec

**Optimal harness shipped surface = (declared capabilities) ∩ (live wired sites) ∩ (consumed externally).**

If a capability is declared but not wired, scaffold debt.
If wired but not consumed externally, dead instrumentation.
If consumed externally but not declared, undocumented power-user reach.

Today the framework leaks on the first axis (R2/R3/R4 — declared > wired). The morph spec should close that gap before adding any new declared surface.

---

## Status

- 🟢 SUPPORTED count: 13 (more than enough to start writing morph spec)
- 🟡 PENDING count: 4 (cross-strategy matrix + RI ablation will resolve)
- 🔵 ASPIRATIONAL count: 5 (post-v1.0 vision; flagged but not blocking)

Combined with the drift analysis, capability mapping, and event coverage diff, this is the empirical + design substrate the morph spec writes from.

Cross-strategy matrix run is in progress (background task b1n8a60bv). RI ablation script ready to fire when matrix finishes (avoid Ollama daemon contention).
