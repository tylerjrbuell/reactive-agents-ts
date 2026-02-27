# Changelog

All notable changes to Reactive Agents will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — Tool Result Compression

### Added

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

### Fixed

- `scratchpad-read` called with bare string arg (e.g. `"_tool_result_1"`) now correctly resolves the key — previously fell back to `args.key` which was `undefined` on a string value
- Pipe transform expression no longer captures trailing newlines or subsequent text when the model writes multi-line thoughts

---

## [Unreleased] — Sprint 3B: EventBus Groundwork + Kill Switch Lifecycle

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

### Stats
- 864 tests across 121 files (was 855/120 in v0.5.3, +9 new tests from Sprint 3B kill switch lifecycle)

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
