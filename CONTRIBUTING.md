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
packages/          # 15 publishable packages
  core/            # EventBus, AgentService, TaskService
  runtime/         # ExecutionEngine, ReactiveAgentBuilder
  llm-provider/    # Anthropic, OpenAI, Ollama adapters
  memory/          # bun:sqlite memory system
  reasoning/       # ReAct, Plan-Execute, ToT
  tools/           # Tool registry and MCP client
  guardrails/      # Safety filters
  verification/    # Output verification
  cost/            # Cost routing and budgets
  identity/        # RBAC and certificates
  observability/   # Tracing and metrics
  interaction/     # 5 interaction modes
  orchestration/   # Multi-agent workflows
  prompts/         # Template engine
  reactive-agents/ # Meta-package (bundles all above)
apps/
  cli/             # rax CLI
  docs/            # Starlight documentation site
  examples/        # Example agent scripts
```

## Development Workflow

```bash
bun test              # Run all 283 tests
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

Tests use the built-in `test` LLM provider for deterministic, API-free testing:

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("test")
  .withTestResponses({ "your query": "your response" })
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
