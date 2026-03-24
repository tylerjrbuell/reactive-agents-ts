# Reactive Agents — AI Build Guide

## Project Status

**v0.8.x — Adoption Readiness.** 22 packages + 2 apps built, 2,851 tests across 336 files. Cost optimization: `.withDynamicPricing()`, `openRouterPricingProvider`, cache-aware token discounts. Builder hardening: `withStrictValidation()`, `withTimeout()`, `withRetryPolicy()`, `withCacheTimeout()`, consolidated `withGuardrails()` thresholds, `withErrorHandler()`, `withFallbacks()`, `withLogging()`, `withHealthCheck()`. Strategy switching: `withReasoning({ enableStrategySwitching: true })`. Stream improvements: AbortSignal cancellation, `IterationProgress` event, `StreamCancelled` event, `StreamCompleted.toolSummary`. `ToolBuilder` fluent API. `SessionStoreService` SQLite-backed chat session persistence. `FallbackChain` in `@reactive-agents/llm-provider`. `makeLoggerService()` structured logging with rotation. `expectStream()` streaming test assertions + scenario fixtures. `agent.health()` health probes. `rax create agent --interactive`. Final Answer, Debrief & Chat: `final-answer` meta-tool hard-gates the ReAct loop exit (replaces fragile text regex). `DebriefSynthesizer` post-run service: collects execution signals + one LLM call → structured `AgentDebrief` (summary, key findings, lessons, errors, metrics). `DebriefStore` persists run artifacts to SQLite (`agent_debriefs` table). `AgentResult` enriched with `debrief?`, `format?`, `terminatedBy?`. `agent.chat()` + `agent.session()` for conversational Q&A with adaptive routing (direct LLM for questions, ReAct loop for tool-capable queries). `OutputFormat` + `TerminatedBy` canonical types. Unified `confidence` type (`"high"|"medium"|"low"`). Agent as Data: `AgentConfig` Effect-TS Schema for JSON-serializable agent definitions, `agentConfigToJSON()`/`agentConfigFromJSON()` roundtrip serialization, `agentConfigToBuilder()`/`builder.toConfig()`/`ReactiveAgents.fromConfig()`/`ReactiveAgents.fromJSON()`. Lightweight Composition: `agentFn()` lazy agent primitives, `pipe()`/`parallel()`/`race()` combinators. Dynamic Tool Registration: `agent.registerTool()`/`agent.unregisterTool()` at runtime. Living Intelligence System: Living Skills with agentskills.io SKILL.md compatibility, `SkillStoreService` SQLite-backed skill persistence, `SkillEvolutionService` LLM-based skill refinement with version management, `SkillResolverService` unified skill resolution (SQLite + filesystem), 5-stage skill compression pipeline, context-aware injection guard with tier budgets, `activate_skill` + `get_skill_section` meta-tools, Intelligence Control Surface expanded to 10 mid-run decisions (temp-adjust, skill-activate, prompt-switch, tool-inject, memory-boost, skill-reinject, human-escalate), test model exclusion guards, `.withSkills()` builder API, `agent.skills()`/`exportSkill()`/`loadSkill()`/`refineSkills()` runtime API.

- Phase 1: Core, LLM Provider, Memory, Reasoning, Tools, Interaction, Runtime
- Phase 2: Guardrails, Verification, Cost
- Phase 3: Identity, Observability, Orchestration, Prompts, CLI (`rax`)
- v0.5: A2A Protocol, Agent-as-Tool, MCP transports, test hardening (624 tests)
- Foundation Hardening: Observability exporters, tracer correlation IDs, EventBus wiring, LLM capture, memory accumulation, hook enrichment, semantic cache embeddings, LLM-based compression, workflow approval gates, ThoughtTracer (675 tests)
- Real-Time Observability: live log streaming, verbosity levels, reasoning event publishing, structured phase logs (720 tests)
- Context Engineering: Model-adaptive context system, budget tracking, sub-agent tools, scratchpad, progressive compaction (804 tests)
- Agent Persona / Steering API: Structured behavior control via `.withPersona()`, systemPrompt bug fix for reasoning path, subagent persona support with LLM generation (812 tests)
- Trust & Differentiators: Real Ed25519 crypto, LiteLLM (40+ providers), kill switch, behavioral contracts, subprocess sandbox, multi-source verification, prompt A/B experiments, cross-task self-improvement (855 tests)
- EventBus Groundwork: +5 new event types, taskId correlation through all 5 reasoning strategies, all lifecycle events wired (AgentStarted/Completed, LLMRequestStarted, FinalAnswerProduced, GuardrailViolationDetected, ExecutionHookFired/Cancelled, AgentPaused/Resumed/Stopped, MemoryBootstrapped/Flushed) (864 tests)
- Professional Metrics Dashboard: MetricsCollector auto-subscribed to EventBus, formatMetricsDashboard() renders header card + timeline + tools + alerts, exportMetrics() shows professional CLI output (20 new tests, 884 total)
- Reasoning Strategy Fixes: `defaultStrategy` wired through to execution engine, ToT plan-then-execute (BFS planning → ReAct tool execution), `adaptive.enabled` flag connected, ToT score parsing robustness for thinking-mode LLMs (909 tests)
- Tool Result Compression: `compressToolResult()` replaces blind truncation — structured previews (JSON array/object/text), scratchpad overflow store (`_tool_result_N`), code-transform pipe (`| transform: <expr>`), `ResultCompressionConfig` user-configurable on `.withTools()` (909 tests, 124 files)
- Agent Gateway: Persistent autonomous agent harness — heartbeats (adaptive), crons, webhooks (GitHub adapter), composable policy engine (4 policies), input router with EventBus integration, `.withGateway()` builder API (1001 tests, 139 files)
- Strategy SDK Refactor: Shared ReAct kernel — `executeReActKernel()` extracted from reactive.ts, all 5 strategies tool-aware, 6 shared utility modules (tool-utils, quality-utils, context-utils, service-utils, step-utils, react-kernel) (1116 tests, 156 files)
- Phase A Foundation Fixes: StrategyFn full type threading (resultCompression, contextProfile, agentId/sessionId), reflexion cross-run learning (priorCritiques → episodic memory), hallucination detection verification layer, `@reactive-agents/testing` package with mock services + assertion helpers (1179 tests, 160 files)
- Structured Plan Engine: Plan-execute-reflect rewritten — structured JSON plans, 4-layer structured output pipeline (prompt → repair → validate → retry), provider-adaptive JSON capabilities, SQLite plan persistence (PlanStoreService wired into memory layer), hybrid step dispatch (tool_call direct, analysis single LLM call, composite scoped kernel), Effect.exit error handling, graduated retry → patch → replan, tier-adaptive prompt builders, `{{from_step:sN}}` cross-step references with self-reference guard, ToolCallCompleted EventBus integration, carry-forward refinement with all-steps-completed guard, granular observability events (1241 tests, 168 files)
- Composable Kernel Architecture: ThoughtKernel abstraction — swappable reasoning algorithms, immutable KernelState, universal KernelRunner with centralized KernelHooks, reactive.ts collapsed 905→128 lines, shared tool-execution module, embedded tool call guard, double metrics fix, custom kernel registration via StrategyRegistry (1340 tests, 173 files)
- Agent Streaming: `agent.runStream()` AsyncGenerator with FiberRef-based TextDelta propagation through react-kernel, Queue+forkDaemon stream backend in ExecutionEngine, `AgentStream` adapters (toSSE, toReadableStream, toAsyncIterable, collect), `.withStreaming()` builder option, AgentStreamStarted/Completed EventBus events (1381 tests, 180 files)
- Context Engine & Memory Intelligence: ContextEngine per-iteration scoring, ExperienceStore cross-agent learning, MemoryConsolidatorService background consolidation, context-status + task-complete meta-tools, parallel/chain tool execution, sub-agent auto-scratchpad + iteration cap, `.withExperienceLearning()` + `.withMemoryConsolidation()` builder methods (1735 tests, 211 files)
- Final Answer, Debrief & Chat: `final-answer` hard-gate tool, `DebriefSynthesizer` + `DebriefStore` SQLite persistence, `AgentResult` enriched with `debrief?`/`format?`/`terminatedBy?`, `agent.chat()` + `agent.session()` adaptive conversational interaction (1773 tests, 217 files)
- Adoption Readiness Phases 1–3: Builder hardening (`withStrictValidation`, `withTimeout`, `withRetryPolicy`, `withCacheTimeout`, consolidated `withGuardrails`, `withErrorHandler`, `withFallbacks`, `withLogging`, `withHealthCheck`), strategy switching, AbortSignal stream cancellation, `IterationProgress`/`StreamCancelled` events, `StreamCompleted.toolSummary`, `ToolBuilder` fluent API, `SessionStoreService` SQLite session persistence, `FallbackChain` provider fallbacks, `makeLoggerService()` structured logging, `expectStream()` streaming test assertions + scenario fixtures, `rax create agent --interactive` (1900 tests, 241 files)
- Test Scenario Provider: `withTestScenario(TestTurn[])` replaces `withTestResponses` — sequential turn consumption with text/toolCall/toolCalls/json/error turns, match guards, auto-provider, tool loop testing (2,048 tests, 258 files)
- Reactive Intelligence Layer (Phase 1): Entropy Sensor — 5 entropy sources (token, structural, semantic, behavioral, context pressure), composite scorer with adaptive weights, conformal calibration, trajectory analysis (converging/flat/diverging/v-recovery/oscillating), model registry, `EntropySensorService` Effect-TS service, KernelRunner integration (post-kernel scoring), `.withReactiveIntelligence()` builder API, 65-example validation dataset with accuracy gates (2,091 tests, 274 files)
- Reactive Intelligence Pipeline (Phases 2–4): Reactive Controller (early-stop, context compression, strategy switch), Local Learning Engine (conformal calibration, Thompson Sampling bandit, skill synthesis), Telemetry Client (RunReport, HMAC signing, fire-and-forget POST to api.reactiveagents.dev), EventBus-driven entropy scoring (all strategies), dashboard entropy signals section, telemetry pipeline integration (2,194 tests, 288 files)
- Framework Evolution: Cost Tracking 2.0 (`.withDynamicPricing`, caching multipliers), Agent as Data (`AgentConfig` schema, serialization, builder reconstruction, `toConfig()`/`fromConfig()`/`fromJSON()`), Lightweight Composition (`agentFn`, `pipe`, `parallel`, `race`), Dynamic Tool Registration (`registerTool`/`unregisterTool` on ReactiveAgent facade + ToolService) (2,851 tests, 336 files)
- Living Intelligence System: Living Skills (`SkillRecord`, `SkillStoreService`, `SkillEvolutionService`, `SkillRegistry`, `SkillResolver`, `SkillDistiller`), agentskills.io SKILL.md compatibility, 5-stage skill compression pipeline, context-aware injection guard with tier budgets, `activate_skill` + `get_skill_section` meta-tools, Intelligence Control Surface expanded to 10 decisions (7 new evaluators), test model exclusion guards, RunReport telemetry enrichment, `.withSkills()` builder API, `agent.skills()`/`exportSkill()`/`loadSkill()`/`refineSkills()` runtime API, MemoryConsolidator CONNECT phase wired to skill distillation (2,851 tests, 336 files)
- Pre-release: tsup compiled output, Google Gemini provider, Reflexion reasoning strategy
- Final Integration: All layers compose via `createRuntime()` and `ReactiveAgentBuilder`
- Docs: Starlight (Astro) site at `apps/docs/`

---

## Build Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests (2851 tests, 336 files)
bun run build            # Build all packages (22 packages, ESM + DTS)
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
  .withStrictValidation()                // Throw at build time if required config is missing
  .withTimeout(30_000)                   // 30s execution timeout
  .withRetryPolicy({ maxRetries: 3, backoffMs: 1_000 })  // Retry on transient LLM errors
  .withCacheTimeout(3_600_000)           // Semantic cache TTL (1h)
  .withReasoning({
    enableStrategySwitching: true,       // Auto-switch strategy on loop detection
    maxStrategySwitches: 1,
    fallbackStrategy: "plan-execute-reflect",
  })
  .withGuardrails({                      // Consolidated thresholds (replaces separate params)
    injectionThreshold: 0.8,
    piiThreshold: 0.9,
    toxicityThreshold: 0.7,
  })
  .withFallbacks({                       // Provider/model fallback chain
    providers: ["anthropic", "openai"],
    errorThreshold: 3,
  })
  .withLogging({ level: "info", format: "json", output: "file", filePath: "./agent.log" })
  .withErrorHandler((err, ctx) => {      // Global error callback for logging/monitoring
    console.error("Agent error:", err);
  })
  .withHealthCheck()                     // Enable agent.health() probe
  .withSkills({                          // Living Skills System
    paths: ["./my-skills/"],
    evolution: { mode: "suggest" },
  })
  .withGateway({
    heartbeat: { intervalMs: 1800000, policy: "adaptive" },
    crons: [{ schedule: "0 9 * * MON", instruction: "Review open PRs" }],
    policies: { dailyTokenBudget: 50000 },
  })
  .build();
const result = await agent.run("Hello");
const health = await agent.health();   // { status: "healthy", checks: [...] }

// Streaming — tokens arrive as TextDelta events
const controller = new AbortController();
for await (const event of agent.runStream("Hello", { signal: controller.signal })) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
  if (event._tag === "IterationProgress") console.log(`Step ${event.iteration}/${event.maxIterations}`);
  if (event._tag === "StreamCancelled") console.log("Cancelled");
  if (event._tag === "StreamCompleted") {
    console.log("\nDone!");
    console.log(event.toolSummary); // Array of tool usage summary
  }
}

// Testing — deterministic multi-turn scenarios
const testAgent = await ReactiveAgents.create()
  .withTestScenario([                    // Auto-sets provider to "test"
    { toolCall: { name: "web-search", args: { query: "AI news" } } },
    { text: "Here is the summary." },
  ])
  .withTools({ tools: [myTool] })
  .build();

// Agent as Data — serialize and reconstruct agents
const config = builder.toConfig();                    // Builder → AgentConfig
const json = agentConfigToJSON(config);                // Config → JSON string
const restored = await ReactiveAgents.fromJSON(json); // JSON → Builder

// Composition — functional agent pipelines
import { agentFn, pipe, parallel, race } from "reactive-agents";
const pipeline = pipe(
  agentFn({ name: "researcher", provider: "anthropic" }, b => b.withReasoning().withTools()),
  agentFn({ name: "summarizer", provider: "anthropic" }),
);
const result = await pipeline("Research topic");
await pipeline.dispose();
```

---

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
TAVILY_API_KEY=tvly-...
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
```

---

## Skills Library

Skills in `.claude/skills/` are loaded automatically.

### Reference Skills (auto-loaded as context)
| Skill | What It Provides |
|-------|-----------------|
| `effect-ts-patterns` | Schema.Struct, Data.TaggedError, Context.Tag + Layer.effect, Ref |
| `architecture-reference` | Layer stack, dependency graph, build order, 10-phase ExecutionEngine loop |
| `llm-api-contract` | LLMService.complete()/stream()/embed() signatures, common mistakes |
| `memory-patterns` | bun:sqlite WAL, FTS5, sqlite-vec KNN, Zettelkasten |

### Task Skills (user-invocable)
| Skill | Invocation | Purpose |
|-------|-----------|---------|
| `build-package` | `/build-package <name>` | 10-step package scaffold from spec |
| `validate-build` | `/validate-build <name>` | 10-check quality gate |
| `review-patterns` | `/review-patterns <path>` | 8-category pattern compliance audit |
| `implement-service` | `/implement-service <Name> <pkg>` | 6-step Effect-TS service creation |
| `implement-test` | `/implement-test <pkg-or-service>` | Test creation with bun:test + Effect patterns |
| `build-coordinator` | `/build-coordinator <phase>` | Multi-agent team orchestration for parallel builds |
| `update-docs` | `/update-docs` | Sync Starlight docs, README, CHANGELOG after changes |

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
| `spec/docs/14-v0.5-comprehensive-plan.md` | v0.5 plan: A2A, agent-as-tool, MCP, test hardening |
| `docs/superpowers/specs/2026-03-14-reactive-intelligence-full-pipeline.md` | `@reactive-agents/reactive-intelligence` (Phases 2–4: controller, learning, telemetry) |
| `docs/superpowers/specs/2026-03-14-reactive-telemetry-server.md` | Reactive Telemetry Server (api.reactiveagents.dev) |
| `docs/superpowers/specs/2026-03-23-living-intelligence-system-design.md` | Living Intelligence System (skills, controller expansion, telemetry enrichment) |

---

## Documentation Update Requirements

**After ANY code change**, check if these need updating:

| What Changed | Update Required |
|---|---|
| New package or service | CHANGELOG, README packages table, CLAUDE.md package map, docs site |
| New builder method | README quick start, docs builder-api reference, CLAUDE.md architecture |
| New CLI command | README CLI section, docs CLI reference |
| New/changed test counts | CLAUDE.md build commands, README development section |
| API signature change | All docs examples that reference the changed API |
| New reasoning strategy | README strategies table, docs reasoning guide |
| New provider | README providers table, docs LLM providers page |

See `AGENTS.md` for full workflow instructions.

---

## Package Map

```
packages/
  core/          — EventBus, AgentService, TaskService, types
  llm-provider/  — LLM adapters (Anthropic, OpenAI, Gemini, Ollama, LiteLLM, Test)
  memory/        — Working, Semantic, Episodic, Procedural (bun:sqlite); SessionStoreService for SQLite-backed chat session persistence; SkillStoreService for living skill CRUD; SkillEvolutionService for LLM-based skill refinement + version management
  reasoning/     — ReAct, Plan-Execute, ToT strategies
  tools/         — Tool registry, sandbox, MCP client
  guardrails/    — Injection, PII, toxicity detection
  verification/  — Semantic entropy, fact decomposition, hallucination detection
  cost/          — Complexity routing, budget enforcement
  identity/      — Agent certificates, RBAC
  observability/ — Tracing, metrics, structured logging
  interaction/   — 5 modes, checkpoints, collaboration, preferences
  orchestration/ — Multi-agent workflow engine
  prompts/       — Template engine, built-in prompt library
  runtime/       — ExecutionEngine, ReactiveAgentBuilder, createRuntime
  eval/          — Evaluation framework (LLM-as-judge, EvalStore)
  a2a/           — [v0.5] A2A protocol: Agent Cards, JSON-RPC server/client, SSE streaming
  gateway/       — Persistent autonomous agent harness: heartbeats, crons, webhooks, policy engine
  testing/       — Mock services (LLM, tools, EventBus), assertion helpers, test fixtures
  benchmarks/    — Benchmark suite: 20 tasks × 5 tiers, overhead measurement, report generation
  health/        — Health checks and readiness probes
  reactive-intelligence/ — Entropy Sensor (5 sources), Reactive Controller (10 decisions: early-stop, compression, strategy switch, temp-adjust, skill-activate, prompt-switch, tool-inject, memory-boost, skill-reinject, human-escalate), Learning Engine (calibration, bandit, skill synthesis), Living Skills (SkillRegistry, SkillResolver, SkillDistiller, skill compression, injection guard), Telemetry Client, EventBus-driven entropy subscriber
  evolution/     — [PLANNED v1.1+] Group-Evolving Agents (GEA): strategy evolution, experience sharing
apps/
  cli/           — `rax` CLI (init, create, run, dev, eval, playground, inspect)
  docs/          — Starlight documentation site
  examples/      — Example agent apps
```

---

## Observability Output

Agents with observability enabled display a professional metrics dashboard on completion. The dashboard shows execution status, per-phase timing, tool execution summary, and smart alerts about bottlenecks — all driven by the EventBus without manual instrumentation.

```
┌─────────────────────────────────────────────────────────────┐
│ ✅ Agent Execution Summary                                   │
├─────────────────────────────────────────────────────────────┤
│ Status:    ✅ Success   Duration: 13.9s   Steps: 7          │
│ Tokens:    1,963        Cost: ~$0.003     Model: claude-3.5 │
└─────────────────────────────────────────────────────────────┘

📊 Execution Timeline
├─ [bootstrap]       100ms    ✅
├─ [guardrail]        50ms    ✅
├─ [strategy]         50ms    ✅
├─ [think]        10,001ms    ⚠️  (7 iter, 72% of time)
├─ [act]           1,000ms    ✅  (2 tools)
├─ [observe]         500ms    ✅
├─ [memory-flush]    200ms    ✅
└─ [complete]         28ms    ✅

🔧 Tool Execution (2 called)
├─ file-write    ✅ 3 calls, 450ms avg
└─ web-search    ✅ 2 calls, 280ms avg

⚠️  Alerts & Insights
├─ think phase blocked ≥10s (LLM latency)
├─ 7 iterations needed (complex reasoning)
└─ 💡 Consider: Simpler task prompt or shorter context
```

**Dashboard Sections:**

1. **Header Card** — Overall status, total duration, step count, tokens, estimated cost, and model used
2. **Execution Timeline** — Each phase with duration and percentage of total time; warning icons (⚠️) for phases ≥10s
3. **Tool Execution** — Summary of all tool calls grouped by name, showing success count, error count, and average duration
4. **Alerts & Insights** — Warnings about bottlenecks, token budgets, and optimization tips (only shown when relevant)

**How It Works:**

- **No manual instrumentation** — `MetricsCollector` auto-subscribes to EventBus `ToolCallCompleted` events via `MetricsCollectorLive` layer
- **Phase timing** — `ExecutionEngine` tracks duration of each phase (bootstrap, guardrail, strategy, think, act, observe, memory-flush, verify, audit, complete)
- **Tool tracking** — Tool calls are automatically recorded with name, duration, and success/error status
- **Cost estimation** — Tokens are tracked per execution and converted to estimated USD cost ($0.003 per 1M tokens)
- **Smart alerts** — Phases >10s are highlighted; tool failures shown; iteration count noted if >5 steps

**Builder Integration:**

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withObservability({ verbosity: "normal", live: true })  // Shows dashboard on completion
  .build();
```

**Enabling Dashboard:**

- Dashboard displays automatically when `withObservability()` is enabled
- Set `verbosity: "normal"` or higher to see the formatted output
- `live: true` also streams phase events during execution
- Dashboard respects `VerbosityLevel`: minimal (no dashboard), normal (full dashboard), verbose/debug (dashboard + detailed logs)
