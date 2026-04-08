---
name: architecture-reference
description: Reactive Agents framework architecture — layer stack, dependency graph, build order, and package structure. Use when planning work, understanding package relationships, or determining build dependencies.
user-invocable: false
---

# Architecture Reference — Reactive Agents

> For the full comprehensive framework map with file-level navigation, cross-cutting data flows, and system diagrams, read `FRAMEWORK_INDEX.md` at project root.

## Package Dependency Graph

**Zero internal deps:**

- `@reactive-agents/core` — EventBus, types, Agent/Task services

**Depends on core only:**

- `@reactive-agents/llm-provider` → `core`
- `@reactive-agents/observability` → `core`
- `@reactive-agents/identity` → `core`
- `@reactive-agents/a2a` → `core`
- `@reactive-agents/interaction` → `core`

**Depends on core + llm-provider:**

- `@reactive-agents/memory` → `core`, `llm-provider`
- `@reactive-agents/tools` → `core`, `llm-provider`
- `@reactive-agents/guardrails` → `core`, `llm-provider`
- `@reactive-agents/cost` → `core`, `llm-provider`
- `@reactive-agents/eval` → `core`, `llm-provider`
- `@reactive-agents/prompts` → `core`, `llm-provider`

**Higher layers:**

- `@reactive-agents/reasoning` → `core`, `llm-provider`, `memory`, `tools`
- `@reactive-agents/verification` → `core`, `llm-provider`, `memory`
- `@reactive-agents/orchestration` → `core`, `llm-provider`, `tools`, `reasoning`
- `@reactive-agents/gateway` → `core`, `llm-provider`, `tools`
- `@reactive-agents/reactive-intelligence` → `core`, `llm-provider`

**Facade (depends on ALL):**

- `@reactive-agents/runtime` → all packages (composes layers via `createRuntime()`)
- `reactive-agents` → `runtime` (public API re-export)

**Private (never published):**

- `@reactive-agents/testing` → `core`, `llm-provider`
- `@reactive-agents/benchmarks` → `runtime`
- `@reactive-agents/health` → `core`

## Build Order

Build runs in dependency order. Lower layers must build before higher layers.

```
Phase 1: core → llm-provider
Phase 2: memory, tools, guardrails, cost, identity, observability, interaction, prompts, eval, a2a (parallel)
Phase 3: reasoning, verification, orchestration, gateway, reactive-intelligence (parallel)
Phase 4: runtime → reactive-agents (facade)
Phase 5: testing, benchmarks, health, cli, docs (parallel)
```

## ExecutionEngine 10-Phase Loop

```
Phase 1:  BOOTSTRAP       MemoryService.bootstrap(agentId)
Phase 2:  GUARDRAIL        GuardrailService.checkInput(input)
Phase 3:  STRATEGY-SELECT  AdaptiveStrategy or config.defaultStrategy
Phase 4:  THINK            ReasoningService.execute() → kernel loop
Phase 5:  ACT              (synthetic — extracted from reasoning steps)
Phase 6:  OBSERVE          (synthetic — extracted from reasoning steps)
Phase 7:  MEMORY-FLUSH     MemoryExtractor + MemoryService.snapshot()
Phase 8:  VERIFY           VerificationService.verify(result) [optional]
Phase 9:  AUDIT            AuditService.log() [optional]
Phase 10: COMPLETE         EventBus.publish("AgentCompleted") + DebriefSynthesizer
```

## Kernel Architecture (Reasoning)

All 5 strategies delegate to `runKernel(reactKernel, input, options)`:

```
runKernel() loop:
  1. kernel(state, ctx)       ← reactKernel: Think → Parse → Execute Tool → Observe
  2. Entropy scoring          ← EntropySensorService.score() [if withReactiveIntelligence()]
  3. Early exit check         ← exitOnAllToolsCalled [composite steps]
  4. Iteration progress       ← ReasoningIterationProgress event
  5. Loop detection           ← 3 patterns: repeated tools, repeated thoughts, consecutive thoughts
  6. Strategy switching       ← fallback dispatch on loop detection [if enableStrategySwitching]
```

## Technology Stack

| Decision | Choice |
|----------|--------|
| Language | TypeScript (strict mode) |
| Runtime | Bun >= 1.1 |
| FP framework | Effect-TS (^3.10) |
| Database | bun:sqlite (WAL mode), FTS5, sqlite-vec |
| LLM providers | Anthropic, OpenAI, Ollama, Gemini, LiteLLM (40+) |
| Module system | ESM ("type": "module") |
| Build | tsup (ESM + DTS) |
| Test | bun:test |
| Versioning | Changesets (fixed group) |

## Quick Navigation

| What you need | Where to look |
|--------------|---------------|
| Full file-level system map | `FRAMEWORK_INDEX.md` |
| Coding standards | `CODING_STANDARDS.md` |
| Effect-TS patterns | `.agents/skills/effect-ts-patterns/SKILL.md` |
| LLM API signatures | `.agents/skills/llm-api-contract/SKILL.md` |
| Memory/SQLite patterns | `.agents/skills/memory-patterns/SKILL.md` |
| Spec documents | `spec/docs/` |
| Build commands | `AGENTS.md` (Build & Test Cycle) and `README.md` (quickstart/dev commands) |
