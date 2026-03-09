# Changelog

All notable changes to Reactive Agents will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.7.0] — 2026-03-08

Context Engine & Memory Intelligence — per-iteration context scoring, cross-agent experience learning, background memory consolidation, meta-tools for agent self-awareness, and parallel/chain tool execution.

### Added

#### ContextEngine — Per-Iteration Context Scoring (`@reactive-agents/reasoning`)

Replaces 6 static context builders (`buildInitialContext`, `buildCompactedContext`, `progressiveSummarize`, `buildCompletedSummary`, `buildPinnedToolReference`, `buildIterationAwareness`) with a unified pipeline:

- **`buildContext(input: ContextBuildInput)`** — scores every history item per iteration using recency decay (`e^{-0.3 * iterDiff}`), keyword overlap relevance, type weight (obs 0.8 > action 0.6 > thought 0.4), failure urgency boost (1.5×), and pin score (1.0). Tool schemas always pinned; memory relevance threshold 0.3. Model-profile-adaptive full-detail step count.
- **`scoreContextItem(item, context)`** — exported scoring primitive; useful for testing and external context assembly.
- **`allocateContextBudget(profile, total)`** — exported budget-allocation primitive; returns per-section token budgets.

#### ExperienceStore — Cross-Agent Learning (`@reactive-agents/memory`)

SQLite-backed cross-run intelligence for tool pattern reuse and error recovery:

- **`ExperienceStore.record(entry)`** — upserts `(taskType, patternKey)` row accumulating count, success rate, avg steps/tokens; upserts error recovery hints keyed by `(tool, errorPattern)`.
- **`ExperienceStore.query(taskDescription, taskType, modelTier)`** — returns tool patterns (filtered to ≥50% confidence AND ≥2 occurrences) and error recovery hints; generates human-readable `tips[]` array injected at agent bootstrap.
- **`.withExperienceLearning()`** builder method — enables `ExperienceStoreLive` in the runtime; execution engine injects tips at bootstrap and records outcomes after each run.

#### MemoryConsolidatorService — Background Memory Intelligence (`@reactive-agents/memory`)

Background decay/replay/compress cycle for episodic entries:

- **`MemoryConsolidatorService.consolidate(agentId)`** — COMPRESS: decays all episodic `importance` × 0.95, prunes entries below 0.1. REPLAY: counts recent episodic entries added since last consolidation run. Persists state to `consolidation_state` SQLite table.
- **`MemoryConsolidatorService.notifyEntry()`** — increments pending counter; returns `true` when threshold (default 10) reached to signal consolidation is due.
- **`MemoryConsolidatorServiceLive(config?)`** — factory `Layer`; accepts `{ threshold?, decayFactor?, pruneThreshold? }`.
- **`.withMemoryConsolidation(config?)`** builder method — enables `MemoryConsolidatorServiceLive` in the runtime.

#### Meta-Tools — Agent Self-Awareness (`@reactive-agents/tools`)

Two new kernel-level meta-tools for agent introspection and guarded completion:

- **`context-status`** — zero-parameter tool that reports `iteration`, `maxIterations`, `remaining`, `toolsUsed`, `toolsPending`, `storedKeys`, `tokensUsed`. Always visible; helps agents orient when lost.
- **`task-complete`** — single-parameter (`summary`) tool for explicit task signalling. Visibility-gated: only shown when all 4 conditions hold: (1) all required tools called, (2) iteration ≥ 2, (3) no pending errors, (4) at least one non-meta tool invoked.
- **`makeContextStatusHandler(state)`** and **`makeTaskCompleteHandler(state)`** — factory functions for dynamic state wiring at kernel level.
- **`shouldShowTaskComplete(input)`** — pure visibility predicate; exported for testing and custom kernels.
- **`metaToolDefinitions`** array — exported for schema inspection without live state wiring.

#### Parallel & Chain Tool Execution (`@reactive-agents/reasoning`)

Agents can now issue multiple tool calls from a single thought:

- **Parallel** — multiple `ACTION:` lines in a single thought → `Effect.all(..., { concurrency: "unbounded" })` → combined numbered observation. Capped at 3 to prevent runaway fan-out. Side-effect prefixes (`send_`, `create_`, `delete_`, etc.) force single mode.
- **Chain** — `ACTION:` followed by `THEN:` → sequential execution with `$RESULT` placeholder forwarding between steps. Fails fast on any step error. Capped at 3.
- **`parseToolRequestGroup(thought)`** — exported primitive returning `ToolRequestGroup { mode: "single"|"parallel"|"chain", requests }`.
- **`executeToolGroup(toolService, group, config)`** — dispatches the group; single delegates to existing `executeToolCall`.

#### Sub-Agent Fixes (`@reactive-agents/tools`)

- **`ALWAYS_INCLUDE_TOOLS`** — constant `["scratchpad-read", "scratchpad-write"]` auto-merged into every sub-agent's tool list so sub-agents always have scratchpad access regardless of parent config.
- **Iteration cap** — `effectiveMaxIter = Math.min(config.maxIterations ?? 6, 6)` prevents runaway sub-agents.
- **Scratchpad key forwarding** — `SubAgentResult.forwardedScratchpadKeys` lists keys written with `sub:<agentName>:<key>` prefix; parent agent can read forwarded context.

### Changed

- `@reactive-agents/reasoning`: `react-kernel.ts` net −200 lines — 6 static context helpers replaced by single `buildContext()` call.
- `@reactive-agents/memory`: new `services/` sub-directory with `ExperienceStoreLive` and `MemoryConsolidatorServiceLive` exported from `src/index.ts`.
- `@reactive-agents/tools`: `src/index.ts` now exports `ALWAYS_INCLUDE_TOOLS`, `contextStatusTool`, `makeContextStatusHandler`, `ContextStatusState`, `taskCompleteTool`, `shouldShowTaskComplete`, `makeTaskCompleteHandler`, `TaskCompleteVisibility`, `TaskCompleteState`.
- `@reactive-agents/reasoning`: `src/index.ts` now exports `buildContext`, `ContextBuildInput`, `ContextItem`, `MemoryItem`, `ScoringContext`, `BudgetResult`.

### Stats

- 1,735 tests across 211 files (was 1,588/190 in v0.6.3, +147 new tests)
- 20 packages (unchanged)

---

## [0.6.4] — 2026-03-08 (pre-release)

### Added

#### Required Tools Guard & Adaptive Inference (`@reactive-agents/runtime`, `@reactive-agents/reasoning`)

Ensure agents use critical tools before producing a final answer — with optional LLM-powered inference for dynamic tool detection:

- **`.withRequiredTools(config)`** — unified config API: `{ tools?: string[], adaptive?: boolean, maxRetries?: number }`
  - `tools: ["web-search"]` — static tool list; agent must call these before answering
  - `adaptive: true` — LLM analyzes the task and available tools to infer which are required (no static list needed)
  - `maxRetries: 2` — number of retry loops if required tools are missed (default: 2)
- **`inferRequiredTools()`** — structured-output LLM call that analyzes task + available tool schemas to determine required tools, with hallucination guard filtering against actual tool names
- **Required tools threaded through all 5 strategies** — `requiredTools` and `maxRequiredToolRetries` added to `ReactiveInput`, `PlanExecuteInput`, `ReflexionInput`, `TreeOfThoughtInput`, `AdaptiveInput` and forwarded to kernel calls
- **`KernelRunner` enforcement** — after kernel produces a final answer, runner checks if all required tools were called; if not, injects a nudge message and re-enters the kernel loop (up to `maxRetries` times)
- **6 new tests** for `inferRequiredTools` covering empty tools, inferred names, hallucination filtering, malformed JSON, and system prompt threading

#### Circuit Breaker (`@reactive-agents/llm-provider`)

- **`CircuitBreaker`** — protects LLM calls with configurable failure thresholds and recovery timeouts. States: `CLOSED` → `OPEN` → `HALF_OPEN`. Prevents cascading failures during provider outages
- **`CircuitBreakerConfig`** — `{ failureThreshold, resetTimeoutMs, halfOpenRequests }`
- **4 new tests** covering state transitions, timeout recovery, and success reset

#### Embedding Cache (`@reactive-agents/llm-provider`)

- **`EmbeddingCache`** — LRU + TTL cache for embedding vectors. Avoids redundant embedding API calls for repeated text
- **`EmbeddingCacheConfig`** — `{ maxSize, ttlMs }`
- **4 new tests** covering cache hits/misses, TTL expiry, and eviction

#### Token Counter Improvements (`@reactive-agents/llm-provider`)

- **Model-specific token estimation** — refined token counting for Anthropic, OpenAI, and Gemini models using calibrated chars-per-token ratios
- **3 new tests** for provider-specific counting accuracy

#### Budget Persistence (`@reactive-agents/cost`)

- **`BudgetDB`** — SQLite-backed persistence for budget state across agent restarts. Records per-session and daily spend with automatic recovery
- **Enhanced `BudgetEnforcer`** — integrates with `BudgetDB` for durable spend tracking. Supports warm-start from persisted state
- **4 new tests** for persistence, recovery, and cross-session continuity

#### Enhanced Complexity Router (`@reactive-agents/cost`)

- **27 complexity signals** — expanded heuristic classifier covers code blocks, math expressions, multi-part questions, constraint satisfaction, creative tasks, and domain-specific indicators
- **3 new tests** for edge-case classification accuracy

#### Memory Extractor Improvements (`@reactive-agents/memory`)

- **Structured extraction pipeline** — extracts facts, decisions, preferences, and action items from conversation turns with confidence scoring
- **Priority-based consolidation** — higher-confidence extractions override lower-confidence duplicates
- **8 new tests** covering extraction categories, confidence scoring, and deduplication

#### Hybrid Search (`@reactive-agents/memory`)

- **FTS5 + semantic score fusion** — search results now combine keyword (FTS5) and vector (semantic) scores with configurable weighting
- **Reciprocal Rank Fusion (RRF)** — merges ranked lists from both search backends into a single relevance-sorted result
- **4 new tests** for hybrid scoring and rank fusion

#### Telemetry System (`@reactive-agents/observability`)

- **`TelemetryCollector`** — collects anonymized usage telemetry with configurable opt-in/opt-out and batched upload
- **`LocalAggregator`** — aggregates telemetry events locally before transmission, computing percentiles, histograms, and counters
- **`PrivacyPreserver`** — strips PII and sensitive data from telemetry payloads using pattern-based redaction and differential privacy noise injection
- **`TelemetrySchema`** — typed telemetry event schemas covering LLM calls, tool usage, strategy selection, and cost tracking
- **12 new tests** across telemetry collection, aggregation, privacy, and schema validation

#### OTLP Exporter (`@reactive-agents/observability`)

- **`OTLPExporter`** — exports traces and metrics to any OpenTelemetry-compatible backend (Jaeger, Grafana, Datadog, etc.) via OTLP/HTTP
- **Enhanced `MetricsCollector`** — extended with histogram buckets, counter resets, and per-phase P50/P95 latency tracking

#### Enhanced Tracer (`@reactive-agents/observability`)

- **Span attributes** — traces now carry model name, provider, token counts, and cost as structured span attributes
- **Parent-child span correlation** — proper parent span propagation through reasoning and tool execution

#### Docker Sandbox (`@reactive-agents/tools`)

- **`DockerSandbox`** — execute code in isolated Docker containers with resource limits (CPU, memory, timeout), network isolation, and volume mounts
- **`DockerSandboxConfig`** — `{ image, memoryMb, cpuShares, timeoutMs, networkMode }`
- **Docker execution skill** — `docker-execution.ts` tool handler for containerized code execution
- **5 new tests** covering container lifecycle, resource limits, and error handling

#### Tool Result Cache (`@reactive-agents/tools`)

- **`ToolResultCache`** — LRU + TTL cache for tool execution results. Avoids redundant tool calls for identical inputs within a session
- **`ToolResultCacheConfig`** — `{ maxSize, ttlMs, hashStrategy }`
- **Wired into `ToolService`** — cache lookups happen transparently before tool execution
- **6 new tests** covering hit/miss, TTL, eviction, and hash strategies

#### JSON Repair (`@reactive-agents/reasoning`)

- **`repairJson()`** enhanced — handles unbalanced braces/brackets, trailing commas inside nested structures, unquoted keys at any depth, and truncated JSON from interrupted LLM responses
- **Structured output pipeline hardened** — retry loop now passes parse error context back to LLM for self-correction
- **4 new tests** for deep nesting repair, truncation recovery, and edge cases

#### Plan Wave Execution (`@reactive-agents/reasoning`)

- **Parallel wave execution** — plan steps with no inter-dependencies execute concurrently in waves, with dependency ordering automatically resolved
- **5 new tests** for wave detection, ordering, and parallel execution semantics

#### Enhanced Context Utilities (`@reactive-agents/reasoning`)

- **Improved token estimation** — context budget allocation now accounts for tool schema verbosity and system prompt length
- **Step history compaction** — smarter progressive compaction preserves error steps and high-value observations

#### Enhanced Tool Execution (`@reactive-agents/reasoning`)

- **Retry with backoff** — tool execution failures trigger configurable retry with exponential backoff before marking as error
- **Timeout enforcement** — per-tool timeout limits prevent runaway tool calls from blocking the reasoning loop

#### Benchmark Suite (`@reactive-agents/benchmarks`) — New Package

- **20 benchmark tasks** across 5 complexity tiers (trivial, simple, moderate, complex, expert)
- **`runBenchmarks(options)`** — runs tasks with configurable provider, model, tier filter, and concurrency
- **Framework overhead measurement** — measures runtime creation, full-feature runtime creation, and complexity classification latency
- **CLI entry point** — `bun run src/run.ts [--provider test] [--tier simple,moderate] [--output report.json]`
- **6 new tests** for task definitions, tier filtering, and ID uniqueness

#### Builder API Extensions (`@reactive-agents/runtime`)

- **Runtime type exports** — `RequiredToolsConfig`, `RequiredToolsSchema` exported from runtime index
- **Builder validation tests** — 4 new tests for `withRequiredTools()` configuration patterns

#### CLI Enhancements (`apps/cli`)

- `apps/cli/tests/cli-contracts.test.ts` — provider CLI contract tests for local Docker, Fly, Railway, Render, Cloud Run (`gcloud`), and DigitalOcean (`doctl`) command/flag compatibility; includes version baselines and optional slow container-image availability checks (`RUN_SLOW_TESTS=1`)
- `rax playground` now launches a real interactive REPL session (single agent instance, `/help` + `/exit`, optional `--stream`) via `apps/cli/src/commands/playground.ts`
- `rax inspect` now performs concrete local diagnostics (Docker/Compose checks, compose status, recent log matching by agent ID, optional `--json`) via `apps/cli/src/commands/inspect.ts`
- `apps/meta-agent` now runs dedicated competitor intelligence crons every 12 hours with staggered tracks: TypeScript-first sweep (`0 */12 * * *`) and Python-first sweep (`30 */12 * * *`)
- `apps/meta-agent` now runs an hourly competitive scorecard cron (`0 * * * *`) that drafts evidence-backed summaries of where reactive-agents is excelling vs behind competition

### Changed

- `@reactive-agents/llm-provider`: Anthropic, OpenAI, Gemini, and Ollama providers now include circuit breaker protection and embedding cache integration
- `@reactive-agents/cost`: Complexity router expanded from 12 to 27 complexity signals for more accurate model tier selection
- `@reactive-agents/memory`: Semantic memory search now uses hybrid FTS5 + vector scoring with reciprocal rank fusion
- `@reactive-agents/observability`: `MetricsCollector` extended with histogram buckets, P50/P95 latency, and OTLP export support
- `@reactive-agents/reasoning`: Structured output pipeline enhanced with improved JSON repair and LLM-guided self-correction
- `@reactive-agents/tools`: `ToolService` now transparently caches tool results via `ToolResultCache`
- `@reactive-agents/verification`: `fact-decomposition` and `semantic-entropy` layers use refined confidence thresholds
- `rax deploy` now uses provider adapter dispatch end-to-end with structured `--dry-run` preflight output and target auto-detection
- `rax run --stream` is now fully implemented using `agent.runStream()` token output path
- `rax dev` now runs a real Bun watch workflow with entrypoint overrides (`--entry`, `--no-watch`)
- `rax serve` input validation tightened (provider validation, memory tier parsing)

### Fixed

- **Duplicate prompt-trace events in reasoning loop** — `react-kernel.ts` emitted a `[prompt-trace]` thought event before every LLM call, causing doubled step counts in all 5 strategies. Removed the redundant event
- **Metrics dashboard now correctly shows failed tool calls** — `ToolCallCompleted` events were always published with `success: true`; updated `KernelHooks.onObservation` to propagate actual success status from `ObservationResult`
- Removed dead code in deploy dispatcher (`listProviders` unused import and unused parse-options parameter)

### Stats

- 1,588 tests across 190 files (was 1,381/180 in v0.6.0, +207 new tests)
- 21 packages (was 20; added `@reactive-agents/benchmarks`)

---

## [0.6.3] - 2026-03-05

Patch release — gateway and streaming examples, `AgentStream` API fix, and public re-exports.

### Added

- `apps/examples/src/gateway/22-persistent-gateway.ts` — runnable gateway example: `.withGateway()`, heartbeat, crons, policies, `agent.start()` / `handle.stop()`, `GatewaySummary`; works in test mode without an API key
- `apps/examples/src/streaming/23-token-streaming.ts` — demonstrates `runStream()` in both `"tokens"` and `"full"` density modes
- `apps/examples/src/streaming/24-streaming-sse-server.ts` — `AgentStream.toSSE()` SSE endpoint via `Bun.serve`; validates headers in test mode, starts a real HTTP server with an API key

### Fixed

- `AgentStream.toSSE()`, `toReadableStream()`, and `collect()` now accept `AsyncIterable<AgentStreamEvent>` (the return type of `agent.runStream()`) in addition to Effect `Stream` — the documented `AgentStream.toSSE(agent.runStream(...))` pattern now compiles and works correctly
- All 20 existing examples updated to import from `"reactive-agents"` instead of `"@reactive-agents/runtime"` — copy-pasted code now works out of the box
- `AgentStream`, `AgentStreamEvent`, and `StreamDensity` exported from the `reactive-agents` umbrella package

### Changed

- Clarified Effect install instructions: `effect` ships as a dependency of `reactive-agents`; only add it explicitly when importing from `effect` directly

---

## [0.6.2] - 2026-03-05

Patch release — fixes 0.x semver dependency resolution. `workspace:^` resolves to `^0.5.5` which in 0.x semver means `>=0.5.5 <0.6.0`, excluding `0.6.x`. Changed all `workspace:^` to `workspace:*` so published packages use exact version pins (e.g., `0.6.2`) which any higher version satisfies.

### Fixed

- All `workspace:^` changed to `workspace:*` across 7 package.json files
- `bun add reactive-agents` and `bun add @reactive-agents/runtime` now correctly resolve to 0.6.2 sub-packages

---

## [0.6.1] - 2026-03-05

Patch release — fixes npm dependency resolution. v0.6.0 was published with stale `workspace:^` resolutions pointing to `^0.5.5` instead of `^0.6.0`. Also adds `@reactive-agents/gateway` and `@reactive-agents/testing` to the publish workflow (were missing from the PACKAGES list).

### Fixed

- All cross-package dependencies now resolve to `^0.6.1` (was `^0.5.5` in 0.6.0)
- `@reactive-agents/gateway` added to npm publish workflow
- `@reactive-agents/testing` added to npm publish workflow

---

## [0.6.0] - 2026-03-04

Agent Streaming, Gateway persistent agent harness, Composable Kernel Architecture, Structured Plan Engine, Strategy SDK Refactor, Foundation Fixes, documentation pass with 13 agent skills. 20 packages bumped to 0.6.0, 1,381 tests across 180 files.

### Added

#### Agent Streaming (`@reactive-agents/runtime` + `@reactive-agents/core`)

Token-by-token output streaming via `runStream()` AsyncGenerator with FiberRef-based TextDelta propagation:

- **`stream-types.ts`** — `AgentStreamEvent` 8-variant discriminated union, `StreamDensity` type (`"tokens"` | `"full"`)
- **`agent-stream.ts`** — `AgentStream` adapter namespace: `toSSE()` (Response with auto-close), `toReadableStream()`, `toAsyncIterable()`, `collect()` (stream → AgentResult)
- **`StreamingTextCallback` FiberRef** — Fiber-local callback set via `Effect.locally` in `executeStream()`, read by react-kernel during LLM streaming
- **`executeStream()` on ExecutionEngine** — Queue + forkDaemon architecture: unbounded queue bridges execution fiber to consumer, `Stream.unfoldEffect` yields events
- **`.withStreaming()` builder method** — Sets default density; per-call override via `runStream(input, { density })`
- **`AgentStreamStarted` / `AgentStreamCompleted`** EventBus events with density, taskId, agentId, durationMs

#### Documentation & Skills Discovery

- **Streaming docs page** — `apps/docs/src/content/docs/features/streaming.md` covering events, density modes, adapters, architecture
- **13 agent skills** — Discoverable at `/.well-known/skills/` via Astro integration: streaming, gateway, a2a, reasoning, memory, observability, orchestration, context-engineering, cost, identity, mcp, verification, framework overview
- **Skills loader** — `apps/docs/src/content/skills-loader.ts` + Astro config integration for auto-discovery
- **New guides** — choosing-a-stack, security-hardening, troubleshooting, agent-skills

#### Composable Kernel Architecture (`@reactive-agents/reasoning`)

Three-layer separation: ThoughtKernel (single-step algorithm) → KernelRunner (universal loop) → Strategy (policy wrapper).

- **`kernel-state.ts`** — `KernelState` immutable state, `ThoughtKernel` contract, `KernelContext`, serialization helpers for collective learning/replay
- **`tool-execution.ts`** — Shared `executeToolCall()`, `makeObservationResult()`, `truncateForDisplay()` — replaces ~260 lines of duplication across reactive.ts and react-kernel.ts
- **`kernel-hooks.ts`** — `buildKernelHooks()` wires `onThought/onAction/onObservation/onDone/onError` to EventBus. Single source of truth for `ToolCallCompleted` events
- **`kernel-runner.ts`** — `runKernel()` universal execution loop with embedded tool call guard (catches bare tool calls in FINAL ANSWER text)
- **`reactKernel: ThoughtKernel`** — ReAct algorithm as first kernel implementation. Single-step state transition dispatching on "thinking"/"acting" status
- **Custom kernel registration** — `StrategyRegistry.registerKernel()/getKernel()/listKernels()` for swappable reasoning algorithms

### Fixed

- **Output containing raw tool call text** — Embedded tool call guard in KernelRunner detects `tool_name({...})` in output and executes the tool instead of returning raw text
- **Double tool metrics** — Removed duplicate `obs.recordHistogram` in execution-engine.ts reasoning path. KernelHooks.onObservation is now the single source of `ToolCallCompleted`

### Changed

- `reactive.ts` collapsed from ~905 lines to ~128 lines (delegates to `runKernel(reactKernel, ...)`)
- `reflexion.ts` generate/improve passes use `runKernel()` directly instead of `executeReActKernel()` wrapper
- `tree-of-thought.ts` Phase 2 execution uses `runKernel()` directly
- `react-kernel.ts` rewritten as `ThoughtKernel` with backwards-compatible `executeReActKernel()` wrapper

---

### Structured Plan Engine (`@reactive-agents/reasoning` + `@reactive-agents/memory`)

Complete rewrite of the plan-execute-reflect strategy with structured JSON plans, replacing fragile text-parsed numbered lists:

- **`packages/reasoning/src/types/plan.ts`** — `Plan`, `PlanStep`, `LLMPlanOutput` type-safe schemas. `hydratePlan()` generates deterministic short IDs (`s1`, `s2`). `resolveStepReferences()` for `{{from_step:sN}}` interpolation.
- **`packages/reasoning/src/structured-output/`** — Reusable 4-layer structured output pipeline: high-signal prompting → JSON repair → Schema validation → retry with error feedback. `extractJsonBlock()` and `repairJson()` handle markdown fences, trailing commas, single quotes, truncated JSON.
- **`packages/llm-provider`** — `StructuredOutputCapabilities` interface. Each provider reports JSON mode, schema enforcement, prefill, and grammar support.
- **`packages/memory`** — `plans` + `plan_steps` SQLite tables. `PlanStoreService` for persistent plan CRUD.
- **`packages/reasoning/src/strategies/plan-execute.ts`** — Rewritten with structured JSON plans, hybrid step execution (tool_call direct dispatch, analysis/composite scoped kernel), graduated retry → patch → replan, plan persistence.
- **`packages/reasoning/src/strategies/shared/plan-prompts.ts`** — Tier-adaptive prompt builders: plan generation, patch, step execution, reflection.
- **`PlanExecuteConfig`** — Extended with `planMode` ("linear" | "dag"), `stepRetries`, `patchStrategy`.

### Fixed

#### Plan Persistence & Error Handling (`@reactive-agents/reasoning` + `@reactive-agents/memory`)

- **`PlanStoreServiceLive` wired into memory layer** — Was missing from `createMemoryLayer()` in `packages/memory/src/runtime.ts`, so `Effect.serviceOption` always returned `None` and plans were never persisted despite the tables existing
- **Step status updates use correct ID** — `updateStepStatus()` was called with composite `${planId}_${stepId}` but DB primary key is just `stepId`
- **Effect error handling** — Replaced broken `try/catch` (doesn't catch Effect typed errors in generators) with `Effect.exit()` + `Exit.isSuccess()` + `Cause.squash()` pattern for reliable retry loop
- **Goal stored as plain text** — `extractGoalText()` unwraps JSON-wrapped `{"question":"..."}` from execution engine's `JSON.stringify(task.input)`
- **"FINAL ANSWER:" stripped from step outputs** — `stripFinalAnswerPrefix()` prevents ReAct protocol artifacts from leaking into tool args via `{{from_step:sN}}` references
- **Analysis steps use direct `llm.complete()`** — Removed unnecessary ReAct kernel overhead for pure reasoning steps (no tools needed)
- **Tool signatures show required vs optional** — `name` vs `name?` in plan generation prompt helps LLM include all required parameters
- **Planning rules enforce efficiency** — Min steps, prefer tool_call, max ONE analysis step, combine related work

#### Duplicate Step Prevention (`@reactive-agents/reasoning`)

- **All-steps-completed guard** — If every plan step completed successfully, treat as satisfied regardless of LLM reflection text. Prevents false-negative refinement loops that re-execute side-effecting actions (e.g., sending duplicate messages)
- **Carry-forward refinement** — Plan generation moved outside refinement loop. Completed steps preserved across cycles — only failed/pending steps get patched and re-executed via `buildPatchPrompt`
- **`isSatisfied()` case-insensitive** — Now matches `"Satisfied:"`, `"Status: Satisfied"`, etc. Reflection prompt restructured to force `SATISFIED:` or `UNSATISFIED:` as first word
- **Granular observability** — Step start, retry, failure, patch, skip, reflection events all published via EventBus for full plan execution visibility

#### Tool Metrics & Prompt Quality (`@reactive-agents/reasoning`)

- **ToolCallCompleted events from plan-execute** — Direct tool dispatch now publishes `ToolCallCompleted` to EventBus so MetricsCollector tracks tool calls in the dashboard (was missing because plan-execute bypasses the execution engine's act phase)
- **`{{from_step:sN}}` self-reference guard** — Runtime check fails the step if unresolved references remain in toolArgs (prevents literal `{{from_step:s3}}` being sent as message content)
- **Plan generation self-reference prevention** — Prompt now explicitly states steps can ONLY reference EARLIER steps (s3 can reference s1/s2, not s3)
- **Analysis step directive prompt** — System prompt changed to "Produce the requested content directly. Never ask questions or offer to do something" to prevent conversational output like "Would you like me to send this?"
- **Step execution structured RULES** — Added explicit rules: no labels/prefixes, no follow-up questions, output is passed directly to next step

#### Output Sanitization (`@reactive-agents/reasoning` + `@reactive-agents/runtime`)

Cross-cutting output sanitization prevents internal agent metadata from reaching users across all 5 reasoning strategies:

- **`sanitizeAgentOutput()`** in `quality-utils.ts` — Strips `FINAL ANSWER:` prefix, `<think>` tags, `[STEP/EXEC/SYNTHESIS/REFLECT]` markers, ReAct protocol prefixes (`Thought:`/`Action:`/`Observation:`), tool call echo lines (`tool/name: {json}`), raw JSON with internal keys (`recipient`, `toolName`)
- **`sanitizeToolOutput()`** in `plan-execute.ts` — Action tools (send/write/post/create) that echo back request payloads get sanitized to clean confirmations; data-fetching tools keep full output
- **Wired into all exit points**: `buildStrategyResult()` (reflexion, plan-execute, ToT, adaptive), `buildResult()` (reactive), execution engine `TaskResult` assembly (safety net)
- **Synthesis prompt hardened** — Explicitly instructs LLM to exclude tool names, JSON payloads, recipient numbers, and execution metadata from final answer
- **17 new tests** covering sanitization patterns, integration with `buildStrategyResult`, and edge cases

#### Strategy Type Threading (`@reactive-agents/reasoning`)

Full type-safe parameter threading from execution engine through all 5 reasoning strategies:

- **`StrategyFn` type extended** — `resultCompression`, `contextProfile`, `taskId`, `agentId`, `sessionId` now explicitly typed (was silently accepted via structural typing)
- **`resultCompression` wired** — All 3 kernel-backed strategies (Reflexion, Plan-Execute, ToT) forward compression config to `executeReActKernel()`
- **`kernelMaxIterations` config** — Reflexion: `config.strategies.reflexion.kernelMaxIterations` (default 3); Plan-Execute: `config.strategies.planExecute.stepKernelMaxIterations` (default 2)
- **Real `agentId`/`sessionId`** — Replaces hard-coded `"reasoning-agent"`/`"reasoning-session"` in react-kernel.ts and reactive.ts; execution engine passes `config.agentId` and `taskId`

#### Reflexion Cross-Run Learning (`@reactive-agents/reasoning` + `@reactive-agents/runtime`)

- **`priorCritiques`** — New optional field on `ReflexionInput`; seeds the critique loop from prior episodic memory
- **Critique persistence** — After reflexion completes, critiques stored to episodic memory tagged `["reflexion", "critique", taskType]`

#### Hallucination Detection Layer (`@reactive-agents/verification`)

New verification layer for catching fabricated claims:

- **`extractClaims(text)`** — Heuristic sentence-level claim extraction with confidence classification (certain/likely/uncertain)
- **`checkHallucination(response, source, threshold?)`** — Keyword overlap verification, passes if rate ≤ 10%
- **`checkHallucinationLLM(response, source, llm, threshold?)`** — LLM-based claim extraction + verification, falls back to heuristic
- **Verification pipeline integration** — Wired as optional layer via `enableHallucinationDetection` config flag

#### `@reactive-agents/testing` — New Package

Reusable test infrastructure for agent testing:

- **`createMockLLM(rules)`** — Ordered rule matching with call tracking
- **`createMockLLMFromMap(responses)`** — Simple key→response mapping
- **`createMockToolService(toolResults)`** — Records calls, returns configured results
- **`createMockEventBus()`** — Captures published events for assertion
- **`assertToolCalled()`**, **`assertStepCount()`**, **`assertCostUnder()`** — Test assertion helpers

### Changed

- `@reactive-agents/reasoning`: All strategy input types (`ReactiveInput`, `ReflexionInput`, `PlanExecuteInput`, `TreeOfThoughtInput`, `AdaptiveInput`) now include `agentId?`, `sessionId?`, `resultCompression?`
- `@reactive-agents/reasoning`: `ReasoningService.execute` params extended with `taskId`, `resultCompression`, `agentId`, `sessionId`
- `@reactive-agents/verification`: `VerificationConfigSchema` extended with `enableHallucinationDetection`, `hallucinationThreshold`

#### Shared Reasoning Kernel (`@reactive-agents/reasoning`)

Extracted a shared execution primitive and utility library from the 5 reasoning strategy files:

- **`shared/react-kernel.ts`** — `executeReActKernel()` — the ReAct Think→Act→Observe loop extracted from `reactive.ts` and parameterized for reuse by all strategies. Accepts `priorContext`, `availableToolSchemas`, `maxIterations`, `contextProfile`, `resultCompression`, `taskId`, `parentStrategy`.
- **`shared/tool-utils.ts`** — `parseToolRequest`, `parseAllToolRequests`, `hasFinalAnswer`, `extractFinalAnswer`, `evaluateTransform`, `formatToolSchemas`, `compressToolResult` (consolidated from reactive.ts + kernel copy)
- **`shared/quality-utils.ts`** — `isSatisfied`, `isCritiqueStagnant`, `parseScore`
- **`shared/context-utils.ts`** — `buildCompactedContext`, `formatStepForContext`
- **`shared/service-utils.ts`** — `resolveStrategyServices`, `compilePromptOrFallback`, `publishReasoningStep`
- **`shared/step-utils.ts`** — `makeStep`, `buildStrategyResult`
- **`shared/index.ts`** — barrel export for entire shared layer

#### Tool Awareness for All Strategies

All 5 strategies are now tool-aware:

- **Reflexion** — generation and improvement passes call `executeReActKernel`; critique pass stays pure LLM
- **Plan-Execute** — each plan step runs through the kernel (`maxIterations: 2` per step)
- **Tree-of-Thought** — Phase 2 execution (best-path follow-through) replaced with single kernel call
- **Adaptive** — threads `availableToolSchemas` to all dispatched sub-strategies
- **Reactive** — unchanged algorithm; private duplicates removed, shared imports added

#### New Input Fields

`availableToolSchemas?: readonly ToolSchema[]` added to `ReflexionInput`, `PlanExecuteInput`, `TreeOfThoughtInput`, `AdaptiveInput`.

- `@reactive-agents/reasoning`: `reactive.ts` — removed private duplicates (`hasFinalAnswer`, `extractFinalAnswer`, `parseToolRequest*`, `formatStepForContext`, `buildCompactedContext`, `compilePromptOrFallback`, local `ToolSchema`/`ToolParamSchema`), replaced with shared imports. Re-exports `evaluateTransform` and `parseToolRequestWithTransform` for backwards compat.
- `@reactive-agents/reasoning`: `reflexion.ts`, `plan-execute.ts`, `tree-of-thought.ts` — removed local copies of `isSatisfied`, `isCritiqueStagnant`, `compilePromptOrFallback`, `buildResult`; all `tot*` duplicate parsing functions removed.
- `@reactive-agents/reasoning`: `adaptive.ts` — replaced boilerplate with shared utils.
- `compressToolResult` + `nextToolResultKey` consolidated into `shared/tool-utils.ts` — previously live in `reactive.ts` and duplicated in `react-kernel.ts`.

---

## [0.5.6] — 2026-02-28

### Added

#### Agent Gateway (`@reactive-agents/gateway`) — New Package

Persistent autonomous agent harness that runs agents as long-lived services with deterministic infrastructure:

- **GatewayService** — central orchestrator with policy-driven event processing, stats tracking, and state management
- **PolicyEngine** — composable policy chain (sorted by priority, first non-null decision wins) with 4 built-in policies:
  - **AdaptiveHeartbeat** — skip ticks when agent state unchanged (3 modes: always, adaptive, conservative)
  - **CostBudget** — daily token budget enforcement with critical-priority bypass
  - **RateLimit** — hourly action cap with critical-priority bypass
  - **EventMerging** — deduplicate events sharing the same merge key
- **SchedulerService** — zero-dependency cron parser (5-field standard syntax with steps, ranges, day names), heartbeat/cron event factories
- **WebhookService** — route-based dispatch with signature validation adapters:
  - **GitHub adapter** — HMAC-SHA256 signature validation via `crypto.createHmac` + `timingSafeEqual`
  - **Generic adapter** — configurable signature header/algorithm for arbitrary webhook sources
- **InputRouter** — routes events through policies, publishes `GatewayEventReceived` and `ProactiveActionSuppressed` to EventBus
- **10 new EventBus event types**: `GatewayStarted`, `GatewayStopped`, `GatewayEventReceived`, `ProactiveActionInitiated`, `ProactiveActionCompleted`, `ProactiveActionSuppressed`, `PolicyDecisionMade`, `HeartbeatSkipped`, `EventsMerged`, `BudgetExhausted`
- **Builder integration**: `.withGateway(options?)` on `ReactiveAgentBuilder`, wired through `createRuntime()`
- **Design philosophy**: "Harness vs Horse" — deterministic infrastructure handles event routing without LLM calls; LLM only invoked when intelligence is genuinely needed

### Changed

- `@reactive-agents/core` 0.5.5 → 0.5.6: 10 new gateway event variants in `AgentEvent` union
- `@reactive-agents/runtime` 0.5.5 → 0.5.6: `.withGateway()` builder method, `enableGateway`/`gatewayOptions` in `RuntimeOptions`

### Stats
- 1001 tests across 139 files (was 909/124 in v0.5.5, +92 new tests)
- 18 packages (was 17)

---

## [0.5.5] — 2026-02-27

### Added

#### Full Real-Time EventBus Coverage (`@reactive-agents/core`, `@reactive-agents/runtime`, `@reactive-agents/reasoning`, `@reactive-agents/guardrails`, `@reactive-agents/memory`)

**New event types in `AgentEvent` union:**
- **`AgentStarted`** — emitted before Phase 1 (BOOTSTRAP) with `taskId`, `agentId`, `provider`, `model`, `timestamp`
- **`AgentCompleted`** — emitted in the COMPLETE phase with `totalIterations`, `totalTokens`, `durationMs`
- **`LLMRequestStarted`** — emitted before each `llm.complete()` call in the direct-LLM path; shares `requestId` with the existing `LLMRequestCompleted` for request correlation
- **`FinalAnswerProduced`** — emitted when a reasoning strategy reaches its final answer, with `strategy`, `answer`, `iteration`, `totalTokens`
- **`GuardrailViolationDetected`** — emitted before `GuardrailViolationError` is thrown, with the `violations` array, `score`, and `blocked: true`

**Previously defined but never emitted — now wired:**
- `ExecutionHookFired` — emitted after each lifecycle hook fires (`timing: "before"` | `"after"`)
- `ExecutionCancelled` — emitted before the `ExecutionError` fail when a task is cancelled
- `AgentPaused` / `AgentResumed` — emitted from `KillSwitchService.pause()` and `.resume()`
- `AgentStopped` — emitted when `stop()` is confirmed in `checkLifecycle`
- `MemoryBootstrapped` — emitted from `MemoryServiceLive.bootstrap()` after context is loaded
- `MemoryFlushed` — emitted from `MemoryServiceLive.flush()` after memory.md is written

**taskId correlation bug fixed:**
- All 5 reasoning strategies (`reactive`, `plan-execute`, `tree-of-thought`, `reflexion`, `adaptive`) hardcoded their own name as the `taskId` in `ReasoningStepCompleted` events, making cross-event correlation impossible
- Added `readonly taskId?: string` to all 5 strategy input interfaces
- Execution engine now passes `taskId: ctx.taskId` to `ReasoningService.execute()`
- All emit sites now use `input.taskId ?? "strategyName"` (safe fallback)

#### Professional Metrics Dashboard (`@reactive-agents/observability`, `@reactive-agents/runtime`)

Agents with observability enabled now render a structured execution summary on completion:

- **`MetricsCollector`** — auto-subscribed to EventBus `ToolCallCompleted` events via `MetricsCollectorLive` layer; no manual instrumentation required
- **`formatMetricsDashboard(metrics)`** — renders a 4-section dashboard:
  - **Header card** — overall status, total duration, step count, tokens, estimated cost (~$0.003/1M tokens), model name
  - **Execution timeline** — per-phase duration with percentage of total time; ⚠️ icons for phases ≥10s
  - **Tool execution summary** — grouped by tool name: success count, error count, average duration
  - **Alerts & insights** — smart warnings about bottlenecks, high iteration counts, tool failures (only shown when relevant)
- **`exportMetrics()`** — prints the formatted dashboard to stdout; wired into `ConsoleExporter.flush()`
- **Tool execution tracking** — `ExecutionEngine` records each tool call with name, duration, and success/error status into `MetricsCollector`
- **20 new tests** across metrics collector, dashboard formatter, and wiring

#### Reasoning Strategy Fixes (`@reactive-agents/reasoning`, `@reactive-agents/runtime`)

- **`defaultStrategy` wired end-to-end** — `.withReasoning({ defaultStrategy: "plan-execute" })` now correctly propagates through `RuntimeOptions` → `ReactiveAgentsConfig` → `ReasoningService.execute()` → strategy selection; was previously silently ignored
- **Tree-of-Thought plan-then-execute** — ToT now uses a two-phase approach: BFS planning generates the thought tree, then the best branch is executed via ReAct tool loop; replaces naive single-pass synthesis
- **Adaptive routing connected** — `adaptive.enabled` flag now gates delegation to sub-strategies; previously the flag existed in config but was never checked
- **ToT score parsing robustness** — score extraction regex updated to handle thinking-mode LLM outputs that wrap scores in XML tags or extra whitespace

#### Tool Result Compression (`@reactive-agents/reasoning`, `@reactive-agents/tools`, `@reactive-agents/runtime`)

Replaces blind `head+tail` truncation with structured, accurate compression for large tool results:

- **`compressToolResult(result, toolName, budget, previewItems)`** — detects JSON arrays, JSON objects, and plain text; generates compact structured previews that fit within budget
  - JSON arrays: shows item count, flattened schema (top-level + one-level-deep keys), and first N items as compact `key=val` rows
  - JSON objects: shows top-level keys with values (strings truncated to 60 chars, nested objects shown as `{...}`)
  - Plain text: shows first N lines with total line count
- **Scratchpad overflow store** — full result auto-stored in per-execution `Map<string, string>` under `_tool_result_N` key; agent can retrieve via `scratchpad-read("_tool_result_N")`
- **`scratchpad-read` short-circuit** — when agent calls `scratchpad-read("_tool_result_N")`, the execution engine intercepts before hitting the tool and returns the stored value directly
- **Pipe transform syntax** — `ACTION: tool(args) | transform: <js-expr>` evaluated in-process via `new Function("result", ...)` so only the transform output enters context; falls back to standard preview on error
- **`ResultCompressionConfig`** type in `@reactive-agents/tools` — `{ budget?, previewItems?, autoStore?, codeTransform? }` — user-configurable on `.withTools({ resultCompression: {...} })`
- **ReAct prompt updated** — explains `[STORED: ...]` format and `| transform:` syntax so models know how to use both mechanisms
- **15 new tests** in `packages/reasoning/tests/strategies/reactive-compression.test.ts` covering preview generation, pipe parsing, transform evaluation, and wiring

#### MCP Streamable-HTTP Transport (`@reactive-agents/tools`)

- **`streamable-http` transport type** — new MCP transport mode that connects to remote MCP servers over HTTP with streaming support (complements existing `stdio` and `sse` transports)
- **Headers, env, and cwd support** — `MCPServerConfig` extended with `headers?: Record<string, string>`, `env?: Record<string, string>`, and `cwd?: string` for full subprocess and remote server configuration
- **Spec compliance** — MCP tool discovery and invocation now follows the MCP 1.0 spec more strictly; `tools/call` result handling updated to extract text content from structured response parts

#### Examples Suite (`apps/examples`)

- **21 runnable examples** organized into 5 categories: `foundations/`, `tools/`, `multi-agent/`, `trust/`, `advanced/`, `interaction/`
- **Unified `index.ts` runner** — `bun run index.ts [category] [--live]` runs all or filtered examples; `--live` mode uses real LLM providers
- **Category READMEs** — each category has a README explaining the examples and prerequisites
- **New examples added**:
  - `tools/05-builtin-tools`, `tools/06-mcp-filesystem`, `tools/07-mcp-github`
  - `multi-agent/08-a2a-protocol`, `multi-agent/09-orchestration`, `multi-agent/10-dynamic-spawning`
  - `trust/11-identity`, `trust/12-guardrails`, `trust/13-verification`
  - `advanced/14-cost-tracking` through `advanced/18-self-improvement`
  - `reasoning/19-react`, `reasoning/20-plan-execute`, `interaction/21-interaction-modes`

### Fixed

- **`scratchpad-read` bare string arg** — calling `scratchpad-read("_tool_result_1")` now correctly resolves the key; previously fell back to `args.key` which was `undefined` on a string value
- **Pipe transform line boundary** — transform expression no longer captures trailing newlines or subsequent text when the model writes multi-line thoughts
- **Cost-route model routing** — `complexity-router` now correctly selects model tiers for non-Anthropic providers (OpenAI, Gemini, Ollama, LiteLLM); was previously defaulting to Anthropic model names for all providers
- **MCP connections scope** — MCP server connections are now established inside `Layer.effectDiscard` scope so they are properly torn down and re-established on each `agent.run()` call

### Changed

- `@reactive-agents/core` 0.2.0 → 0.5.5: typed `EventBus.on<T>()`, 5 new event types, `AgentEventTag` and `TypedEventHandler<T>` exports
- `@reactive-agents/cost` 0.2.0 → 0.5.5: complexity-router model routing fix for non-Anthropic providers
- `@reactive-agents/guardrails` 0.1.0 → 0.5.5: `GuardrailViolationDetected` event emission wired
- `@reactive-agents/identity` 0.1.0 → 0.5.5: `MemoryBootstrapped` / `MemoryFlushed` event wiring (via memory service)
- `@reactive-agents/llm-provider` 0.5.0 → 0.5.5: `LLMRequestStarted` event emission in direct-LLM path
- `@reactive-agents/memory` 0.1.0 → 0.5.5: emits `MemoryBootstrapped` from `bootstrap()` and `MemoryFlushed` from `flush()`
- `@reactive-agents/observability` 0.2.0 → 0.5.5: `MetricsCollector`, `formatMetricsDashboard()`, `exportMetrics()`, tool execution tracking
- `@reactive-agents/prompts` 0.1.0 → 0.5.5: no API changes; version aligned to release
- `@reactive-agents/reasoning` 0.5.1 → 0.5.5: strategy fixes (defaultStrategy, ToT plan-then-execute, adaptive routing, score parsing), tool result compression, taskId correlation
- `@reactive-agents/runtime` 0.5.4 → 0.5.5: metrics wiring, MCP scope fix, execution engine tool tracking
- `@reactive-agents/tools` 0.4.1 → 0.5.5: `ResultCompressionConfig`, streamable-http MCP transport, headers/env/cwd in `MCPServerConfig`
- `@reactive-agents/verification` 0.2.0 → 0.5.5: no API changes; version aligned to release
- `reactive-agents` meta-package 0.5.2 → 0.5.5
- `@reactive-agents/cli` 0.5.4 → 0.5.5

### Stats
- 909 tests across 124 files (was 855/120 in v0.5.3, +54 new tests)
- 21 example apps across 6 categories

---

## [0.5.3] — 2026-02-25

### Added

#### Real Ed25519 Cryptography (`@reactive-agents/identity`)
- **`crypto.subtle.generateKey("Ed25519")`** — real asymmetric key generation for agent certificates, replacing placeholder key stubs
- **Signature verification** — `crypto.subtle.sign()` / `crypto.subtle.verify()` used for certificate authentication
- **SHA-256 fingerprints** — certificate fingerprints computed via `crypto.subtle.digest("SHA-256")` over the DER-encoded public key

#### LiteLLM Provider (`@reactive-agents/llm-provider`)
- **5th LLM provider adapter**: `packages/llm-provider/src/providers/litellm.ts` — connects to any LiteLLM proxy endpoint, unlocking 100+ model backends (OpenAI-compatible format)
- Builder: `.withProvider("litellm")` — requires `LITELLM_BASE_URL` env var (e.g., `http://localhost:4000`)
- Full tool calling, streaming, and structured output support via the LiteLLM OpenAI-compatible API

#### Kill Switch & Lifecycle Control (`@reactive-agents/guardrails`)
- **`KillSwitchService`** — per-agent and global halt capability with full lifecycle control API:
  - `trigger(agentId, reason)` — hard stop at next phase boundary
  - `triggerGlobal(reason)` — halt all agents globally
  - `pause(agentId)` / `resume(agentId)` — suspend and resume execution at phase boundaries
  - `stop(agentId, reason)` — graceful stop (completes current phase, then exits)
  - `terminate(agentId, reason)` — immediate termination
  - `getLifecycle(agentId)` — query current state: `"running" | "paused" | "stopping" | "terminated" | "unknown"`
  - `waitIfPaused(agentId)` — used by execution engine to block at phase boundaries when paused
- Builder: `.withKillSwitch()` — wires `KillSwitchService` and exposes `agent.pause()`, `agent.resume()`, `agent.stop()`, `agent.terminate()` on the `ReactiveAgent` facade
- `guardedPhase()` wrapper — every execution phase is wrapped to check kill switch state before entering
- Emits `AgentPaused` / `AgentResumed` / `AgentStopped` events to EventBus when wired

#### Behavioral Contracts (`@reactive-agents/guardrails`)
- **`.withBehavioralContracts(contract)`** builder method — enforces typed behavioral boundaries:
  - `deniedTools: string[]` — tool names the agent may never call
  - `allowedTools: string[]` — if set, only these tools may be called (whitelist)
  - `maxIterations: number` — per-contract iteration cap that cannot be overridden at runtime
- Contract violations throw `BehavioralContractError` at the guardrail phase before the LLM executes

#### Code Sandbox via Subprocess (`@reactive-agents/tools`)
- **`Bun.spawn()` isolation** in `packages/tools/src/skills/code-execution.ts` — code snippets now execute in a subprocess with `cwd: "/tmp"` and a minimal environment (`PATH` only, no inherited secrets)
- Replaces the previous `new Function()` eval approach; prevents environment variable leakage and file system escapes

#### Multi-Source Verification (`@reactive-agents/verification`)
- **Real LLM claim extraction + Tavily search** in `packages/verification/src/layers/multi-source.ts` — the Multi-Source verification layer now extracts factual claims from the output via LLM, then cross-references each claim with a Tavily web search
- Previously documented as "not fully implemented"; now functional when `TAVILY_API_KEY` is set

#### Prompt A/B Experiment Framework (`@reactive-agents/prompts`)
- **`ExperimentService`** in `packages/prompts/src/services/experiment-service.ts` — structured A/B testing for prompt variants
- Define experiments with variant groups, traffic splits, and success metrics; `ExperimentService.assign()` deterministically routes requests to variants; `ExperimentService.record()` logs outcomes for analysis

#### Cross-Task Self-Improvement (`@reactive-agents/runtime`, `@reactive-agents/reasoning`)
- **`StrategyOutcome` episodic logging** — after each completed task, strategy name, task description, outcome (success/failure), and step count are logged as episodic memories
- **`.withSelfImprovement()`** builder method — enables outcome logging and retrieves relevant past strategy outcomes at bootstrap to bias strategy selection on similar future tasks

#### Integration Scenarios
- **S14** (`test.ts`) — code sandbox env isolation: verifies spawned code processes cannot read `ANTHROPIC_API_KEY` from the environment
- **S15** (`test.ts`) — self-improvement two-run scenario: second run on similar task uses fewer iterations than first run, validated via episodic memory retrieval

### Changed
- `@reactive-agents/identity` 0.5.2 → 0.5.3: real Ed25519 key generation and signature verification
- `@reactive-agents/llm-provider` 0.5.0 → 0.5.3: LiteLLM adapter (5th provider)
- `@reactive-agents/guardrails` 0.5.2 → 0.5.3: KillSwitchService, BehavioralContractError, `.withKillSwitch()` / `.withBehavioralContracts()`
- `@reactive-agents/tools` 0.5.1 → 0.5.3: Bun.spawn subprocess isolation in code-execute handler
- `@reactive-agents/verification` 0.5.2 → 0.5.3: functional Multi-Source layer with LLM + Tavily
- `@reactive-agents/prompts` 0.2.0 → 0.5.3: ExperimentService
- `@reactive-agents/runtime` 0.5.2 → 0.5.3: `.withSelfImprovement()` builder method, StrategyOutcome logging
- `@reactive-agents/reasoning` 0.5.1 → 0.5.3: StrategyOutcome type, episodic outcome logging

### Stats
- 855 tests across 120 files (was 812/116 in v0.5.2, +43 new tests)
- 2 new integration scenarios: S14 (code sandbox), S15 (self-improvement)

---

## [0.5.2] — 2026-02-24

### Added

#### Agent Persona / Steering API (`@reactive-agents/runtime`, `@reactive-agents/reasoning`, `@reactive-agents/tools`)

- **`AgentPersona` Interface** — Structured alternative to raw system prompts. Fields: `name?`, `role?`, `background?`, `instructions?`, `tone?` — all optional.
- **`.withPersona(persona)` Builder Method** — Enables steerable, type-safe behavior configuration for main agents. Personas are composed into system prompt sections.
- **Persona Composition** — When both persona and systemPrompt are set, persona comes first (`${personaPrompt}\n\n${systemPrompt}`), allowing layered behavior guidance.
- **Subagent Personas** — Static subagents (`.withAgentTool()`) and dynamic subagents (`spawn-agent` tool) now accept persona configuration. Parent agents can dynamically generate persona parameters (`role`, `instructions`, `tone`) to steer specialized subagents at runtime.
- **Enhanced `spawn-agent` Tool** — New tool parameters enable parent agents to specify subagent personas: `role` (e.g., "Data Analyst"), `instructions` (e.g., "Focus on accuracy"), `tone` (e.g., "professional").

#### Critical Bug Fix: System Prompt Forwarding in Reasoning Path
- **Bug**: When `enableReasoning: true`, custom systemPrompt (from `.withSystemPrompt()` or composed persona) was silently ignored by all reasoning strategies (ReAct, Plan-Execute, Tree-of-Thought, Reflexion, Adaptive).
- **Root Cause**: ReasoningService had no mechanism to pass systemPrompt to strategies; each strategy hardcoded its own default fallback.
- **Fix** (6 files):
  1. Added `systemPrompt?: string` to `ReasoningService.execute()` params
  2. Added `systemPrompt?: string` to `StrategyFn` type in strategy-registry
  3. Updated all 5 strategy input types to include `systemPrompt?`
  4. Updated all 5 strategies to use `input.systemPrompt` in fallback when available
  5. Updated execution-engine to pass `config.systemPrompt` to reasoning execute
  6. Fixed Context.GenericTag type in execution-engine to include systemPrompt

### Changed
- `@reactive-agents/runtime` 0.5.1 → 0.5.2: AgentPersona type, `.withPersona()` method, persona composition, subagent persona support
- `@reactive-agents/reasoning` 0.5.0 → 0.5.1: ReasoningService params include systemPrompt, all strategies accept and use systemPrompt
- `@reactive-agents/tools` 0.4.0 → 0.4.1: SubAgentConfig includes persona, spawn-agent tool has role/instructions/tone parameters

### Stats
- 812 tests across 116 files (was 804/114 in v0.5.1, +8 new tests)
- 2 new test files: `persona.test.ts`, `subagent-persona.test.ts`

---

## [0.5.1] — 2026-02-24

### Added

#### Context Engineering Revolution (`@reactive-agents/reasoning`, `@reactive-agents/tools`, `@reactive-agents/runtime`)

- **Structured Tool Observations** (`ObservationResult`) — Typed replacement for `startsWith("✓")` string checks. Every tool result now carries `{ success, toolName, category, resultKind, preserveOnCompaction }`. Categories: `file-write`, `file-read`, `web-search`, `http-get`, `code-execute`, `agent-delegate`, `scratchpad`, `custom`, `error`.
- **Model Context Profiles** — Four model tiers (`local`, `mid`, `large`, `frontier`) each with calibrated thresholds: compaction frequency, full-detail window, tool result size limits, rules complexity, prompt verbosity, and tool schema detail. Builder API: `.withContextProfile({ tier: "local" })`.
- **Context Budget System** — `allocateBudget()` dynamically allocates token budget per section (system prompt, tool schemas, memory, step history, rules). Budget tracks usage per iteration and adapts aggressiveness as tasks progress.
- **Real Sub-Agent Tool** — `.withAgentTool(name, config)` now spawns real sub-runtimes (clean context, focused task, structured `SubAgentResult` summary capped at 1500 chars). Depth-limited to `MAX_RECURSION_DEPTH=3`. Previously this was a stub.
- **Scratchpad Built-in Tool** — Two new built-in tools: `scratchpad-write(key, content)` and `scratchpad-read(key?)`. Persistent notes outside the context window — survives compaction. Total built-in tools: 7 (was 5).
- **Progressive Context Compaction** — Four-level compaction: full detail → one-line summary → grouped sequence → dropped. Uses `ObservationResult.preserveOnCompaction` to protect error steps and important observations. Budget-adaptive: escalates level under pressure.
- **Prompt Template Variants** — Tier-aware prompt resolution: compiles `${templateId}:${tier}` first, falls back to base template. New templates: `react-system:local` (ultra-lean), `react-system:frontier` (rich guidance), `react-thought:local`, `react-thought:frontier`.

#### New Exports (`@reactive-agents/reasoning`)
- `ModelTier`, `ContextProfileSchema`, `ContextProfile`, `CONTEXT_PROFILES`, `mergeProfile`, `resolveProfile`
- `ContextBudgetSchema`, `ContextBudget`, `allocateBudget`, `estimateTokens`, `wouldExceedBudget`, `trackUsage`
- `ObservationResult`, `ObservationResultSchema`, `ObservationCategory`, `ResultKind`, `categorizeToolName`, `deriveResultKind`
- Progressive compaction utilities: `formatStepFull`, `formatStepSummary`, `shouldPreserve`, `clearOldToolResults`, `groupToolSequences`, `progressiveSummarize`

#### Dynamic Sub-Agent Spawning (`@reactive-agents/tools`, `@reactive-agents/runtime`)

- **`withDynamicSubAgents(options?)`** builder method — registers the built-in `spawn-agent` tool, enabling the model to delegate subtasks to ad-hoc sub-agents at runtime without pre-configured named agent tools
- **`createSpawnAgentTool()`** exported from `@reactive-agents/tools` — constructs the `spawn-agent` ToolDefinition with parameters: `task` (required), `name?`, `model?`, `maxIterations?`
- Sub-agents receive a clean context window with no parent history; inherit parent's provider and model by default
- Depth-guarded at `MAX_RECURSION_DEPTH = 3`; spawned sub-agents do not receive `spawn-agent` by default, naturally containing recursion
- Tool result routed through the `agent-delegate` observation category (same as `.withAgentTool()`)
- **test.ts S13** scenario added for dynamic spawn; 12/12 pass (7.7 avg steps, 2,366 avg tokens, 4.8s avg)
- Total built-in tools: **8** (was 7)

#### New Exports (`@reactive-agents/tools`)
- `SubAgentConfig`, `SubAgentResult`, `createSubAgentExecutor`
- `scratchpadWriteTool`, `scratchpadReadTool`, `makeScratchpadStore`, `makeScratchpadWriteHandler`, `makeScratchpadReadHandler`
- `createSpawnAgentTool`

#### Type Safety
- Replaced all `as any` casts introduced by context engineering with specific types: branded `Task`/`TaskResult` via `generateTaskId()`/`Schema.decodeSync(AgentId)()`, `Partial<ContextProfile>` replacing `unknown`, typed `RemoteAgentClient` parameters, narrow service interface assertions for dynamic ToolService access.
- `ReactiveAgent` engine type updated from `(task: any) => Effect<any, any>` to properly typed `(task: Task) => Effect<TaskResult, RuntimeErrors | TaskError>`.
- `contextProfile` in config schema updated from `Schema.Unknown` to `Schema.partial(ContextProfileSchema)`.

### Changed
- `@reactive-agents/reasoning` 0.4.0 → 0.5.0: context engineering types, profiles, budget, compaction, observation result
- `@reactive-agents/tools` 0.3.0 → 0.4.0: sub-agent executor, scratchpad tools, spawn-agent tool (8 built-ins)
- `@reactive-agents/runtime` 0.5.0 → 0.5.1: `.withContextProfile()` builder method, real sub-agent wiring, type safety
- `@reactive-agents/prompts` 0.1.0 → 0.2.0: tier-aware variant resolution, 4 new tier-specific templates

### Fixed
- Fixed Layer scope bug where `withAgentTool()` and `withDynamicSubAgents()` tool registrations were lost between `build()` and `run()` calls — agent and spawn-agent tools are now always available on every `run()` call by composing registrations as `Layer.effectDiscard` baked into the runtime layer so they re-run on every scope evaluation

### Stats
- 804 tests across 114 files (was 720/106 in v0.5.0, +84 new tests)
- 7 new test files: `observation.test.ts`, `context-profile.test.ts`, `context-budget.test.ts`, `compaction.test.ts`, `sub-agent.test.ts`, `scratchpad.test.ts`, `prompt-variants.test.ts`
- Verified with real Ollama agent (cogito:14b): 8/9 scenarios pass, avg 6.4 steps, 2,093 tokens, 4.4s

---

## [0.5.0] — 2026-02-23

### Added

#### A2A Protocol Package (`@reactive-agents/a2a` 0.1.0) — NEW
- **Full A2A (Agent-to-Agent) protocol implementation** based on Google's A2A specification
- **Agent Card** — `generateAgentCard()` pure function produces A2A-compliant Agent Cards with skills, capabilities, and provider metadata; `toolsToSkills()` maps tool definitions to `AgentSkill[]`
- **JSON-RPC 2.0 Server** — `A2AHttpServer` with `Bun.serve()` binding, routes `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`, `agent/card`; serves `GET /.well-known/agent.json` for standard agent discovery
- **Task Handler** — `createTaskHandler()` persists tasks via Effect `Ref`, transitions through `submitted → working → completed/failed` states, extracts text from message parts, stores artifacts on completion
- **SSE Streaming** — `createSSEStream()` produces `ReadableStream` + `Queue` for real-time task updates; `formatSSEEvent()` serializes events with JSON-RPC 2.0 wrapping
- **Client** — `A2AClient` (Effect-TS service) with `sendMessage()`, `getTask()`, `cancelTask()`, `getAgentCard()` via fetch-based JSON-RPC; supports bearer and API key auth
- **Discovery** — `discoverAgent()` tries `/.well-known/agent.json` then falls back to `/agent/card`; `discoverMultipleAgents()` runs up to 5 discoveries concurrently
- **Capability Matcher** — `matchCapabilities()` scores agents by skill ID (10pts), tag overlap (5pts each), input mode (2pts each); `findBestAgent()` returns top-scoring result
- **A2AService** — unified Effect-TS service wrapping both server and client operations
- **Types** — full Schema.Struct types: `AgentCard`, `A2ATask`, `A2AMessage`, `Part` (Text/File/Data), `Artifact`, `TaskState`, `JsonRpcRequest/Response`, `SendMessageParams`, `TaskQueryParams`, `TaskCancelParams`, `A2AServerConfig`
- **Errors** — `A2AError`, `DiscoveryError`, `TransportError`, `TaskNotFoundError`, `TaskCanceledError`, `InvalidTaskStateError`, `AuthenticationError`

#### Agent-as-Tool Pattern (`@reactive-agents/tools` 0.3.0, `@reactive-agents/runtime` 0.5.0)
- **`createAgentTool()`** — wraps a local agent as a `ToolDefinition`
- **`createRemoteAgentTool()`** — wraps a remote A2A client call as a tool with `MAX_RECURSION_DEPTH=3`
- **Builder wiring** — `.withAgentTool(name, config)` and `.withRemoteAgent(name, url)` now register tools via `ToolService` (was placeholder comment)
- Dynamic import of `ToolService` and adapters at build time; remote agents use `fetch`-based JSON-RPC

#### CLI A2A Support (`@reactive-agents/cli` 0.5.0)
- **`rax serve`** — fully functional A2A HTTP server via `Bun.serve()`:
  - `GET /.well-known/agent.json` and `GET /agent/card` for discovery
  - `POST /` JSON-RPC endpoint: `message/send` (runs agent async, returns taskId), `tasks/get`, `tasks/cancel`, `agent/card`
  - In-memory task store, SIGINT/SIGTERM graceful shutdown
  - Configurable: `--port`, `--name`, `--provider`, `--model`, `--with-tools`, `--with-reasoning`, `--with-memory`

#### Test Coverage Hardening (35+ new tests)
- `packages/a2a/tests/a2a-client.test.ts` — 6 tests: JSON-RPC send/get/cancel, discovery, transport errors, error propagation
- `packages/a2a/tests/agent-card.test.ts` — 6 tests: minimal/full config, defaults, toolsToSkills mapping
- `packages/a2a/tests/a2a-service.test.ts` — 6 tests: server integration, JSON-RPC routing, error mapping
- `packages/a2a/tests/integration.test.ts` — 6 tests: send→poll→complete, discovery, capability matching, full pipeline, task cancellation
- `packages/cost/tests/semantic-cache.test.ts` — 11 tests: cache hit/miss, TTL expiration, stats, eviction, case-insensitive matching

#### Example Apps
- `apps/examples/src/04-a2a-agents.ts` — two agents communicating via A2A protocol
- `apps/examples/src/05-agent-composition.ts` — agent-as-tool pattern with coordinator/specialist
- `apps/examples/src/06-remote-mcp.ts` — MCP server configuration (stdio + SSE transports)

#### Real-Time Observability (`@reactive-agents/observability`, `@reactive-agents/runtime`)
- **`withObservability({ verbosity, live, file? })`** — builder now accepts options:
  - `live: true` — each log line written to stdout immediately as it fires, not buffered until flush
  - `verbosity: "minimal" | "normal" | "verbose" | "debug"` — controls log detail level
  - `file?: string` — optional JSONL file exporter path
- **`LiveLogWriter`** — synchronous callback wired into `StructuredLogger` via `Effect.suspend`
- **`makeLiveLogWriter(options?)`** — factory exported from observability package; ANSI colors + timestamps
- **Structured phase logs**: `◉ [bootstrap/strategy/think/act/complete]` at `normal`; `┄ [thought/action/obs/llm/ctx]` at `verbose`/`debug` — streaming live as each step fires
- **`ConsoleExporter`** — ANSI-colored span tree with timing + metrics summary, printed at flush
- **`FileExporter`** — JSONL output with one entry per span/log
- **Tracer correlation IDs** — `withSpan()` propagates `traceId` via `FiberRef`; child spans inherit parent context

#### ThoughtTracer (`@reactive-agents/observability`)
- **`ThoughtTracerService`** — new Effect-TS service that auto-subscribes to `ReasoningStepCompleted` events and exposes `getThoughtChain(strategy)` / `clearChain()`
- **`ThoughtTracerLive`** — wired via `Layer.provideMerge(ThoughtTracerLive, EventBusLive)` pattern

#### EventBus Reasoning Events (`@reactive-agents/reasoning`)
- All 5 strategies (`reactive`, `plan-execute`, `tree-of-thought`, `reflexion`, `adaptive`) publish `ReasoningStepCompleted` via `Effect.serviceOption(EventBus)` after each thought/action/observation step
- No hard dependency — runs gracefully when EventBus is absent from context
- EventBus extended with `on(tag, handler)` method for filtered subscriptions

#### Foundation Hardening
- **Semantic cache embeddings** — `makeSemanticCache(embedFn?)` factory; cosine similarity matching (>0.92 threshold, hash fast path)
- **LLM-based prompt compressor** — `makePromptCompressor(llm?)` factory; heuristic first pass + LLM second pass when over `maxTokens`
- **InteractionManager approval gates** — `approvalGate()` waits async until `resolveApproval()` called; 5-minute timeout
- **WorkflowEngine approval gates** — `requiresApproval` on `WorkflowStep`; `approveStep()` / `rejectStep()` on `OrchestrationService`
- **LLM hook context enrichment** — `lastLLMRequest`, `lastLLMResponse`, `availableTools`, `traceId` in every hook context
- **LLM episodic memory** — LLM calls and tool results logged as episodic memory items during execution
- **Semantic entropy** — both heuristic + LLM-based (paraphrase embeddings) implementations in verification
- **Fact decomposition** — both heuristic + LLM-based (atomic claim extraction + status scoring) in verification
- **Feature contract tests** — 18 tests verifying user-observable behavior (hooks, iterations, tool visibility, stepsCount, tokensUsed, TaskResult shape)

### Changed
- `@reactive-agents/runtime` 0.4.0 → 0.5.0: agent-tool builder wiring, A2A integration, observability verbosity, live streaming wiring
- `@reactive-agents/cli` 0.4.0 → 0.5.0: `rax serve` with real HTTP server
- `@reactive-agents/a2a` 0.1.0: new package
- `@reactive-agents/core` 0.1.0 → 0.2.0: EventBus `on(tag, handler)` method + 6 new event types (LLMRequestCompleted, ToolCallStarted/Completed, ExecutionPhaseCompleted, ReasoningStepCompleted, ExecutionLoopIteration)
- `@reactive-agents/observability` 0.1.0 → 0.2.0: ConsoleExporter, FileExporter, ThoughtTracer, live streaming, verbosity API, tracer correlation IDs
- `@reactive-agents/reasoning` 0.3.0 → 0.4.0: all 5 strategies publish ReasoningStepCompleted events, ReAct prompt hardening (stop sequences, one-action rule, extractFinalAnswer)
- `@reactive-agents/cost` 0.1.0 → 0.2.0: `makeSemanticCache(embedFn?)` and `makePromptCompressor(llm?)` factories
- `@reactive-agents/verification` 0.1.0 → 0.2.0: LLM-based semantic entropy and fact decomposition
- `@reactive-agents/interaction` 0.1.0 → 0.2.0: `approvalGate()` with `resolveApproval()` and 5-minute timeout
- `@reactive-agents/orchestration` 0.1.0 → 0.2.0: `requiresApproval` on WorkflowStep, `approveStep()`/`rejectStep()`
- `@reactive-agents/llm-provider` 0.4.0 → 0.5.0: LLMRequestEvent type + ObservabilityVerbosity field
- Build order: added `@reactive-agents/a2a` to `build:packages` (after orchestration, before runtime)
- `serve.ts` uses lazy `import()` for `@reactive-agents/a2a` to avoid module resolution in non-serve contexts

### Fixed
- CI lockfile: `bun.lock` updated for new `@reactive-agents/a2a` package (was causing `--frozen-lockfile` failures)
- CLI test failures from top-level `@reactive-agents/a2a` import — converted to dynamic `import()` in `serve.ts`
- ReAct `iteration: 0` bug — fixed to start at 1
- `[act]` hook never firing in reasoning path — fixed: action steps extracted post-reasoning, synthetic act/observe phases fired
- `stepsCount: 0` in TaskResult — fixed: reads from reasoning result metadata
- `maxIterations` override silently ignored — `defaultReactiveAgentsConfig` now accepts optional overrides param

### Stats
- 720 tests across 106 files (was 442/77 in v0.4.0)
- 17 packages + 2 apps
- 3 new example apps (6 total)

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
