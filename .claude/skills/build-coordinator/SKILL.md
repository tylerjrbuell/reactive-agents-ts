```skill
---
name: build-coordinator
description: Coordinate an agent team to build Reactive Agents packages in parallel. Defines team structure, task assignment, parallelization strategy, and inter-package dependency gates. Use when planning or executing a multi-package build with agent teams.
disable-model-invocation: true
argument-hint: <phase-number-or-package-list>
---

# Build Coordinator — Agent Team Orchestration

## Overview

This skill guides the **team lead** in organizing and delegating package builds across teammates. The lead does NOT build packages directly — it plans, assigns, monitors, and integrates.

## Team Structure

| Role | Responsibilities |
|------|------------------|
| **Lead** | Read specs, plan task order, assign packages to teammates, validate outputs, resolve cross-package issues |
| **Teammate** | Build one package at a time using `/build-package`, `/implement-service`, `/implement-test`, and `/validate-build` skills |

**Recommended team size:** 1 lead + 2–3 teammates (max 4 teammates).

## Arguments

`$ARGUMENTS` = phase number (`1`, `2`, `3`) or comma-separated package list (e.g., `core,llm-provider,memory`).

## Parallelization Rules

### Phase 1: Foundation (Mostly Sequential)

```

Step 1: core ← MUST be first (zero deps)
Step 2: llm-provider ← depends on core
Step 3: memory, tools ← both depend on core + llm-provider; CAN PARALLEL
Step 4: reasoning (Reactive) ← depends on core + llm-provider
Step 5: interaction (Autonomous)← depends on core + llm-provider
Step 6: runtime ← depends on ALL above; MUST be last in Phase 1

```

**Phase 1 Teammate Assignment:**
- Teammate A: `core` → `memory` → `runtime`
- Teammate B: (waits for core) → `llm-provider` → `tools` → `reasoning`
- Teammate C: (waits for llm-provider) → `interaction`

**Gates:** `core` must pass `/validate-build core` before ANY other package starts. `llm-provider` must pass before `memory`, `tools`, `reasoning`, `interaction`.

### Phase 2: Differentiation (More Parallelism)

```

Step 8: reasoning (full) ← extends Phase 1 reasoning
Step 9: guardrails ← depends on core + llm-provider only
Step 10: verification ← depends on core + llm-provider + memory
Step 11: eval ← depends on core + llm-provider only
Step 12: cost ← depends on core + llm-provider only
Step 13: memory (Tier 2) ← extends Phase 1 memory

```

**Phase 2 Parallelization:**
- Teammate A: `reasoning` (full) → `memory` (Tier 2)
- Teammate B: `guardrails` → `verification`
- Teammate C: `eval` → `cost`

**All Phase 2 packages can start immediately** (all deps built in Phase 1). Only `verification` needs `memory` from Phase 1.

### Phase 3: Production (High Parallelism)

```

Step 14: identity ← depends on core only
Step 15: orchestration ← depends on core + llm-provider + tools + reasoning
Step 16: observability ← depends on core only
Step 17: prompts ← depends on core only
Step 18: interaction (full) ← extends Phase 1 interaction
Step 19: cli ← depends on runtime + interaction

```

**Phase 3 Parallelization:**
- Teammate A: `identity` → `orchestration`
- Teammate B: `observability` → `prompts`
- Teammate C: `interaction` (full) → `cli`

## Lead Workflow

### 1. Plan Phase

```

1. Parse $ARGUMENTS to determine scope (phase or package list)
2. Read architecture-reference skill for dependency graph
3. Identify which packages can be parallelized
4. Create task list with dependency annotations

```

### 2. Assign Tasks

For each teammate assignment:

```

Build @reactive-agents/<package-name>:

1. Use /build-package <package-name> to scaffold and implement
2. Use /validate-build <package-name> when done
3. Report back with: pass/fail status, any blockers, export list

```

### 3. Gate Checks

Before allowing a dependent package to start:

```

1. Predecessor package passes /validate-build
2. Predecessor's index.ts exports are verified
3. Type-check passes across workspace: bun run build

```

### 4. Integration Validation

After each phase completes:

```

1. Run full test suite: bun test
2. Run full type-check: bun run build
3. Verify cross-package imports resolve correctly
4. Check no circular dependencies exist

```

## Task Sizing Guidelines

| Package Complexity | Examples | Estimated Services | Task Size |
|-------------------|----------|-------------------|-----------|
| Small | identity, prompts, observability | 1–3 services | 1 task |
| Medium | llm-provider, tools, cost, guardrails | 3–5 services | 1–2 tasks |
| Large | core, memory, reasoning, runtime | 5–10+ services | 2–4 tasks |

**Rule:** Each teammate should have 3–6 active tasks. Break large packages into sub-tasks (e.g., "implement types + errors", "implement services", "implement tests").

## Cross-Package Communication Points

These are the critical integration interfaces — verify them explicitly:

| Producer | Consumer(s) | Interface |
|----------|------------|-----------|
| `core` EventBus | ALL packages | `EventBus.publish()` / `EventBus.subscribe()` |
| `core` AgentService | runtime, orchestration | `AgentService.get()` / `AgentService.updateStatus()` |
| `core` TaskService | runtime, orchestration | `TaskService.create()` / `TaskService.updateStatus()` |
| `llm-provider` LLMService | memory (Tier 2), reasoning, tools, verification, cost | `LLMService.complete()` / `LLMService.embed()` |
| `memory` MemoryService | runtime, verification | `MemoryService.bootstrap()` / `MemoryService.store()` / `MemoryService.search()` |
| `tools` ToolService | runtime, orchestration | `ToolService.register()` / `ToolService.execute()` |
| `reasoning` StrategySelector | runtime | `StrategySelector.select()` → `ReasoningStrategy` |

## v0.5 Sprint Coordination

### Sprint 0: Housekeeping (Solo)
No parallelism needed. One agent updates spec files sequentially.

### Sprint 1: A2A Core (2 Teammates)
```
Teammate A: types.ts → errors.ts → agent-card.ts → a2a-service.ts → runtime.ts
Teammate B: (waits for types) → server/a2a-server.ts → server/task-handler.ts → server/streaming.ts
Teammate A: (after service) → client/a2a-client.ts → client/discovery.ts → client/capability-matcher.ts
Gate: /validate-build a2a before Sprint 2
```

### Sprint 2: Agent-as-Tool + MCP (2-3 Teammates)
```
Teammate A: packages/tools/src/adapters/agent-tool-adapter.ts + tests
Teammate B: MCP SSE transport (packages/tools/src/mcp/mcp-client.ts) + tests
Teammate C: MCP WebSocket transport + tests
Gate: bun test packages/tools — all pass
```

### Sprint 3: Test Hardening (3 Teammates — High Parallelism)
```
Teammate A: verification tests (5 files)
Teammate B: identity + orchestration tests (6 files)
Teammate C: observability + cost tests (5 files)
All parallel — no cross-dependencies
```

### Sprint 4-5: Sequential
Builder API extensions → CLI → Integration tests → Release prep

## Common Coordination Mistakes

1. **Starting runtime before ALL Phase 1 packages pass** — runtime imports from every layer
2. **Building verification before memory** — verification needs MemoryService for fact-checking
3. **Not running workspace-wide type-check after each package** — cross-package type breaks compound
4. **Assigning more than one large package per teammate** — leads to context thrashing
5. **Skipping /validate-build between packages** — pattern drift compounds across layers
6. **Not verifying index.ts exports** — downstream packages will fail to import
7. **Forgetting documentation updates** — run `/update-docs` after completing any sprint
```
