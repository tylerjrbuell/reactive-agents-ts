# Reactive Agents — AI Build Guide

## Project Status

**Spec-only.** No source code exists yet. All `packages/` and `apps/` directories are empty.

---

## Getting Started

**Read `spec/docs/START_HERE_AI_AGENTS.md` first.** It covers:
- Solo build workflow (build each package in order)
- Agent team workflow (parallel builds with coordinated teammates)
- Per-phase launch prompts ready to use

Then read each layer's spec as you build it (see Spec File Index below).

---

## Skills Library

Skills in `.claude/skills/` are loaded automatically. They encode all mandatory patterns, architecture knowledge, and build procedures.

### Reference Skills (auto-loaded when relevant)

| Skill | What It Provides |
|-------|-----------------|
| `effect-ts-patterns` | Schema.Struct, Data.TaggedError, Context.Tag + Layer.effect, Ref, Effect.sync/tryPromise |
| `architecture-reference` | Layer stack, dependency graph, 3-phase build order, 10-phase ExecutionEngine loop |
| `llm-api-contract` | LLMService.complete()/stream()/embed() signatures, correct field access, error handling |
| `memory-patterns` | bun:sqlite WAL, FTS5, sqlite-vec KNN, Zettelkasten, WorkingMemory Ref |

### Task Skills (invokable)

| Skill | Invocation | Purpose |
|-------|-----------|---------|
| `build-package` | `/build-package <name>` | 10-step package scaffold + implement from spec |
| `implement-service` | `/implement-service <Svc> <pkg>` | Effect-TS service creation template + wiring |
| `implement-test` | `/implement-test <pkg>` | 5 test patterns: basic, Ref, EventBus, LLM, SQLite |
| `validate-build` | `/validate-build <name>` | 10-check quality gate with anti-pattern grep |
| `review-patterns` | `/review-patterns <path>` | 8-category pattern compliance audit |
| `build-coordinator` | `/build-coordinator <phase>` | Agent team orchestration: parallelization, gates, task assignment |

---

## Build Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests
bun test packages/core   # Run tests for a single package
bun run build            # Type-check all packages
```

---

## Environment Variables

```bash
# LLM (at least one required)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Embeddings (Tier 2 memory; Anthropic has no embeddings API)
EMBEDDING_PROVIDER=openai       # "openai" (default) or "ollama"
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# Fully local embeddings
# EMBEDDING_PROVIDER=ollama
# OLLAMA_ENDPOINT=http://localhost:11434

# Optional
LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
LLM_MAX_RETRIES=3
```

---

## Spec File Index

| Spec | Package |
|---|---|
| `spec/docs/00-monorepo-setup.md` | **Monorepo scaffolding** (run before any package build) |
| `spec/docs/FRAMEWORK_USAGE_GUIDE.md` | **Public API reference** (ReactiveAgentBuilder, createRuntime) |
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
