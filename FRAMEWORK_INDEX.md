# Reactive Agents — Framework Index

> Comprehensive system map for agents working in this codebase. Navigate any package in under 10 seconds.

---

## System Map

```
                                    ┌──────────────────┐
                                    │  ReactiveAgents   │  ← Public facade
                                    │  .create().build()│     (reactive-agents)
                                    └────────┬─────────┘
                                             │
                                    ┌────────▼─────────┐
                                    │     Runtime       │  ← 10-phase execution loop
                                    │  ExecutionEngine  │     Builder API, Streaming,
                                    │  AgentBuilder     │     Debrief, Chat/Session
                                    └────────┬─────────┘
                                             │ composes via Effect Layers
               ┌──────────┬─────────┬───────┼───────┬──────────┬───────────┐
               │          │         │       │       │          │           │
          ┌────▼───┐ ┌────▼───┐ ┌───▼──┐ ┌──▼──┐ ┌──▼───┐ ┌───▼────┐ ┌───▼────┐
          │Reasoning│ │ Tools  │ │Memory│ │Guard│ │Verify│ │  Cost  │ │Identity│
          │5 strats │ │9 cap +8│ │4-tier│ │rails│ │halluc│ │ router │ │Ed25519 │
          │ kernel  │ │ +MCP   │ │sqlite│ │ PII │ │NLI   │ │ cache  │ │ RBAC   │
          └────┬───┘ └───┬────┘ └──────┘ └─────┘ └──────┘ └────────┘ └────────┘
               │         │
          ┌────▼─────────▼────┐     ┌──────────┐  ┌──────────┐  ┌──────────┐
          │   LLM Provider    │     │ Observe  │  │  A2A     │  │ Gateway  │
          │ 6 adapters, stream│     │ EventBus │  │ JSON-RPC │  │ crons    │
          │ logprobs, fallback│     │ traces   │  │ SSE      │  │ webhooks │
          └────────┬──────────┘     └──────────┘  └──────────┘  └──────────┘
                   │
          ┌────────▼──────────┐     ┌───────────────────┐
          │      Core         │     │ Reactive Intelli-  │
          │ EventBus, Types   │     │ gence (Sensor,     │
          │ Agent/Task Service│     │ Controller, Learn, │
          └───────────────────┘     │ Telemetry)         │
                                    └───────────────────┘
```

---

## Package Quick-Find

### When you need to... → Go to:

| Task | Package | Entry File |
|------|---------|-----------|
| Understand agent execution flow | `runtime` | `src/execution-engine.ts` (10-phase loop) |
| Add/change builder methods | `runtime` | `src/builder.ts` |
| Fix tool calling behavior | `reasoning` | `src/strategies/kernel/react-kernel.ts` |
| Fix strategy selection | `reasoning` | `src/strategies/adaptive.ts` |
| Fix plan-execute loops | `reasoning` | `src/strategies/plan-execute.ts` |
| Fix loop detection | `reasoning` | `src/strategies/kernel/kernel-runner.ts` |
| Change entropy scoring | `reactive-intelligence` | `src/sensor/entropy-sensor-service.ts` |
| Add model to registry | `reactive-intelligence` | `src/calibration/model-registry.ts` |
| Fix LLM provider behavior | `llm-provider` | `src/providers/{name}.ts` |
| Fix streaming | `llm-provider` | `src/providers/local.ts` (Ollama) |
| Add/change tool | `tools` | `src/skills/{name}.ts` |
| Fix MCP integration | `tools` | `src/mcp/mcp-client.ts` |
| Fix EventBus events | `core` | `src/services/event-bus.ts` |
| Add event type | `core` | `src/types/events.ts` |
| Fix memory persistence | `memory` | `src/runtime.ts` |
| Fix debrief content | `runtime` | `src/debrief.ts` |
| Fix metrics dashboard | `observability` | `src/services/metrics-collector.ts` |
| Fix agent chat/session | `runtime` | `src/chat.ts` |

---

## Reasoning Layer — Kernel Architecture

The reasoning layer is the most complex subsystem. All 5 strategies share a common kernel.

```
                   executeAdaptive()
                        │ classifies task
            ┌───────────┼───────────┬─────────────┐
            ▼           ▼           ▼             ▼
    executeReactive  executePlanExecute  executeReflexion  executeTreeOfThought
            │           │                   │                   │
            │     ┌─────┴──────┐            │                   │
            │     │ Structured │            │                   │
            │     │ Plan Engine│            │                   │
            │     │ (plan→exec │            │                   │
            │     │  →reflect) │            │                   │
            │     └─────┬──────┘            │                   │
            │           │                   │                   │
            └───────────┼───────────────────┼───────────────────┘
                        ▼
               runKernel(reactKernel, input, options)    ← kernel-runner.ts
                        │
                  ┌─────┼───────────────────┐
                  │  Per-iteration loop:     │
                  │  1. kernel(state, ctx)   │ ← react-kernel.ts (Think→Act→Observe)
                  │  2. Entropy scoring      │ ← EntropySensorService
                  │  3. Early exit check     │ ← exitOnAllToolsCalled
                  │  4. Loop detection       │ ← circuit breaker (3 patterns)
                  │  5. Strategy switching   │ ← fallback strategy dispatch
                  └─────────────────────────┘
```

### Key Files (reading order)

| # | File | What It Does |
|---|------|-------------|
| 1 | `reasoning/src/strategies/kernel/kernel-state.ts` | `KernelState`, `KernelInput`, `KernelContext`, `ThoughtKernel` type, `transitionState()` |
| 2 | `reasoning/src/strategies/kernel/react-kernel.ts` | `reactKernel` — single-step Think→Parse→Execute→Observe |
| 3 | `reasoning/src/strategies/kernel/kernel-runner.ts` | `runKernel()` — iteration loop, entropy, loop detection |
| 4 | `reasoning/src/strategies/kernel/utils/tool-formatting.ts`, `tool-parsing.ts`, `tool-gating.ts`, `tool-capabilities.ts` | Tool schema shaping, FC parsing, gating, classification (split from original `tool-utils.ts`) |
| 5 | `reasoning/src/strategies/kernel/utils/tool-execution.ts` | `executeToolCall()`, observation result construction |
| 6 | `reasoning/src/strategies/reactive.ts` | Thin wrapper: `runKernel(reactKernel, input, opts)` → `ReasoningResult` |
| 7 | `reasoning/src/strategies/plan-execute.ts` | Structured Plan Engine with step patching and composite steps |

---

## Tool Execution Pipeline

```
Task prompt → Adaptive tool classifier → 4-8 relevant tools shown to LLM
                                                    │
LLM generates: Thought + ACTION: tool_name({args})  │
                                                    ▼
                                         parseToolRequest()
                                                    │
                                         ┌──────────▼──────────┐
                                         │  Duplicate check     │
                                         │  (exact JSON match)  │
                                         │  → "Already done"    │
                                         └──────────┬──────────┘
                                                    │ (new call)
                                         ┌──────────▼──────────┐
                                         │ ToolService.execute()│
                                         │  Built-in / MCP /    │
                                         │  Custom / Sandbox    │
                                         └──────────┬──────────┘
                                                    │
                                         ┌──────────▼──────────┐
                                         │ compressToolResult() │
                                         │ (JSON preview, trunc)│
                                         └──────────┬──────────┘
                                                    │
                                         ┌──────────▼──────────┐
                                         │ Observation step     │
                                         │ + ToolCallCompleted  │
                                         │   EventBus event     │
                                         └─────────────────────┘
```

### Built-in Tools — 9 capability + 8 meta-tools

**9 capability tools** (registered by ToolServiceLive — see `packages/tools/src/skills/builtin.ts`):

| Tool | Purpose |
|------|---------|
| `web-search` | Tavily / Brave / Serper / DuckDuckGo chain with quota-aware fallback |
| `crypto-price` | CoinGecko free API — batched spot prices, no key required |
| `http-get` | Fetch URL content |
| `file-read` | Read file content |
| `file-write` | Write file content |
| `code-execute` | Run JS in sandboxed subprocess or Docker container |
| `git-cli` | Safe git subcommand runner (CliRunner-backed) |
| `gh-cli` | Safe gh (GitHub CLI) subcommand runner |
| `gws-cli` | Google Workspace CLI runner (requires `gws` installed) |

**8 meta-tools** (wired by kernel with live state — see `packages/tools/src/skills/builtin.ts` `metaToolDefinitions`):

| Tool | Purpose |
|------|---------|
| `context-status` | Always-on context-window introspection |
| `task-complete` | Visibility-gated completion signal |
| `final-answer` | Hard exit gate for the reasoning loop |
| `brief` | Compact task/progress summary |
| `find` | Unified search/routing tool |
| `pulse` | Emit controller decision log line |
| `recall` | Working-memory retrieval (replaces scratchpad) |
| `checkpoint` | Resumable execution checkpoint |

---

## Entropy Sensor System

```
KernelRunner (post-kernel, each iteration)
        │
        ▼
EntropySensorService.score({thought, modelId, iteration, ...})
        │
        ├── 1A. Token Entropy      (logprobs → Shannon entropy, null if unavailable)
        ├── 1B. Structural Entropy  (format compliance, hedge detection, JSON parse)
        ├── 1C. Semantic Entropy    (embedding cosine sim, novelty vs centroid)
        ├── 1D. Behavioral Entropy  (tool success rate, action diversity, loop detection)
        └── 1E. Context Pressure    (token utilization vs model limit)
                │
                ▼
        Composite Score (weighted blend, [0,1])
                │
                ▼
        Trajectory Analysis (converging/flat/diverging/v-recovery/oscillating)
                │
                ▼
        EntropyScored EventBus event → MetricsCollector → Dashboard
```

### Key Files

| File | Purpose |
|------|---------|
| `reactive-intelligence/src/sensor/entropy-sensor-service.ts` | Main service, orchestrates all 5 sources |
| `reactive-intelligence/src/sensor/composite.ts` | Weighted combination + confidence tiers |
| `reactive-intelligence/src/sensor/token-entropy.ts` | Shannon entropy from logprobs |
| `reactive-intelligence/src/sensor/structural-entropy.ts` | Format compliance, hedging, JSON quality |
| `reactive-intelligence/src/sensor/semantic-entropy.ts` | Cosine similarity, centroid tracking |
| `reactive-intelligence/src/sensor/behavioral-entropy.ts` | Tool success, action diversity, loops |
| `reactive-intelligence/src/sensor/context-pressure.ts` | Token utilization tracking |
| `reactive-intelligence/src/sensor/entropy-trajectory.ts` | Shape classification, derivative, momentum |
| `reactive-intelligence/src/calibration/model-registry.ts` | Model tier + context limit lookup |
| `reactive-intelligence/src/calibration/conformal.ts` | Statistical threshold calibration |

---

## Reactive Controller

After each entropy score, the controller evaluates 3 decisions:

| Decision | Trigger | Action |
|----------|---------|--------|
| Early-stop (2A) | Converging trajectory for 2+ iterations + below threshold | Signal kernel to produce final answer |
| Compress (2C) | Context pressure > 80% | Compress low-signal context sections |
| Switch strategy (2D) | Flat trajectory for 3+ iterations + high loop score | Trigger strategy switching |

Key files:
- `reactive-intelligence/src/controller/controller-service.ts` — ReactiveControllerService
- `reactive-intelligence/src/controller/early-stop.ts` — evaluateEarlyStop()
- `reactive-intelligence/src/controller/context-compressor.ts` — evaluateCompression()
- `reactive-intelligence/src/controller/strategy-switch.ts` — evaluateStrategySwitch()

---

## Learning Engine

Post-run learning that accumulates knowledge across runs:

| Component | What It Does |
|-----------|-------------|
| Conformal Calibration | Per-model entropy thresholds (20 runs → statistical bounds) |
| Thompson Sampling Bandit | Learns which strategies work for which model × task combinations |
| Skill Synthesis | Extracts reusable "recipes" from high-signal runs |
| Task Classifier | Keyword heuristic for task categorization (no LLM) |

Key files:
- `reactive-intelligence/src/learning/learning-engine.ts` — LearningEngineService
- `reactive-intelligence/src/learning/bandit.ts` — selectArm(), updateArm()
- `reactive-intelligence/src/learning/bandit-store.ts` — BanditStore (SQLite)
- `reactive-intelligence/src/learning/skill-synthesis.ts` — shouldSynthesizeSkill(), extractSkillFragment()
- `reactive-intelligence/src/learning/task-classifier.ts` — classifyTaskCategory()

---

## Telemetry Client

Anonymous entropy data collection for the cloud intelligence platform:

Key files:
- `reactive-intelligence/src/telemetry/telemetry-client.ts` — TelemetryClient
- `reactive-intelligence/src/telemetry/types.ts` — RunReport, SkillFragment
- `reactive-intelligence/src/telemetry/signing.ts` — signPayload() (HMAC-SHA256)
- `reactive-intelligence/src/telemetry/install-id.ts` — getOrCreateInstallId()

---

## EventBus Event Flow

```
All events flow through a single EventBus instance (shared via ManagedRuntime)

Producers:                          Consumers:
─────────                          ──────────
ExecutionEngine ──┐                ┌── MetricsCollector (dashboard)
KernelRunner ─────┤                ├── ThoughtTracer (tracing)
ToolExecution ────┤   EventBus    ├── ObservabilityService (logging)
EntropySensor ────┤──────────────►├── MemoryExtractor (auto-save)
GatewayService ───┤                ├── ReactiveAgent.subscribe()
A2AServer ────────┘                └── Debrief toolCallHistory
```

### Event Types (key subset)

| Event | When | Key Fields |
|-------|------|-----------|
| `AgentStarted` | Execution begins | taskId, agentId |
| `AgentCompleted` | Execution ends | success, totalTokens, durationMs |
| `ToolCallCompleted` | Any tool finishes | toolName, durationMs, success |
| `ReasoningStepCompleted` | Each kernel step | strategy, step, thought/action/observation |
| `ReasoningIterationProgress` | End of each iteration | iteration, maxIterations, toolsThisStep |
| `EntropyScored` | Post-kernel scoring | composite, sources, trajectory, modelTier |
| `FinalAnswerProduced` | Agent has answer | answer, totalTokens |
| `ExecutionPhaseEntered/Completed` | Each phase boundary | phase, durationMs |
| `ExecutionHookFired` | Lifecycle hook | phase, timing (before/after) |

---

## Debrief Pipeline

```
Execution completes
        │
        ├── toolCallHistory  ← deterministic: collected from ToolCallCompleted events
        ├── errorsFromLoop   ← deterministic: failed tool calls + observation patterns
        ├── outcome          ← deterministic: deriveOutcome(terminatedBy, errors)
        ├── metrics          ← deterministic: tokens, duration, iterations, cost
        │
        ├── summary          ← LLM call: 1 small synthesis (~200 tokens)
        ├── keyFindings      ← LLM call: structured JSON extraction
        └── lessonsLearned   ← LLM call: structured JSON extraction
                │
                ▼
        AgentDebrief {outcome, summary, keyFindings, toolsUsed, metrics, markdown}
```

---

## LLM Provider Adapters

| Provider | File | Models | Logprobs | Streaming |
|----------|------|--------|----------|-----------|
| Anthropic | `llm-provider/src/providers/anthropic.ts` | Claude 4.x | No | Yes |
| OpenAI | `llm-provider/src/providers/openai.ts` | GPT-4o, o1 | Yes | Yes |
| Ollama | `llm-provider/src/providers/local.ts` | Any local | Yes | Yes |
| Gemini | `llm-provider/src/providers/gemini.ts` | Gemini Pro | No | Yes |
| LiteLLM | `llm-provider/src/providers/litellm.ts` | 40+ via proxy | Varies | Yes |
| Test | `llm-provider/src/testing.ts` | Deterministic mock | No | No |

---

## 25 Packages — Complete Inventory

| # | Package | Purpose | Tests | Key Export |
|---|---------|---------|-------|-----------|
| 1 | `core` | EventBus, Agent/Task services, shared types | ~100 | `EventBus`, `AgentEvent` |
| 2 | `llm-provider` | 6 LLM adapters, streaming, fallback | ~120 | `LLMService`, `CompletionResponse` |
| 3 | `memory` | 4-tier SQLite memory, FTS5, sqlite-vec | ~140 | `MemoryService`, `SessionStoreService` |
| 4 | `reasoning` | 5 strategies, kernel runner, plan engine | ~850 | `ReasoningService`, `StrategyRegistry` |
| 5 | `tools` | 9 capability + 8 meta-tools, MCP, sandbox, ToolBuilder | ~650 | `ToolService`, `ToolBuilder` |
| 6 | `guardrails` | Injection/PII/toxicity, KillSwitch | ~60 | `GuardrailService`, `KillSwitchService` |
| 7 | `verification` | Semantic entropy, NLI, hallucination | ~70 | `VerificationService` |
| 8 | `cost` | Complexity routing, budget, semantic cache | ~50 | `CostService` |
| 9 | `identity` | Ed25519 certs, RBAC, audit | ~40 | `IdentityService` |
| 10 | `observability` | Tracing, metrics, structured logging | ~50 | `ObservabilityService`, `MetricsCollector` |
| 11 | `interaction` | 5 autonomy modes, checkpoints, prefs | ~30 | `InteractionService` |
| 12 | `orchestration` | Multi-agent workflows (seq/parallel/pipeline) | ~40 | `OrchestrationService` |
| 13 | `prompts` | Template engine, prompt variants | ~30 | `PromptService` |
| 14 | `eval` | LLM-as-judge, EvalStore | ~30 | `EvalService` |
| 15 | `a2a` | Agent Cards, JSON-RPC 2.0, SSE | ~40 | `A2AServer`, `A2AClient` |
| 16 | `gateway` | Heartbeats, crons, webhooks, policies | ~50 | `GatewayService` |
| 17 | `testing` | Mock LLM/Tools/EventBus, assertions | ~40 | `makeMockLLM()`, `expectStream()` |
| 18 | `benchmarks` | 20-task benchmark suite | ~20 | Private (not published) |
| 19 | `health` | Health checks, readiness probes | ~20 | Private (not published) |
| 20 | `reactive-intelligence` | Entropy sensor, reactive controller, learning engine, telemetry | ~120 | `EntropySensorService`, `ReactiveControllerService`, `LearningEngineService` |
| 21 | `runtime` | ExecutionEngine, Builder, createRuntime() | ~200 | `ReactiveAgents`, `ExecutionEngine` |
| 22 | `reactive-agents` (facade) | Public API re-export | — | `ReactiveAgents` |
| 23 | `react` | React hooks: `useAgent`, `useAgentStream` | — | `useAgent`, `useAgentStream` |
| 24 | `vue` | Vue composables for agent streaming | — | `useAgent`, `useAgentStream` |
| 25 | `svelte` | Svelte stores for agent streaming | — | `createAgent`, `createAgentStream` |

**Total: ~4,150 tests across ~460 files**

---

## Cross-Cutting Data Flows

### modelId Flow
```
builder.withModel("cogito")
  → config.defaultModel
    → execution-engine: modelId: String(config.defaultModel)
      → ReasoningService.execute({modelId})
        → StrategyFn({...params, config})
          → runKernel(options: {modelId})
            → initialKernelState() → state.meta.entropy.modelId
              → entropySensor.score({modelId}) → lookupModel() → tier
```

### Tool Call Tracking Flow
```
react-kernel: executeToolCall()
  → ToolCallCompleted EventBus event
    → MetricsCollector (dashboard: tool counts, avg duration)
    → execution-engine toolCallLog[] (debrief: toolsUsed)
```

### Entropy → Dashboard Flow
```
kernel-runner: entropySensor.score()
  → EntropyScored EventBus event
    → MetricsCollector (future: entropy trajectory visualization)
    → state.meta.entropy.entropyHistory[] (trajectory analysis)
```
