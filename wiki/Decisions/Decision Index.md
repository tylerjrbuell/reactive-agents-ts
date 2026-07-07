---
aliases: [All Decisions, Decision Log]
tags: [decisions, index, trade-offs]
---

# Decision Index

**Purpose:** Searchable catalog of all strategic decisions made during project development, organized by phase and impact.

---

## Phase Gates & Major Milestones

### CURRENT AUTHORITY (2026-07-07) — Adaptive Harness Architecture (Ratified ✅)
- [[Decisions/2026-07-07-adaptive-harness-architecture-ratified|Adaptive Harness Architecture]] — 9-pillar centralization; harness composes per model+task, recomposes mid-run
- **Design arbiter:** `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` (v6.0, 2026-07-05) — supersedes North Star v3.0 references below
- **Execution plan:** [[Planning/Implementation-Plans/2026-07-07-adaptive-harness-overhaul|7-phase overhaul]] (0.5 hotfixes + 1b SHIPPED 2026-07-07)
- **Evidence:** `wiki/Research/Audit-Reports-2026-07-07/` (7-surface sweep + synthesis)
- **Note:** entries below this line predate v6.0; where they conflict, the ratified decision + spec 08 win.

### Roadmap Realignment v0.12 → v1.0 (Accepted ✅)
- [[Decisions/2026-06-10-roadmap-realignment-v0.12-v1.0|Roadmap Realignment 2026-06-10]] — milestone arc: v0.12 "Durable & Honest" (durable exec + DX wave + memory default-off) → v0.13 "Receipts" (public local-model bench + LAUNCH) → v0.14 "Compounding" (recitation/experience-reuse, ablation-gated) → v1.0 polish
- **Status:** ✅ Accepted (2026-06-10, 3 forks user-ratified)
- **Impact:** supersedes root ROADMAP.md v0.12/v0.13 sections + 07-ROADMAP remaining-phase sequencing; vision pillars unchanged
- **Evidence:** `wiki/Research/Audit-Reports-2026-06-10/v0.12.0-leverage-audit.md`

### Phase 0: Frozen Judge (Complete ✅)
- [[Decisions/Phase 0 Frozen Judge|Frozen Judge Gate]] — Single-model arbitration validation
- **Status:** ✅ Complete (requirement, not design)
- **Impact:** Enables fair benchmark evaluation
- **Date:** Baseline requirement for Phase 1

### Phase 1: Mechanism Validation (Complete ✅)
- [[Decisions/Phase 1 Mechanism Validation Results|Phase 1 Results]] — All 13 mechanisms spike-validated
- **Status:** ✅ Complete (May 4, 2026)
- **Verdicts:** 8 KEEP, 5 IMPROVE, 0 REMOVE
- **Impact:** Confirmed improvement-first posture effective

### Phase 1.5: Improvement Work (Active 🟡)
- [[Decisions/2026-05-12-m3-terminal-verifier-rework|M3 Terminal Verifier REWORK]] — Disable retry loop; retain heuristic pass/fail gate. 0pp ablation delta, premature-termination signal. **Provisional** pending judge structured output fix.
- [[Decisions/Phase 1.5 Retry Context Tuning|M3 Retry Tuning]] — cogito:14b instruction-following
- [[Decisions/Phase 1.5 Skill Persistence|M6 Persistence]] — SQLite/filesystem skill storage
- [[Decisions/Phase 1.5 Calibration Activation|M7 Activation]] — 8+ fields with consumers
- [[Decisions/Phase 1.5 Sub-agent Metrics|M8 Metrics]] — Accuracy lift measurement
- [[Decisions/Phase 1.5 Multi-session Memory|M10 Memory]] — Natural multi-turn scenarios

### Phase 2: Orchestration Decomposition (Planning 🔵)
- [[Decisions/Phase 2 Orchestration Decomposition|Decomposition Plan]] — Split builder.ts + execution-engine.ts
- [[Decisions/Phase 2 Integration Testing|Integration Testing]] — Test mechanism compositions
- [[Decisions/Phase 2 Real LLM Validation|Real LLM Validation]] — Frontier + local model testing
- **Target:** After Phase 1.5 completion

---

## North Star & Vision

### North Star v3.0 Design
- [[Decisions/North Star v3.0|North Star v3.0]] — 10 capabilities, 3 ports, 2 disciplines
- **Capabilities:** Capability, AgentMemory, Verification
- **Ports:** Typed errors, fixture recording, composable phases
- **Disciplines:** Decision Rules, Thin Orchestrator
- **Alignment:** All Phase 1 work validated against this north star
- **Date:** Finalized May 4, 2026

### Vision 2026: Six Core Principles
- [[Decisions/Vision 2026|Vision Alignment]] — Explicit > Implicit, Observable, Type-Safe, Composable, Efficient, Secure
- **Enforcement:** CI lint, type checking, test coverage requirements
- **Audit Cycle:** Per-phase alignment checks

---

## Architecture & Infrastructure Decisions

### Core Infrastructure

#### Decision: Single-Owner Arbitration Pattern
- **Problem:** Multiple code paths could terminate loop; no single decision maker
- **Solution:** Single arbitrator at `kernel/capabilities/decide/arbitrator.ts`
- **Trade-off:** More centralization vs clearer authority
- **Status:** ✅ ACCEPTED (implemented, validated in IC-1 fix)
- **Validation:** 100% path coverage, zero unhooked termination paths
- **Date:** Resolved Apr 30, 2026

#### Decision: Dual Record System (Messages vs Steps)
- **Problem:** Need to track both LLM conversation AND system observations
- **Solution:** `state.messages[]` for provider thread, `state.steps[]` for system telemetry
- **Trade-off:** More memory vs clearer semantics, different consumers
- **Status:** ✅ ACCEPTED (architectural foundation)
- **Impact:** Enables clean separation of concerns

#### Decision: Effect-TS Runtime with Strict Types
- **Problem:** TypeScript any-casts and implicit conversions
- **Solution:** Mandatory Effect-TS, zero any-casts, unknown + guards
- **Trade-off:** Learning curve vs type safety
- **Status:** ✅ ACCEPTED (CI enforced, Phase 3 compliance required)
- **Enforcement:** No any casts; strict tsconfig

---

### Tool Calling & Provider Strategy

#### Decision: Native FC vs Text Parse (Per-Model Routing)
- **Problem:** Different models have different tool calling fidelity
- **Solution:** Anthropic/Gemini use native FC; others fall back to text parsing
- **Trade-off:** Fidelity vs coverage
- **Status:** ✅ ACCEPTED
- **Validation:** ✅ M12 provider adapters (7/7 hooks wired)
- **Implementation:** `ProviderAdapter` interface with per-model routing

#### Decision: Provider Adapter Hooks Architecture (vs Plugin Registry)
- **Problem:** Need per-provider customization without tight coupling
- **Solution:** 7 lifecycle hooks on interface (parseToolCalls, extractText, computeCost, validateResponse, optimizePrompt, handleError, streamSupport)
- **Trade-off:** Type-safe but less dynamic vs simpler but runtime-prone
- **Status:** ✅ ACCEPTED
- **Validation:** ✅ M12 provider adapters (all 7 hooks wired, 254/254 tests pass)
- **Date:** Validated May 3, 2026

---

### Context & State Management

#### Decision: Synchronous Kernel Loop (vs Event-Driven)
- **Problem:** Need clear causality and observability
- **Solution:** Sequential Think → Act → Observe → Verify → Reflect loop
- **Trade-off:** Simpler causality vs less responsive to concurrent signals
- **Status:** ✅ ACCEPTED
- **Note:** Event-bus ready for upgrade in Phase 3

#### Decision: Message Windowing + Compression + Episodic Stash
- **Problem:** Context grows unbounded; need efficient token management
- **Solution:** Three-stage strategy (stash → curator → patch)
- **Trade-off:** 60.7% compression vs risk of context loss
- **Status:** ✅ ACCEPTED
- **Validation:** ✅ M5 context curation (38.6% token savings, zero regressions)
- **Regression Test:** `context-curator.test.ts` validates composition

#### Decision: 4-Layer Memory Architecture
- **Problem:** Different recall needs (working, semantic, episodic, procedural)
- **Solution:** Working (current context) | Semantic (facts) | Episodic (experience) | Procedural (skills)
- **Trade-off:** Dimensionality vs recall accuracy
- **Status:** ✅ ACCEPTED
- **Validation:** ✅ M10 memory system (66.7% recall verbose, 100% recall keyed)
- **Phase 1.5:** Multi-session scenarios

---

### Safety & Quality

#### Decision: Guard System (6 Guards as Pre/Post Gates)
- **Problem:** Need compliance and safety enforcement
- **Solution:** 6 guards (auth, injection, PII, toxicity, schema, trust) + KillSwitch meta-tool
- **Trade-off:** Latency (0.001ms) vs security
- **Status:** ✅ ACCEPTED
- **Validation:** ✅ M13 guards (100% accuracy, 0.001ms latency)
- **Enforcement:** Pre-execution gating + post-synthesis validation

#### Decision: Semantic Verification Pipeline (Entropy + NLI + Evidence)
- **Problem:** Need to detect hallucinations and low-confidence outputs
- **Solution:** Semantic entropy scoring + NLI consistency + evidence grounding
- **Trade-off:** Latency vs output confidence
- **Status:** ✅ ACCEPTED
- **Validation:** ✅ M3 verifier, ✅ M11 diagnostic (0.02ms latency)

---

### Release & Publishing

#### Decision: Semantic Versioning via Changesets
- **Problem:** Need automated, auditable version bumps
- **Solution:** Changesets for npm packages, feature-driven (not time-based)
- **Status:** ✅ ACCEPTED
- **Implementation:** CI changeset publish workflow

#### Decision: Monorepo with Workspace Packages
- **Problem:** Multiple packages with shared dependencies
- **Solution:** Bun workspace with 26 workspace packages + 5 apps
- **Trade-off:** Complexity vs single source of truth
- **Status:** ✅ ACCEPTED
- **Build:** Turborepo for optimized builds

---

## Deferred Decisions (Post-v1.0)

### Agent Sessions & Multi-Turn Lifecycle
- **Status:** 🔵 DEFERRED (Spec 17-agent-sessions.md)
- **Reason:** Phase 2 focuses on kernel orchestration decomposition
- **Target:** v1.0+ when single-agent kernel stabilizes

### Multi-Agent Orchestration & Teamwork
- **Status:** 🔵 DEFERRED (Spec 16-multi-agent-orchestration.md)
- **Reason:** Phase 2 focuses on single-agent kernel improvements
- **Target:** v1.0+ when delegation (M8) is fully validated

### Evolutionary Intelligence & Adaptive Strategies
- **Status:** 🔵 DEFERRED (v1.1+, @reactive-agents/evolution)
- **Reason:** Phase 1.5 focuses on improvement loop validation
- **Target:** v1.1+ when all Phase 1.5 improvements complete

---

## Decision Process

### How Decisions Are Made

1. **Discovery:** Problem surfaces during spike work or user feedback
2. **Options:** 3+ alternatives evaluated with trade-offs
3. **Decision:** North Star alignment checked; chosen option documented
4. **Validation:** Implementation validated via test suite
5. **Audit:** Phase gate checklist ensures alignment

### Authority Hierarchy

1. **North Star v3.0** — Ultimate design arbiter
2. **Phase Gate Criteria** — What must be true to advance
3. **AGENTS.md** — Operational guidance
4. **Individual Decision Docs** — Specific trade-off rationale

---

## Audit & Compliance

### Phase Gate Enforcement

| Gate | Criterion | Owner | Status |
|------|-----------|-------|--------|
| Phase 0 | Rule 4 frozen judge | Benchmarking | 🔴 Pending |
| Phase 1 | 13 mechanisms validated | Architecture | ✅ Complete |
| Phase 1.5 | 5 improvements complete | Domain owners | 🟡 In progress |
| Phase 2 | Orchestration decomposed | Orchestration | 🔵 Planning |

### Type Safety Enforcement

- **Requirement:** Zero `any` casts in TypeScript
- **Enforcement:** CI lint rule `@typescript-eslint/no-explicit-any`
- **Status:** ✅ Enforced since May 1, 2026
- **Exceptions:** Intentional casts must include JSDoc justification

---

## How to Navigate Decisions

1. **Find decision by phase** → See phase gates at top
2. **Find decision by impact** → See infrastructure sections
3. **Find decision by trade-off** → See trade-off columns
4. **Find decision by status** → Filter by ✅/🟡/🔵 indicators

---

**See also:** [[MOCs/Decisions MOC|Decisions MOC]] (comprehensive decision hub)

**Last Updated:** 2026-05-12  
**Phase:** Phase 1.5 active  
**Next Review:** Phase 1.5 checkpoint (May 15, 2026)
