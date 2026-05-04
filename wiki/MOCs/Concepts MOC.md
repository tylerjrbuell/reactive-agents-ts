---
aliases: [Core Concepts]
tags: [MOC]
---

# Concepts MOC

**Purpose:** Central hub for understanding design patterns, terminology, and conceptual frameworks used throughout the system.

---

## Cognitive Architecture

### Kernel Loop
- [[Concepts/Reactive Loop|Reactive Loop]] — Think → Act → Observe → Verify → Reflect cycle
- [[Concepts/Effect-TS Runtime|Effect-TS Runtime]] — Layered services, Context propagation
- [[Concepts/KernelState|KernelState]] — Messages vs Steps, immutable state accumulation
- [[Concepts/Event Bus|Event Bus]] — Observable event dispatch system

### Decision Making
- [[Concepts/Arbitration Pattern|Arbitration Pattern]] — Single-owner decision making
- [[Concepts/Reactive Intelligence|Reactive Intelligence (RI)]] — Entropy-driven intervention
- [[Concepts/Strategy Switching|Strategy Switching]] — Heuristic-based routing
- [[Concepts/Termination Arbitration|Termination Arbitration]] — Loop exit logic

---

## Quality & Observation

### Observability
- [[Concepts/ThoughtTracer|ThoughtTracer]] — Distributed trace propagation
- [[Concepts/Metrics Collection|Metrics Collection]] — TokenCount, ToolCalls, Latency
- [[Concepts/Diagnostic System|Diagnostic System]] — Real-time health checking
- [[Concepts/EventBus Events|EventBus Events]] — Observable signal taxonomy

### Verification & Evidence
- [[Concepts/Verification Pipeline|Verification Pipeline]] — Evidence grounding, hallucination detection
- [[Concepts/Semantic Entropy|Semantic Entropy]] — Output quality scoring
- [[Concepts/NLI Verification|NLI Verification]] — Logical consistency checking
- [[Concepts/Requirement State|Requirement State]] — Task completion confidence

---

## Context & Continuity

### Memory & Persistence
- [[Concepts/Memory System|Memory System (M10)]] — 4-layer (Working/Semantic/Episodic/Procedural)
- [[Concepts/Skill System|Skill System (M6)]] — Learnable, refinable capabilities
- [[Concepts/Calibration|Calibration (M7)]] — Model-specific behavior profiles
- [[Concepts/Session Continuity|Session Continuity]] — Multi-turn context preservation

### Context Curation
- [[Concepts/Message Windowing|Message Windowing]] — Context pressure, truncation strategy
- [[Concepts/Context Compression|Context Compression]] — 60.7% compression ratio
- [[Concepts/Stash & Retrieve|Stash & Retrieve]] — Episodic memory compression

---

## Tool Integration

### Tool Calling Patterns
- [[Concepts/Native FC vs Text Parse|Native FC vs Text Parse]] — Per-model routing
- [[Concepts/Tool Healing|Tool Healing (M4)]] — 4-stage error recovery
- [[Concepts/Tool Gating|Tool Gating]] — Budget enforcement, required tools
- [[Concepts/Tool Capabilities|Tool Capabilities]] — ProviderAdapter hooks

### Provider Abstraction
- [[Concepts/ProviderAdapter Interface|ProviderAdapter Interface]] — 7 lifecycle hooks
- [[Concepts/Streaming Patterns|Streaming Patterns]] — Per-provider streaming quirks
- [[Concepts/Cost Modeling|Cost Modeling]] — Token estimation and accounting

---

## Safety & Compliance

### Guards & Gates
- [[Concepts/Guard System|Guard System (M13)]] — 6 guards, meta-tools
- [[Concepts/Guardrails|Guardrails]] — Injection, PII, toxicity detection
- [[Concepts/Trust Levels|Trust Levels]] — Per-tool authorization
- [[Concepts/Compliance Rules|Compliance Rules]] — Input/output schema validation

### Orchestration Safety
- [[Concepts/Budget Enforcement|Budget Enforcement]] — Token budget tracking
- [[Concepts/Loop Detection|Loop Detection]] — Consecutive thought streak tracking
- [[Concepts/Checkpoint System|Checkpoint System]] — Approval gates, manual intervention

---

## Design Principles

### Core Invariants
- [[Concepts/Single Owner Arbitration|Single Owner Arbitration]] — One path decides termination
- [[Concepts/Observable Everything|Observable Everything]] — Event-driven telemetry
- [[Concepts/Type Safety|Type Safety]] — No `any` casts, strict TypeScript
- [[Concepts/Composable Capabilities|Composable Capabilities]] — Port-based abstraction

### Development Discipline
- [[Concepts/Research Discipline|Research Discipline]] — 12 rules for spike validation
- [[Concepts/TDD Spike Pattern|TDD Spike Pattern]] — RED → GREEN → ANALYSIS methodology
- [[Concepts/Improvement Pipeline|Improvement Pipeline]] — DISCOVERY → CATALOG → PRIORITIZE → DISSECT → DESIGN → INTEGRATE+VALIDATE → DEPRECATE

---

## Multi-Agent Patterns

### Delegation & Orchestration
- [[Concepts/Sub-agent Delegation|Sub-agent Delegation (M8)]] — Green phase ready
- [[Concepts/Service Composition|Service Composition]] — Layered services
- [[Concepts/A2A Networking|A2A Networking]] — Agent-to-agent communication
- [[Concepts/Multi-Agent Coordination|Multi-Agent Coordination]] — Consensus and handoff

---

## Historical Learnings

### Phase 1 Key Lessons
- [[Concepts/Improvement-First Validation|Improvement-First Validation]] — Remove binary prove-or-sunset
- [[Concepts/Parallel Validation|Parallel Validation]] — 13 mechanisms validated simultaneously
- [[Concepts/Ownership Alignment|Ownership Alignment]] — Domain owners prevent complaints
- [[Concepts/Integration Testing Gap|Integration Testing Gap]] — Phase 2 should test compositions

---

**See also:** [[MOCs/Architecture MOC|Architecture MOC]] (system design), [[MOCs/Research MOC|Research MOC]] (mechanisms), [[MOCs/Decisions MOC|Decisions MOC]] (trade-offs)
