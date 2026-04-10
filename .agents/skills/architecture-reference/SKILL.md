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

All 5 strategies delegate to `runKernel(reactKernel, input, options)` in `packages/reasoning/src/strategies/kernel/`.

### Composable Phase Pipeline

```
makeKernel({ phases?: Phase[] })
  ↓
kernel-runner.ts: runKernel() loop
  ↓ per turn:
  1. context-builder.ts  — buildSystemPrompt, toProviderMessage, buildConversationMessages, buildToolSchemas (pure data, no LLM)
  2. think.ts            — LLM stream, FC parsing, fast-path, loop detection, oracle hard gate
  3. guard.ts            — Guard[] pipeline, checkToolCall(guards), defaultGuards[]
  4. act.ts              — MetaToolHandler registry, final-answer gate, tool dispatch
```

### Key Files

```
packages/reasoning/src/strategies/kernel/
  kernel-state.ts      — KernelState, Phase type, KernelContext, ThoughtKernel
  kernel-runner.ts     — the loop: runKernel() — DO NOT add per-turn logic here directly
  kernel-hooks.ts      — KernelHooks lifecycle hooks
  react-kernel.ts      — makeKernel() factory + reactKernel + executeReActKernel
  phases/
    context-builder.ts — pure data: builds what the LLM sees this turn
    think.ts           — LLM decision: stream, FC parsing, loop detection
    guard.ts           — Guard[] pipeline: is this tool call allowed?
    act.ts             — MetaToolHandler registry: what happens when tools run?
  utils/
    ics-coordinator.ts, reactive-observer.ts, loop-detector.ts
    tool-utils.ts, tool-execution.ts, termination-oracle.ts, strategy-evaluator.ts
    stream-parser.ts, context-utils.ts, quality-utils.ts, service-utils.ts, step-utils.ts
```

### Two Independent State Records

```
state.messages[]  ← What the LLM sees (multi-turn FC conversation thread)
state.steps[]     ← What systems observe (entropy, metrics, debrief)
```

Do NOT conflate these. Debugging LLM behavior → inspect `messages[]`. Debugging metrics/entropy → inspect `steps[]`.

### Extending the Kernel

- **New phase**: create `phases/<name>.ts`, insert into `makeKernel({ phases: [...] })`
- **New guard**: add `Guard` fn to `guard.ts`, add to `defaultGuards[]`
- **New inline meta-tool**: add one entry to `metaToolRegistry` in `act.ts`
- **Custom kernel**: `makeKernel({ phases: [myThink, act] })`

See `.agents/skills/kernel-extension/SKILL.md` for full patterns.

### Dead Code — Do Not Touch

- `buildDynamicContext` / `buildStaticContext` in `context-engine.ts` — disabled behind flag (~560 LOC)
- `context-engine.ts` dead text-assembly functions (~690 LOC total)
- These areas are preserved for reference. Do not re-enable, modify, or "clean up."

## MCP Client Architecture

Location: `packages/tools/src/mcp/mcp-client.ts`

### Two Docker Patterns

| Pattern | Examples | Behavior |
|---------|---------|----------|
| stdio MCP | GitHub MCP, filesystem | Container reads JSON-RPC from stdin |
| HTTP-only | mcp/context7 | Container starts HTTP server, ignores stdin |

Both handled transparently via auto-detection.

### Critical Rules

- **`docker rm -f <containerName>` is the ONLY reliable container stop.** `subprocess.kill()` leaves the container alive in the Docker daemon.
- **Two-phase container naming**: `rax-probe-<name>-<pid>` (initial stdio probe) → `rax-mcp-<name>-<pid>` (port-mapped HTTP if HTTP detected)
- **PID in name** prevents conflicts between concurrent agents running the same MCP server
- **Transport auto-inferred**: `command` → `"stdio"`, endpoint `/mcp` → `"streamable-http"`, other endpoint → `"sse"`
- `transport` field is optional in `MCPServerConfig` — auto-inferred at runtime

See `.agents/skills/mcp-integration/SKILL.md` for full patterns.

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
| Extending the kernel | `.agents/skills/kernel-extension/SKILL.md` |
| Debugging agent behavior | `.agents/skills/kernel-debug/SKILL.md` |
| Provider streaming patterns | `.agents/skills/provider-streaming/SKILL.md` |
| MCP client patterns | `.agents/skills/mcp-integration/SKILL.md` |
| Full feature workflow | `.agents/skills/reactive-feature-dev/SKILL.md` |
