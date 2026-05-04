# Reactive Agents — Design North Star v3.0

**Status:** AUTHORITATIVE for ARCHITECTURE. This document supersedes v2.3 and consolidates all architecture, code-organization, and implementation-plan thinking into one source of truth.

**Date:** 2026-04-26 (architecture); 2026-04-27 (methodology layer added — see companion docs below)
**Author:** Tyler Buell + Claude
**Mandate:** v0.10.0 release is **deferred** until this architecture is in place. No exceptions. The framework's reliability problem is structural, not surface, and shipping more features on a fractured foundation only multiplies the debt.

**Companion documents (added 2026-04-27):**
- `PROJECT-STATE.md` — current empirical state of the project. **Read first at session start.**
- `00-RESEARCH-DISCIPLINE.md` — the 12 rules governing any harness change. Every architectural change in §6 is subject to spike validation per Rule 1.
- `01-FAILURE-MODES.md` — catalog of failure modes. The §7 validation discipline operates against this catalog.
- `02-IMPROVEMENT-PIPELINE.md` — operational rhythm: how discoveries flow into harness changes.

---

## Table of Contents

1. [Mandate & Vision Alignment](#1-mandate--vision-alignment)
2. [Empirical Foundations](#2-empirical-foundations)
3. [The Agent Model — 10 Capabilities, 5 Traits](#3-the-agent-model)
4. [The Cognitive Architecture](#4-the-cognitive-architecture)
5. [Code & Package Organization](#5-code--package-organization)
6. [Implementation Plan — Sprint by Sprint](#6-implementation-plan)
7. [Validation Discipline](#7-validation-discipline)
8. [Success Criteria](#8-success-criteria)
9. [What Stays vs What Changes](#9-what-stays-vs-what-changes)
10. [Glossary](#10-glossary)
11. [Superseded Documents](#11-superseded-documents)

---

## 1. Mandate & Vision Alignment

### What we're building toward

`docs/spec/docs/00-VISION.md` names four properties:

> **Reliability, Control, Security, Performance** — delivered through engineering, not magic.

This document is how we deliver those four properties as observable, gate-pinned, empirically-validated agent behavior. Not aspiration. **Outcomes you can measure on the failure corpus and the gate scenarios.**

### The diagnosis (one paragraph)

After Phase 0 + Phase 1 (Sprints 1–2) shipped 11 commits of structural foundation (typed errors, capability port, ContextCurator, trustLevel), the failure corpus moved from 4/8 → 5/8 correct booleans. CHANGE A (controllerSignalVeto) added a Verdict-Override pattern but still produced 5/8 — because the kernel has **9 termination paths** and CHANGE A wired the oracle into only one of them. The remaining failure modes traced to **mixed concerns within phases** (think.ts conflates Sense + Comprehend + Reason + Decide + Act in one module). The framework has ~70% of the right pieces; the architectural sin is **distributed responsibility for what should be single-owner concerns**.

### The mandate

**Stop adding features. Stop refining individual evaluators. Implement the cognitive architecture below. Validate with empirical discipline. Then ship v0.10.0.**

---

## 2. Empirical Foundations

This section is the evidence base. All architectural decisions in §3–§9 are anchored here.

### 2.1 Failure corpus baseline (Apr 24)

8-scenario corpus on cogito:14b. Result: **4/8 correct booleans.** All four labeled-failure scenarios returned `success=true`. Entropy AUC = 1.000 (perfect predictor); dispatch AUC = 0.750 (imperfect action). **Detection works. Termination doesn't.**

### 2.2 Post-Phase-1 corpus (Apr 25)

Same corpus, after 11 commits of structural work. Result: **5/8 correct booleans** (+1: failure-contradictory-data correctly returned false). Entropy gap shrunk 0.340 → 0.140 (-59%). **Structural foundation is in but behavioral payoff is partial.**

### 2.3 Post-CHANGE-A corpus (Apr 26)

Same corpus, after CHANGE A added the controllerSignalVeto. Result: **5/8 correct booleans, no improvement in count, composition shifted.** failure-verify-loop went `true→false` (correctly identified) in run 1; success-typescript-paradigm got falsely vetoed; remaining false positives unchanged.

### 2.4 The W4 verdict (proven by trace inspector)

`scratch-trace-inspector.ts` confirmed: **W4 is genuinely closed at the kernel-iteration level.** Peak iter ≤ maxIterations in 7/8 traces (1 inconclusive — agent terminated before any controller event ran). The corpus's "29 iters" reading was a `traceStats().iterations` measurement bug AND an entropy-scored.iter anomaly (separate issue, see §4.2 Provenance concern). **cf-14 is testing the right thing.**

### 2.5 The 9-termination-path finding

```
$ grep -rn 'status.*"done"' packages/reasoning/src/strategies/kernel/
  act.ts:436                  ← final-answer TOOL bypasses oracle
  think.ts:553                ← fast-path bypasses oracle
  think.ts:696                ← loop-detect bypasses oracle
  think.ts:910                ← oracle path (where CHANGE A landed)
  loop-detector.ts:145
  kernel-runner.ts:637, 675, 761, 823, 877
```

**Nine code paths transition the kernel to `status: "done"`. The termination oracle is consulted at exactly one.** Three of four labeled-failure corpus scenarios call `final-answer` as a tool, exiting through act.ts:436 — bypassing the veto entirely. **This is the architectural blocker. CHANGE A is a gate at one door of a building with nine doors.**

### 2.6 Run-to-run variance

Same scenario, two consecutive corpus runs:

| Scenario | Run 1 | Run 2 |
|---|---|---|
| failure-rate-limit-loop | 9 decisions, peakIter 9 | 2 decisions, peakIter 3 |
| failure-verify-loop | false ✓ (vetoed) | true ✗ (not vetoed) |

**5× variance in dispatch count between consecutive runs of the same scenario.** Single corpus runs are not reliable signal. Future architectural decisions must be validated against **N=3 medians**, not single runs.

### 2.7 Architectural-gap status (consolidated from scorecard)

| Gap | Status | Evidence |
|---|---|---|
| **G-1** num_ctx not derived from capability | ✅ closed | cf-15, cf-16 green; resolveCapability shipped |
| **G-2** Two ModelTier schemas | ✅ closed | cf-17 referential identity assertion |
| **G-3** Memory not async | 🟡 unchanged | not addressed in Phases 0–1 |
| **G-4** 3 compression systems | 🟡 partial | curator IS sole prompt author; deletion deferred |
| **G-5** Termination scattered | 🟡 partial | cf-14 pins builder; runtime has 9 paths (root cause of corpus failures) |
| **G-6** ExecutionEngine 4404 LOC | 🟡 unchanged | not addressed |

---

## 3. The Agent Model

### 3.1 The 10 Capabilities

Every agent — biological or artificial — performs the same loop. The harness must guarantee each capability with one clear owner system:

```
Sense → Attend → Comprehend → Recall → Reason → Decide → Act → Verify → Reflect → Learn
```

These are *concerns*, not workflow stages. Some run in parallel, some sequentially.

| # | Capability | What it means | Failure mode if missing |
|---|---|---|---|
| 1 | **Sense** | Observe state + world (state, tools, time, entropy, tokens) | Agent doesn't know what's happening |
| 2 | **Attend** | Filter sensed signal to per-iteration relevance | Context bloat, noise drowns signal |
| 3 | **Comprehend** | Parse meaning from task + observations | Misreads task, wrong tools, wrong question |
| 4 | **Recall** | Retrieve relevant prior knowledge (4 memory layers) | Can't compound learning, repeats mistakes |
| 5 | **Reason** | Generate candidate next actions | Bad action selection, no plan |
| 6 | **Decide** | Select exactly ONE action — the Arbitrator | Multiple paths choosing differently (today's bug) |
| 7 | **Act** | Execute chosen action (LLM, tool, memory write) | Wrong args, ignores tool errors |
| 8 | **Verify** | Check whether action succeeded | Declares success when failing |
| 9 | **Reflect** | Evaluate trajectory, signal trouble | Doesn't notice it's stuck |
| 10 | **Learn** | Consolidate experience for future use | No cross-session improvement |

### 3.2 The 5 Trait Clusters (mapped to vision)

| Trait | Capabilities | Vision pillar | Today's failure |
|---|---|---|---|
| **Comprehension** | Sense + Attend + Comprehend | Control | Mixed concerns in think.ts; no TaskComprehender service |
| **Strategic intent** | Reason + Decide | Reliability | 9 termination paths; no escalation ladder |
| **Effective action** | Act + Verify | Reliability + Security | No first-class Verifier; effectors decide termination |
| **Self-monitoring** | Reflect | Performance | reactive-observer mixes pure + side effects |
| **Compounding intelligence** | Recall + Learn | Performance | Learning pipeline scattered across 3 packages |

**The vision is delivered when each trait is empirically visible in agent runs.** Each gate scenario in §7 pins one trait or sub-component.

### 3.3 Why these 10 (and not more, not fewer)

Established cognitive architectures (ACT-R, SOAR, ~30-40 years of research) converged on the same shape: working memory + perception + decision + action + learning, with ONE rule firing per cycle. The brain converged on it (basal ganglia for arbitration, prefrontal cortex for inhibitory control, hippocampus for learning). Successful agent frameworks (LangGraph, OpenAI Swarm) converge on minimal primitives doing one thing each.

**We are not inventing cognitive design. We are adopting what already works.**

---

## 4. The Cognitive Architecture

### 4.1 The shape

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CROSS-CUTTING (always available)                     │
│  State (KernelState)  |  Telemetry (EventBus)  |  Safety (Guardrails+      │
│  Budgets+Identity)    |  Time (Clock)          |  Provenance (TrustLabels) │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
       ┌─────────────────────────────┼─────────────────────────────┐
       │                             │                             │
       ▼                             ▼                             ▼
┌─────────────┐                ┌─────────────┐               ┌─────────────┐
│  PERCEIVE   │                │  REASON     │               │   ACT       │
│             │                │             │               │             │
│ Observation │                │ Reasoning   │               │ Effector    │
│ Sensor      │     ────►      │ Engine      │     ────►     │ Pool        │
│             │                │             │               │             │
│ Salience    │                │ Reflection  │               │ Verifier    │
│ Curator     │                │ Engine      │               │             │
│             │                │             │               │             │
│ Task        │                └──────┬──────┘               └──────┬──────┘
│ Comprehender│                       │                             │
└──────┬──────┘                       ▼                             │
       │                       ┌─────────────┐                      │
       │                       │             │                      │
       │                       │ ARBITRATOR  │ ◄──── ALL signals    │
       │                       │             │                      │
       │                       │ ONE verdict │                      │
       │                       │ per iter    │                      │
       │                       │             │                      │
       │                       │ continue    │                      │
       │                       │ exit-ok     │                      │
       │                       │ exit-fail   │                      │
       │                       │ escalate    │                      │
       │                       └─────────────┘                      │
       │                                                            │
       └────────────────────────────────────────────────────────────┘
       ▲                                                            │
       │                                                            ▼
       │                                                     ┌─────────────┐
       │                                                     │   LEARN     │
       │                                                     │             │
       │                                                     │ Memory      │
       │                                                     │ Service     │
       └─────────────────────────────────────────────────────┤             │
                                                             │ Calibration │
                                                             │ Experience  │
                                                             └─────────────┘

  Loop Controller orchestrates: Perceive → Reason → Decide → Act → Learn → repeat
                                                       ↑
                                                  the one decision
```

### 4.2 The contracts

**Sensors** are pure functions `state → readonly Observation`. No mutation. Observable via EventBus.

**Integrators** are pure functions `Observation[] → decision-ready data`. No mutation, no decisions.

**Arbitrator** is a pure function `(integrated signals, state) → Verdict`. Returns exactly ONE of: `continue | exit-success | exit-failure | escalate`. The only place termination is decided. The only place strategy switches are decided.

**Effectors** are side-effect functions `(state, Verdict) → Effect<NewState, Error>`. Execute what the Verdict commands. Cannot decide termination, cannot decide strategy.

**Loop Controller** is the only state mutator. Owns the iteration cycle. Sequence is fixed: sense → integrate → arbitrate → act → learn (between iterations) → loop.

### 4.3 The 10 services + 5 cross-cutting concerns

| Service | Capability | Where it lives |
|---|---|---|
| ObservationSensor | Sense | `packages/reasoning/src/kernel/capabilities/sense/` |
| SalienceCurator | Attend | `packages/reasoning/src/context/` (already exists as ContextCurator) |
| TaskComprehender | Comprehend | `packages/reasoning/src/kernel/capabilities/comprehend/` |
| MemoryService | Recall | `packages/memory/` (already cohesive) |
| ReasoningEngine | Reason | `packages/reasoning/src/kernel/capabilities/reason/` |
| **Arbitrator** | **Decide** | `packages/reasoning/src/kernel/capabilities/decide/` |
| EffectorPool | Act | `packages/reasoning/src/kernel/capabilities/act/` |
| Verifier | Verify | `packages/reasoning/src/kernel/capabilities/verify/` |
| ReflectionEngine | Reflect | `packages/reasoning/src/kernel/capabilities/reflect/` |
| LearningPipeline | Learn | `packages/reasoning/src/kernel/capabilities/learn/` (bridge to memory + reactive-intelligence) |

| Cross-cutting concern | Where |
|---|---|
| State | `packages/reasoning/src/kernel/state/` |
| Telemetry | `packages/core/event-bus` + `packages/trace` (existing) |
| Safety | `packages/guardrails` + `packages/cost` + `packages/identity` (existing) |
| Time | `packages/core` (extract from implicit, make mockable) |
| Provenance | `ObservationResult.trustLevel` (S2.3, extend to all observations) |

### 4.4 The unifying principle

> **Every cognitive function in the agent is implemented as a service with: one owner, typed contract, observable events, replaceable strategy, and isolated tests.**

This is the rule. Violating it is the failure mode this architecture exists to prevent.

---

## 5. Code & Package Organization

### 5.1 Package strategy: don't add new packages

Today: 27 packages. The chaos is **inside `packages/reasoning/src/strategies/kernel/`**, not in package count. Five mega-files (kernel-runner.ts 63.7K, think.ts 41.0K, act.ts 43.2K, tool-execution.ts 34.0K, kernel-state.ts 29.5K) plus 21 utility files mixed across two folders (`phases/`, `utils/`).

**The fix is reorganization within the existing reasoning package, plus 5-6 small package consolidations.** Net package count goes DOWN to ~22.

### 5.2 The new kernel internal structure

```
packages/reasoning/src/kernel/                  (was: src/strategies/kernel/)
├── state/                                      (working memory + lifecycle)
│   ├── kernel-state.ts
│   ├── kernel-hooks.ts
│   └── kernel-constants.ts
├── loop/                                       (the only state mutator)
│   ├── runner.ts                               (extracted from 63.7K kernel-runner.ts)
│   └── react-kernel.ts                         (factory)
├── capabilities/                               (the 10 cognitive functions)
│   ├── sense/
│   │   ├── observation-sensor.ts
│   │   └── step-utils.ts
│   ├── attend/                                 (or keep ContextCurator in src/context/)
│   │   ├── context-utils.ts
│   │   └── tool-formatting.ts
│   ├── comprehend/
│   │   ├── task-comprehender.ts
│   │   └── task-intent.ts
│   ├── reason/                                 (LLM call only — no decisions)
│   │   ├── think.ts                            (decomposed from 41K)
│   │   ├── stream-parser.ts
│   │   └── think-guards.ts
│   ├── decide/                                 (the Arbitrator)
│   │   ├── arbitrator.ts                       (renamed termination-oracle)
│   │   └── evaluators/
│   │       ├── controller-signal-veto.ts       (CHANGE A)
│   │       ├── llm-end-turn.ts
│   │       ├── final-answer-regex.ts
│   │       └── ...
│   ├── act/                                    (effectors only — no decisions)
│   │   ├── tool-execution.ts
│   │   ├── tool-gating.ts
│   │   ├── tool-parsing.ts
│   │   └── tool-capabilities.ts
│   ├── verify/                                 (NEW first-class)
│   │   ├── verifier.ts
│   │   ├── quality-utils.ts
│   │   ├── evidence-grounding.ts
│   │   └── requirement-state.ts
│   ├── reflect/                                (pure parts of reactive-observer)
│   │   ├── reflection-engine.ts
│   │   ├── loop-detector.ts
│   │   └── strategy-evaluator.ts
│   └── learn/                                  (bridge to memory + RI packages)
│       └── learning-bridge.ts
└── utils/                                      (truly cross-cutting only)
    ├── ics-coordinator.ts
    └── lane-controller.ts
```

**Every dev question maps to one folder name:**

| Question | Folder |
|---|---|
| "Where does the agent decide to stop?" | `decide/` |
| "Where does the prompt get assembled?" | `attend/` (or shared `context/`) |
| "Where does the LLM call happen?" | `reason/` |
| "Where do tools execute?" | `act/` |
| "Where do we check if the task is done?" | `verify/` |
| "Where does the loop run?" | `loop/` |
| "Where does state mutate?" | `loop/runner.ts` (and ONLY there) |

### 5.3 Small package consolidations (opportunistic, ~22 packages target)

| Today | Merges into | Why |
|---|---|---|
| `packages/verification` | `packages/reasoning/.../capabilities/verify/` | Single owner; verification is a kernel capability |
| `packages/prompts` | `packages/reasoning/src/context/` | Prompts are a curator concern |
| `packages/interaction` | `packages/runtime` | Interaction patterns are runtime |
| `packages/benchmarks` + `packages/scenarios` | `packages/testing` | Three test packages → one with submodules |
| `packages/health` | `packages/observability` | Health is observability |

### 5.4 What stays exactly as-is

- `core`, `llm-provider`, `tools`, `memory`, `observability`, `trace` — distinct concerns, one owner each
- `guardrails`, `cost`, `identity` — safety domain, separate publish boundaries
- `a2a`, `gateway`, `orchestration` — multi-agent / deployment concerns
- `reactive-agents` (facade), `runtime`, `reactive-intelligence` — orchestration layers
- `react`, `vue`, `svelte` — framework adapters (separate npm publish targets)
- `eval`, `testing` — separate testing concerns

### 5.5 The principle

> **Add a package when there's a publish boundary or different consumer profile. Add a folder when there's a clear concern boundary. Don't confuse the two.**

The 10 cognitive capabilities are *concerns*, not *publish boundaries* — agents don't import "the SalienceCurator" separately. So they're folders, not packages.

---

## 6. Implementation Plan

### 6.1 Phase structure

| Phase | Name | Status | Deliverable |
|---|---|---|---|
| **Phase 0** | Foundation | ✅ Shipped | Typed errors, redactor, error-swallow events, P11 dispatches, W4/cf-14 |
| **Phase 1** | Capability + Curator | ✅ Shipped (Sprints 1-2) | Capability port, ContextCurator, trustLevel, ModelTier unification |
| **Phase 2** | Cognitive Kernel | 🚧 NOW | Reorganize kernel, promote Verifier, consolidate Arbitrator, close G-5 |
| **Phase 3** | Validation Harness | Queued | N=3 corpus methodology, multi-run aggregation, statistical gates |
| **Phase 4** | Package consolidation | Queued | 27 → ~22 packages, opportunistic |
| **Phase 5** | v0.10.0 release | Blocked on Phases 2-4 | Tag, publish, announce |

### 6.2 Phase 2 — Cognitive Kernel (the now-work)

Five sprints, each ~1 week, each with explicit validation gates.

#### Sprint 3.1 — Kernel Reorganization (~1 week, 1 large mechanical PR + tests)

**Goal:** Move from `src/strategies/kernel/{phases,utils}/` to `src/kernel/{state,loop,capabilities/*,utils}/`. **No behavior change.**

**Scope:**
- Move every file in `strategies/kernel/` to its new home per §5.2
- Update all imports (mechanical, tooling-assisted)
- Run full test suite — every test must still pass
- Add gate scenario `cf-22-kernel-internal-structure` that asserts the folder structure exists (very lightweight: just imports + checks)

**Validation gate:**
- ✅ All 4500+ tests pass with no behavior change
- ✅ Typecheck clean across all 27 packages
- ✅ Gate scenarios cf-04 through cf-21 still green
- ✅ N=3 corpus run shows ≤ 5% variance from current baseline (no regression)

**What we DON'T do in this sprint:** decompose any of the mega-files. That's Sprint 3.3+. This sprint is purely move-and-rename.

#### Sprint 3.2 — Verifier promotion (~1 week)

**Goal:** Promote Verify to a first-class capability with one owner.

**Scope:**
- Create `kernel/capabilities/verify/verifier.ts` with typed `verify(action, result, context) → VerificationResult` interface
- Move quality-utils, evidence-grounding, requirement-state under `verify/`
- Refactor `act.ts` to call `verifier.verify()` after every effector output
- Add gate scenario `cf-23-verify-runs-after-every-action`
- Add 15+ unit tests on the Verifier

**Validation gate:**
- ✅ Verifier emits a structured pass/fail event for every effector call
- ✅ N=3 corpus shows verifier output present in every iteration trace
- ✅ Gate scenarios still green

#### Sprint 3.3 — Arbitrator consolidation (CHANGE A.5, closes G-5)  ★ HIGHEST LEVERAGE

**Goal:** All termination decisions flow through one Arbitrator. Close G-5.

**Scope:**
- Promote `termination-oracle.ts` to `arbitrator.ts` under `decide/`
- Define `Verdict = continue | exit-success | exit-failure | escalate`
- Refactor 9 `status:"done"` sites:
  - act.ts:436 (final-answer-tool path)
  - think.ts:553, 696, 910
  - loop-detector.ts:145
  - kernel-runner.ts:637, 675, 761, 823, 877
- Each refactored site emits a TerminationIntent; Arbitrator resolves to a Verdict
- Add gate scenario `cf-24-all-termination-flows-through-arbitrator`
- Add 25+ unit tests on the Arbitrator

**Validation gate:**
- ✅ N=3 corpus shows ≥ 7/8 correct booleans (vs today's 5/8)
- ✅ Run-to-run variance ≤ 2× (vs today's 5×)
- ✅ Wall time per scenario ≤ 90% of today's median
- ✅ Gate scenarios still green
- ✅ A grep for `status.*"done"` outside `kernel/loop/runner.ts` returns ZERO results

**Critical:** if validation gate fails, Sprint 3.4 does not start. We diagnose before continuing.

#### Sprint 3.4 — Reflect / Sense extraction (~1 week)

**Goal:** Split reactive-observer into pure (Reflect) and side-effect (Effector) parts.

**Scope:**
- Create `kernel/capabilities/reflect/reflection-engine.ts` (pure)
- Create `kernel/capabilities/sense/observation-sensor.ts` (pure read of state + entropy)
- Move dispatch side-effects into `act/` effector pool
- Reflection's output feeds the Arbitrator as one of its signals
- Add gate scenario `cf-25-reflection-feeds-arbitrator`

**Validation gate:**
- ✅ N=3 corpus stable
- ✅ Reflection output traceable independent of side effects
- ✅ Per-tier reflection thresholds configurable via ContextProfile

#### Sprint 3.5 — TaskComprehender + Provenance + Time (~1 week)

**Goal:** Promote the missing first-class services.

**Scope:**
- Create `kernel/capabilities/comprehend/task-comprehender.ts` (extends task-intent.ts)
- Extract Time service into `packages/core` (mockable clock)
- Extend ObservationResult.trustLevel to ALL observations (not just tool results)
- Fix entropy-scored.iter to read state.iteration (closes the iter=23/28 anomaly)
- Add gate scenarios cf-26 (Time mockable), cf-27 (Provenance universal), cf-28 (TaskComprehender output is structured)

**Validation gate:**
- ✅ N=3 corpus stable or improving
- ✅ All gate scenarios green
- ✅ Trace replays show clean per-iteration data flow: sense → integrate → arbitrate → act → verify

### 6.3 Phase 3 — Validation Harness (~1 week)

**Goal:** N=3 corpus methodology becomes the default validation gate for any future change.

**Scope:**
- Update `failure-corpus.ts` to run each scenario N times (default 3) and report median + range
- Add `corpus-compare.ts` script: takes two baseline files, reports deltas with statistical significance
- Make multi-run validation a gate-update prerequisite for any commit affecting kernel
- Document the methodology in `docs/spec/docs/16-validation-discipline.md`

### 6.4 Phase 4 — Package Consolidation (~1 week, opportunistic)

**Goal:** 27 → ~22 packages per §5.3.

**Scope:** 5 small PRs, one per consolidation listed in §5.3. Each is mechanical, low-risk.

### 6.5 Phase 5 — v0.10.0 release

**Pre-release checklist (all must hold):**
- [ ] Failure corpus N=3 median ≥ 7/8 correct booleans
- [ ] Run-to-run variance ≤ 2×
- [ ] All gate scenarios cf-04 through cf-28 green
- [ ] Typecheck clean across all packages
- [ ] All 4500+ tests pass
- [ ] No `status:"done"` transitions outside `kernel/loop/runner.ts`
- [ ] No parallel prompt-author paths outside ContextCurator
- [ ] CHANGELOG covers Phase 0 + Phase 1 + Phase 2
- [ ] North Star v3.0 (this doc) is current
- [ ] Public docs reflect new architecture

---

## 7. Validation Discipline

### 7.1 The N=3 corpus rule

**Every architectural change is validated by running the failure corpus 3 times and comparing medians to baseline.** Single runs are not evidence.

### 7.2 The gate scenario growth plan

Phase 0 + Phase 1 shipped cf-04 through cf-21 (11 gate scenarios). Phase 2 adds:

| ID | Pins |
|---|---|
| cf-22 | Kernel folder structure (sense/, attend/, comprehend/, reason/, decide/, act/, verify/, reflect/, learn/, loop/, state/) |
| cf-23 | Verifier runs after every effector output |
| cf-24 | All `status:"done"` transitions flow through Arbitrator |
| cf-25 | Reflection output feeds Arbitrator as a signal |
| cf-26 | Time service is mockable (no implicit Date.now() in kernel) |
| cf-27 | Provenance (trustLevel) on all observations |
| cf-28 | TaskComprehender output is structured |

### 7.3 The empirical gates per phase

Each sprint has a measurable gate. If the gate doesn't pass, we diagnose before continuing — same discipline as the diagnostic loop that produced this document.

---

## 8. Success Criteria

### 8.1 Architectural (objective)

- [ ] Every status:"done" transition flows through `kernel/loop/runner.ts` (grep test)
- [ ] Every prompt assembly flows through ContextCurator (grep test)
- [ ] Every kernel iteration produces: 1 sensor read + 1 integrator pass + 1 arbitrator verdict + ≤1 effector call (trace assertion)
- [ ] All 10 capabilities have a folder under `kernel/capabilities/`
- [ ] All 5 cross-cutting concerns are reachable via service composition
- [ ] Package count ≤ 22

### 8.2 Behavioral (empirical)

- [ ] Failure corpus N=3 median: ≥ 7/8 correct booleans (today: 5/8)
- [ ] Run-to-run variance: ≤ 2× (today: 5×)
- [ ] Average wall time per scenario: ≤ 90% of today's median
- [ ] Entropy gap (success vs failure): ≥ 0.30 (today: 0.140)
- [ ] All gate scenarios cf-04 through cf-28 green

### 8.3 Vision-aligned (qualitative)

- [ ] **Reliability**: same input → same output for pure functions; no contradictory termination decisions
- [ ] **Control**: every decision visible at one location; trace replay tells the full story
- [ ] **Performance**: pure functions cache; effectors parallelize; memory async
- [ ] **Compounding intelligence**: learning runs at session boundary; calibration accumulates per-(provider, model)

---

## 9. What Stays vs What Changes

### 9.1 Stays (preserve everything good we shipped)

- **Builder API** — `ReactiveAgents.create().with*()` — unchanged
- **Effect-TS service composition** — services flow through loop controller
- **EventBus + Trace** — telemetry concern, well-shaped
- **Memory layers** (working/episodic/semantic/procedural) — already cohesive
- **5 reasoning strategies** — pluggable Reason implementations
- **6 LLM providers** — capability port already abstracts them
- **ContextCurator (S2.5)** — IS the SalienceCurator, just gets named explicitly
- **Trust labels (S2.3)** — the Provenance concern, just extends to all observations
- **Capability port (S1.x)** — what every service consumes
- **Guardrails / cost / identity** — safety domain, well-shaped
- **Gateway / A2A / orchestration** — multi-agent / deployment, well-shaped
- **27 → 22 packages** — consolidation only; no removal of capability

### 9.2 Changes (refactor, not rewrite)

- **think.ts** decomposes into: `sense/`, `comprehend/`, `reason/think.ts`, calls to `decide/arbitrator.ts`, dispatches to `act/`
- **act.ts** decomposes into: `act/effector-pool.ts`, calls to `verify/verifier.ts`, no decisions
- **reactive-observer.ts** decomposes into: `reflect/reflection-engine.ts` (pure) + `act/dispatcher-effector.ts` (side effects)
- **termination-oracle.ts** promotes to `decide/arbitrator.ts`
- **9 status:"done" sites** all route through one Arbitrator
- **3 compression systems** collapse into the Curator (already the right home)
- **5 small packages** consolidate per §5.3

### 9.3 Adds (small, focused)

- **TaskComprehender** as a first-class service
- **Verifier** as a first-class service
- **Time** service (mockable clock) in `packages/core`
- **N=3 validation harness** in `harness-improvement-loop` skill

### 9.4 Net LOC change

The refactor SHRINKS total LOC. Decomposition extracts well-defined responsibilities; consolidation removes duplicates. Estimated -10% to -20% net LOC after Phase 2-4 complete.

---

## 10. Glossary

| Term | Definition |
|---|---|
| **Capability** | One of the 10 cognitive functions every agent must perform (Sense, Attend, etc.) |
| **Service** | A typed component that owns one capability (one owner, contract, events, replaceable, isolated tests) |
| **Sensor** | A pure read of state. Returns observations; never mutates. |
| **Integrator** | A pure synthesis of observations into decision-ready data. Never decides, never mutates. |
| **Arbitrator** | The single function that produces exactly ONE Verdict per iteration. Owns Decide capability. |
| **Effector** | A side-effect function that executes what the Verdict commands. Cannot decide. |
| **Loop Controller** | The only component that mutates state. Owns the iteration cycle. |
| **Verdict** | One of: `continue \| exit-success \| exit-failure \| escalate` |
| **TerminationIntent** | A signal a phase emits indicating it observed something terminal-worthy. The Arbitrator resolves intents into Verdicts. |
| **Trait** | A cluster of capabilities that delivers a vision pillar (Comprehension, Strategic intent, Effective action, Self-monitoring, Compounding intelligence) |
| **Cross-cutting concern** | A primitive available to every service: State, Telemetry, Safety, Time, Provenance |
| **Cognitive Services architecture** | The shape: 10 services + 5 cross-cutting concerns + 1 loop controller + 1 arbitrator pivot |
| **Verdict-Override pattern** | Higher-priority signal trumps lower-priority signal in decision (e.g., controller veto over agent's success claim) |
| **Sole Author pattern** | One component owns one concern; no parallel paths (proven by S2.5 ContextCurator) |
| **Single Source of Truth pattern** | Derived observables read from one state field; no parallel counters (proven needed by entropy.iter anomaly) |
| **Per-tier Calibration pattern** | Behavior thresholds parameterized by ContextProfile, not fixed globally |
| **N=3 validation rule** | Every architectural change validated by running the corpus 3 times and comparing medians |

---

## 11. Superseded Documents

This North Star v3.0 supersedes and consolidates the following analysis documents. They remain in `harness-reports/` as historical evidence (the diagnostic trail), but are no longer authoritative for forward direction:

| Document | Status | What it contributed to v3.0 |
|---|---|---|
| `harness-reports/north-star-status-audit-20260424.md` | Historical | G-1..G-6 status table → §2.7 |
| `harness-reports/improvement-report-20260424-north-star-1.md` | Historical | Apr 24 corpus baseline → §2.1 |
| `harness-reports/north-star-closure-scorecard-2026-04-25.md` | Historical | Post-Phase-1 corpus → §2.2 |
| `harness-reports/north-star-diagnosis-2026-04-25.md` | Historical | W4 verdict via trace inspector → §2.4 |
| `harness-reports/change-a-empirical-validation-2026-04-26.md` | Historical | 9-termination-paths finding → §2.5 |
| `harness-reports/cognitive-kernel-architecture-2026-04-26.md` | Superseded | Three-tier shape → §4 |
| `harness-reports/agent-capability-architecture-2026-04-26.md` | Superseded | 10 capabilities + 5 traits → §3, §4.3 |

The **previous** `15-design-north-star.md v2.3` is also superseded by this v3.0.

Going forward, **this document is the single source of truth for architecture decisions.** When in doubt about a kernel concern or a refactor priority, refer here first.

---

## Appendix A — The Convergence Argument

Why we are confident this architecture is the right one (not just a plausible one):

1. **Empirically derived, not theorized.** The 10 capabilities map 1:1 to failures we measured. The 9-termination-paths root cause was found by trace inspection, not by inspection of intent.

2. **Biologically convergent.** The brain evolved exactly this shape (sensors, integrators, arbitrator, effectors, loop) over 200M+ years. C. elegans (302 neurons) follows this pattern; humans follow this pattern; everything in between follows this pattern.

3. **Independently rediscovered.** ACT-R (Carnegie Mellon, 30 years), SOAR (Newell, 40 years), Global Workspace Theory (Baars, Dehaene), LangGraph (state machine), OpenAI Swarm (minimal primitives), Anthropic Claude Code (single termination contract) — every serious cognitive architecture project converges on a subset of these properties.

4. **Failure-mode-symmetric.** The pattern's prescriptions (one decision per cycle, separate sense from act, etc.) are the *negation* of the failure modes we measured (9 termination paths, mixed phase concerns). Choosing the architecture that fixes the measured failures is the conservative move.

5. **Already 70% present.** ContextCurator, memory layers, capability port, trust labels — the pattern's components already exist in our codebase. We are *naming and consolidating*, not *inventing and adding*.

This is the closest thing to architectural certainty we get to have. It will not be perfect — but it will be observably better than what we have, and we have the validation discipline to catch deviations early.

---

## Appendix B — Decision Log (the choices baked into v3.0)

Documented for future contributors who want to know *why* this and not something else:

| Decision | Alternative considered | Why this won |
|---|---|---|
| Three-tier (sensors/integrators/effectors) with arbitrator | Two-tier (perceive/act) | Cognitive science decisively prefers separating decide from act |
| One Arbitrator function | Multiple specialized arbitrators | Proven failure mode: 9 termination paths is what happens when "specialized" decisions don't converge |
| ContextCurator stays in `src/context/`, others move to `kernel/capabilities/` | Move ContextCurator into `attend/` for symmetry | Curator is shared by multiple kernel paths and tests; moving it is large blast radius for low symmetry gain |
| Reorganize within `packages/reasoning` | New `packages/cognition` package | User feedback: 27 packages already; structural clarity comes from folders, not packages |
| Sequential phase plan (3.1 → 3.5) | Single big-bang refactor PR | Diagnostic loop discipline: validate each step's metric before continuing |
| N=3 corpus rule | N=1 single runs | Empirically proven: 5× variance between runs invalidates single-run conclusions |
| Defer v0.10.0 release | Ship v0.10.0 with current state | Vision pillars (reliability, control) demonstrably not delivered; shipping locks in debt |

---

_Version: 3.0.0_
_Status: AUTHORITATIVE_
_Date: 2026-04-26_
_Supersedes: v2.3 + 5 harness-reports analysis docs_
_Next review: after Phase 2 Sprint 3.3 (Arbitrator consolidation) lands_
