---
aliases: [Package Architecture]
tags: [MOC]
---

# Packages MOC

**Purpose:** Complete map of the 29 packages and 5 apps organized by architectural layer, with ownership, key files, and cross-package dependencies.

---

## Foundation Layer (No Dependencies)

Lowest level, no internal dependencies — provides primitives used everywhere.

### Core Services & Events
- [[Packages/core|core]] — EventBus, AgentService, TaskService, base types
  - Key files: `event-bus.ts`, `services/`, `types.ts`
  - Owner: Architecture team
  - Dependents: All other packages

### LLM Provider Abstraction
- [[Packages/llm-provider|llm-provider]] — 6 providers, streaming, tool calling, cost modeling
  - Key files: `providers/`, `abstract-provider.ts`, `hooks.ts`
  - Providers: Anthropic, OpenAI, Google Gemini, Ollama, Groq, AWS Bedrock
  - Owner: Provider team
  - Status: ✅ M12 provider adapters validated (7/7 hooks wired)

### Memory System
- [[Packages/memory|memory]] — 4-layer (Working/Semantic/Episodic/Procedural)
  - Key files: `layers/`, `memory-service.ts`, `persistence.ts`
  - Owner: Memory team
  - Status: 🔄 M10 validation complete; Phase 1.5 multi-session scenarios pending

---

## Composition Layer (Build on Foundation)

Mid-level packages that compose foundation primitives into higher-level capabilities.

### Reasoning & Strategy
- [[Packages/reasoning|reasoning]] — Kernel (12 phases), 5 strategies, state machine
  - Key files: `kernel/`, `strategies/`, `kernel-state.ts`
  - Strategies: raw, naive, todo, plan-execute, tree-of-thought
  - Owner: Reasoning team
  - Status: ✅ M1, M2, M9 validation complete

### Tools & Capabilities
- [[Packages/tools|tools]] — ToolService, 11 built-in tools, MCP client
  - Key files: `tool-service.ts`, `tools/`, `mcp-client.ts`
  - Owner: Tools team
  - Dependencies: core, llm-provider, memory
  - Status: ✅ M4 healing pipeline, M13 guards validated

### Prompts & Templates
- [[Packages/prompts|prompts]] — Template engine, tier-adaptive variants
  - Key files: `engine.ts`, `templates/`, `tiers/`
  - Owner: Prompts team
  - Dependents: reasoning, runtime

### Orchestration
- [[Packages/orchestration|orchestration]] — Sequential, parallel, pipeline workflows
  - Key files: `workflows.ts`, `coordinator.ts`, `lane-controller.ts`
  - Owner: Orchestration team
  - Status: 🔄 Phase 2 decomposition of builder.ts planned

### Skills System
- [[Packages/skills|skills]] — Learnable capabilities, activation, refinement
  - Key files: `skill-service.ts`, `lifecycle.ts`, `persistence.ts`
  - Owner: Skills team
  - Status: 🔄 M6 validation complete; Phase 1.5 persistence layer pending

---

## Quality & Control Layer

Validation, safety, observability, and constraint enforcement.

### Guardrails & Safety
- [[Packages/guardrails|guardrails]] — Injection, PII, toxicity + KillSwitch
  - Key files: `guards/`, `guard-service.ts`, `meta-tools.ts`
  - Owner: Safety team
  - Status: ✅ M13 guards shipped (100% accuracy, 0.001ms latency)

### Verification & Grounding
- [[Packages/verification|verification]] — Semantic entropy, NLI, hallucination detection
  - Key files: `verifier.ts`, `evidence-grounding.ts`, `quality-utils.ts`
  - Owner: Verification team
  - Status: ✅ M3 verifier + M11 diagnostic shipped

### Cost & Budget
- [[Packages/cost|cost]] — Token counting, budget enforcement, complexity routing
  - Key files: `cost-service.ts`, `complexity-router.ts`, `budget-enforcer.ts`
  - Owner: Cost team
  - Dependencies: llm-provider, reasoning

### Identity & Access
- [[Packages/identity|identity]] — RBAC, Ed25519 certs, permission enforcement
  - Key files: `rbac.ts`, `cert-service.ts`, `permissions.ts`
  - Owner: Security team

### Observability
- [[Packages/observability|observability]] — Tracing, metrics, logging
  - Key files: `tracer.ts`, `metrics-collector.ts`, `diagnostic-service.ts`
  - Owner: Observability team
  - Status: ✅ M11 diagnostic system shipped

### Interaction & Autonomy
- [[Packages/interaction|interaction]] — Autonomy modes, checkpoints, approval gates
  - Key files: `autonomy-service.ts`, `checkpoint.ts`, `approval-gate.ts`
  - Owner: Interaction team

---

## Specialized Layer

Domain-specific implementations for particular use cases.

### Eval & Benchmarking
- [[Packages/eval|eval]] — LLM-as-judge evaluation, benchmark harness
  - Key files: `runtime.ts`, `judge.ts`, `harness.ts`
  - Owner: Benchmarking team
  - Status: 🔐 Rule 4 frozen-judge validation pending (Phase 0)

### Gateway & Persistence
- [[Packages/gateway|gateway]] — Persistent harness, webhooks, heartbeats, session history
  - Key files: `gateway-service.ts`, `session-storage.ts`, `webhook-handler.ts`
  - Owner: Gateway team
  - Status: ✅ Chat mode shipped (May 1, 2026)

### Agent-to-Agent (A2A)
- [[Packages/a2a|a2a]] — Multi-agent networking, delegation, coordination
  - Key files: `dispatcher.ts`, `protocol.ts`, `handoff.ts`
  - Owner: Orchestration team
  - Status: 🔄 Phase 2 integration testing pending

### Testing & Mocks
- [[Packages/testing|testing]] — Mock services, test harnesses, fixtures
  - Key files: `mocks/`, `harness.ts`, `fixtures.ts`
  - Owner: QA team
  - Status: ✅ 4,672 tests passing (527 files)

### Calibration System
- [[Packages/calibration|calibration]] — Model-specific behavior profiling
  - Key files: `calibration-service.ts`, `profiles/`, `persistence.ts`
  - Owner: Calibration team
  - Status: 🔄 M7 validation complete; Phase 1.5 activation (8+ fields) pending

---

## Public APIs Layer

High-level facades that expose the framework to users.

### Runtime
- [[Packages/runtime|runtime]] — ExecutionEngine, ReactiveAgentBuilder, orchestration
  - Key files: `execution-engine.ts` (1,539 LOC), `builder.ts` (2,407 LOC), `reactive-agent.ts` (1,535 LOC), `gateway-chat.ts`. Internals under `engine/`, `builder/`, `builder/build-effect/`, `agent/`.
  - Owner: Runtime team
  - Status: ✅ v0.10.0 release-ready; W23/W24/W25 decomposition complete (May 2026)
  - ~~Debt: builder.ts 6,082 LOC + execution-engine.ts 4,499 LOC need decomposition~~ ✅ Closed (May 9, 2026): builder.ts -61%, execution-engine.ts -66% via 39 new submodules

### Reactive Agents (Umbrella)
- [[Packages/reactive-agents|reactive-agents]] — Facade, re-exports, public API
  - Key files: `index.ts`, `exports.ts`
  - Owner: API team
  - Status: ✅ v0.9.0 published; v0.10.0 pending

---

## Apps

### Cortex (Main Demo App)
- [[Apps/cortex|cortex]] — Multi-mode agent application with web UI
  - Key files: `src/`, `public/`, `routes.ts`
  - Modes: task, chat, autonomous
  - Owner: Demo team
  - Status: ✅ Shipping with v0.10.0

### Examples
- [[Apps/examples|examples]] — Code examples, tutorials, reference implementations
  - Key files: `src/`, `demos/`
  - Owner: Developer relations
  - Status: ✅ Maintained for v0.10.0

### Docs
- [[Apps/docs|docs]] — Astro documentation site
  - Key files: `src/content/docs/`
  - Owner: Documentation team
  - Status: ✅ Messaging channels feature shipped

### Judge Server
- [[Apps/judge-server|judge-server]] — Standalone evaluation server
  - Key files: `Dockerfile`, `src/`
  - Owner: Benchmarking team
  - Status: 🔐 Phase 0 frozen-judge validation pending

### Benchmarks
- [[Apps/benchmarks|benchmarks]] — Performance and accuracy benchmarks
  - Key files: `src/`, `wiki/Research/Harness-Reports/`
  - Owner: Performance team
  - Status: ✅ Frontier models 100%, bare-llm 85%

---

## Cross-Package Patterns

### Dependency Tiers
1. **Foundation:** core, llm-provider, memory (no dependencies)
2. **Composition:** reasoning, tools, prompts, orchestration, skills (depend on Foundation)
3. **Quality:** guardrails, verification, cost, identity, observability, interaction (depend on Foundation + Composition)
4. **Specialized:** eval, gateway, a2a, testing, calibration (depend on Foundation + Composition + Quality)
5. **Public:** runtime, reactive-agents (depend on all)

### Test Architecture
- Each package has `tests/` directory with unit tests
- Integration tests in `packages/runtime/tests/`
- Benchmark tests in `apps/benchmarks/`
- Total: 4,672 tests passing across 527 files

### Build & Publishing
- Workspace packages use Bun (src/ runs directly)
- npm packages built via Turborepo
- Changesets for semantic versioning
- v0.10.0 release-ready (awaiting CI publish)

---

## Phase 1.5 Improvements (In Progress)

| Package | Mechanism | Action | Owner |
|---------|-----------|--------|-------|
| reasoning | M3 Retry Context | Tune prompts/temperature for cogito:14b | Reasoning |
| skills | M6 Persistence | SQLite/filesystem skill storage | Skills |
| calibration | M7 Activation | Activate 8+ fields with real consumers | Calibration |
| orchestration | M8 Metrics | Measure accuracy lift, token cost, latency | Orchestration |
| memory | M10 Memory | Design multi-session validation scenarios | Memory |

---

**See also:** [[MOCs/Architecture MOC|Architecture MOC]] (system design), [[MOCs/Concepts MOC|Concepts MOC]] (patterns), [[MOCs/Decisions MOC|Decisions MOC]] (trade-offs)
