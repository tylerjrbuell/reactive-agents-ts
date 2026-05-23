---
tags: [optimal-algorithm, execution-spec, success-signals, harness-canonical-loop]
date: 2026-05-23
companion-required-reading:
  - 00-VISION.md
  - 05-DESIGN-NORTH-STAR.md
  - 06-MISSION-STATEMENTS.md
  - wiki/Architecture/Design-Specs/2026-05-23-harness-convergence.md
status: canonical-target
---

# Optimal Execution Algorithm — The Canonical Harness Loop

> **The harness exists to compress the gap between intent and outcome.** This document specifies the canonical per-iter algorithm the harness executes when functioning at peak signal, efficiency, and effectiveness. Every architectural decision in `2026-05-23-harness-convergence.md` is in service of reaching this algorithm structurally.

---

## 0. Framing — Signal, Efficiency, Effectiveness

The harness is a controller in service of three quantitative properties:

| Property | Definition | Measurement |
|---|---|---|
| **Signal** | Trace richness × diagnostic value per byte emitted | `% of decisions auditable to source signal` × `% of trace bytes that change a diagnosis when removed` |
| **Efficiency** | Outcome quality per unit cost (tokens, latency, $, iterations) | `output-quality-score / total-cost`; minimize cost to first acceptable verdict |
| **Effectiveness** | Probability of correct outcome across the failure-mode catalog | `success rate × output quality / total cost`, evaluated per FM category |

**The optimal harness maximizes all three simultaneously.** Tradeoffs surface in tier-specific behavior — frontier models can afford different Efficiency/Effectiveness curves than local models.

---

## 1. The Per-Iter Canonical Algorithm

```
═══════════════════════════════════════════════════════════════════════
ITER N
═══════════════════════════════════════════════════════════════════════

  ┌─────────────────────────────────────────────────────────────────┐
  │ 0. SETUP  (≤0.5ms)                                              │
  │    state ← read previous iter                                   │
  │    emit kernel-state-snapshot { iter:N, status:'entering' }     │
  └────────────────────────────┬────────────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ 1. SENSE  (≤1ms)                                                │
  │    observations ← sensors(state)         [PURE]                 │
  │    emit observation-emitted × N                                 │
  │  Capabilities: ObservationSensor — pure, side-effect-free       │
  └────────────────────────────┬────────────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ 2. ATTEND  (≤5ms)                                               │
  │    curatedContext ← curate(observations, history, budget)       │
  │    emit curator-decision (per kept/dropped fragment)            │
  │  Capabilities: SalienceCurator — sole prompt author             │
  └────────────────────────────┬────────────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ 3. COMPREHEND  (≤2ms)                                           │
  │    intent ← parseTask(task, state)                              │
  │      → soft-required-tools, format hints, complexity class      │
  │    emit comprehend-result { softRequiredTools, formatHints }    │
  │  Capabilities: TaskComprehender                                 │
  └────────────────────────────┬────────────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ 4. RECALL  (≤10ms)                                              │
  │    memory ← recall(query={iter, intent, taskCategory})          │
  │    skills ← findSkills(intent.taskCategory)                     │
  │    calibration ← loadProfile(modelId, taskCategory)             │
  │    emit memory-recall × { type, hits }                          │
  │  Capabilities: MemoryService                                    │
  └────────────────────────────┬────────────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ 5. REASON  (≤provider latency, hard cap 30s)                    │
  │    llmResponse ← LLM.complete({                                 │
  │      prompt: curatedContext + intent + memory + skills,         │
  │      tools: gatedTools(intent.softRequiredTools, calibration),  │
  │      temperature: calibration.preferredTemp                     │
  │    })                                                           │
  │    emit llm-exchange { promptHash, responsePreview, tokens }    │
  │  Capabilities: ReasoningEngine                                  │
  └────────────────────────────┬────────────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ 6. DECIDE — Arbitrator  (≤5ms, PURE)                            │
  │    signals ← collect([                                          │
  │      EntropySignal, VerifierSignal, HealingSignal,              │
  │      KillswitchSignal, LoopDetectorSignal, BudgetSignal         │
  │    ])                                                           │
  │    verdict ← arbitrate(signals, state)                          │
  │      → { continue | exit-success | exit-failure | escalate }    │
  │    emit arbitrator-verdict { verdict, signalSources }           │
  │  Capabilities: Arbitrator (PURE FUNCTION, SOLE DECIDER)         │
  └────────────────────────────┬────────────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ 7. ACT  (≤tool latency, hard cap 60s per tool)                  │
  │    IF verdict = continue + tool calls present:                  │
  │      results ← parallel(toolCalls)                              │
  │    IF verdict = exit-success:                                   │
  │      state.output ← sanitize(state.thought) [strip M2a/b/c]    │
  │    IF verdict = exit-failure:                                   │
  │      state.output ← null  [trust differentiator]                │
  │    IF verdict = escalate:                                       │
  │      switch strategy OR human-in-loop                           │
  │    emit tool-call × N + observation.tool-result × N             │
  │  Capabilities: EffectorPool + executeToolCall (single owner)    │
  └────────────────────────────┬────────────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ 8. VERIFY  (≤10ms, PURE)                                        │
  │    checks ← runVerifierChecks(state.output, intent, observations)│
  │      per-check severity: pass | warn | reject | escalate        │
  │    emit verifier-verdict { checks, computedVerified }           │
  │  Capabilities: Verifier — multi-severity ladder                 │
  └────────────────────────────┬────────────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ 9. REFLECT  (≤5ms, PURE)                                        │
  │    signals ← reflect(state.history, observations, verdict)      │
  │      → loop-detected, trajectory-shape, evidence-trajectory     │
  │    emit reflection-signals (for next iter's Arbitrator)         │
  │  Capabilities: ReflectionEngine                                 │
  └────────────────────────────┬────────────────────────────────────┘
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ 10. LEARN  (≤20ms async, NON-BLOCKING)                          │
  │    LearningPipeline.write(observations, decisions, outcomes)    │
  │      → SkillStoreService.store(skillFragment?)                  │
  │      → CalibrationStoreService.update(taskCategory, profile)    │
  │      → MemoryStoreService.append(episode)                       │
  │    emit learn-write × { target, success, durationMs }           │
  │    on failure: emit warning skill-persistence-failed (NO SWALLOW)│
  │  Capabilities: LearningPipeline                                 │
  └────────────────────────────┬────────────────────────────────────┘
                               ▼
  IF verdict ∈ {exit-success, exit-failure}: HALT
  ELSE: state.iteration++; continue with ITER N+1
```

### Framework overhead budget per iter

Sum of **non-LLM, non-tool** time: **≤59ms framework overhead** (0.5+1+5+2+10+5+5+10+20 = 58.5ms).

The actual iter wallclock = framework overhead + provider latency + tool latency.

For a 14b local model with no tools, expect ~3-15s per iter. Framework overhead ≤2% of total. Anything else is symptom of drift.

---

## 2. Strategy Composition over the Canonical Loop

Strategies are **declarative phase compositions** that reuse the 10 capabilities:

```typescript
// reactive (default — full canonical loop, one iter at a time)
const reactive = phases([sense, attend, comprehend, recall, reason, decide, act, verify, reflect, learn]);

// direct (one-shot — same loop, max 1 iter)
const direct = phases([sense, attend, comprehend, reason, act, verify, learn], { maxIter: 1 });

// plan-execute-reflect (outer plan; inner reactive for steps; outer reflect)
const planExecuteReflect = phases([
  outerPhase.plan,        // own algorithmic outer-loop (legitimate primitive)
  outerPhase.executeWaves,  // wave-schedule → per-step reactive sub-loops
  outerPhase.reflect,     // own algorithmic critique
  outerPhase.maybeRefine,
  outerPhase.terminate,
]);

// reflexion (initial → critique → improve)
const reflexion = phases([
  outerPhase.initialResponse,  // delegates to reactive
  outerPhase.critique,         // pure-LLM critique (no tools)
  outerPhase.checkConvergence,
  outerPhase.improve,          // delegates to reactive
]);

// tree-of-thought (BFS explore → execute best path)
const treeOfThought = phases([
  outerPhase.bfsExplore,     // own algorithmic outer-loop
  outerPhase.scorePaths,
  outerPhase.selectBest,
  outerPhase.executeBest,    // delegates to reactive
]);

// code-action (genuine substrate divergence)
const codeAction = strategy.codeAction;  // own worker-thread sandbox
```

**Every outer-phase emits the same diagnostic events as the inner kernel.** That's how F1 closes structurally.

---

## 3. Per-Capability Success Signals

### Sense
- **Signal:** Every state transition yields ≥1 observation
- **Efficiency:** Pure function; zero side effects; <1ms execution
- **Effectiveness:** Observations cover state changes with 100% recall (audit: replay should reconstruct from observations)

### Attend
- **Signal:** Curator decisions emit per kept/dropped fragment
- **Efficiency:** Compression ratio ≥40% on long contexts; latency <5ms
- **Effectiveness:** No key fact missing from curated context (audit: probe-replay matches)

### Comprehend
- **Signal:** Per-task `comprehend-result` event with intent + softRequiredTools + formatHints + complexityClass
- **Efficiency:** Single pass through task text
- **Effectiveness:** softRequiredTools extraction recall ≥60% on F4/F5-class tasks

### Recall
- **Signal:** Per-recall event with `type` ∈ {episodic, semantic, skill, calibration} + hit count
- **Efficiency:** Async-friendly; <10ms for FTS5 lookup
- **Effectiveness:** Recall hit rate ≥66% on verbose queries, ≥100% on keyed (M10 baseline)

### Reason
- **Signal:** Every LLM call emits llm-exchange { promptHash, responsePreview, tokens, latency }
- **Efficiency:** Token budget per iter; prompts compressed via Attend
- **Effectiveness:** Native FC compliance ≥95% on frontier; ≥70% on local large; ≥50% on local mid

### Decide (Arbitrator)
- **Signal:** Exactly ONE arbitrator-verdict per iter
- **Efficiency:** Pure function, ≤5ms
- **Effectiveness:** Verdict correctness audit-replay matches ≥99% on gate corpus

### Act
- **Signal:** Per-tool-call start + end events with rationale
- **Efficiency:** Parallel execution of independent tool calls
- **Effectiveness:** Tool error → healing recovery ≥86% (M4 baseline maintained)

### Verify
- **Signal:** Per-check severity emission; no boolean collapse
- **Efficiency:** ≤10ms; pure-function checks
- **Effectiveness:** FM-C1 / FM-D1 reject rate ≥80% on respective failure modes

### Reflect
- **Signal:** Per-reflection signals for next iter's Arbitrator
- **Efficiency:** ≤5ms; pure-function
- **Effectiveness:** Loop detection recall ≥95% (within 3 iter of formation)

### Learn
- **Signal:** Per-write events with target + success
- **Efficiency:** Async, non-blocking; ≤20ms write
- **Effectiveness:** Cross-session lift ≥+5pp session-2 on repeat tasks

---

## 4. Composite Success Signals

### S1 — Audit Density (signal)

```
audit_density = (decisions traceable to source events) / (total decisions made)
TARGET: ≥0.99
```

Every verdict, every intervention, every termination must trace to a source signal in the event stream.

### S2 — Cost Per Quality Unit (efficiency)

```
cost_per_quality = total_tokens / output_quality_score
TARGET (frontier): ≤300 tokens/quality-unit
TARGET (local large): ≤1500 tokens/quality-unit
TARGET (local mid): ≤3000 tokens/quality-unit
```

`output_quality_score` is rubric-graded; calibration tracks per-strategy-per-tier per-task-class.

### S3 — Time-To-Signal (efficiency)

```
time_to_first_intervention = max(iter when first dispatched intervention fires)
time_to_loop_detection = max(iter loop-detector fires after loop formation)
TARGET: ≤3 iter for both
```

### S4 — Effectiveness Across Failure Modes

```
effectiveness_per_FM = (correct outcomes on FM-X) / (total FM-X scenarios)
TARGET per FM:
  FM-A (tool engagement) ≥ 0.85
  FM-B (tool error handling) ≥ 0.90
  FM-C (reasoning quality) ≥ 0.70
  FM-D (loop control) ≥ 0.90
  FM-E (output quality) ≥ 0.95
  FM-F (context/memory) ≥ 0.80
  FM-G (multi-turn) ≥ 0.75
  FM-H (compliance) — tier-dependent
```

### S5 — Trust Compliance (effectiveness)

```
trust_violations_per_run = count[(success=true && output is internal markup)]
                        + count[(success=true && failed-to-produce-output logs)]
                        + count[(metadata.totalTokens=0 && trace has token events)]
TARGET: 0
```

Direct anti-mission #4 enforcement.

### S6 — Surface Wiring Compliance

```
declared_surface_with_wires = |{ declared TagMap entries }| - |{ tags with 0 emit sites }|
                            + |{ ControllerDecision variants }| - |{ variants with 0 fires }|
                            + |{ calibration fields }| - |{ fields with 0 consumers }|

declared_surface_total = | declared entries union |

surface_compliance = declared_surface_with_wires / declared_surface_total
TARGET: ≥0.95
```

Direct anti-mission #6 enforcement.

---

## 5. Cross-Tier Optimal Behavior Targets

Optimal harness exhibits tier-specific defaults that maximize Signal/Efficiency/Effectiveness for each.

| Tier | Strategy default | Verifier threshold | RI mode | LLM-exchange capture |
|---|---|---|---|---|
| **Frontier** (claude-haiku-4.5, gpt-4o-mini, gemini-2.5-pro) | adaptive | warn-only | minimal (frontier compliant) | preview only |
| **Local Large** (qwen3:14b, deepseek-r1:14b) | adaptive | warn → reject | full | full prompt+completion |
| **Local Mid** (cogito:14b, gemma3:12b) | reactive | warn → reject → escalate | full + healing-aggressive | full + reasoning trace |
| **Local Small** (cogito:8b, qwen3:4b) | direct / reactive | escalate-fast | minimal (avoid feedback loop drift) | full |

Tier detection from `capabilitySnapshot` in builder → routes through calibration table.

---

## 6. Optimal Trajectory Shape

### Acceptable

```
Iter 1: thought → tool → observation
Iter 2: thought → tool → observation  
Iter 3: thought → final-answer (verdict=exit-success)

Total: 3 iter, ≤15s wall, ≤8000 tokens (local) or ≤2000 tokens (frontier)
```

### Anti-pattern — recognized failure shapes

| Shape | Diagnosis | Phase 0-3 fix |
|---|---|---|
| `thought → thought → thought (no tool)` | FM-A1 confident-no-tool | Phase 1.4 soft-required nomination |
| `tool-error → same-tool-call → tool-error → ...` | FM-B1 infinite retry | RI tool-failure-streak (Phase 1.5) |
| `tool → analyze → "no data" claim` | FM-C1 shallow give-up | Phase 1.4 + Phase 2.2 multi-severity verifier |
| `final-answer with <rationale> XML` | M2a output leak | Phase 0.2 output sanitization |
| `BFS explore × 23× cost on trivial` | M3 ToT misrouting | Phase 0.5.1 cost gate |

---

## 7. Algorithmic Invariants — What MUST Hold

These are non-negotiable; violation = bug:

1. **Single Arbitrator per iter.** Loop Controller calls `arbitrate()` exactly once per iter; result is sole termination decision.

2. **`status=failed → output=null`.** Trust differentiator. No exceptions.

3. **`status=done → output≠null` AND `output passes sanitization`.** No M2a/b/c leak.

4. **Every emit site has ≥1 consumer.** Anti-mission #6 enforced.

5. **`state.status =` outside `transitionState()`** → lint failure.

6. **Verifier check failure → severity ≠ pass.** No boolean collapse.

7. **Tool execution flows through `executeToolCall()` capability** regardless of caller.

8. **Token + cost metadata aggregates from real per-call data.** R1 never recurs.

9. **`success === true` IFF `output !== null && output.length > 0 && status === 'done'`.** R10/M7 never recur.

10. **Capability emit events fire from capability code, never from strategy code.** F1 stays closed.

---

## 8. Measurement Cadence

| Cadence | Measurement | Tool |
|---|---|---|
| **Per-PR** | L1 metrics ladder (07 §9) | CI lint + test suite |
| **Per-session** | Probe one task across all strategies × current tier | `harness-improvement-loop` skill |
| **Weekly** | L2 metrics + sample probe trace replay determinism | `bun run rax:diagnose validate` |
| **Monthly** | L3 outcome metrics on gate corpus | dedicated probe suite |
| **Quarterly** | Full sweep + drift detection + amendment review | full harness-improvement-loop campaign |

The optimal harness sees itself measured continuously. Drift > 5% → amendment OR fix.

---

## 9. The Single-Sentence Optimal Harness Spec

> **Sense → Attend → Comprehend → Recall → Reason → ARBITRATE → Act → Verify → Reflect → Learn, all at capability scope, all observable, all hookable, one Verdict per iter, every advertised surface backed by live wiring, every result truthful.**

That sentence is the entire system. The morph spec exists to make it structurally true.

---

## 10. How To Use This Document

- **For code review:** Does this PR move toward an algorithmic invariant from §7?
- **For new feature:** Which capability does it land in (§3)? Does it preserve the time budget (§1)?
- **For debugging:** Which step in §1 is the diagnosis sitting on? Did the relevant capability emit its required signal (§3)?
- **For roadmap:** Which Phase 0/0.5/1/2/3 issue (in `2026-05-23-harness-convergence.md`) is needed to make this algorithm fully realizable?

---

## 11. Provenance + Living Document

- Drafted: 2026-05-23, after harness sweep + morph spec
- Empirical basis: 97 evidence runs across 3 model tiers + 10 evidence reports + 22 GH issues filed
- Will evolve with each campaign; statements get stricter over time, never vaguer
