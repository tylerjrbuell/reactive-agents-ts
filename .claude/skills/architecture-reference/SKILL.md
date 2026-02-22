---
name: architecture-reference
description: Reactive Agents framework architecture — layer stack, dependency graph, build order, and package structure. Use when planning work, understanding package relationships, or determining build dependencies.
user-invocable: false
---

# Architecture Reference — Reactive Agents

## Layer Stack (Bottom-Up)

```
@reactive-agents/runtime ← ExecutionEngine (10-phase agent loop; depends on ALL layers)
     ↑
Layer 11: a2a (A2A protocol: Agent Cards, JSON-RPC server/client, SSE)  [v0.5]
     ↑
Layer 10: interaction   Layer 9: observability   Layer 8: tools
     ↑                        ↑                       ↑
Layer 7: orchestration (durable exec, multi-agent workflows)
     ↑
Layer 6: identity (Ed25519 certs, RBAC, audit)
     ↑
Layer 5: cost (routing, semantic cache, budgets)
Layer 4: verification (5-layer hallucination detection)
Layer 3: reasoning (5 strategies: Reactive, PlanExecuteReflect, ToT, Reflexion, Adaptive)
     ↑
Layer 2: memory (bun:sqlite; Semantic/Episodic/Procedural/Working; Zettelkasten)
Layer 1.5: llm-provider (LLMService: complete/stream/structured/embed)
Layer 1: core (types, EventBus, AgentService, TaskService, ContextWindowManager)
```

## Package Dependency Graph

**Zero internal deps:**

- `@reactive-agents/core` — depends only on `effect`, `ulid`

**Depends on core only:**

- `@reactive-agents/llm-provider` → `core`

**Depends on core + llm-provider:**

- `@reactive-agents/memory` → `core`, `llm-provider` (optional, Tier 2 only)
- `@reactive-agents/reasoning` → `core`, `llm-provider`
- `@reactive-agents/tools` → `core`, `llm-provider`
- `@reactive-agents/guardrails` → `core`, `llm-provider`

**Higher layers:**

- `@reactive-agents/verification` → `core`, `llm-provider`, `memory`
- `@reactive-agents/cost` → `core`, `llm-provider`
- `@reactive-agents/identity` → `core`
- `@reactive-agents/orchestration` → `core`, `llm-provider`, `tools`, `reasoning`
- `@reactive-agents/observability` → `core`
- `@reactive-agents/interaction` → `core`, `llm-provider`
- `@reactive-agents/eval` → `core`, `llm-provider`
- `@reactive-agents/prompts` → `core`

**A2A (v0.5 — agent-to-agent interop):**

- `@reactive-agents/a2a` → `core`, `tools`, `identity` (optional), Effect `HttpServer`/`HttpClient`

**Orchestrator (depends on ALL):**

- `@reactive-agents/runtime` → ALL packages (composes layers via `createRuntime()`)

## Build Order (3 Phases)

### Phase 1: Foundation (Weeks 1-4)

| #   | Package                                          | Spec                                           |
| --- | ------------------------------------------------ | ---------------------------------------------- |
| 1   | `@reactive-agents/core`                          | `layer-01-core-detailed-design.md`             |
| 2   | `@reactive-agents/llm-provider`                  | `01.5-layer-llm-provider.md`                   |
| 3   | `@reactive-agents/memory`                        | `02-layer-memory.md`                           |
| 4   | `@reactive-agents/tools`                         | `08-layer-tools.md`                            |
| 5   | `@reactive-agents/reasoning` (Reactive only)     | `03-layer-reasoning.md`                        |
| 6   | `@reactive-agents/interaction` (Autonomous only) | `layer-10-interaction-revolutionary-design.md` |
| 7   | `@reactive-agents/runtime`                       | `layer-01b-execution-engine.md`                |

### Phase 2: Differentiation (Weeks 5-9)

| #   | Package                                         | Spec                                     |
| --- | ----------------------------------------------- | ---------------------------------------- |
| 8   | `@reactive-agents/reasoning` (all 5 strategies) | `03-layer-reasoning.md`                  |
| 9   | `@reactive-agents/guardrails`                   | `11-missing-capabilities-enhancement.md` |
| 10  | `@reactive-agents/verification`                 | `04-layer-verification.md`               |
| 11  | `@reactive-agents/eval`                         | `11-missing-capabilities-enhancement.md` |
| 12  | `@reactive-agents/cost`                         | `05-layer-cost.md`                       |
| 13  | `@reactive-agents/memory` (Tier 2)              | `02-layer-memory.md`                     |

### Phase 3: Production (Weeks 10-14)

| #   | Package                                    | Spec                                           |
| --- | ------------------------------------------ | ---------------------------------------------- |
| 14  | `@reactive-agents/identity`                | `06-layer-identity.md`                         |
| 15  | `@reactive-agents/orchestration`           | `07-layer-orchestration.md`                    |
| 16  | `@reactive-agents/observability`           | `09-layer-observability.md`                    |
| 17  | `@reactive-agents/prompts`                 | `11-missing-capabilities-enhancement.md`       |
| 18  | `@reactive-agents/interaction` (all modes) | `layer-10-interaction-revolutionary-design.md` |
| 19  | `@reactive-agents/cli`                     | `11-missing-capabilities-enhancement.md`       |

## Technology Stack

| Decision        | Choice                                                 |
| --------------- | ------------------------------------------------------ |
| Language        | TypeScript (strict mode)                               |
| Runtime         | Bun ≥ 1.1                                              |
| FP framework    | Effect-TS (^3.10)                                      |
| Memory storage  | bun:sqlite (WAL mode)                                  |
| FTS search      | SQLite FTS5 (BM25)                                     |
| KNN search      | sqlite-vec (Tier 2 only)                               |
| Embeddings      | OpenAI text-embedding-3-small (via LLMService.embed()) |
| LLM primary     | Anthropic Claude                                       |
| LLM secondary   | OpenAI, Ollama                                         |
| Module system   | ESM ("type": "module")                                 |
| Package manager | Bun workspaces                                         |

## ExecutionEngine 10-Phase Loop

```
Phase 1:  BOOTSTRAP      MemoryService.bootstrap(agentId)
Phase 2:  GUARDRAIL      GuardrailService.checkInput(input)
Phase 3:  COST_ROUTE     CostRouter.selectModel(task)
Phase 4:  STRATEGY       StrategySelector.select(task, context)
Phase 5:  AGENT_LOOP     LLMService.complete() → think → ToolService.execute() → observe
Phase 6:  VERIFY         VerificationService.verify(result)
Phase 7:  MEMORY_FLUSH   MemoryExtractor.evaluate() + MemoryService.snapshot()
Phase 8:  COST_TRACK     CostTracker.record(taskId, usage)
Phase 9:  AUDIT          AuditService.log(taskId, agentId, result)
Phase 10: COMPLETE       EventBus.publish("task.completed") + return TaskResult
```

## File Naming Conventions

- Types: `src/types.ts` or `src/types/<name>.ts`
- Errors: `src/errors.ts` or `src/errors/<name>.ts`
- Services: `src/services/<service-name>.ts`
- Runtime factory: `src/runtime.ts`
- Public API: `src/index.ts`
- Tests: `tests/<module-name>.test.ts`

## Additional References

- For detailed spec for any package, open `spec/docs/` + the spec filename from the build order tables above
- For the public API (builder pattern), see `spec/docs/FRAMEWORK_USAGE_GUIDE.md`
- For monorepo setup, see `spec/docs/00-monorepo-setup.md`
- For complete implementation timeline, see `spec/docs/implementation-guide-complete.md`
