---
aliases: [Strategic Decisions]
tags: [MOC]
---

# Decisions MOC

**Purpose:** Central hub for architectural decisions, trade-offs, phase gates, and strategic direction.

---

## Phase Gates & Milestones

### Phase 0: Frozen Judge (Complete)
- [[Decisions/Phase 0 Frozen Judge|Frozen Judge Gate]] — Single-model arbitration validation
- **Status:** ✅ Resolved (v0.10.0)
- **Impact:** Enables fair benchmark evaluation

### Phase 1: Mechanism Validation (Complete ✅)
- [[Decisions/Phase 1 Mechanism Validation|Phase 1 Results]] — All 13 mechanisms validated
- **Status:** ✅ Complete (May 4, 2026)
- **Evidence:** 8 KEEP, 5 IMPROVE, 0 REMOVE verdicts
- **Next:** Phase 1.5 improvement work

### Phase 1.5: Improvement Work (Active)
- [[Decisions/Phase 1.5 Retry Context Tuning|M3 Retry Tuning]] — Tune retry prompts for cogito:14b
- [[Decisions/Phase 1.5 Skill Persistence|M6 Persistence]] — SQLite/filesystem skill storage
- [[Decisions/Phase 1.5 Calibration Activation|M7 Activation]] — 8+ fields with real consumers
- [[Decisions/Phase 1.5 Sub-agent Metrics|M8 Metrics]] — Accuracy lift, token cost, latency
- [[Decisions/Phase 1.5 Multi-session Memory|M10 Memory]] — Natural multi-turn scenarios

### Phase 2: Orchestration Decomposition (Planning)
- [[Decisions/Phase 2 Orchestration Decomposition|Decomposition Plan]] — Split builder.ts + execution-engine.ts
- [[Decisions/Phase 2 Integration Testing|Integration Testing]] — Test mechanism compositions
- [[Decisions/Phase 2 Real LLM Validation|Real LLM Validation]] — Frontier + local model validation

---

## North Star & Vision

### Design North Star v3.0
- [[Decisions/North Star v3.0|North Star Design]] — 10 capabilities, 3 ports, 2 disciplines
- **Capabilities:** Capability, AgentMemory, Verification
- **Ports:** Typed errors, fixture recording, composable phases
- **Disciplines:** Decision Rules, Thin Orchestrator

### Vision Alignment
- [[Decisions/Vision 2026|Vision 2026]] — Explicit > Implicit, Observable, Type-Safe, Composable, Efficient, Secure
- **Enforcement:** CI lint gates, type checking, test coverage
- **Audit:** [[MOCs/Architecture MOC|Architecture MOC]] for compliance

---

## Strategic Technical Decisions

### Authentication & Authorization
- [[Decisions/RBAC Model|RBAC Model]] — Role-based access control with Ed25519 certs
- **Trade-off:** Complexity vs flexibility
- **Status:** ✅ Shipped in v0.10.0

### Tool Calling Strategy
- [[Decisions/Native FC vs Text Parse|Native FC vs Text Parse]] — Per-model routing
- **Trade-off:** Fidelity vs fallback coverage
- **Validation:** ✅ M12 provider adapters validated

### Memory Architecture
- [[Decisions/4-Layer Memory|4-Layer Memory Design]] — Working / Semantic / Episodic / Procedural
- **Trade-off:** Dimensionality vs recall accuracy
- **Status:** 🔄 Phase 1.5 multi-session validation pending

### Skill System
- [[Decisions/Skill Lifecycle|Skill Lifecycle]] — Activation → Refinement → Conflict resolution
- **Trade-off:** Learnability vs reproducibility
- **Status:** 🔄 Persistence layer pending (M6)

---

## Architectural Trade-offs

### Synchronous vs Reactive Dispatching
- [[Decisions/Synchronous Loop|Synchronous Kernel Loop]] — Sequential Think → Act → Observe → Verify → Reflect
- **Alternative:** Event-driven reactive dispatch (deferred to v1.1)
- **Chosen because:** Simpler observability, clearer causality, easier testing
- **Cost:** Less responsive to concurrent signals
- **Future:** Event-bus ready for upgrade in Phase 3

### Message Windowing vs Context Pruning
- [[Decisions/Context Strategy|Context Strategy]] — Windowing + compression + episodic stash
- **Alternative:** Full context replay with semantic caching
- **Chosen because:** 60.7% compression, 38.6% token savings, proven in Phase 1
- **Cost:** Risk of losing subtle context
- **Validation:** ✅ M5 context curation validated

### Single-Model vs Multi-Model Orchestration
- [[Decisions/Judge Architecture|Judge Architecture]] — Single frozen model for arbitration
- **Alternative:** Model ensemble voting
- **Chosen because:** Simpler, fairer benchmarking, clearer accountability
- **Cost:** Single point of failure
- **Mitigation:** Fallback to frontier LLM in production

### Provider Adapters: Hook vs Plugin Architecture
- [[Decisions/Provider Adapter Hooks|Adapter Hooks Architecture]] — 7 lifecycle hooks on interface
- **Alternative:** Plugin registry with discovery
- **Chosen because:** Type-safe, compile-time verification, zero runtime overhead
- **Cost:** Less dynamic at runtime
- **Validation:** ✅ M12 provider adapters validated (7/7 hooks wired)

---

## Data & State Management

### State Records: Messages vs Steps
- [[Decisions/Dual Record System|Dual Record System]] — `state.messages` (LLM thread) + `state.steps` (system observation)
- **Why two:** Different purposes, different consumers
- **Trade-off:** More memory vs clearer semantics
- **Validation:** ✅ Used throughout kernel

### Calibration Storage
- [[Decisions/Calibration Persistence|Calibration Persistence]] — SQLite file-based, not :memory:
- **Trade-off:** I/O cost vs session-persistent profiles
- **Default:** `~/.reactive-agents/calibration.db`

### Skill Persistence (Phase 1.5)
- [[Decisions/Skill Storage|Skill Storage]] — SQLite or filesystem (TBD)
- **Options:** Database vs JSON files vs versioned git
- **Trade-off:** Query power vs simplicity
- **Status:** 🔄 Phase 1.5 design pending

---

## Quality & Safety Gates

### Verification Pipeline
- [[Decisions/Evidence Grounding|Evidence Grounding]] — Semantic entropy, NLI, hallucination detection
- **Verdict:** Low confidence → request clarification
- **Status:** ✅ M11 diagnostic system shipped

### Guard System
- [[Decisions/Guard Architecture|Guard Architecture]] — 6 guards (auth, injection, PII, toxicity, schema, compliance)
- **Enforcement:** Pre-execution gating + post-synthesis validation
- **Status:** ✅ M13 guards shipped (100% accuracy, 0.001ms latency)

### Loop Detection
- [[Decisions/Loop Detection Strategy|Loop Detection]] — Consecutive thought streak tracking
- **Threshold:** `maxConsecutiveThoughts: 3`
- **Exemption:** ACTION steps reset streak; observations do not
- **Validation:** ✅ IC-1 fix (Apr 12), 100% path coverage

---

## Release & Publishing Strategy

### Version Targeting
- [[Decisions/Release Strategy|Release Strategy]] — v0.10.0 (mechanisms), v1.0.0 (north star), v1.1+ (evolution)
- **Changesets:** Automated via Changesets for npm
- **Cadence:** Feature-driven, not time-based

### Package Publishing
- [[Decisions/Publishing Model|Publishing Model]] — Umbrella + scoped packages
- **Stable:** @reactive-agents, @reactive-agents/runtime, @reactive-agents/tools, @reactive-agents/eval
- **Experimental:** @reactive-agents/evolution (v1.1+)
- **Pending:** @reactive-agents/diagnose (May 4)

---

## Team & Ownership

### Domain Ownership
- [[Decisions/Domain Ownership|Domain Ownership]] — Per-mechanism owners for accountability
- **Process:** Owners design spikes, run TDD validation, sign-off verdicts
- **Result:** 13 mechanisms, 13 owners, 0 orphaned work

### Multi-Agent Coordination
- [[Decisions/Build Order|Build Order]] — Foundation → Composition → Orchestration → Public API
- **Handoff:** Tests enforce dependency tree
- **Responsibility:** Each layer owner validates downstream compatibility

---

## Deferred Decisions

### Multi-Agent Sessions (Post-v1.0)
- [[Decisions/Agent Sessions Deferred|Agent Sessions]] — Multi-turn conversation lifecycle
- **Status:** Spec 17-agent-sessions.md (deferred)
- **Reason:** Phase 2 focuses on kernel orchestration decomposition

### Multi-Agent Orchestration (Post-v1.0)
- [[Decisions/Multi-Agent Orchestration Deferred|Multi-Agent Orchestration]] — Agent teams, A2A networking, gateway patterns
- **Status:** Spec 16-multi-agent-orchestration.md (deferred)
- **Reason:** Phase 2 focuses on single-agent kernel improvements

### Evolutionary Intelligence (v1.1+)
- [[Decisions/Evolution Deferred|Evolutionary Intelligence]] — Composable strategy architecture, adaptive provider selection
- **Status:** Spec @reactive-agents/evolution (deferred)
- **Reason:** Phase 1.5 focuses on improvement loop validation

---

## Audit & Compliance

### Phase Gates & Rule Enforcement
- **Rule 1:** All mechanisms spike-validated before merge
- **Rule 2:** No `any` casts in TypeScript; strict types required
- **Rule 3:** CI lint enforces guard justifications and trustLevel compliance
- **Rule 4:** Frozen judge for evaluation fairness (Phase 0 gate)
- **Rule 5:** Single arbitrator as termination path (Phase 2 enforcement)

---

**See also:** [[MOCs/Architecture MOC|Architecture MOC]] (system design), [[MOCs/Research MOC|Research MOC]] (mechanisms), [[MOCs/Concepts MOC|Concepts MOC]] (patterns)
