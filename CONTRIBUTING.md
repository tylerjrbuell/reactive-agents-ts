# Contributing to Reactive Agents

Thank you for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh) v1.1+
- TypeScript 5.5+
- An Anthropic or OpenAI API key (for integration tests)

## Setup

```bash
git clone https://github.com/tylerjrbuell/reactive-agents-ts.git
cd reactive-agents-ts
bun install
```

## Project Structure

```
packages/                  # 25 packages (24 publishable + 1 private: benchmarks)
  core/                    # EventBus, AgentService, TaskService, shared types
  runtime/                 # ExecutionEngine, ReactiveAgentBuilder, createRuntime()
  llm-provider/            # 6 providers: Anthropic, OpenAI, Gemini, Ollama, LiteLLM, Test
  memory/                  # 4-layer memory (Working/Semantic/Episodic/Procedural) via bun:sqlite + FTS5 + sqlite-vec
  reasoning/               # 5 strategies + composable ThoughtKernel + KernelRunner
  tools/                   # ToolService, 9 capability tools, 8 meta-tools, MCP client, sandbox
  guardrails/              # Injection/PII/toxicity, KillSwitch, behavioral contracts
  verification/            # Semantic entropy, fact decomposition, NLI, hallucination detection
  cost/                    # Complexity router, budget enforcer, semantic cache
  identity/                # Ed25519 certs, RBAC, delegation, audit trail
  observability/           # Distributed tracing, metrics, structured logging
  interaction/             # 5 autonomy modes, checkpoints, preference learning
  orchestration/           # Multi-agent workflows (sequential, parallel, pipeline, map-reduce)
  prompts/                 # Template engine, version control, tier-adaptive variants
  eval/                    # LLM-as-judge, EvalStore, 5 scoring dimensions
  a2a/                     # Agent Cards, JSON-RPC 2.0, SSE streaming
  gateway/                 # Persistent harness: heartbeats, crons, webhooks, policy engine
  health/                  # Health checks, readiness probes
  testing/                 # Mock LLMService, mock ToolService, assertion helpers
  reactive-intelligence/   # Entropy sensor, reactive controller, learning engine, telemetry
  benchmarks/              # Private: 20-task benchmark suite (not published)
  react/                   # React hooks: useAgent, useAgentStream
  vue/                     # Vue composables
  svelte/                  # Svelte stores
  reactive-agents/         # Public facade — bundles the publishable packages
apps/
  cli/                     # rax CLI
  cortex/                  # Bun/Elysia desk server + SvelteKit UI (Stage/Run)
  docs/                    # Starlight documentation site
  examples/                # Example agent scripts
  meta-agent/              # Meta-agent app
```

## Development Workflow

```bash
bun test              # Run all ~4,150 tests across ~460 files
bun run build         # Typecheck all packages
bun run docs:dev      # Start docs dev server
bun run rax --help    # Test the CLI
```

## Running Tests

Each package has its own test suite using Bun's built-in test runner:

```bash
bun test                              # All packages
bun test packages/core                # Single package
bun test --watch                      # Watch mode
```

Tests use `withTestScenario()` for deterministic, API-free testing:

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withTestScenario([{ match: "your query", text: "your response" }])
  .build();
```

## Code Style

- **Effect-TS patterns** — all services use `Context.Tag`, `Layer.effect`, `Data.TaggedError`
- **No classes** — use tagged unions and Effect services
- **Strict TypeScript** — `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- **No external test framework** — use `bun:test` (`describe`, `it`, `expect`)

See the `effect-ts-patterns` skill in `.claude/skills/` for the full coding conventions.

## Adding a Feature

1. Check the relevant spec in `spec/docs/` for the layer you're modifying
2. Write a failing test first
3. Implement the feature following existing Effect-TS patterns
4. Run `bun test && bun run build` — both must pass
5. Update the docs page for the affected package if behaviour changes

## Pull Request Process

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`
2. Make your changes with tests
3. Ensure `bun test` and `bun run build` both pass clean
4. Open a PR against `main` with a clear description of what and why

## Reporting Issues

- **Bug reports** — open an issue at https://github.com/tylerjrbuell/reactive-agents-ts/issues
- **Security issues** — please email directly rather than opening a public issue

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
