# Reactive Agents — AI Build Guide

## Project Status

**All phases complete + pre-release features shipped.** 15 packages + 2 apps built, 300 tests passing, full integration verified.

- Phase 1: Core, LLM Provider, Memory, Reasoning, Tools, Interaction, Runtime
- Phase 2: Guardrails, Verification, Cost
- Phase 3: Identity, Observability, Orchestration, Prompts, CLI (`rax`)
- Pre-release: tsup compiled output, Google Gemini provider, Reflexion reasoning strategy
- Final Integration: All layers compose via `createRuntime()` and `ReactiveAgentBuilder`
- Docs: Starlight (Astro) site at `apps/docs/`

---

## Build Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests (300 tests, 54 files)
bun run build            # Build all packages (16 packages, ESM + DTS)
cd apps/docs && npx astro dev    # Start docs dev server
cd apps/docs && npx astro build  # Build docs for production
```

---

## CLI (`rax`)

```bash
rax init <name> --template minimal|standard|full   # Scaffold project
rax create agent <name> --recipe basic|researcher   # Generate agent
rax run <prompt> --provider anthropic               # Run agent
rax help                                            # Show help + banner
```

---

## Key Architecture

### Layer Composition
All services compose via Effect-TS Layers through `createRuntime()`:
```typescript
const runtime = createRuntime({
  agentId: "my-agent",
  provider: "anthropic",
  enableReasoning: true,
  enableGuardrails: true,
  enableCostTracking: true,
  // ... any combination of optional layers
});
```

### Builder API (Primary DX)
```typescript
const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")
  .withReasoning()
  .withGuardrails()
  .build();
const result = await agent.run("Hello");
```

---

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
```

---

## Skills Library

Skills in `.claude/skills/` are loaded automatically.

### Reference Skills
| Skill | What It Provides |
|-------|-----------------|
| `effect-ts-patterns` | Schema.Struct, Data.TaggedError, Context.Tag + Layer.effect, Ref |
| `architecture-reference` | Layer stack, dependency graph, 10-phase ExecutionEngine loop |
| `llm-api-contract` | LLMService.complete()/stream()/embed() signatures |
| `memory-patterns` | bun:sqlite WAL, FTS5, sqlite-vec KNN, Zettelkasten |

### Task Skills
| Skill | Invocation | Purpose |
|-------|-----------|---------|
| `build-package` | `/build-package <name>` | 10-step package scaffold from spec |
| `validate-build` | `/validate-build <name>` | 10-check quality gate |
| `review-patterns` | `/review-patterns <path>` | 8-category pattern compliance audit |

---

## Spec File Index

| Spec | Package |
|---|---|
| `spec/docs/layer-01-core-detailed-design.md` | `@reactive-agents/core` |
| `spec/docs/layer-01b-execution-engine.md` | `@reactive-agents/runtime` |
| `spec/docs/01.5-layer-llm-provider.md` | `@reactive-agents/llm-provider` |
| `spec/docs/02-layer-memory.md` | `@reactive-agents/memory` |
| `spec/docs/03-layer-reasoning.md` | `@reactive-agents/reasoning` |
| `spec/docs/04-layer-verification.md` | `@reactive-agents/verification` |
| `spec/docs/05-layer-cost.md` | `@reactive-agents/cost` |
| `spec/docs/06-layer-identity.md` | `@reactive-agents/identity` |
| `spec/docs/07-layer-orchestration.md` | `@reactive-agents/orchestration` |
| `spec/docs/08-layer-tools.md` | `@reactive-agents/tools` |
| `spec/docs/09-layer-observability.md` | `@reactive-agents/observability` |
| `spec/docs/layer-10-interaction-revolutionary-design.md` | `@reactive-agents/interaction` |
| `spec/docs/11-missing-capabilities-enhancement.md` | guardrails, eval, prompts, CLI |
| `spec/docs/12-market-validation-feb-2026.md` | Competitive analysis, A2A priority |
| `spec/docs/13-foundation-gap-analysis-feb-2026.md` | Full codebase audit, prioritized fix plan |

---

## Package Map

```
packages/
  core/          — EventBus, AgentService, TaskService, types
  llm-provider/  — LLM adapters (Anthropic, OpenAI, Ollama, Test)
  memory/        — Working, Semantic, Episodic, Procedural (bun:sqlite)
  reasoning/     — ReAct, Plan-Execute, ToT strategies
  tools/         — Tool registry, sandbox, MCP client
  guardrails/    — Injection, PII, toxicity detection
  verification/  — Semantic entropy, fact decomposition
  cost/          — Complexity routing, budget enforcement
  identity/      — Agent certificates, RBAC
  observability/ — Tracing, metrics, structured logging
  interaction/   — 5 modes, checkpoints, collaboration, preferences
  orchestration/ — Multi-agent workflow engine
  prompts/       — Template engine, built-in prompt library
  runtime/       — ExecutionEngine, ReactiveAgentBuilder, createRuntime
  eval/          — Evaluation framework (scaffold only)
  evolution/     — [PLANNED v1.1+] Group-Evolving Agents (GEA): strategy evolution, experience sharing, zero-cost genome deployment
apps/
  cli/           — `rax` CLI (init, create, run, dev, eval, playground, inspect)
  docs/          — Starlight documentation site
  examples/      — Example agent apps
```
