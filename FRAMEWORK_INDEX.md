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
          │5 strats │ │8 built │ │4-tier│ │rails│ │halluc│ │ router │ │Ed25519 │
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
          │ EventBus, Types   │     │ gence (Entropy     │
          │ Agent/Task Service│     │ Sensor, Calibration│
          └───────────────────┘     └───────────────────┘
```

---

## Package Quick-Find

### When you need to... → Go to:

| Task | Package | Entry File |
|------|---------|-----------|
| Understand agent execution flow | `runtime` | `src/execution-engine.ts` (10-phase loop) |
| Add/change builder methods | `runtime` | `src/builder.ts` |
| Fix tool calling behavior | `reasoning` | `src/strategies/shared/react-kernel.ts` |
| Fix strategy selection | `reasoning` | `src/strategies/adaptive.ts` |
| Fix plan-execute loops | `reasoning` | `src/strategies/plan-execute.ts` |
| Fix loop detection | `reasoning` | `src/strategies/shared/kernel-runner.ts` |
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
| 1 | `reasoning/src/strategies/shared/kernel-state.ts` | `KernelState`, `KernelInput`, `KernelContext`, `ThoughtKernel` type, `transitionState()` |
| 2 | `reasoning/src/strategies/shared/react-kernel.ts` | `reactKernel` — single-step Think→Parse→Execute→Observe |
| 3 | `reasoning/src/strategies/shared/kernel-runner.ts` | `runKernel()` — iteration loop, entropy, loop detection |
| 4 | `reasoning/src/strategies/shared/tool-utils.ts` | Tool parsing, ACTION extraction, compression, LLM-based filtering |
| 5 | `reasoning/src/strategies/shared/tool-execution.ts` | `executeToolCall()`, observation result construction |
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

### Built-in Tools (8)

| Tool | File | Purpose |
|------|------|---------|
| `web-search` | `tools/src/skills/web-search.ts` | Tavily-powered web search |
| `http-get` | `tools/src/skills/http-client.ts` | Fetch URL content |
| `file-read` | `tools/src/skills/file-operations.ts` | Read file content |
| `file-write` | `tools/src/skills/file-operations.ts` | Write file content |
| `code-execute` | `tools/src/skills/code-execution.ts` | Run JS in subprocess |
| `scratchpad-write` | `tools/src/skills/scratchpad.ts` | Persist notes across steps |
| `scratchpad-read` | `tools/src/skills/scratchpad.ts` | Retrieve notes |
| `final-answer` | `tools/src/skills/final-answer.ts` | Hard exit gate for ReAct loop |

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

## 22 Packages — Complete Inventory

| # | Package | Purpose | Tests | Key Export |
|---|---------|---------|-------|-----------|
| 1 | `core` | EventBus, Agent/Task services, shared types | ~100 | `EventBus`, `AgentEvent` |
| 2 | `llm-provider` | 6 LLM adapters, streaming, fallback | ~120 | `LLMService`, `CompletionResponse` |
| 3 | `memory` | 4-tier SQLite memory, FTS5, sqlite-vec | ~140 | `MemoryService`, `SessionStoreService` |
| 4 | `reasoning` | 5 strategies, kernel runner, plan engine | ~485 | `ReasoningService`, `StrategyRegistry` |
| 5 | `tools` | 8 built-in tools, MCP, sandbox, ToolBuilder | ~180 | `ToolService`, `ToolBuilder` |
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
| 20 | `reactive-intelligence` | Entropy sensor, calibration, trajectory | ~60 | `EntropySensorService` |
| 21 | `runtime` | ExecutionEngine, Builder, createRuntime() | ~200 | `ReactiveAgents`, `ExecutionEngine` |
| 22 | `reactive-agents` (facade) | Public API re-export | — | `ReactiveAgents` |

**Total: 2,091 tests across 274 files**

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
