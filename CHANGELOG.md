# Changelog

All notable changes to Reactive Agents will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] — 2026-02-20

### Added

#### Tools in Reasoning
- **ReAct strategy now executes real tools** — `ACTION: tool_name({"param": "value"})` JSON format is dispatched to registered tools via `ToolService`
- String arguments are mapped to the first required parameter of the tool definition as a fallback
- Tool errors are captured as observations (no crashes, no runaway loops); graceful degradation when `ToolService` is absent
- `ExecutionEngine` think phase populates `availableTools` from real registered tool names (was hardcoded empty `[]`)
- `ExecutionEngine` act phase calls real `ToolService.execute()` with `concurrency: 3` (was a `[Tool ${name} executed]` placeholder)
- 5 new integration tests in `packages/reasoning/tests/strategies/reactive-tool-integration.test.ts`

#### MCP Stdio Transport
- **Real stdio transport** for MCP (Model Context Protocol) via `Bun.spawn()` — line-delimited JSON-RPC 2.0
- Background stdout reader loop with pending request tracking and Promise-based resolution
- Subprocess kill on disconnect; `activeTransports` map for lifecycle management
- SSE and WebSocket transports remain stubs (planned for v0.2.x)

### Changed
- `@reactive-agents/reasoning` 0.1.0 → 0.2.0: adds `@reactive-agents/tools` dependency; ReAct rewired
- `@reactive-agents/tools` 0.1.1 → 0.2.0: MCP client rewritten with real stdio transport
- `@reactive-agents/runtime` 0.1.2 → 0.2.0: updated tools/reasoning deps; real act phase
- `@reactive-agents/cli` 0.1.7 → 0.2.0: updated runtime dep

### Stats
- 307 tests across 54 test files (was 300/52)

---

## [0.1.1] — 2026-02-20

### Added

#### Provider Improvements
- All 4 LLM providers (Anthropic, OpenAI, Gemini, Ollama) handle both `string` and `ModelConfig` model parameters
- Gemini provider defaults to `gemini-2.5-flash` with fallback logic for non-Gemini model names
- **Reflexion reasoning strategy** — self-critique loop with reflection memory

#### Tools System
- `@reactive-agents/tools` — dynamic tool registration, execution, sandboxing, risk levels (`low`/`medium`/`high`/`critical`)
- Function-to-tool auto-adaptation: convert any TypeScript function to a typed tool
- Tool input validation with risk-level gates
- Sandbox with timeout enforcement and structured error handling

#### CLI Enhancements
- `rax run --tools` flag — register built-in tools for a run
- `rax run --reasoning` flag — enable reasoning strategy
- `rax run --model <model>` — select model at runtime
- Version string now read dynamically from `package.json` (no hardcoding)

### Fixed
- `ExecutionEngine` now reliably initializes `selectedModel` from config in bootstrap phase
- Model parameter plumbing verified end-to-end: builder → runtime config → execution context → LLM `complete()` call
- `ReasoningService.execute` takes a single `params` object (not positional args)
- CLI binary now uses Bun shebang for correct runtime detection
- npm dependency resolution fixed for published packages

### Changed
- `@reactive-agents/runtime` 0.1.0 → 0.1.1–0.1.2
- `@reactive-agents/cli` 0.1.0 → 0.1.2–0.1.7 (incremental fixes)
- `@reactive-agents/llm-provider` updated with model parameter handling
- Restored `reactive-agents` unscoped meta-package to npm registry

---

## [0.1.0] — 2026-02-20

### Added

#### Core Framework
- `@reactive-agents/core` — EventBus, AgentService, TaskService, shared types and schemas
- `@reactive-agents/runtime` — 10-phase ExecutionEngine, ReactiveAgentBuilder, `createRuntime()` compositor
- `@reactive-agents/llm-provider` — LLM adapters for Anthropic, OpenAI, Ollama, and a deterministic test provider
- `reactive-agents` — single meta-package that bundles all layers for simplified installation

#### Memory System
- `@reactive-agents/memory` — Working, Semantic, Episodic, and Procedural memory backed by `bun:sqlite`
- Tier 1: FTS5 full-text search
- Tier 2: vector embeddings via `sqlite-vec` for semantic similarity (KNN)
- Zettelkasten-style note linking

#### Reasoning Strategies
- `@reactive-agents/reasoning` — ReAct (Reason + Act), Plan-Execute, and Tree-of-Thought strategies
- Configurable max iterations and strategy selection per task

#### Safety & Verification
- `@reactive-agents/guardrails` — prompt injection detection, PII scanning, toxicity filtering
- `@reactive-agents/verification` — semantic entropy scoring and fact decomposition

#### Cost Management
- `@reactive-agents/cost` — complexity-based model routing (Haiku / Sonnet / Opus)
- Session and per-request budget enforcement

#### Identity & Access
- `@reactive-agents/identity` — agent certificates, role-based access control (RBAC)

#### Observability
- `@reactive-agents/observability` — distributed tracing, metrics, structured logging

#### Interaction Modes
- `@reactive-agents/interaction` — 5 autonomy modes: Autonomous, Supervised, Collaborative, Consultative, Interrogative
- Dynamic mode transitions based on confidence and cost
- Human-in-the-loop checkpoints and collaboration sessions

#### Orchestration
- `@reactive-agents/orchestration` — multi-agent workflow engine, parallel and sequential coordination

#### Prompts
- `@reactive-agents/prompts` — template engine with variable interpolation, built-in prompt library

#### CLI (`rax`)
- `@reactive-agents/cli` — `rax` CLI (Reactive Agents eXecutable)
- `rax init <name> --template minimal|standard|full` — scaffold a new project
- `rax create agent <name> --recipe basic|researcher|coder|orchestrator` — generate agent files
- `rax run <prompt> --provider anthropic|openai|ollama` — run an agent from the command line
- `rax dev`, `rax eval`, `rax playground`, `rax inspect` — development utilities

#### Documentation
- Starlight (Astro) documentation site at https://tylerjrbuell.github.io/reactive-agents-ts/
- 16 pages covering guides, concepts, and API reference

#### CI/CD
- GitHub Actions: CI (typecheck + test), docs deployment to GitHub Pages, npm publish on version tags
- 283 tests across 52 files

---

## [Unreleased]

### Planned (v0.2.x)
- MCP SSE (HTTP event stream) transport
- MCP WebSocket transport
- MCP tool schema auto-conversion to `defineTool()` format
- Real MCP server integration tests (Filesystem, GitHub, Brave Search)

### Planned (v0.3.0)
- `@reactive-agents/eval` — LLM-as-judge scoring, regression detection, dataset loading, `rax eval run` CLI command
- Mistral and Cohere provider adapters
- A2A Protocol (agent-to-agent): server, client, agent-as-tool pattern
- Streaming service with real-time agent events (SSE + Effect Queue/Stream)
