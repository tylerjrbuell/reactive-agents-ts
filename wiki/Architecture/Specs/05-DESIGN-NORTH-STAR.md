# Reactive Agents — Design North Star v5.0

**Status:** AUTHORITATIVE for ARCHITECTURE + ROADMAP. This document is the single consolidated source of truth for all forward-looking work. It supersedes v3.0, `07-ROADMAP-v1.0.md`, and `Phase 1.5 Improvement Roadmap.md`.

**Date:** 2026-04-26 (architecture); 2026-04-27 (methodology layer); 2026-05-07 (v4.0 — consolidated forward plan, empirical state updated to v0.10.6, all roadmap phases absorbed)
**Author:** Tyler Buell + Claude
**v5.0 amendments (2026-05-11):** Pruning Principle added (§9); M14 Self-Evolution added to Phase 1.5 (§2.2, §6); M3 changed to ablation-gated (§2.2, §6); M8 elevated to elevated-priority IMPROVE (§2.2, §6); Phase B Wave A/B tag catalog expanded to 7 tags (§6). All changes grounded in verified research (arXiv 2603.25723, 2603.28052). See `Architecture/Design-Specs/2026-05-11-harness-research-integration.md`.

**Companion documents (unchanged — read these, not this doc, for their specific concerns):**
- `04-PROJECT-STATE.md` — framing for cold session start. **Read first.**
- `01-RESEARCH-DISCIPLINE.md` — the 12 rules governing any harness change.
- `02-FAILURE-MODES.md` — failure mode catalog.
- `03-IMPROVEMENT-PIPELINE.md` — operational rhythm: how discoveries flow into harness changes.

**Referenced design specs (tactical detail — not absorbed here):**
- `wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md` — Compose API injection points, type system, tag catalog.
- `wiki/Planning/Implementation-Plans/2026-05-06-v0.11-launch-readiness.md` — v0.11 tactical rollout, metrics, timeline.

---

## Table of Contents

1. [Mandate & Vision Alignment](#1-mandate--vision-alignment)
2. [Empirical Foundations — Current State (v0.10.6)](#2-empirical-foundations--current-state-v0106)
3. [The Agent Model — 10 Capabilities, 5 Traits](#3-the-agent-model--10-capabilities-5-traits)
4. [The Cognitive Architecture](#4-the-cognitive-architecture)
5. [Code & Package Organization](#5-code--package-organization)
6. [Consolidated Forward Plan](#6-consolidated-forward-plan)
7. [Validation Discipline](#7-validation-discipline)
8. [Success Criteria](#8-success-criteria)
9. [What Stays vs What Changes](#9-what-stays-vs-what-changes)
10. [Glossary](#10-glossary)
11. [Amendment Log](#11-amendment-log)
12. [Superseded Documents](#12-superseded-documents)

---

## 1. Mandate & Vision Alignment

### What we're building toward

`wiki/Architecture/Specs/00-VISION.md` names the mission:

> **Built for control, not magic. Reliable, observable, composable agents for any model, any tier.**

Three core principles:
1. Every decision an agent makes should be controllable, observable, and auditable.
2. The right engineering makes any model production-capable — great agents aren't locked to flagship models.
3. Great frameworks disappear — the DX should feel like building with superpowers, not fighting configuration.

Eight vision pillars: **Control · Observability · Flexibility · Scalability · Reliability · Efficiency · Security · Speed.**

### The architecture mandate

This document is how we deliver those eight pillars as observable, gate-pinned, empirically-validated agent behavior. Not aspiration. **Outcomes you can measure on the failure corpus and the gate scenarios.**

Every phase in §6 has a measurable validation gate. No phase ships without its gate passing. No features without a foundation.

---

## 2. Empirical Foundations — Current State (v0.10.6)

This section replaces the Apr 27 baseline from v3.0. All forward planning in §6 anchors here.

### 2.1 What has shipped (as of 2026-05-07)

**v0.10.6 is released on npm.** All packages published. All P1 issues resolved.

| Item | Status | Evidence |
|---|---|---|
| Typed errors, capability port, ContextCurator, trustLevel | ✅ Phase 0–1 | commit history |
| 9-termination-path consolidation → single `terminate.ts` | ✅ FIX-18 Stage 5 W4 | `kernel/loop/terminate.ts` |
| Frozen judge isolation (Rule 4) | ✅ FIX-21 W9 (commit a9a7c55f) | `eval-service.ts:189` uses `JudgeLLMService` Tag |
| 13-mechanism Phase 1 validation sweep | ✅ 8 KEEP + 5 IMPROVE | `.agents/PHASE-1-SYNTHESIS.md` |
| Gateway chat mode (per-sender SQLite, 40-turn windowing) | ✅ May 1 | `packages/runtime/src/gateway-chat.ts` |
| Frontier bench 100% (4 models: claude-sonnet-4-6, haiku-4-5, gpt-4o-mini, gemini-2.5-pro) | ✅ W21 Apr 30 | `ra-full` suite |
| Layer 1 builder: `buildFinalAnswerDescription` (calibration-driven length pruning) | ✅ commit 941bcb3a | `packages/tools/src/skills/final-answer.ts` |
| Layer 1 builder: `buildOracleNudge` (escalating oracle nudge) | ✅ commit e72f50d3 | `packages/reasoning/src/kernel/capabilities/decide/oracle-nudge.ts` |
| Calibration profiles: cogito:14b, cogito:8b, gemma4:e4b, qwen3:14b | ✅ 4 models profiled | `packages/llm-provider/src/calibrations/` |

### 2.2 Phase 1 mechanism verdicts (8 KEEP + 5 IMPROVE)

| Mechanism | Verdict | Finding | Phase 1.5 Action |
|---|---|---|---|
| M1: RI Dispatcher | ✅ KEEP | Measurement infra in place; architecture sound | — |
| M2: Strategy Switching | ✅ KEEP | 20 passing tests; switching heuristics validated | Real LLM execution for optimal heuristics |
| M3: Verifier + Retry | 🔄 IMPROVE (ablation-gated) | Research (arXiv:2603.25723) shows LLM-as-judge verifier gates are net-negative in isolation (-0.8pp SWE, -8.4pp OSWorld). Note: that paper tested LLM-as-judge; our defaultVerifier is a heuristic guard — applicability unconfirmed until our own ablation. | **Step 1:** ablate on our gate corpus (disable verifier, measure delta). **Step 2 (only if net-positive):** tune retry context for cogito:14b. |
| M4: Healing Pipeline | ✅ KEEP | 86.7% recovery, +80% accuracy, 10:1 token ROI | — |
| M5: Context Curation | ✅ KEEP | 60.7% compression, 38.6% token savings | — |
| M6: Skill System | 🔄 IMPROVE | Within-session learning works; no cross-session persistence | SQLite persistence (target: >70% cross-session recall) |
| M7: Calibration | 🔄 IMPROVE | 14 fields defined; ~5 active consumers | Activate ≥8 fields with lift evidence |
| M8: Sub-agent Delegation | 🔄 IMPROVE (elevated priority) | NLAH (arXiv:2603.25723) shows 90% of compute flowing through child agents in the TRAE coding system — context-specific finding, but signals delegation as high-leverage. | Real LLM execution on 10 scenarios; compose pipeline integration; target raised to ≥20% accuracy lift on complex (≥3-step) tasks. |
| M9: Termination Oracle | ✅ KEEP | Single-owner `terminate.ts` shipped (FIX-18) | — |
| M10: Memory System | 🔄 IMPROVE | 100% keyed / 66.7% verbose recall; multi-session unvalidated | Multi-session scenarios (target: >80% recall) |
| M11: Diagnostic System | ✅ KEEP | 100% TP, 0% FP, 0.02ms latency; production-ready | — |
| M12: Provider Adapters | ✅ KEEP | All 7 hooks, 254/254 tests, zero cross-provider interference | — |
| M13: Guards + Meta-tools | ✅ KEEP | 6 guards functional, 100% accuracy, 0.001ms latency | — |
| M14: Self-Evolution | 🔄 IMPROVE (new) | Not yet implemented. Research (arXiv:2603.25723) shows acceptance-gated attempt narrowing is the most consistently positive module (+4.8pp SWE, +2.7pp OSWorld). | Implement as Compose API hooks (`lifecycle.failure` + `control.strategy-evaluated`) after Phase B Wave A ships. Target: ≥3pp lift on looping gate scenarios; no regression on non-looping scenarios. |

> **File-backed state confirmed:** The per-sender SQLite session history (gateway-chat, shipped May 1) corresponds to the NLAH "file-backed state" module, which was also robustly positive (+1.6pp SWE, +5.5pp OSWorld). This is a research confirmation of an already-correct decision.

### 2.3 Remaining architectural gaps

| Gap | Description | Phase |
|---|---|---|
| **G-3** | Memory not async | Phase E |
| **G-4** | 3 compression systems (curator is sole author; dual systems deferred) | Phase A (opportunistic) |
| ~~**G-6**~~ | ~~`builder.ts` 6,082 LOC + `execution-engine.ts` 4,499 LOC~~ — ✅ CLOSED W23–W25 (May 9, 2026): builder.ts 6,232 → 2,407 LOC (-61%); execution-engine.ts 4,499 → 1,539 LOC (-66%). Internals decomposed into `engine/`, `builder/`, `agent/` subdirs. | ~~Phase A~~ |
| **G-7** | Calibration: 14 fields defined, ~5 active consumers | Phase 1.5 + Phase E |

Closed gaps: G-1 (num_ctx from capability), G-2 (dual ModelTier schemas), G-5 (9 termination paths).

---

## 3. The Agent Model — 10 Capabilities, 5 Traits

Every agent — biological or artificial — performs the same loop. The harness must guarantee each capability with one clear owner system.

### 3.1 The 10 Capabilities

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
| 6 | **Decide** | Select exactly ONE action — the Arbitrator | Multiple paths choosing differently |
| 7 | **Act** | Execute chosen action (LLM, tool, memory write) | Wrong args, ignores tool errors |
| 8 | **Verify** | Check whether action succeeded | Declares success when failing |
| 9 | **Reflect** | Evaluate trajectory, signal trouble | Doesn't notice it's stuck |
| 10 | **Learn** | Consolidate experience for future use | No cross-session improvement |

### 3.2 The 5 Trait Clusters (mapped to vision)

| Trait | Capabilities | Vision pillar | Today's status |
|---|---|---|---|
| **Comprehension** | Sense + Attend + Comprehend | Control | TaskComprehender service shipped; ContextCurator is sole prompt author |
| **Strategic intent** | Reason + Decide | Reliability | Single `terminate.ts` owner (FIX-18); Arbitrator at `decide/arbitrator.ts` |
| **Effective action** | Act + Verify | Reliability + Security | Verifier first-class under `capabilities/verify/` |
| **Self-monitoring** | Reflect | Performance | `reflect/loop-detector.ts`, `strategy-evaluator.ts`; pure/side-effect split needed |
| **Compounding intelligence** | Recall + Learn | Performance | M6 persistence (Phase 1.5); M10 multi-session (Phase 1.5); M7 calibration (Phase 1.5) |

**The vision is delivered when each trait is empirically visible in agent runs.** Each gate scenario pins one trait or sub-component.

### 3.3 Why these 10 (and not more, not fewer)

Established cognitive architectures (ACT-R, SOAR, ~30–40 years of research) converged on the same shape: working memory + perception + decision + action + learning, with ONE rule firing per cycle. Successful agent frameworks (LangGraph, OpenAI Swarm) converge on minimal primitives doing one thing each.

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
       │                       │ ARBITRATOR  │ ◄──── ALL signals ───┘
       │                       │             │
       │                       │ ONE verdict │
       │                       │ per iter    │
       │                       │             │
       │                       │ continue    │
       │                       │ exit-ok     │
       │                       │ exit-fail   │
       │                       │ escalate    │
       │                       └──────┬──────┘
       │                              │
       │                       ┌─────────────┐
       │                       │   LEARN     │
       │                       │             │
       │                       │ Memory      │
       └───────────────────────┤ Service     │
                               │             │
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

**Arbitrator** is a pure function `(integrated signals, state) → Verdict`. Returns exactly ONE of: `continue | exit-success | exit-failure | escalate`. The only place termination is decided.

**Effectors** are side-effect functions `(state, Verdict) → Effect<NewState, Error>`. Execute what the Verdict commands. Cannot decide termination, cannot decide strategy.

**Loop Controller** is the only state mutator. Owns the iteration cycle. Sequence is fixed: sense → integrate → arbitrate → act → learn → loop.

### 4.3 The 10 services + 5 cross-cutting concerns

| Service | Capability | Location |
|---|---|---|
| ObservationSensor | Sense | `kernel/capabilities/sense/` |
| SalienceCurator | Attend | `kernel/capabilities/attend/` (ContextCurator) |
| TaskComprehender | Comprehend | `kernel/capabilities/comprehend/` |
| MemoryService | Recall | `packages/memory/` |
| ReasoningEngine | Reason | `kernel/capabilities/reason/` |
| **Arbitrator** | **Decide** | `kernel/capabilities/decide/` |
| EffectorPool | Act | `kernel/capabilities/act/` |
| Verifier | Verify | `kernel/capabilities/verify/` |
| ReflectionEngine | Reflect | `kernel/capabilities/reflect/` |
| LearningPipeline | Learn | `kernel/capabilities/learn/` |

| Cross-cutting concern | Where |
|---|---|
| State | `kernel/state/` |
| Telemetry | `packages/core/event-bus` + `packages/trace` |
| Safety | `packages/guardrails` + `packages/cost` + `packages/identity` |
| Time | `packages/core` (mockable clock) |
| Provenance | `ObservationResult.trustLevel` (extends to all observations in Phase A) |

### 4.4 The unifying principle

> **Every cognitive function in the agent is implemented as a service with: one owner, typed contract, observable events, replaceable strategy, and isolated tests.**

Violating this is the failure mode this architecture exists to prevent.

---

## 5. Code & Package Organization

### 5.1 Package strategy

Today: 27 packages. ~~The chaos is inside `packages/runtime/src/` (builder.ts 6,082 LOC, execution-engine.ts 4,499 LOC) and not in package count.~~ As of W25 (May 9, 2026), the orchestration monoliths have been decomposed: builder.ts is 2,407 LOC + 18 focused submodules in `builder/` and `agent/`, execution-engine.ts is 1,539 LOC + 30+ focused submodules in `engine/`. Package count is the next opportunistic optimization.

**The fix is decomposition within existing packages plus 5–6 small consolidations.** Net package count goes DOWN to ~22.

**The principle:** Add a package when there's a publish boundary or different consumer profile. Add a folder when there's a clear concern boundary. The 10 cognitive capabilities are *concerns*, not *publish boundaries* — they're folders, not packages.

### 5.2 Kernel internal structure (current — Stage 5 complete)

```
packages/reasoning/src/kernel/
├── state/                    ← kernel-state.ts, kernel-hooks.ts, kernel-constants.ts
├── loop/                     ← runner.ts (1,706 LOC), react-kernel.ts, terminate.ts
├── capabilities/
│   ├── act/                  ← act.ts, guard.ts, tool-execution.ts, tool-gating.ts, tool-parsing.ts, tool-capabilities.ts
│   ├── attend/               ← context-utils.ts, tool-formatting.ts
│   ├── comprehend/           ← task-intent.ts
│   ├── decide/               ← arbitrator.ts, oracle-nudge.ts
│   ├── reason/               ← think.ts, stream-parser.ts, think-guards.ts
│   ├── reflect/              ← loop-detector.ts, reactive-observer.ts, strategy-evaluator.ts
│   ├── sense/                ← step-utils.ts
│   └── verify/               ← evidence-grounding.ts, quality-utils.ts, requirement-state.ts, verifier.ts
└── utils/                    ← diagnostics.ts, ics-coordinator.ts, lane-controller.ts, service-utils.ts
```

### 5.3 Orchestration structure (post-W25, May 2026)

```
packages/runtime/src/
├── builder.ts              2,407 LOC (was 6,232) — factory + ReactiveAgentBuilder + build/buildEffect orchestration
├── reactive-agent.ts       1,535 LOC — runtime ReactiveAgent class (extracted W25-E)
├── execution-engine.ts     1,539 LOC (was 4,499) — engine entry + run-pipeline driver
├── builder/
│   ├── types.ts            (option types — public API)
│   ├── helpers.ts          (composePersona, deriveGoalAchieved, defaultTracingConfig)
│   ├── to-config.ts        (serialization)
│   ├── ri-wiring.ts        (RI hook subscription)
│   └── build-effect/       (9 modules: sub-agent-executor, spawn-handlers, remote-agent-tools,
│                            local-agent-tools, tool-init-layer, rag-ingestion, health-layer,
│                            tracing-layer, runtime-construction)
├── agent/                  (5 gateway-loop modules: bootstrap, execute-event, chat-manager-factory,
│                            gateway-tick, gateway-driver)
└── engine/                 (30+ phase + finalize + bootstrap modules from W23+W24)
```

**Rationale:** Both monoliths now have clean concern boundaries. Absolute LOC ceilings (≤500/≤600) were not met but the structural goal — making each concern individually navigable and Phase B (Compose API) pluggable — is achieved. See `wiki/Planning/Implementation-Plans/2026-05-08-execution-engine-final-decomposition.md` and `2026-05-09-builder-decomposition.md` for the full task sequence.

### 5.4 Package consolidations (Phase A, opportunistic)

| Today | Merges into | Why |
|---|---|---|
| `packages/verification` | `kernel/capabilities/verify/` | Single owner; verification is a kernel capability |
| `packages/prompts` | `packages/reasoning/src/context/` | Prompts are a curator concern |
| `packages/interaction` | `packages/runtime` | Interaction patterns are runtime |
| `packages/benchmarks` + `packages/scenarios` | `packages/testing` | Three test packages → one with submodules |
| `packages/health` | `packages/observability` | Health is observability |

### 5.5 What stays exactly as-is

`core`, `llm-provider`, `tools`, `memory`, `observability`, `trace`, `guardrails`, `cost`, `identity`, `a2a`, `gateway`, `orchestration`, `reactive-agents` (facade), `runtime`, `reactive-intelligence`, `react`, `vue`, `svelte`, `eval`, `testing`.

---

## 6. Consolidated Forward Plan

**Single authoritative sequence from today (v0.10.6) to v1.0.** This section replaces `07-ROADMAP-v1.0.md` and `Phase 1.5 Improvement Roadmap.md`.

Detailed tactical plans live in `wiki/Planning/Implementation-Plans/` and are written immediately before execution of each phase. No phase ships without its validation gate.

**Pillars served per phase:**

| Phase | Focus | Pillars | Target release |
|---|---|---|---|
| **A** | Architecture Cleanup (W23–W28) | Control, DX | now-work |
| **1.5** | Mechanism Improvements (M3/M6/M7/M8/M10) | Reliability, Efficiency | parallel with A |
| **B** | Compose API (Waves A–F) | Composition, Control | v0.11 prerequisite |
| **C** | v0.11 Launch | All 8 (credibility signal) | v0.11.0 |
| **D** | Code-as-Action Strategy | Local-First, Efficiency | v0.12 |
| **E** | Local Model Engineering | Model-Adaptive, Local-First | v0.12 |
| **F** | Public Benchmark Discipline | Reliability, Trustworthiness | v0.13 |
| **G** | v1.0 Polish & Release | All 8 | v1.0 |

---

### Phase A — Architecture Cleanup (W23–W28)

**Status: ✅ Decomposition core complete (May 9, 2026).** W23, W24, and W25 shipped — both `execution-engine.ts` and `builder.ts` decomposed; G-6 closed. W27 (`GatewayAgent` type extraction) and W28 (phase-typed builder validation) are optional refinements still ahead. The original W24 plan ("Strategy RI-scaffolding helper") was deferred; the slot was used for `execution-engine.ts` final decomposition instead.

**Goal:** ~~Decompose the orchestration monolith into composable units. Close G-6. This is the foundation that makes the Compose API (Phase B) land on clean ground — the alternative is bolting new API onto a 6,082-line file and paying for that choice in every subsequent phase.~~ **Achieved:** builder.ts 6,232→2,407 LOC (-61%), execution-engine.ts 4,499→1,539 LOC (-66%), 39 new focused submodules across `engine/`, `builder/`, `agent/` subdirs. Phase B (Compose API) is unblocked.

**Vision pillars:** Composition (Phase B depends on this), Control, DX.

**Sequence:** W23 → W24 → W25 → W27 → W28 (W26 in original plan was renumbered to W25 when builder decomposition shipped).

#### W23 — Execution-engine decomposition (phase-as-data architecture) ✅ COMPLETE

**Shipped:** May 7-8, 2026. `execution-engine.ts` 4,499 → 2,358 LOC after agent-loop body, harness-hooks, verify-quality-gate, reasoning-think, and inline-act/observe extractions. Phase-as-data infrastructure landed in `engine/phase.ts`, `engine/pipeline.ts`, `engine/runtime-context.ts`. Closure-state lifted into `PhaseStateRefs`.

**Goal:** Decompose `execution-engine.ts` (~4,663 LOC) using a phase-as-data architecture: each phase is a first-class typed value (`Phase`); the engine composes a `phases` array via a `runPipeline` runner. Number of files is incidental; **composability + LOC ceilings** are the gate.

**Scope:**
- Build infrastructure: `engine/phase.ts` (Phase type + PhaseDeps), `engine/pipeline.ts` (runPipeline + runObservablePhase), `engine/runtime-context.ts` (shared state Refs)
- Extract phases to `engine/phases/{name}.ts` — empirical count: 10 named phases, two (`agent-loop`, `complete`) get sub-folders
- `execution-engine.ts` becomes thin orchestrator (≤600 LOC) that wires deps and composes the phases array
- Cross-phase mutable state moves to `PhaseStateRefs` (no closure leakage)
- Add unit tests where decision logic exists (pipeline composer, tool-classifier, verify, debrief)

**Validation gate:**
- [ ] `execution-engine.ts` ≤ 600 LOC
- [ ] Every phase module ≤ 400 LOC
- [ ] Phase composition is declarative (single `phases` array literal)
- [ ] All 738+ existing `packages/runtime` tests pass unchanged
- [ ] Typecheck clean across all packages
- [ ] New unit tests for ≥3 phases with decision logic

**Tactical plan:** `wiki/Planning/Implementation-Plans/2026-05-07-phase-a-w23-execution-engine-decomposition.md`

#### W24 — Execution-engine final decomposition ✅ COMPLETE

**Shipped:** May 8, 2026. `execution-engine.ts` 2,358 → 1,539 LOC (-35% additional). 12 sub-tasks (T1–T12) extracted post-execution finalize blocks (debrief synthesis, telemetry RunReport, local learning, run finalization), pre-execution dispatchers (bootstrap skill post-processing, pre-loop dispatch), iteration guards, plus quality improvements (typed `ExecutionContextMetadata`, hoisted shared `Context.GenericTag` declarations to `engine/service-tags.ts`). New modules under `engine/finalize/` and `engine/bootstrap/`. Plan: `wiki/Planning/Implementation-Plans/2026-05-08-execution-engine-final-decomposition.md`. _Note: original W24 ("Strategy RI-scaffolding helper") deferred to a later wave._

#### W25 — builder.ts decomposition ✅ COMPLETE (was originally W26)

**Shipped:** May 9, 2026. `builder.ts` 6,232 → 2,407 LOC (-61%). 18 sub-tasks across 5 phases (W25-A through W25-E) extracted public option types, helpers, `toConfig` serialization, RI hook subscription, the `buildEffect()` body (sub-agent executor, spawn handlers, remote A2A tools, local agent-tool registration, tool init layer, RAG ingestion, health/tracing layer composition, base runtime construction), the gateway loop (bootstrap, executeEvent, chat manager factory, tick handler, driver), and the `ReactiveAgent` runtime class (now in `reactive-agent.ts`). 18 commits + 1 type-fix follow-up. All 5,032 tests green; DTS build clean (33/33). Plan: `wiki/Planning/Implementation-Plans/2026-05-09-builder-decomposition.md`.

**LOC ceiling:** Absolute targets (`builder.ts` ≤500, `execution-engine.ts` ≤600) were not met. The structural goal — each concern individually navigable, Phase B (Compose API) able to plug in cleanly — is achieved. Further LOC reduction is possible by extracting individual `with*` setters to method-group modules (deferred; gain-to-cost ratio low).

#### W27 — `GatewayAgent` type extraction

**Goal:** Type-level separation between task agents and gateway agents.

**Scope:**
- Remove `ReactiveAgent.start()` and `ReactiveAgent.stop()`
- Create `GatewayAgent extends ReactiveAgent` with `start()`/`stop()`
- `withGateway()` returns `GatewayAgentBuilder` (not `ReactiveAgentBuilder`)
- Compile-time enforcement: calling `start()` on a non-gateway agent is a type error

**Validation gate:**
- [ ] Gateway-mode tests pass
- [ ] Deliberately-wrong usage in CI produces a TS compile error

#### W28 — Phase-typed builder validation (optional)

**Goal:** Enforce builder phase ordering at compile time.

**Scope:**
- `withTools()` requires prior `withReasoning()` call at the type level
- Phantom type on builder tracks which phases have been called

**Validation gate:**
- [ ] One deliberately-broken example in CI produces exactly one TS error

**Phase A completion gate:**
- [ ] `builder.ts` ≤ 500 LOC, `execution-engine.ts` ≤ 600 LOC
- [ ] Every phase module ≤ 400 LOC
- [ ] Phase composition is declarative (single array literal in `execution-engine.ts`)
- [ ] All 4,672+ tests pass
- [ ] Typecheck clean across all packages
- [ ] N=3 corpus run shows ≤5% variance from current baseline (no behavioral regression)

---

### Phase 1.5 — Mechanism Improvements

**Goal:** Close the 5 IMPROVE verdicts from Phase 1. These run in parallel with Phase A — different files, no conflicts.

**Detailed scopes:** `wiki/Planning/Phase 1.5 Improvement Roadmap.md` (reference only — superseded here but retained for per-mechanism detail).

| Mech | Action | Target | Effort |
|---|---|---|---|
| **M3** Verifier Retry | **✅ Step 1 (ablation) complete — verdict: REWORK.** Accuracy tied (12% both variants across 3 models); noop wins qwen3 +1pp and cogito +1pp; ra-full wins gpt-4o-mini +1pp. Token overhead absent (ra-full uses fewer tokens in 2/3 models). Pre-stated rule fires: REWORK. **Step 2 does NOT fire** (no net-positive accuracy signal). **Next action:** Disable terminal retry loop at `runner.ts:568`; keep verifier as pass/fail gate. Evidence: `wiki/Research/Harness-Reports/phase-1.5-m3-ablation-2026-05-12.md`. | ✅ Ablation complete. Retry loop disabled (pending). | 0.5 day remaining. |
| **M6** Skill Persistence | SQLite-backed skill storage; per-agent scope; SKILL.md import/export | >70% recall across 3+ sessions | 5–7 days |
| **M7** Calibration Consumers | Wire `parallelCallCapability`, `interventionResponseRate`, `tokenEfficiency`, `reasoningDepth`, `knownToolAliases` | ≥8 fields active with measurable lift | 4–6 days |
| **M8** Sub-agent Delegation | Run 10 delegation scenarios on frontier + qwen3:14b. Wire delegation traces through `control.strategy-evaluated` compose hook (Phase B Wave A prereq). Measure accuracy lift, token ROI, and trace completeness. | ≥20% accuracy lift on complex tasks (≥3-step); delegation events visible in trace via compose hook. | 3–5 days (after Phase B Wave A). |
| **M10** Memory Multi-session | Design 3 multi-session scenarios; add Tier 2 semantic search for verbose queries | >80% recall across 3+ sessions | 4–6 days |
| **M14** Self-Evolution | Implement `composeNarrowRetry(maxBroadenAfter)` helper using `lifecycle.failure` + `control.strategy-evaluated` compose hooks. Validate on 3 gate scenarios where agents currently loop. | ≥3pp lift on looping gate scenarios vs. baseline; no regression on non-looping scenarios. | 4–6 days (after Phase B Wave A). |

**Phase 1.5 completion gate:**
- [ ] All 5 mechanisms at or above their targets
- [ ] Evidence artifacts in `wiki/Research/Harness-Reports/phase-1.5-<mech>-YYYY-MM-DD.md`
- [ ] No regressions on existing test suite
- [ ] M14 self-evolution: ≥3pp lift on looping gate scenarios; evidence artifact in `wiki/Research/Harness-Reports/phase-1.5-m14-YYYY-MM-DD.md`

---

### Phase B — Compose API (v0.11 Differentiator)

**Goal:** Ship `.compose((harness) => …)` — full harness injection coverage across 24 chokepoints in 5 namespaces (`prompt.*`, `message.*`, `nudge.*`, `tool.*`, `observation.*`). This is the architectural differentiator that separates Reactive Agents from black-box frameworks.

**Depends on:** Phase A W23/W24/W25 complete ✅ (decomposition gives Phase B clean injection points).

**Full design spec:** `wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md`

**Wave sequence:**

| Wave | Scope | Gate |
|---|---|---|
| **Wave A** | `harness-pipeline.ts` registry + resolver; `harness-tag-catalog.generated.ts` (**7 initial tags**) (5 original + `lifecycle.failure` + `control.strategy-evaluated` for M14 self-evolution); `TagMap`, `PayloadFor`, `ContextFor` type system; `.compose()` on builder | Type inference works; pipeline registry resolves tags |
| **Wave B** | 5 chokepoint refactors: `prompt.system`, `nudge.loop-detected`, `nudge.healing-failure`, `message.tool-result`, `observation.verifier-retry` | All 5 injection points fire in traces; zero regressions |
| **Wave C** | `RunHandle` with pause/resume/stop/terminate; `KernelState.pendingGuidance` plumbing | Handle works end-to-end; `pause()` + `resume()` round-trip |
| **Wave D** | `packages/compose` with 6 killswitches: `budgetLimit`, `timeoutAfter`, `maxIterations`, `requireApprovalFor`, `watchdog`, `confidenceFloor` | All 6 killswitches pass acceptance tests |
| **Wave E** | `.withX()` sugar desugars to compose calls + backward-compat tests | Every `.withX()` method desugar test passes |
| **Wave F** | Docs: `compose-api.mdx`, `harness-tags.mdx`, `composition-recipes.mdx`; `stability.md` update | Docs published; all 24 injection points documented |

**New tags added in v5.0 (Wave A/B catalog):**
- `lifecycle.failure` — fires from `kernel/capabilities/act/tool-execution.ts` (tool errors) and `kernel/capabilities/verify/verifier.ts` (rejections); payload: `{ reason, errorMessage, attemptNumber, failureStreak, currentStrategy }`
- `control.strategy-evaluated` — fires from `kernel/capabilities/reflect/strategy-evaluator.ts`; payload: `{ currentStrategy, score, failureStreak, recommendedAction, availableStrategies }`

**Phase B completion gate:**
- [ ] All 24 injection points have tags reachable via `.compose(harness)`
- [ ] Pattern matching (`.*`, `.**`) infers `PayloadFor<Tag>` correctly in TypeScript
- [ ] 6 killswitches pass acceptance tests
- [ ] `.withX()` methods desugar correctly (backward compatible; no behavior change)
- [ ] Zero regressions on 4,672+ tests

---

### Phase C — v0.11 Launch (Show-HN Inflection Point)

**Goal:** Ship v0.11.0 — the "composable, auditable, transparent" alternative to AutoGen/CrewAI/Mastra. Five market-positioning items plus Snapshot/Replay capability, which directly demonstrates the "every decision auditable" vision claim in a live demo.

**Depends on:** Phase B complete.

**Tactical details:** `wiki/Planning/Implementation-Plans/2026-05-06-v0.11-launch-readiness.md`

**Scope summary:**

| Item | Effort | Vision pillar | Why |
|---|---|---|---|
| **Skill Persistence** (M6 — if not done Phase 1.5) | 1 week | Compounding intelligence | Skills survive session restarts; tech demo → production capability |
| **Live Playground** (Stackblitz, 3 scenarios) | 2 days | DX | "Show me" conversion; 10× reader → installer |
| **`npx create-reactive-agent`** (5 templates) | 3 days | DX | 90 seconds to first running agent |
| **OpenInference / OTel Exporter** (`@reactive-agents/observe`) | 1 week | Observability | Production credibility; Langfuse/Braintrust integration |
| **Public Roadmap + Named Users** (GitHub Projects) | 1 day | — | Momentum signal; closes "Is this maintained?" objection |
| **Snapshot/Replay** (`agent.replay(traceId, overrides)`) | 1 week | Observability, Control | Unique capability; auditable-by-demo; no other framework has this |

**Snapshot/Replay detail:** `agent.replay(traceId, overrides)` replays a recorded run against modified prompts/models with tool results held constant, producing a diff report. Builds on existing `packages/trace` infrastructure. Directly demonstrates "every decision observable and auditable" in a 10-second live demo. Equivalent to Phase 6 in the prior v1.0 roadmap — promoted to v0.11 for Show-HN impact.

**Phase C completion gate (v0.11.0 tag):**
- [ ] Phase B gate passes (Compose API fully shipped)
- [ ] Skill Persistence: cross-session recall >70% (or Phase 1.5 M6 already passed)
- [ ] Playground: 3 Stackblitz scenarios, cold start <3s, edit + re-run works
- [ ] Generator: 5 templates scaffold in <2s, all run with `npm run dev`
- [ ] OTel: all 14+ event tags → OpenInference spans; Langfuse integration tested on real instance
- [ ] Snapshot/Replay: `agent.replay(traceId, overrides)` end-to-end; deterministic on same overrides
- [ ] Zero regressions on 4,672+ tests
- [ ] `ROADMAP.md` (root, public-facing) aligned to this document ← **see §6 note below**

> **Public roadmap alignment:** The root `ROADMAP.md` is the user-facing milestone tracker. It must be updated to reflect Phase A–G sequencing once this v4.0 is finalized and before v0.11.0 ships. The Show-HN post should link to a roadmap that matches this plan.

---

### Phase D — Code-as-Action Strategy

**Goal:** Add `CodeAgentStrategy` as the 6th reasoning strategy. The strategy emits code blocks that compose existing tools as function calls — `tool_x(); tool_y(); return final_answer(...)` — closing the local-model agentic gap and reducing LLM round-trips on multi-step tasks.

**Vision pillars:** Local-First (Pillar 8), Flexibility (Pillar 3), Efficiency (Pillar 6).

**Validation gate:**
- [ ] `CodeAgentStrategy` exists at `packages/reasoning/src/strategies/code-action.ts` and integrates with strategy registry
- [ ] On 10-task multi-step suite: ≥20% accuracy lift over `reactive` on qwen3:14B
- [ ] ≥25% token reduction vs `reactive` on same suite
- [ ] Sandbox safety: no host filesystem access outside sandbox dir; no unwhitelisted network calls; timeout enforced
- [ ] Frontier parity: does not regress claude-haiku or gemini-flash by >5%
- [ ] Evidence artifact: `wiki/Research/Harness-Reports/phase-D-code-as-action-YYYY-MM-DD.md`

**Stop-the-line:** if local-tier lift is <20% after implementation, mark `_unstable_*` and ship opt-in only.

---

### Phase E — Local Model Engineering

**Goal:** Close the per-provider FC-parsing gap, activate dormant calibration consumers, and add tool-result paging. Delivers qwen3:14B at ≥30% of frontier on τ-bench retail subset.

**Vision pillars:** Model-Adaptive Intelligence, Local-First.

**Three parallelizable tracks:**

**Track 1 — Per-provider tool-call parser**
- `ProviderAdapter.parseToolCalls(rawResponse, modelId, runtimeVersion)` resolves qwen3 + Ollama + thinking-mode + tool_calls coexistence (LiteLLM #18922)
- Regression test: thinking-mode + tool_calls coexist on Ollama qwen3:14B without dropped tool calls

**Track 2 — Calibration consumer activation**
- Wire `parallelCallCapability` → gate batch tool calls
- Wire `interventionResponseRate` → gate dispatcher firing on non-compliant models
- Wire `knownToolAliases` → proactive prompt-injection layer
- Wire `tokenEfficiency` → cost router model selection
- Wire `reasoningDepth` → strategy selector
- Total active consumers: ≥8 (counting Layer 1 builders shipped in v0.10.6)

**Track 3 — Tool-result paging**
- 50KB per-tool / 200KB per-message caps with disk spill
- Implement at `kernel/capabilities/attend/context-utils.ts`

**Phase E completion gate:**
- [ ] qwen3:14B ≥30% of frontier (claude-sonnet) on τ-bench-derived retail subset
- [ ] thinking-mode + tool_calls coexistence regression test passes
- [ ] ≥8 calibration fields active with documented lift evidence
- [ ] Tool-result paging caps observed in production traces (no message exceeds 200KB)

---

### Phase F — Public Benchmark Discipline

**Goal:** Submit to or replicate ≥1 third-party agent benchmark with reproducible methodology. Closes the "self-graded marketing" gap — internal 100% scores are necessary but not sufficient for external credibility.

**Vision pillars:** Reliability, Trustworthiness, Local-First.

**Recommended first benchmark:** τ²-bench retail (clearest reproducibility story; directly validates the local-tier claim from Phase E).

**Phase F completion gate:**
- [ ] ≥1 benchmark integration in `packages/benchmarks/src/sessions/` with reproducible run command
- [ ] Published to `wiki/Research/Harness-Reports/public-bench-<name>-YYYY-MM-DD.md` with: model + provider + date pinned, cost reported, ≥3 seed variance (mean ± stdev), raw JSONL traces
- [ ] `README.md` contains exactly one external benchmark claim with full methodology disclosure

**Stop-the-line:** if the run produces results inconsistent with internal bench (>15% delta), investigate the harness — not the result. Honest reporting wins.

---

### Phase G — v1.0 Polish & Release

**Goal:** Tag v1.0. All phase gates re-run on the integrated codebase. No aspirational claims in docs.

**Phase G completion gate (v1.0 tag):**
- [ ] Every Phase A–F gate passes on re-run
- [ ] CHANGELOG comprehensive: every wave, mechanism sunset, new strategy, benchmark publication
- [ ] `README.md` rewritten: no aspirational claims, only validated state
- [ ] `ROADMAP.md` (root) rewritten: what shipped, what's deferred, what was killed and why
- [ ] Vision pillar artifact table complete (each pillar has a concrete file path, bench number, or doc)
- [ ] `bun test` green across workspace; typecheck clean across all packages
- [ ] Snapshot/Replay determinism validated: same trace + same overrides → identical bench scores (modulo provider nondeterminism, which is logged)

**Vision pillar artifact checklist (Phase G acceptance criterion):**

| Pillar | Required artifact | Verification |
|---|---|---|
| **Control** | Every mechanism has enable/disable + observable events | `grep -L "enable[A-Z]" packages/*/src/index.ts` returns no false negatives |
| **Observability** | EventBus 15+ event types; replay primitive works | `bun test packages/runtime/tests/replay-determinism.test.ts` passes |
| **Flexibility** | 6 reasoning strategies; ≥6 providers | `ls packages/reasoning/src/strategies/` ≥ 6 files |
| **Scalability** | Concurrent execution + persistent gateway + A2A all wired | `bun test packages/orchestration packages/gateway packages/a2a` green |
| **Reliability** | Frozen judge + reproducible bench + Effect-TS typed errors | Phase F artifact shows ≤±0.5% reproducibility |
| **Efficiency** | Code-as-Action ≥25% token reduction; semantic cache; paging | Phase D validation artifact |
| **Security** | Sandboxed code execution; guardrails + identity tested | `bun test packages/guardrails packages/identity` green |
| **Speed** | Bun-native; AgentStream.toSSE works; parallel tool execution gated by calibration | `bun test packages/runtime/tests/streaming.test.ts` passes |

---

## 7. Validation Discipline

### 7.1 The N=3 corpus rule

**Every architectural change is validated by running the failure corpus 3 times and comparing medians to baseline.** Single runs are not evidence (proven: 5× run-to-run variance observed Apr 26).

### 7.2 Gate scenario growth plan

| Phase | New scenarios | What they pin |
|---|---|---|
| A | cf-22..cf-28 | Kernel folder structure; Verifier post-effector; single termination owner; reflection→arbitrator; mockable time; universal provenance; TaskComprehender output |
| B | cf-29 | All 24 compose injection points reachable |
| C | cf-30 | Replay determinism |
| D | cf-31 | Code-as-action sandbox isolation |
| E | cf-32 | qwen3 thinking-mode + tool_calls coexistence |

### 7.3 Stop-the-line condition

If a phase gate fails, the next phase does not start. Diagnose and fix-forward. No exceptions.

If three consecutive sub-tasks within a phase fail their TDD gates AND the failure analysis points to a structural reason (the underlying assumption is wrong): abandon the phase, document the structural reason in §11 Amendment Log, rewrite the phase definition before re-attempting.

### 7.4 Per-phase evidence flow

```
Phase N
  ├─ Baseline measurement  → wiki/Research/Harness-Reports/phase-N-baseline.json
  ├─ Implementation (TDD, frequent commits)
  ├─ Post-impl measurement → wiki/Research/Harness-Reports/phase-N-postimpl.json
  ├─ Evidence artifact     → wiki/Research/Harness-Reports/phase-N-<focus>-YYYY-MM-DD.md
  ├─ Validation gate check (baseline → postimpl comparison)
  └─ Verdict: PASS → next phase | FAIL → stop the line
```

---

## 8. Success Criteria

### 8.1 Phase A (Architecture Cleanup)

- [ ] `builder.ts` ≤ 500 LOC, `execution-engine.ts` ≤ 600 LOC
- [ ] Every `status:"done"` transition flows through `kernel/loop/terminate.ts` (grep test)
- [ ] Every prompt assembly flows through ContextCurator (grep test)
- [ ] N=3 corpus: no regression from Phase 1 baseline

### 8.2 Phase 1.5 (Mechanism Improvements)

- [ ] M3: ≥50% cogito:14b retry recovery
- [ ] M6: >70% skill recall across 3+ sessions
- [ ] M7: ≥8 calibration fields with measured lift
- [ ] M8: ≥15% accuracy lift on complex sub-agent tasks (real LLMs)
- [ ] M10: >80% multi-session memory recall

### 8.3 Phase B (Compose API)

- [ ] 24 injection points, all reachable via `.compose(harness)`
- [ ] TypeScript type inference: `PayloadFor<Tag>` infers correctly
- [ ] 6 killswitches pass acceptance tests
- [ ] `.withX()` desugars without behavior change

### 8.4 Phase C (v0.11.0)

- [ ] Playground, generator, OTel exporter all live
- [ ] Snapshot/Replay: deterministic on same overrides
- [ ] 0 regressions on 4,672+ tests
- [ ] Root `ROADMAP.md` aligned to this document

### 8.5 Phase D (Code-as-Action)

- [ ] qwen3:14B: ≥20% accuracy lift, ≥25% token reduction vs `reactive` on multi-step suite
- [ ] Sandbox safety enforced

### 8.6 Phase E (Local Model Engineering)

- [ ] qwen3:14B ≥30% of frontier on τ-bench retail subset
- [ ] ≥8 calibration fields active with evidence

### 8.7 Phase F (Public Benchmark)

- [ ] ≥1 third-party benchmark with full reproducibility artifact in `wiki/`

### 8.8 Phase G (v1.0)

- [ ] All prior gates pass on re-run
- [ ] Vision pillar artifact table complete
- [ ] No aspirational claims in README or docs

---

## 9. What Stays vs What Changes

### 9.1 Stays (preserve everything good that shipped)

- **Builder API** — `ReactiveAgents.create().with*()` — unchanged (`.compose()` added in Phase B)
- **Effect-TS service composition** — services flow through loop controller
- **EventBus + Trace** — telemetry concern, well-shaped
- **Memory layers** (working/episodic/semantic/procedural) — already cohesive
- **5 reasoning strategies** — pluggable Reason implementations (6th added Phase D)
- **6 LLM providers** — capability port abstracts them
- **ContextCurator** — IS the SalienceCurator, already the sole prompt author
- **Trust labels** — the Provenance concern, extended to all observations in Phase A
- **Capability port** — what every service consumes
- **Guardrails / cost / identity** — safety domain, well-shaped
- **Gateway / A2A / orchestration** — multi-agent / deployment, well-shaped
- **Layer 1 builders** — `buildFinalAnswerDescription`, `buildOracleNudge` — already shipped

### 9.2 Changes (Phase A — decompose, not rewrite)

- ✅ **`builder.ts`** (6,232 → **2,407** LOC, May 9, 2026) — 18 submodules across `builder/`, `builder/build-effect/`, `agent/`, plus `reactive-agent.ts` extracted
- ✅ **`execution-engine.ts`** (4,499 → **1,539** LOC, May 7-8, 2026) — phase-as-data infrastructure + 30+ submodules under `engine/`
- ⏳ **`GatewayAgent`** extracts `start()`/`stop()` from `ReactiveAgent` (type-level separation) — W27, still ahead

### 9.3 Adds

- **Compose API** (Phase B) — `.compose((harness) => …)` with 24 injection points + 6 killswitches
- **Snapshot/Replay** (Phase C) — `agent.replay(traceId, overrides)` built on `packages/trace`
- **`@reactive-agents/observe`** (Phase C) — OpenInference / OTel exporter
- **`packages/create-reactive-agent`** (Phase C) — `npx create-reactive-agent` with 5 templates
- **`CodeAgentStrategy`** (Phase D) — 6th reasoning strategy at `strategies/code-action.ts`
- **Per-provider tool-call parser** (Phase E) — resolves qwen3 + Ollama coexistence

### 9.4 Net LOC change

Phase A shrinks total LOC by decomposition (-10% to -20% estimated). Subsequent phases add net new capability but onto a smaller surface.

### The Pruning Principle (v5.0)

Harness components encode assumptions about what the model cannot do alone. Those assumptions expire as model capability improves.

**Empirical basis:** Full harness skill set costs ~13.6× the tokens and produces outcomes 0.8pp *worse* than a lighter configuration (NLAH arXiv:2603.25723, Table 1). Adding structure actively degrades outcomes while consuming resources.

**Operational rule:** Before adding any new harness mechanism, identify and document the model-capability assumption it encodes. During each major version review, test whether that assumption still holds on current frontier models. Mechanisms whose assumptions have expired are removal candidates, not improvement candidates.

---

## 10. Glossary

| Term | Definition |
|---|---|
| **Capability** | One of the 10 cognitive functions every agent must perform |
| **Service** | A typed component owning one capability: one owner, typed contract, observable events, replaceable strategy, isolated tests |
| **Sensor** | Pure read of state. Returns observations; never mutates. |
| **Integrator** | Pure synthesis of observations into decision-ready data. Never decides, never mutates. |
| **Arbitrator** | The single function producing exactly ONE Verdict per iteration. Owns Decide capability. |
| **Effector** | Side-effect function executing what the Verdict commands. Cannot decide. |
| **Loop Controller** | Only component that mutates state. Owns the iteration cycle. |
| **Verdict** | One of: `continue \| exit-success \| exit-failure \| escalate` |
| **TerminationIntent** | Signal a phase emits indicating terminal observation. Arbitrator resolves intents into Verdicts. |
| **Trait** | Cluster of capabilities delivering a vision pillar |
| **Cross-cutting concern** | Primitive available to every service: State, Telemetry, Safety, Time, Provenance |
| **N=3 validation rule** | Every architectural change validated by running corpus 3 times, comparing medians |
| **Layer 1 Builder** | Calibration-driven function that sets an intelligent default for a harness parameter (e.g., `buildFinalAnswerDescription`, `buildOracleNudge`) |
| **HarnessPipeline** | Registry of `.compose()` interceptors keyed by injection-point tag |
| **Snapshot/Replay** | `agent.replay(traceId, overrides)` — replays a recorded run against modified prompts/models with tool results held constant |
| **Sole Author pattern** | One component owns one concern; no parallel paths |
| **Single Source of Truth pattern** | Derived observables read from one state field; no parallel counters |
| **Per-tier Calibration pattern** | Behavior thresholds parameterized by ContextProfile, not fixed globally |

---

## 11. Amendment Log

Every amendment to this North Star (phase reordering, gate revision, phase addition/deletion) is logged here. **Never silently drift** — always amend lower-authority docs, never this one.

| Date | Amendment | Reason | Authority |
|---|---|---|---|
| 2026-05-03 | v1.0 Roadmap created (Phases 0–7) | v0.10.0 release-pending; audit §16 surfaced gaps | tylerjrbuell |
| 2026-05-04 | Phase 1 complete: 8 KEEP + 5 IMPROVE; Phase 1.5 defined | Improvement-first posture confirmed via TDD spikes | Phase 1 validation evidence |
| 2026-05-07 | **v4.0** — `07-ROADMAP-v1.0.md` and `Phase 1.5 Improvement Roadmap.md` absorbed; Phase A (W23–W28) established as now-work before Compose API; Snapshot/Replay promoted from Phase 6 → Phase C (v0.11); `04-PROJECT-STATE.md` retained as separate framing doc; public `ROADMAP.md` alignment flagged as Phase C gate requirement | Single source of truth directive — plans were sprawled across 3+ documents; architecture cleanup before Compose API prevents rework | tylerjrbuell |
| 2026-05-07 | **W23 gate refinement** — module count "9" replaced by composability + LOC ceilings: `execution-engine.ts` ≤ 600 LOC, every phase module ≤ 400 LOC, phase composition declarative (single array literal). Empirical structure has 10 named phases; two (`agent-loop` ~1,950 LOC, `complete` ~787 LOC) need internal sub-modules. Final layout is ~13–17 files via phase-as-data architecture (each phase exports a typed `Phase` value; pipeline runner composes them). This is the substrate Phase B (`.compose()`) builds on. | Decomposition design discovered the empirical phase count exceeds initial estimate; counting files is less meaningful than declarative composition + LOC ceilings. Phase-as-data design also eliminates the closure-breakage cost the advisor flagged and pre-builds the Phase B substrate. | tylerjrbuell + Claude (Opus 4.7) |
| v5.0 | 2026-05-11 | Pruning Principle (§9); M14 Self-Evolution (§2.2 + §6 Phase 1.5); M3 ablation-gated (§2.2 + §6 Phase 1.5); M8 elevated-priority IMPROVE (§2.2 + §6 Phase 1.5); Phase B Wave A/B tag catalog expanded to 7 (§6). Research basis: arXiv 2603.25723, 2603.28052. Design spec: `Architecture/Design-Specs/2026-05-11-harness-research-integration.md`. | tylerjrbuell |
| *(future amendments append here)* | | | |

---

## 12. Superseded Documents

These remain in the repository as historical evidence. They are no longer authoritative for forward direction.

| Document | Status | What it contributed to v4.0 |
|---|---|---|
| `05-DESIGN-NORTH-STAR.md` v3.0 (this file, Apr 26) | Superseded by v4.0 | Architecture target (§3–§5), validation discipline (§7), N=3 rule |
| `wiki/Architecture/Specs/07-ROADMAP-v1.0.md` | **Superseded by §6** | 8-phase plan → §6 Phase A–G |
| `wiki/Planning/Phase 1.5 Improvement Roadmap.md` | **Superseded by §6 Phase 1.5** | M3/M6/M7/M8/M10 action items + per-mechanism detail (retained as reference) |
| `wiki/Research/Harness-Reports/north-star-status-audit-20260424.md` | Historical | G-1..G-6 status table → §2.3 |
| `wiki/Research/Harness-Reports/improvement-report-20260424-north-star-1.md` | Historical | Apr 24 corpus baseline → §2.1 |
| `wiki/Research/Harness-Reports/north-star-closure-scorecard-2026-04-25.md` | Historical | Post-Phase-1 corpus → §2.1 |
| `wiki/Research/Harness-Reports/north-star-diagnosis-2026-04-25.md` | Historical | W4 verdict via trace inspector → §2.1 |
| `wiki/Research/Harness-Reports/change-a-empirical-validation-2026-04-26.md` | Historical | 9-termination-paths finding → §2.3 |
| `wiki/Research/Harness-Reports/cognitive-kernel-architecture-2026-04-26.md` | Historical | Three-tier shape → §4 |
| `wiki/Research/Harness-Reports/agent-capability-architecture-2026-04-26.md` | Historical | 10 capabilities + 5 traits → §3, §4.3 |

---

## Appendix A — The Convergence Argument

Why we are confident this architecture is the right one (not just a plausible one):

1. **Empirically derived, not theorized.** The 10 capabilities map 1:1 to failures we measured. The 9-termination-paths root cause was found by trace inspection, not by inspection of intent.

2. **Biologically convergent.** The brain evolved exactly this shape (sensors, integrators, arbitrator, effectors, loop) over 200M+ years. C. elegans (302 neurons) follows this pattern; humans follow this pattern.

3. **Independently rediscovered.** ACT-R (Carnegie Mellon, 30 years), SOAR (Newell, 40 years), Global Workspace Theory (Baars, Dehaene), LangGraph (state machine), OpenAI Swarm (minimal primitives), Anthropic Claude Code (single termination contract) — every serious cognitive architecture project converges on a subset of these properties.

4. **Failure-mode-symmetric.** The pattern's prescriptions (one decision per cycle, separate sense from act, etc.) are the *negation* of the failure modes we measured (9 termination paths, mixed phase concerns). Choosing the architecture that fixes the measured failures is the conservative move.

5. **Already 70% present.** ContextCurator, memory layers, capability port, trust labels, terminate.ts — the pattern's components already exist in our codebase. We are *naming and consolidating*, not *inventing and adding*.

---

## Appendix B — Decision Log

Choices baked into this architecture, with alternatives considered:

| Decision | Alternative considered | Why this won |
|---|---|---|
| Phase A before Compose API | Compose API first on existing monolith | Bolting `.compose()` onto 6K-line builder creates structural debt in every subsequent wave |
| Snapshot/Replay in Phase C (v0.11) | Phase G (v1.0) | Builds on existing `packages/trace`; 1-week implementation; unique Show-HN demo; directly proves "auditable" vision claim |
| Three-tier (sensors/integrators/effectors) with arbitrator | Two-tier (perceive/act) | Cognitive science decisively prefers separating decide from act |
| One Arbitrator function | Multiple specialized arbitrators | Proven failure mode: 9 termination paths is what happens when "specialized" decisions don't converge |
| ContextCurator stays in `src/context/` | Move into `attend/` for symmetry | Curator is shared by multiple kernel paths; moving is large blast radius for low symmetry gain |
| Reorganize within `packages/reasoning` | New `packages/cognition` package | 27 packages already; structural clarity comes from folders, not packages |
| N=3 corpus rule | N=1 single runs | Empirically proven: 5× variance between runs invalidates single-run conclusions |
| Code-as-Action in Phase D (v0.12) | Phase C (v0.11) | High implementation complexity; rushed delivery risks regressing frontier parity |
| `04-PROJECT-STATE.md` retained | Absorbed into §2 | Different framing purpose (cold session start); §2 here is the empirical record, not the orientation guide |

---

*Version: 5.0.0*
*Status: AUTHORITATIVE*
*Date: 2026-05-11*
*Supersedes: v3.0 + `07-ROADMAP-v1.0.md` + `Phase 1.5 Improvement Roadmap.md`*
*Next review: after Phase B Wave A ships*
