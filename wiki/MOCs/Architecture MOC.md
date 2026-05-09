---
aliases: [System Architecture]
tags: [MOC]
---

# Architecture MOC

**Purpose:** Central hub for understanding the system design, kernel phases, package relationships, and architectural decisions.

---

## Core Architecture

### System Overview
- [[Architecture/00 System Overview|System Overview]] — 28 packages, 5 apps, 12 kernel phases
- [[Architecture/Kernel Phases|Kernel Phases]] — bootstrap → complete (12 sequential phases)
- [[Architecture/Package Dependency Graph|Package Dependency Graph]] — Foundation → Composition → Orchestration
- [[Architecture/Port System|Port System]] — Capability, AgentMemory, Verification (v3.0 design)

### Cognitive Kernel
- [[Architecture/Kernel Architecture|Kernel Design]] — Think → Act → Observe → Verify → Reflect loop
- [[Architecture/Effect-TS Runtime|Effect-TS Runtime]] — Layers, Context, services
- [[Architecture/Event Bus|Event Bus]] — Core event dispatch system
- [[Architecture/State Machine|State Machine]] — KernelState, step accumulation

### Reasoning & Strategy
- [[Architecture/Reasoning Strategies|Reasoning Strategies]] — 5 strategies (raw, naive, todo, plan-execute, tree-of-thought)
- [[Architecture/Strategy Switching|Strategy Switching (M2)]] — Entropy-driven strategy selection
- [[Architecture/Reactive Intelligence|Reactive Intelligence (M1)]] — 6 intervention handlers, dispatch logic

### Context & Continuity
- [[Architecture/Context Curation (M5)|Context Curation (M5)]] — 60.7% compression, 38.6% token savings
- [[Architecture/Message Windowing|Message Windowing]] — Context pressure, truncation strategy
- [[Architecture/Memory System (M10)|Memory System (M10)]] — 4-layer (Working/Semantic/Episodic/Procedural)

---

## Design Decisions

### North Star v3.0
- [[Concepts/North Star Design|North Star Design]] — 10 capabilities, cognitive architecture, v1.0 target
- [[Architecture/Port Abstraction|Port Abstraction]] — Capability, AgentMemory, Verification ports

### Termination & Arbitration (M9)
- [[Architecture/Termination Oracle (M9)|Termination Oracle (M9)]] — Single-owner arbitrator pattern
- [[Architecture/Loop Detection|Loop Detection]] — Consecutive thought streak tracking

### Quality Gates
- [[Architecture/Verification & Grounding|Verification & Grounding]] — Evidence-based output validation
- [[Architecture/Calibration (M7)|Calibration (M7)]] — Model-specific behavior profiling

---

## Implementation Patterns

### Tool Calling
- [[Architecture/Native FC vs Text Parse|Native FC vs Text Parse]] — Per-model routing
- [[Architecture/Healing Pipeline (M4)|Healing Pipeline (M4)]] — Tool name, param, path, type healing
- [[Architecture/Tool Gating|Tool Gating]] — Required tools, per-tool budgets

### Provider Adapters (M12)
- [[Architecture/Provider Adapter Hooks|Provider Adapter Hooks]] — 7 hooks (parseToolCalls, extractText, computeCost, etc.)
- [[Architecture/Streaming Patterns|Streaming Patterns]] — Per-provider streaming quirks

### Safety & Compliance
- [[Architecture/Guards & Meta-tools (M13)|Guards & Meta-tools (M13)]] — 6 guards, 100% accuracy
- [[Architecture/Guardrails|Guardrails]] — Injection, PII, toxicity detection

---

## Packages by Layer

### Foundation (No Dependencies)
- `core` — EventBus, AgentService, TaskService, types
- `llm-provider` — 6 LLM providers, streaming, tool calling
- `memory` — 4-layer memory system

### Composition (Build on Foundation)
- `reasoning` — 5 strategies + composable kernel
- `tools` — ToolService, 11 built-in tools, MCP client
- `prompts` — Template engine, tier-adaptive variants
- `orchestration` — Sequential/parallel/pipeline workflows

### Quality & Control
- `guardrails` — Injection/PII/toxicity + KillSwitch
- `verification` — Semantic entropy, NLI, hallucination detection
- `cost` — Complexity router, budget enforcer
- `identity` — RBAC, Ed25519 certs
- `observability` — Tracing, metrics, logging
- `interaction` — Autonomy modes, checkpoints, approval gates

### Specialized
- `gateway` — Persistent harness, webhooks, heartbeats
- `eval` — LLM-as-judge evaluation
- `a2a` — Agent-to-agent networking
- `testing` — Mock services

### Public APIs
- `runtime` — ExecutionEngine, ReactiveAgentBuilder
- `reactive-agents` — Facade, re-exports

See [[Packages/00 Package Index|Package Index]] for full details.

---

## Cross-Cutting Concerns

### Observability (M11)
- [[Concepts/ThoughtTracer|ThoughtTracer]] — Distributed tracing
- [[Concepts/EventBus Events|EventBus Events]] — Observable event stream
- [[Concepts/Metrics Collection|Metrics Collection]] — TokenCount, ToolCalls, etc.

### Sub-agent Delegation (M8)
- [[Architecture/Sub-agent Dispatch|Sub-agent Dispatch]] — Green phase ready, metrics pending
- [[Architecture/Service Composition|Service Composition]] — Layered services

### Skill System (M6)
- [[Architecture/Skill Lifecycle|Skill Lifecycle]] — Activation, refinement, conflict
- [[Architecture/Skill Persistence|Skill Persistence]] — SQLite storage (Phase 1.5)

---

## Architectural Debt & Future

### Known Debt
- ✅ `builder.ts` (6,232 → 2,407 LOC, -61%) + `execution-engine.ts` (4,499 → 1,539 LOC, -66%) decomposed in W23/W24/W25 (May 2026). Now organized under `engine/`, `builder/`, `agent/` subdirs. See `wiki/Planning/Implementation-Plans/2026-05-09-builder-decomposition.md`.
- ToT outer loop doesn't honor dispatcher early-stop → Phase 2
- Strategy routing still opt-in (default disabled) → Phase 2

### Phase 2 Work
- [[Decisions/Phase 2 Orchestration Decomposition|Orchestration Decomposition]] — 3 focused components
- [[Decisions/Phase 2 Integration Testing|Integration Testing]] — Compositions (healing+guards, strategy-switch+RI, etc.)
- [[Decisions/Phase 2 Real LLM Validation|Real LLM Validation]] — M2, M8, M10 with frontier models

---

**See also:** [[MOCs/Research MOC|Research MOC]] (mechanisms), [[MOCs/Concepts MOC|Concepts MOC]] (patterns), [[MOCs/Decisions MOC|Decisions MOC]] (trade-offs)
