# Reactive Agents — AI Build Guide

## Project Status

**v0.5.3+ released.** 17 packages + 2 apps built, 884 tests across 122 files, full integration verified with professional metrics dashboard.

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
- Pre-release: tsup compiled output, Google Gemini provider, Reflexion reasoning strategy
- Final Integration: All layers compose via `createRuntime()` and `ReactiveAgentBuilder`
- Docs: Starlight (Astro) site at `apps/docs/`

---

## Build Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests (884 tests, 122 files)
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

---

## v0.5 Active Development

**Current plan:** `spec/docs/14-v0.5-comprehensive-plan.md`

Sprint order: Housekeeping → A2A Core → Agent-as-Tool + MCP → Test Hardening → Builder/DX → Integration + Release

New package: `@reactive-agents/a2a` (JSON-RPC 2.0, Agent Cards, SSE streaming)

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
  eval/          — Evaluation framework (LLM-as-judge, EvalStore)
  a2a/           — [v0.5] A2A protocol: Agent Cards, JSON-RPC server/client, SSE streaming
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
