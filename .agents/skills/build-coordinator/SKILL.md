```skill
---
name: build-coordinator
description: Coordinate cross-cutting changes, incremental features, and multi-package modifications across the Reactive Agents monorepo. Defines team structure, task assignment, parallelization strategy, and inter-package dependency gates.
disable-model-invocation: true
argument-hint: <feature-description-or-package-list>
---

# Build Coordinator — Agent Team Orchestration

## Overview

This skill guides the **team lead** in organizing and delegating cross-cutting work across the 22-package Reactive Agents monorepo (2,189 tests across 287 files). All initial packages are built and shipping — this skill is for **incremental features, refactors, and cross-package changes** rather than building from scratch.

## Team Structure

| Role | Responsibilities |
|------|------------------|
| **Lead** | Analyze change scope, plan task order, assign work to teammates, validate outputs, resolve cross-package issues |
| **Teammate** | Implement changes using `/build-package`, `/implement-service`, `/implement-test`, and `/validate-build` skills |

**Recommended team size:** 1 lead + 2–3 teammates (max 4 teammates).

## Arguments

`$ARGUMENTS` = feature description, comma-separated package list (e.g., `core,llm-provider,memory`), or cross-cutting concern (e.g., `add-new-event-type`, `refactor-error-handling`).

## Package Dependency Graph

Understanding the dependency graph is critical for ordering changes that touch multiple packages. Changes to upstream packages require downstream rebuilds and test runs.

### Layer 0 — No Internal Dependencies
```
core
```

### Layer 1 — Depends on core
```
llm-provider, identity, observability, prompts, health
```

### Layer 2 — Depends on core + llm-provider
```
memory, tools, reasoning, guardrails, cost, eval, testing, benchmarks
```

### Layer 3 — Depends on multiple Layer 1–2 packages
```
verification (core + llm-provider + memory)
orchestration (core + llm-provider + tools + reasoning)
interaction (core + llm-provider)
gateway (core + runtime)
reactive-intelligence (core + llm-provider + reasoning)
```

### Layer 4 — Depends on ALL above
```
runtime (imports from every layer)
```

### Layer 5 — Depends on runtime
```
cli (runtime + interaction)
```

## Lead Workflow

### 1. Scope Analysis

```
1. Parse $ARGUMENTS to determine what's changing
2. Identify ALL packages affected (direct changes + downstream consumers)
3. Check the dependency graph to determine change ordering
4. Identify which changes can be parallelized vs. must be sequential
```

### 2. Plan Changes

```
1. For interface/type changes: start at the lowest layer and work up
2. For new features: identify which packages need new code vs. which need integration wiring
3. For refactors: map all call sites before starting
4. Create task list with dependency annotations
```

### 3. Assign Tasks

For each teammate assignment:

```
Implement <description> in @reactive-agents/<package-name>:

1. Make the specified changes
2. Run bun test packages/<package-name> — all tests must pass
3. Run bun run build — typecheck must pass workspace-wide
4. Report back with: pass/fail status, any blockers, list of changed exports
```

### 4. Gate Checks

Before allowing dependent work to start:

```
1. Upstream package changes pass tests
2. Changed exports are verified in index.ts
3. Workspace-wide typecheck passes: bun run build
```

### 5. Integration Validation

After all changes are complete:

```
1. Run full test suite: bun test (expect 2,189+ tests passing)
2. Run full build: bun run build (22 packages, ESM + DTS)
3. Verify cross-package imports resolve correctly
4. Check no circular dependencies introduced
5. Run /update-docs if public API changed
```

## Task Sizing Guidelines

| Change Scope | Examples | Task Size |
|-------------|----------|-----------|
| Single-package, small | Add a method to an existing service, fix a bug | 1 task |
| Single-package, large | New service, new strategy, major refactor | 2–3 tasks |
| Cross-cutting, narrow | New event type through EventBus → consumers | 1 task per affected package |
| Cross-cutting, broad | New builder method end-to-end (builder → runtime → engine) | 3–5 tasks, sequential |
| New package | Full package scaffold + implementation | Use `/build-package` skill |

**Rule:** Each teammate should have 3–6 active tasks. Break large changes into sub-tasks.

## Cross-Package Communication Points

These are the critical integration interfaces — verify them explicitly when changes touch these boundaries:

| Producer | Consumer(s) | Interface |
|----------|------------|-----------|
| `core` EventBus | ALL packages | `EventBus.publish()` / `EventBus.subscribe()` |
| `core` AgentService | runtime, orchestration | `AgentService.get()` / `AgentService.updateStatus()` |
| `core` TaskService | runtime, orchestration | `TaskService.create()` / `TaskService.updateStatus()` |
| `llm-provider` LLMService | memory, reasoning, tools, verification, cost | `LLMService.complete()` / `LLMService.embed()` |
| `llm-provider` FallbackChain | runtime | Provider/model fallback on transient errors |
| `memory` MemoryService | runtime, verification | `MemoryService.bootstrap()` / `MemoryService.store()` / `MemoryService.search()` |
| `memory` SessionStoreService | runtime (chat/session) | SQLite-backed chat session persistence |
| `tools` ToolService | runtime, orchestration | `ToolService.register()` / `ToolService.execute()` |
| `reasoning` StrategySelector | runtime | `StrategySelector.select()` → `ReasoningStrategy` |
| `runtime` DebriefSynthesizer | runtime (post-run) | Structured `AgentDebrief` from execution signals |
| `reactive-intelligence` EntropySensorService | reasoning (KernelRunner) | Post-kernel entropy scoring + trajectory analysis |
| `health` HealthCheckService | runtime (agent.health()) | Readiness probes |
| `gateway` GatewayService | runtime (.withGateway()) | Heartbeats, crons, webhooks, policy engine |

## All 22 Packages

```
packages/
  core/                    — EventBus, AgentService, TaskService, types
  llm-provider/            — LLM adapters (Anthropic, OpenAI, Gemini, Ollama, LiteLLM, Test)
  memory/                  — Working, Semantic, Episodic, Procedural; SessionStoreService
  reasoning/               — ReAct, Plan-Execute, ToT, Reflexion, Adaptive strategies
  tools/                   — Tool registry, sandbox, MCP client
  guardrails/              — Injection, PII, toxicity detection
  verification/            — Semantic entropy, fact decomposition, hallucination detection
  cost/                    — Complexity routing, budget enforcement
  identity/                — Agent certificates, RBAC
  observability/           — Tracing, metrics, structured logging
  interaction/             — 5 modes, checkpoints, collaboration, preferences
  orchestration/           — Multi-agent workflow engine
  prompts/                 — Template engine, built-in prompt library
  runtime/                 — ExecutionEngine, ReactiveAgentBuilder, createRuntime
  eval/                    — Evaluation framework (LLM-as-judge, EvalStore)
  a2a/                     — A2A protocol: Agent Cards, JSON-RPC server/client, SSE streaming
  gateway/                 — Persistent autonomous agent harness: heartbeats, crons, webhooks, policy engine
  testing/                 — Mock services (LLM, tools, EventBus), assertion helpers, test fixtures
  benchmarks/              — Benchmark suite: 20 tasks × 5 tiers, overhead measurement, report generation
  health/                  — Health checks and readiness probes
  reactive-intelligence/   — Entropy Sensor, reactive controller, learning engine
  evolution/               — [PLANNED v1.1+] Group-Evolving Agents (GEA)
apps/
  cli/                     — `rax` CLI (init, create, run, dev, eval, playground, inspect)
  docs/                    — Starlight documentation site
  examples/                — Example agent apps
```

## Common Coordination Mistakes

1. **Not checking downstream consumers** — changing a service interface without updating all importers
2. **Not running workspace-wide type-check after each package** — cross-package type breaks compound
3. **Assigning more than one large cross-cutting change per teammate** — leads to context thrashing
4. **Skipping /validate-build between packages** — pattern drift compounds across layers
5. **Not verifying index.ts exports** — downstream packages will fail to import
6. **Forgetting documentation updates** — run `/update-docs` after completing any feature work
7. **Editing runtime without rebuilding** — packages use `dist/` compiled output; must `bun run build` after source changes
```
