# Changelog

All notable changes to Reactive Agents will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0] — 2026-02-22

### Added

#### Enhanced Builder API (`@reactive-agents/runtime` 0.4.0)
- **`.withReasoning(options?)`** — accepts optional `ReasoningOptions` for `defaultStrategy`, per-strategy config, and adaptive settings
- **`.withTools(options?)`** — accepts optional `ToolsOptions` with custom tool definitions (definition + handler pairs) registered at build time
- **`.withPrompts(options?)`** — accepts optional `PromptsOptions` with custom `PromptTemplate` objects registered at build time
- All three methods remain zero-arg compatible for simple use cases
- New exported interfaces: `ReasoningOptions`, `ToolsOptions`, `PromptsOptions`

#### Structured Tool Results (`@reactive-agents/llm-provider` 0.4.0, `@reactive-agents/runtime` 0.4.0)
- **LLMMessage type extended** with `{ role: "tool", toolCallId: string, content: string }` variant
- Execution engine OBSERVE phase now emits structured tool result messages with `toolCallId` references (was plain text `"Tool result: ..."`)
- **Anthropic adapter**: tool messages converted to `{ role: "user", content: [{ type: "tool_result", tool_use_id, content }] }`
- **OpenAI adapter**: tool messages mapped to `{ role: "tool", tool_call_id, content }`
- **Gemini adapter**: tool messages converted to `functionResponse` parts
- **Ollama adapter**: tool messages filtered (unsupported by Ollama API)

#### EvalStore Persistence (`@reactive-agents/eval` 0.2.0)
- **`makeEvalServiceLive(store?)`** factory wires optional `EvalStore` (SQLite) into `EvalService`
- `saveRun()` persists to both in-memory Ref and SQLite store when provided
- `getHistory()` reads from SQLite store when available, falls back to in-memory Ref
- **`makeEvalServicePersistentLive(dbPath?)`** convenience function — one-line persistent eval setup
- `EvalServiceLive` remains backwards compatible (in-memory only)

#### CLI Improvements (`@reactive-agents/cli` 0.4.0)
- `--stream` flag now prints informational warning ("not yet implemented") instead of silently ignoring

#### Integration Smoke Tests (6 new test files, 26 tests)
- `packages/runtime/tests/smoke-builder-combinations.test.ts` — 8 tests: minimal, tools-only, reasoning-only, tools+reasoning, full stack, custom system prompt, custom max iterations, withTestResponses
- `packages/runtime/tests/smoke-tool-pipeline.test.ts` — 3 tests: register → call → observe → complete, tool-not-found graceful error, tool timeout handling
- `packages/runtime/tests/smoke-guardrails.test.ts` — 3 tests: injection blocked, clean input passes, guardrails + reasoning combo
- `packages/runtime/tests/smoke-error-recovery.test.ts` — 4 tests: max iterations, missing provider, invalid input, structured error shape
- `packages/runtime/tests/smoke-memory.test.ts` — 3 tests: memory tier 1, multi-turn sequential, memory + reasoning combo
- `packages/eval/tests/smoke-eval-store.test.ts` — 5 tests: saveRun → loadHistory, compareRuns dimension changes, unknown ID returns null, cross-instance persistence, limit option

#### Performance & Quality Benchmarks (3 test files, 19 tests)
- `packages/eval/tests/benchmarks.test.ts` — extended with: `agent.run()` e2e < 100ms, all layers enabled < 200ms, prompt template compilation < 2ms average
- `packages/eval/tests/quality-regression.test.ts` — 6 tests: ReAct thought sequence, Reflexion critique cycle, Plan-Execute plan sequence, Tree-of-Thought branching + synthesis, Adaptive strategy delegation, all strategies return valid ReasoningResult shape
- `packages/prompts/tests/template-compilation.test.ts` — 6 tests: template structure validation, compilation with dummy variables, token estimation, PromptService registration, unique IDs, valid variable types

### Changed
- `@reactive-agents/runtime` 0.3.1 → 0.4.0: enhanced builder API with optional params, structured tool results in execution engine
- `@reactive-agents/llm-provider` 0.3.0 → 0.4.0: LLMMessage extended with tool role, all 4 provider adapters updated
- `@reactive-agents/eval` 0.1.0 → 0.2.0: EvalStore wired into EvalService, persistent layer factory
- `@reactive-agents/cli` 0.3.0 → 0.4.0: --stream warning
- `reactive-agents` meta-package 0.3.1 → 0.4.0

### Fixed
- All documentation code examples now reflect actual builder API signatures
- Removed all references to non-existent `defineTool()` function — replaced with actual `ToolService.register()` pattern or builder `.withTools({ tools: [...] })` option
- Fixed `.withTools([tool])`, `.withReasoning({ defaultStrategy })`, `.withPrompts({ system })` examples across 18+ documentation files to match real API
- Updated stale test/file counts in README and CLAUDE.md

### Stats
- 442 tests across 77 files (was 361/66)
- 41 files changed, 1238 insertions, 285 deletions

---

## [0.3.1] — 2026-02-21

### Added

#### Ollama SDK Integration (`@reactive-agents/llm-provider` 0.3.0)
- **Replaced raw `fetch()` with `ollama` npm SDK** — lazy-imported via `await import("ollama")` (same pattern as Gemini)
- Native tool calling: `tools` param passed to `ollama.chat()`, `response.message.tool_calls` parsed into `CompletionResponse.toolCalls`
- `done_reason` mapping: `"stop"` → `end_turn`, `"length"` → `max_tokens`, tool_calls present → `tool_use`
- `keep_alive: "5m"` for model caching between requests
- `embed()` rewritten to use `ollama.embed()` with batched input array
- `completeStructured()` uses `format: "json"` for native JSON mode
- Configurable endpoint via `new Ollama({ host })` from `config.ollamaEndpoint`

#### MCP Tool Parameter Population (`@reactive-agents/tools` 0.3.0)
- MCP `tools/list` response now parsed for full `{ name, description, inputSchema }` tuples (was name-only)
- `MCPServer.toolSchemas` field added for rich tool metadata
- `connectMCPServer()` converts `inputSchema.properties` → `parameters[]` array with proper types and `required` flags
- Tool descriptions use actual MCP description (was generic "MCP tool from ...")

#### MCP Server Configuration (`@reactive-agents/runtime` 0.3.1)
- `MCPServerConfig` interface and `mcpServers` field added to `RuntimeOptions`
- `mcpServers` implicitly enables tools when set
- `.withMCP(config)` builder method — accepts single config or array, implicitly sets `_enableTools = true`
- Builder `buildEffect()` connects MCP servers after layer construction via dynamic `ToolService` import
- Exported `RuntimeOptions` and `MCPServerConfig` types from runtime index

#### CLI MCP Support (`@reactive-agents/cli` 0.3.0)
- `--mcp-config <path>` / `--mcp <path>` flag for `rax run` — points to JSON config file
- Auto-loads `.rax/mcp.json` from project root if present (no flag needed)
- Config format: `{ "servers": [{ "name", "transport", "command", "args", "endpoint" }] }`

#### Web Search: Tavily Integration
- `webSearchHandler` checks `TAVILY_API_KEY` at execution time
- If set: POST to `https://api.tavily.com/search`, returns `{ title, url, content }` results
- If not set: returns existing stub (zero breakage for users without API key)

#### Exports
- `builtinTools` array exported from `@reactive-agents/tools` index
- `MCPToolSchema` type exported from tools index

#### New Tests
- `packages/tools/tests/builtin-tools.test.ts` — 5 tests: httpGet (real HTTP), fileRead, fileWrite, webSearch stub, codeExecute stub
- `packages/llm-provider/tests/ollama-tools.test.ts` — 6 tests: complete(), tools pass-through, tool_calls parsing, done_reason mapping, embed(), getModelConfig()
- `packages/runtime/tests/builder-tools.test.ts` — 5 tests: .withTools() build, run with tools, .withMCP() config, array configs, full pipeline
- `packages/tools/tests/tool-service.test.ts` — +1 test: MCP parameter population

### Changed
- `@reactive-agents/llm-provider` 0.2.0 → 0.3.0: Ollama SDK rewrite with tool calling support
- `@reactive-agents/tools` 0.2.0 → 0.3.0: MCP parameter population, Tavily web search, builtinTools export
- `@reactive-agents/runtime` 0.3.0 → 0.3.1: MCP server config in builder and runtime
- `@reactive-agents/cli` 0.2.1 → 0.3.0: --mcp-config flag, .rax/mcp.json auto-loading
- `reactive-agents` meta-package 0.3.0 → 0.3.1

### Stats
- 361 tests across 66 files (was 340/63)

---

## [0.3.0] — 2026-02-21

### Added

#### Foundation Integration — All Services Wired Through Execution Engine

The 10-phase execution engine now calls every configured service. Agents can think, use tools, observe results, verify output, track costs, and log audit trails — all in a single execution loop.

**Tools in Reasoning (C1)**
- `ReasoningService` captures `ToolService` optionally at layer construction time
- Strategies like ReAct receive ToolService in their Effect context — tools execute for real during reasoning
- `createRuntime()` restructured: tools layer built before reasoning layer and provided as a dependency

**OpenAI Function Calling (C2)**
- `toOpenAITool()` converter maps tool definitions to OpenAI's function_calling format
- `tools` array sent in OpenAI API request body when tools are provided
- `tool_calls` extracted from responses; `function.arguments` JSON parsed into `ToolCall[]`
- `finish_reason: "tool_calls"` mapped to `stopReason: "tool_use"`; `content: null` handled

**3 New Reasoning Strategies (C3)**
- **Plan-Execute-Reflect** — Generate plan → execute steps → reflect → refine (configurable `maxRefinements`, `reflectionDepth`)
- **Tree-of-Thought** — BFS expansion → score branches → prune below threshold → synthesize best path (configurable `breadth`, `depth`, `pruningThreshold`)
- **Adaptive** — Meta-strategy: analyze task complexity via LLM → delegate to optimal sub-strategy
- All 5 strategies registered in `StrategyRegistryLive` initial map

**Tool Type Adapter (C4)**
- Execution engine calls `toFunctionCallingFormat()` before LLM loop, converting tools package format to LLM-compatible `{ name, description, inputSchema }` format

**Token Tracking (C5)**
- `tokensUsed` added to `ExecutionContext` schema, initialized to 0
- Accumulated from `response.usage.totalTokens` after each LLM call
- Final `TaskResult` reports accurate token count (was hardcoded to 0)

**Observability Integration (H1)**
- `ObservabilityService` acquired optionally at start of `execute()`
- `runObservablePhase()` wrapper wraps every phase in `obs.withSpan()` when available
- All `runPhase()` calls replaced with `runObservablePhase()`
- Spans include `taskId`, `agentId`, and `phase` attributes

**Stub Phases Wired to Real Services (H2)**
- Phase 2 (Guardrail): `GuardrailService.check(inputText)` — fails with `GuardrailViolationError` if `!result.passed`
- Phase 3 (Cost Route): `CostService.routeToModel(task)` — selects optimal model tier
- Phase 6 (Verify): `VerificationService.verify(response, input)` — stores score and risk in context metadata
- Phase 8 (Cost Track): `CostService.recordCost()` — logs token counts, latency, and cost
- Phase 9 (Audit): `ObservabilityService.info()` — logs task summary with iterations, tokens, cost, strategy, duration

**Context Window Management (H3)**
- `ContextWindowManager.truncate()` called before each LLM call to stay within token limits

**Memory Integration in Reasoning Loop (H5)**
- OBSERVE phase logs tool results as episodic memories via `MemoryService.logEpisode()`
- Phase 7 (Memory Flush) calls `flush()` in addition to `snapshot()` for full persistence

#### Documentation Overhaul
- **12 new documentation pages** (28 total, up from 15)
- 7 feature docs: LLM Providers, Verification, Cost Tracking, Identity/RBAC, Observability, Orchestration, Prompt Templates
- 4 cookbook pages: Testing Agents, Multi-Agent Patterns, Custom Strategies, Production Deployment
- Rewritten landing page with tabbed code examples and framework comparison cards
- New sidebar sections: Features, Cookbook
- Neural network logo design, favicon

#### README Rewrite
- Architecture tables mapping phases to services
- Strategy comparison matrix with use cases
- Multi-provider capability matrix
- Cleaner badge layout, updated stats

#### New Tests
- `packages/runtime/tests/foundation-integration.test.ts` — token accumulation, tools-to-LLM, observability spans, guardrails/verify/cost phases, OpenAI tool_calls
- `packages/reasoning/tests/strategies/plan-execute.test.ts` — 3 tests
- `packages/reasoning/tests/strategies/tree-of-thought.test.ts` — 3 tests
- `packages/reasoning/tests/strategies/adaptive.test.ts` — 3 tests
- `packages/llm-provider/tests/openai-tools.test.ts` — OpenAI tool format

### Changed
- `@reactive-agents/runtime` 0.2.0 → 0.3.0: major execution engine rewrite, all phases wired
- `@reactive-agents/reasoning` 0.2.0 → 0.3.0: 3 new strategies, ToolService integration
- `@reactive-agents/llm-provider` 0.1.1 → 0.2.0: OpenAI function calling support
- `reactive-agents` meta-package 0.2.1 → 0.3.0
- Updated existing docs: reasoning (5 strategies), tools (reasoning integration), guardrails (execution engine wiring), agent lifecycle (service calls per phase), builder API reference (Gemini provider)

### Stats
- 340 tests across 63 files (was 318/56)
- 28 documentation pages (was 15)

---

## [0.2.1] — 2026-02-20

### Added

#### Evaluation Framework (`@reactive-agents/eval`)
- **`@reactive-agents/eval` 0.1.0** — LLM-as-judge evaluation framework for agent quality measurement
- 5 built-in scoring dimensions: `accuracy`, `relevance`, `completeness`, `safety`, `cost-efficiency`
- Custom dimension support via generic LLM-as-judge prompting
- `EvalService.runSuite(suite, agentConfig)` — runs all cases, scores all dimensions, builds summary with pass/fail counts
- `EvalService.runCase(evalCase, agentConfig, dimensions, actualOutput, metrics)` — score a single case with real agent output
- `EvalService.compare(runA, runB)` — per-dimension improvement/regression/unchanged classification (±0.02 delta threshold)
- `EvalService.checkRegression(current, baseline, threshold?)` — regression detection with configurable threshold (default 0.05)
- `EvalService.getHistory(suiteId)` — retrieve past runs from in-memory history ref
- `DatasetService.loadSuite(path)` — load eval suite from JSON file (Schema-validated)
- `DatasetService.loadSuitesFromDir(dir)` — batch-load all `*.json` suites from a directory
- `rax eval run --suite <path> [--provider anthropic|openai|test]` — CLI command with summary table and dimension score bars
- 11 tests: eval-service (7) and dataset-service (4)

### Changed
- `reactive-agents` meta-package 0.2.0 → 0.2.1: adds `@reactive-agents/eval` dep and `./eval` subpath export
- `@reactive-agents/cli` 0.2.0 → 0.2.1: real `rax eval run` implementation (was placeholder)
- `@reactive-agents/reasoning` type fixes for correct DTS output (no API changes)

### Fixed
- Build order: `@reactive-agents/tools` now builds before `@reactive-agents/reasoning` (DTS dependency)
- `reactive.ts` type errors in DTS output from `typeof ToolService.Service` — replaced with explicit local interface

### Stats
- 318 tests across 56 test files (was 307/54)

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
