# Reactive Agents: Framework Usage Guide

## Purpose

This document shows **how framework consumers use the API** — builder patterns, configuration options,
agent creation, task execution, and real-world examples. Read this alongside the layer specs.

**Audience:** Developers building agents with this framework (end users), and AI coding agents
building the framework itself (reference for intended public API shape).

**Prerequisites:** Read `START_HERE_AI_AGENTS.md` and `00-master-architecture.md` first.

---

## Table of Contents

1. [Installation & Environment Setup](#1-installation--environment-setup)
2. [ReactiveAgentBuilder — Elegant DX (Primary API)](#2-reactiveagentbuilder--elegant-dx-primary-api)
3. [Quick Start — Raw Effect API (Advanced)](#3-quick-start--raw-effect-api-advanced)
4. [createRuntime() — The Main Entry Point](#4-createruntime--the-main-entry-point)
5. [Agent Creation (AgentService)](#5-agent-creation-agentservice)
6. [Task Creation and Execution](#6-task-creation-and-execution)
7. [LLM Provider Configuration](#7-llm-provider-configuration)
8. [Memory System Configuration](#8-memory-system-configuration)
9. [Tools: MCP Servers and Custom Functions](#9-tools-mcp-servers-and-custom-functions)
10. [Reasoning Strategy Configuration](#10-reasoning-strategy-configuration)
11. [Interaction Modes](#11-interaction-modes)
12. [Lifecycle Hooks](#12-lifecycle-hooks)
13. [Guardrails & Safety](#13-guardrails--safety)
14. [Cost Optimization](#14-cost-optimization)
15. [Multi-Agent Orchestration](#15-multi-agent-orchestration)
16. [Observability & Tracing](#16-observability--tracing)
17. [Testing Patterns](#17-testing-patterns)
18. [Complete Examples](#18-complete-examples)
19. [Error Handling Reference](#19-error-handling-reference)
20. [Configuration Reference](#20-configuration-reference)

---

## 1. Installation & Environment Setup

```bash
# Install Bun (required runtime)
curl -fsSL https://bun.sh/install | bash

# Install framework packages
bun add @reactive-agents/runtime @reactive-agents/core
bun add @reactive-agents/llm-provider @reactive-agents/memory
bun add @reactive-agents/tools @reactive-agents/reasoning

# Optional production packages
bun add @reactive-agents/guardrails @reactive-agents/verification
bun add @reactive-agents/cost @reactive-agents/identity
bun add @reactive-agents/orchestration @reactive-agents/observability
bun add @reactive-agents/interaction
```

### Environment Variables

```bash
# .env
# ─── LLM Providers (at least one required) ───
ANTHROPIC_API_KEY=sk-ant-...           # Required for Anthropic models
OPENAI_API_KEY=sk-...                  # Required for OpenAI models

# ─── Embeddings (Tier 2 memory only) ───
EMBEDDING_PROVIDER=openai              # "openai" (default) or "ollama"
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# ─── Local Embeddings (alternative to OpenAI) ───
# EMBEDDING_PROVIDER=ollama
# OLLAMA_ENDPOINT=http://localhost:11434

# ─── Runtime Defaults ───
LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
LLM_MAX_RETRIES=3
```

---

## 2. ReactiveAgentBuilder — Elegant DX (Primary API)

`ReactiveAgentBuilder` is a fluent class that hides Effect-TS complexity behind a clean
`async/await` interface. It lives in `@reactive-agents/runtime/src/builder.ts` and is the
**primary API** for most users.

Both `build()` (Promise) and `buildEffect()` (Effect) target the same underlying
`createRuntime()` + `ExecutionEngine` infrastructure. No functionality is lost going
through the builder — it is a zero-overhead convenience facade.

### Implementation Spec: `src/builder.ts`

> This file must be added to the `@reactive-agents/runtime` package build.
> Add it to the Build Order between current steps 5 and 6 in `layer-01b-execution-engine.md`.

```typescript
import { Effect, Layer } from "effect";
import { createRuntime } from "./runtime.js";
import { ExecutionEngine } from "./execution-engine.js";
import type { LifecycleHook, ReactiveAgentsConfig } from "./types.js";

// ─── ReactiveAgents Namespace ────────────────────────────────────────────────
// Primary entry point. All paths start here.

export const ReactiveAgents = {
  /** Create a new builder. All configuration is optional except `.withModel()`. */
  create: (): ReactiveAgentBuilder => new ReactiveAgentBuilder(),
};

// ─── ReactiveAgentBuilder ────────────────────────────────────────────────────

export class ReactiveAgentBuilder {
  private _name: string = "agent";
  private _provider: "anthropic" | "openai" | "ollama" = "anthropic";
  private _apiKey?: string;
  private _model?: string;
  private _baseUrl?: string;
  private _memoryTier: "1" | "2" = "1";
  private _tools: string[] = [];
  private _hooks: LifecycleHook[] = [];
  private _reasoningStrategy?: string;
  private _maxIterations: number = 10;
  private _enableGuardrails: boolean = false;
  private _enableVerification: boolean = false;
  private _enableCostTracking: boolean = false;
  private _enableAudit: boolean = false;
  private _extraLayers?: Layer.Layer<unknown, unknown>;

  // ─── Vision Pillar: Control ───
  private _reasoningController?: ReasoningController;
  private _contextController?: ContextController;

  // ─── Vision Pillar: Reliability ───
  private _circuitBreaker?: CircuitBreakerConfig;

  // ─── Vision Pillar: Efficiency ───
  private _tokenBudget?: TokenBudgetConfig;

  // ─── Vision Pillar: Security ───
  private _secretsConfig?: SecretsConfig;

  // ─── Vision Pillar: Flexibility ───
  private _plugins: AgentPlugin[] = [];

  // ─── Identity ───

  withName(name: string): this { this._name = name; return this; }

  // ─── Model & Provider ───

  withModel(model: string): this { this._model = model; return this; }

  withProvider(
    provider: "anthropic" | "openai" | "ollama",
    options: { apiKey?: string; baseUrl?: string } = {},
  ): this {
    this._provider = provider;
    this._apiKey = options.apiKey;
    this._baseUrl = options.baseUrl;
    return this;
  }

  // ─── Memory ───

  /** "1" = FTS5 full-text search (default, zero deps). "2" = FTS5 + sqlite-vec KNN. */
  withMemory(tier: "1" | "2"): this { this._memoryTier = tier; return this; }

  // ─── Tools ───

  withTools(tools: string[]): this { this._tools = tools; return this; }

  // ─── Reasoning ───

  withReasoningStrategy(
    strategy: "reactive" | "plan-execute-reflect" | "reflexion" | "tree-of-thought" | "adaptive",
  ): this { this._reasoningStrategy = strategy; return this; }

  // ─── Execution ───

  withMaxIterations(n: number): this { this._maxIterations = n; return this; }

  // ─── Lifecycle Hooks ───

  withHook(hook: LifecycleHook): this { this._hooks.push(hook); return this; }

  // ─── Optional Features (Phase 2+) ───

  withGuardrails(): this { this._enableGuardrails = true; return this; }
  withVerification(): this { this._enableVerification = true; return this; }
  withCostTracking(): this { this._enableCostTracking = true; return this; }
  withAudit(): this { this._enableAudit = true; return this; }

  /** Provide additional Effect layers (power users only). */
  withLayers(layers: Layer.Layer<unknown, unknown>): this {
    this._extraLayers = layers;
    return this;
  }

  // ─── Control (Vision Pillar) ───

  /**
   * Attach a ReasoningController for fine-grained step-level hooks inside the
   * reasoning loop. Unlike LifecycleHooks (which fire at the coarse 10-phase
   * ExecutionEngine level), ReasoningController hooks fire within each
   * reasoning step: before reasoning, during/after each step, and on uncertainty.
   *
   * Type: see @reactive-agents/reasoning/src/types/reasoning.ts
   */
  withReasoningController(controller: ReasoningController): this {
    this._reasoningController = controller;
    return this;
  }

  /**
   * Configure ContextWindowManager behavior: prioritization strategy,
   * pruning mode, retention list, and compression level.
   *
   * Type: see @reactive-agents/core/src/types/context.ts
   */
  withContextController(controller: ContextController): this {
    this._contextController = controller;
    return this;
  }

  // ─── Reliability (Vision Pillar) ───

  /**
   * Add an agent-level circuit breaker that halts execution after consecutive
   * failures exceed a threshold, preventing cascading errors and runaway cost.
   *
   * Type: see @reactive-agents/core/src/types/config.ts
   */
  withCircuitBreaker(config: CircuitBreakerConfig): this {
    this._circuitBreaker = config;
    return this;
  }

  // ─── Efficiency (Vision Pillar) ───

  /**
   * Set a per-invocation token budget with optional allocation splits.
   * Hard enforcement aborts on budget exceed; soft enforcement emits warnings.
   *
   * Type: see @reactive-agents/core/src/types/config.ts
   */
  withTokenBudget(config: TokenBudgetConfig): this {
    this._tokenBudget = config;
    return this;
  }

  // ─── Security (Vision Pillar) ───

  /**
   * Configure secret management (API keys, credentials) for the agent runtime.
   * Default provider reads from environment variables; extensible to Vault/AWS.
   *
   * Type: see @reactive-agents/identity/src/types.ts
   */
  withSecrets(config: SecretsConfig): this {
    this._secretsConfig = config;
    return this;
  }

  // ─── Flexibility (Vision Pillar) ───

  /**
   * Register a plugin — a named Effect Layer that extends agent capabilities.
   * This is a convenience wrapper around withLayers() for discoverable extensions.
   */
  withPlugin(plugin: AgentPlugin): this {
    this._plugins.push(plugin);
    return this;
  }

  // ─── Build ───

  /**
   * Build a `ReactiveAgent` (Simple API — returns Promise).
   * No Effect knowledge required.
   */
  async build(): Promise<ReactiveAgent> {
    return Effect.runPromise(this.buildEffect());
  }

  /**
   * Build a `ReactiveAgent` (Advanced API — returns Effect).
   * For use inside Effect programs.
   */
  buildEffect(): Effect.Effect<ReactiveAgent, Error> {
    const agentId = `${this._name}-${Date.now()}`;
    const apiKey = this._apiKey
      ?? (this._provider === "anthropic"
          ? process.env.ANTHROPIC_API_KEY
          : process.env.OPENAI_API_KEY)
      ?? "";

    const runtime = createRuntime({
      agentId,
      provider: this._provider,
      apiKey,
      baseUrl: this._baseUrl,
      memoryTier: this._memoryTier,
      maxIterations: this._maxIterations,
      enableGuardrails: this._enableGuardrails,
      enableVerification: this._enableVerification,
      enableCostTracking: this._enableCostTracking,
      enableAudit: this._enableAudit,
      extraLayers: this._extraLayers,
    });

    const hooks = [...this._hooks];

    return Effect.gen(function* () {
      const engine = yield* ExecutionEngine.pipe(Effect.provide(runtime));

      for (const hook of hooks) {
        yield* engine.registerHook(hook);
      }

      return new ReactiveAgent(engine, agentId, runtime);
    });
  }
}

// ─── ReactiveAgent Facade ────────────────────────────────────────────────────

export class ReactiveAgent {
  constructor(
    private readonly engine: {
      execute: (task: any) => Effect.Effect<any, any>;
      cancel: (taskId: string) => Effect.Effect<void, any>;
      getContext: (taskId: string) => Effect.Effect<any, never>;
    },
    readonly agentId: string,
    private readonly runtime: Layer.Layer<unknown, unknown>,
  ) {}

  // ─── Core ────────────────────────────────────────────────────────────────

  /**
   * Run a task and return the result (Simple API — Promise).
   *
   * @example
   * const result = await agent.run('Summarize the latest AI safety research');
   */
  async run(input: string): Promise<AgentResult> {
    return Effect.runPromise(this.runEffect(input));
  }

  /**
   * Run a task and return the result (Advanced API — Effect).
   * Compose with retry, timeout, and typed error handling.
   *
   * @example
   * const result = yield* agent.runEffect('Summarize').pipe(
   *   Effect.retry({ times: 3, schedule: Schedule.exponential('1 second') }),
   * );
   */
  runEffect(input: string): Effect.Effect<AgentResult, Error> {
    const taskId = `task-${Date.now()}`;
    const agentId = this.agentId;
    const engine = this.engine;
    const runtime = this.runtime;

    const task = {
      id: taskId,
      agentId,
      type: "query" as const,
      input: { question: input },
      priority: "medium" as const,
      status: "pending" as const,
      metadata: { tags: [] },
      createdAt: new Date(),
    };

    return engine.execute(task).pipe(
      Effect.map((result: any) => ({
        output: String(result.output ?? ""),
        success: Boolean(result.success),
        taskId: String(result.taskId),
        agentId: String(result.agentId),
        metadata: result.metadata as AgentResultMetadata,
      })),
      Effect.provide(runtime as any),
    );
  }

  /** Cancel a running task by ID. */
  async cancel(taskId: string): Promise<void> {
    return Effect.runPromise(
      this.engine.cancel(taskId).pipe(Effect.provide(this.runtime as any)),
    );
  }

  /** Inspect context of a running task (null if not running). */
  async getContext(taskId: string): Promise<unknown> {
    return Effect.runPromise(
      this.engine.getContext(taskId).pipe(Effect.provide(this.runtime as any)),
    );
  }

  // ─── Observability (Vision Pillar) ────────────────────────────────────────

  /**
   * Get structured execution trace for a completed task.
   * Requires @reactive-agents/observability layer to be active.
   * Returns null if observability is not available or task not found.
   */
  async getTrace(taskId: string): Promise<ExecutionTrace | null> {
    return Effect.runPromise(
      Effect.gen(function* () {
        const obsOpt = yield* Effect.serviceOption(
          Context.GenericTag<{ getTrace: (id: string) => Effect.Effect<any> }>("ObservabilityService"),
        );
        if (obsOpt._tag === "Some") {
          return yield* obsOpt.value.getTrace(taskId);
        }
        return null;
      }).pipe(Effect.provide(this.runtime as any)),
    );
  }

  /**
   * Stream real-time metrics from this agent.
   * Requires @reactive-agents/observability layer to be active.
   * Returns an AsyncIterable of metric events; empty stream if observability
   * is not available.
   */
  async *metrics(): AsyncGenerator<AgentMetricEvent> {
    // Implemented by subscribing to EventBus metric events for this agentId.
    // Requires @reactive-agents/observability to emit metric events.
    // Falls back to an empty stream if observability is not active.
  }

  /**
   * Create a debug session from captured snapshots.
   * Requires @reactive-agents/observability layer.
   * Supports rewinding to a previous snapshot and replaying from that point.
   */
  async debugger(): Promise<DebugSession | null> {
    return Effect.runPromise(
      Effect.gen(function* () {
        const obsOpt = yield* Effect.serviceOption(
          Context.GenericTag<{ createDebugSession: (id: string) => Effect.Effect<any> }>("ObservabilityService"),
        );
        if (obsOpt._tag === "Some") {
          return yield* obsOpt.value.createDebugSession(this.agentId);
        }
        return null;
      }).pipe(Effect.provide(this.runtime as any)),
    );
  }

  // ─── Runtime Control (Vision Pillar) ──────────────────────────────────────

  /**
   * Register a callback invoked before any high-importance decision is executed.
   * Return the original or a modified AgentDecision.
   * Wired into LifecycleHookRegistry as a dynamic "think.before" hook.
   */
  onDecision(
    handler: (decision: AgentDecision, ctx: ExecutionContext) => Promise<AgentDecision> | AgentDecision,
  ): void {
    // Registers a dynamic lifecycle hook on the "think" phase (before timing)
    // that intercepts the decision and allows the handler to approve/modify/reject.
  }

  /**
   * Register a callback invoked when the agent reaches an uncertainty signal
   * (confidence below threshold). Return 'continue', 'abort', or 'escalate'.
   * Wired into LifecycleHookRegistry as a dynamic "think.after" hook.
   */
  onUncertainty(
    handler: (signal: UncertaintySignal) => Promise<"continue" | "abort" | "escalate"> | "continue" | "abort" | "escalate",
  ): void {
    // Registers a dynamic lifecycle hook on the "think" phase (after timing)
    // that checks for low-confidence signals and delegates to the handler.
  }
}

// ─── Result Types ────────────────────────────────────────────────────────────

export interface AgentResultMetadata {
  readonly duration: number;       // Milliseconds wall-clock
  readonly cost: number;           // USD (0 if cost tracking disabled)
  readonly tokensUsed: number;
  readonly strategyUsed?: string;  // e.g. "adaptive", "reflexion"
  readonly stepsCount: number;     // Agent loop iterations
}

export interface AgentResult {
  readonly output: string;
  readonly success: boolean;
  readonly taskId: string;
  readonly agentId: string;
  readonly metadata: AgentResultMetadata;
}

// ─── Vision Pillar Types ─────────────────────────────────────────────────────
// These types are defined in their respective packages and re-exported here
// for reference. Implementations live in the listed source files.

/**
 * Fine-grained hooks that fire INSIDE the reasoning loop (per-step level).
 * Source: @reactive-agents/reasoning/src/types/reasoning.ts
 */
export interface ReasoningController {
  readonly beforeReasoning?: (context: ReasoningInput) => Effect.Effect<ReasoningInput, ReasoningError>;
  readonly duringStep?: (step: ReasoningStep) => Effect.Effect<ReasoningStep, ReasoningError>;
  readonly afterStep?: (step: ReasoningStep) => Effect.Effect<ReasoningStep, ReasoningError>;
  readonly onUncertainty?: (signal: UncertaintySignal) => Effect.Effect<"continue" | "abort" | "escalate", never>;
  readonly onAdapt?: (context: ReasoningInput) => Effect.Effect<ReasoningStrategy, never>;
}

/**
 * ContextWindowManager configuration overrides.
 * Source: @reactive-agents/core/src/types/context.ts
 */
export interface ContextController {
  readonly prioritization?: "semantic" | "recency" | "importance";
  readonly pruning?: "adaptive" | "sliding-window" | "fifo";
  readonly retention?: readonly string[];   // message types to always retain
  readonly compression?: "none" | "aggressive" | "adaptive";
}

/**
 * Agent-level circuit breaker (distinct from LLM-level circuit breaker in llm-provider).
 * Source: @reactive-agents/core/src/types/config.ts
 */
export interface CircuitBreakerConfig {
  readonly errorThreshold: number;    // 0.0–1.0: error rate to trip
  readonly timeout: number;           // ms: max execution time before trip
  readonly resetTimeout: number;      // ms: time before attempting reset
}

/**
 * Per-invocation token budget with allocation splits.
 * Source: @reactive-agents/core/src/types/config.ts
 */
export interface TokenBudgetConfig {
  readonly total: number;
  readonly allocation?: {
    readonly system?: number;
    readonly context?: number;
    readonly reasoning?: number;
    readonly output?: number;
  };
  readonly enforcement: "hard" | "soft";  // hard = abort; soft = warn
}

/**
 * Secret management configuration.
 * Source: @reactive-agents/identity/src/types.ts
 */
export interface SecretsConfig {
  readonly provider: "env" | "vault";
  readonly path?: string;             // vault path prefix
  readonly encryption?: "aes-256";
}

/**
 * Lightweight plugin interface — a named Layer.
 * Source: @reactive-agents/runtime/src/builder.ts
 */
export interface AgentPlugin {
  readonly name: string;
  readonly layer: Layer.Layer<unknown, unknown>;
}

/**
 * Structured execution trace (returned by agent.getTrace()).
 * Source: @reactive-agents/observability/src/types.ts
 */
export interface ExecutionTrace {
  readonly taskId: string;
  readonly agentId: string;
  readonly phases: readonly TracePhase[];
  readonly totalDuration: number;
  readonly totalCost: number;
}

export interface TracePhase {
  readonly name: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly durationMs: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Real-time metric event (yielded by agent.metrics()).
 * Source: @reactive-agents/observability/src/types.ts
 */
export interface AgentMetricEvent {
  readonly timestamp: Date;
  readonly phase: string;
  readonly reasoningTimeMs?: number;
  readonly toolCallCount?: number;
  readonly tokensUsed?: number;
  readonly estimatedCost?: number;
}

/**
 * Debug session for snapshot-based time-travel debugging.
 * Source: @reactive-agents/observability/src/types.ts
 */
export interface DebugSession {
  readonly snapshots: readonly AgentStateSnapshot[];
  readonly rewindTo: (index: number) => Effect.Effect<AgentStateSnapshot, ObservabilityError>;
  readonly replay: (options?: { fromIndex?: number }) => Effect.Effect<AgentResult, ExecutionError>;
}

/**
 * Signal emitted when agent confidence drops below threshold.
 * Source: @reactive-agents/core/src/types/signals.ts
 */
export interface UncertaintySignal {
  readonly taskId: string;
  readonly agentId: string;
  readonly confidence: number;
  readonly phase: string;
  readonly context: string;
}

/**
 * Decision object intercepted by onDecision() handler.
 * Source: @reactive-agents/core/src/types/signals.ts
 */
export interface AgentDecision {
  readonly type: "tool_call" | "strategy_switch" | "output";
  readonly importance: number;  // 0.0–1.0
  readonly content: unknown;
}
```

### Update `src/index.ts` — add exports:

```typescript
export { ReactiveAgents, ReactiveAgentBuilder, ReactiveAgent } from "./builder.js";
export type { AgentResult, AgentResultMetadata } from "./builder.js";
```

---

### Hello World (30 Seconds to Running)

```typescript
import { ReactiveAgents } from '@reactive-agents/runtime';

const agent = await ReactiveAgents.create()
  .withModel('claude-sonnet-4-5-20250929')
  .build();

const result = await agent.run('What is the capital of France?');
console.log(result.output);  // "The capital of France is Paris."
```

### AgentResult Shape

```typescript
{
  output: string;            // The agent's final answer
  success: boolean;          // true if completed without error
  taskId: string;
  agentId: string;
  metadata: {
    duration: number;        // Wall-clock ms
    cost: number;            // USD (0 if cost tracking disabled)
    tokensUsed: number;
    strategyUsed?: string;   // "reactive" | "plan-execute-reflect" | "reflexion" | ...
    stepsCount: number;      // Agent loop iterations
  }
}
```

---

### Builder Method Reference

```typescript
ReactiveAgents.create()

  // ─── Identity ────────────────────────────────────────────────────────────
  .withName('my-agent')                      // Agent ID prefix (default: "agent")

  // ─── Model & Provider ────────────────────────────────────────────────────
  .withModel('claude-sonnet-4-5-20250929')   // Model name passed to LLMService
  .withProvider('anthropic', {               // Default provider
    apiKey: 'sk-ant-...',                    // Falls back to ANTHROPIC_API_KEY env
  })
  .withProvider('openai', {
    apiKey: 'sk-...',                        // Falls back to OPENAI_API_KEY env
    baseUrl: 'https://api.openai.com/v1',
  })
  .withProvider('ollama', {
    baseUrl: 'http://localhost:11434',
  })

  // ─── Memory ──────────────────────────────────────────────────────────────
  .withMemory('1')          // Tier 1: FTS5 only (zero deps, default)
  .withMemory('2')          // Tier 2: FTS5 + sqlite-vec KNN (requires sqlite-vec)

  // ─── Tools (Phase 2+) ────────────────────────────────────────────────────
  .withTools(['web-search', 'code-execution', 'file-operations'])

  // ─── Reasoning (Phase 2+) ────────────────────────────────────────────────
  .withReasoningStrategy('reactive')               // Fast, direct answers
  .withReasoningStrategy('plan-execute-reflect')   // Structured multi-step
  .withReasoningStrategy('reflexion')              // Self-correcting (high quality)
  .withReasoningStrategy('tree-of-thought')        // Exploratory, creative
  .withReasoningStrategy('adaptive')               // Auto-selects best strategy

  // ─── Execution ───────────────────────────────────────────────────────────
  .withMaxIterations(20)    // Override default (10)

  // ─── Lifecycle Hooks ─────────────────────────────────────────────────────
  .withHook({
    phase: 'think',
    timing: 'before',
    handler: (ctx) => Effect.succeed(ctx),  // Inspect or modify ExecutionContext
  })

  // ─── Optional Features (Phase 2+) ────────────────────────────────────────
  .withGuardrails()         // Enable GuardrailService (safety contracts + PII)
  .withVerification()       // Enable VerificationService (hallucination detection)
  .withCostTracking()       // Enable CostRouter + CostTracker
  .withAudit()              // Enable AuditService (immutable audit trail)
  .withLayers(myLayer)      // Inject additional Effect layers (power users)

  // ─── Build ───────────────────────────────────────────────────────────────
  .build()                  // → Promise<ReactiveAgent>  (Simple API)
  .buildEffect()            // → Effect<ReactiveAgent>   (Advanced API)
```

---

### Reasoning Strategy Guide

| Strategy | Best For | Loop Behavior |
|---|---|---|
| `reactive` | Simple Q&A, calculations | 1 think call → immediate answer |
| `plan-execute-reflect` | Research, multi-step tasks | Plan → execute each step → reflect → refine |
| `reflexion` | Quality-critical content, legal/medical | Draft → self-critique → improve (up to N) |
| `tree-of-thought` | Brainstorming, creative, complex reasoning | Explore N paths → evaluate → best |
| `adaptive` | Mixed workloads, production | LLM selects best strategy per task |

```typescript
// reactive — fastest, cheapest
const quickAgent = await ReactiveAgents.create()
  .withModel('claude-haiku-4-5')
  .withReasoningStrategy('reactive')
  .build();

await quickAgent.run('What is 2 + 2?');
// → Single LLM call, < 1s

// reflexion — highest quality
const qualityAgent = await ReactiveAgents.create()
  .withModel('claude-sonnet-4-5-20250929')
  .withReasoningStrategy('reflexion')
  .withMaxIterations(5)  // Up to 5 draft/critique cycles
  .build();

await qualityAgent.run('Draft a privacy policy for a SaaS product');
// → Draft → Self-critique → Revise → Repeat until confidence threshold

// adaptive — production default
const productionAgent = await ReactiveAgents.create()
  .withModel('claude-sonnet-4-5-20250929')
  .withReasoningStrategy('adaptive')
  .build();

await productionAgent.run('What is 2+2?');        // → picks reactive
await productionAgent.run('Research AI safety');  // → picks plan-execute
await productionAgent.run('Draft legal clause');  // → picks reflexion
```

---

### Memory Examples

```typescript
// Tier 1: FTS5 full-text search (default, zero dependencies)
const agent = await ReactiveAgents.create()
  .withModel('claude-sonnet-4-5-20250929')
  .withMemory('1')
  .build();

// Memory persists to: .reactive-agents/memory/{agentId}/memory.db
// First run: no prior context
await agent.run('My name is Alex, I work in fintech at a Series B startup');

// Second run: bootstrap phase loads prior context automatically
const result = await agent.run('What industry do I work in?');
console.log(result.output);  // "You work in fintech."

// Tier 2: FTS5 + sqlite-vec KNN (requires: bun add sqlite-vec)
const semanticAgent = await ReactiveAgents.create()
  .withModel('claude-sonnet-4-5-20250929')
  .withMemory('2')
  .build();
// Tier 2 finds conceptually similar memories (not just keyword matches)
// Uses LLMService.embed() for embeddings — no separate EmbeddingProvider needed
```

---

### Lifecycle Hook Examples

```typescript
import { Effect } from 'effect';
import { ExecutionError } from '@reactive-agents/runtime';

// ── Observability Hook ─────────────────────────────────────────────────────
const agent = await ReactiveAgents.create()
  .withModel('claude-sonnet-4-5-20250929')
  .withHook({
    phase: 'think',
    timing: 'after',
    handler: (ctx) => Effect.gen(function* () {
      console.log(`[iter ${ctx.iteration}] cost=$${ctx.cost.toFixed(4)}`);
      return ctx;
    }),
  })
  .build();

// ── Budget Guard Hook ─────────────────────────────────────────────────────
const budgetAgent = await ReactiveAgents.create()
  .withModel('claude-sonnet-4-5-20250929')
  .withHook({
    phase: 'think',
    timing: 'before',
    handler: (ctx) => ctx.cost > 0.50
      ? Effect.fail(new ExecutionError({ message: 'Budget exceeded $0.50', taskId: ctx.taskId, phase: 'think' }))
      : Effect.succeed(ctx),
  })
  .build();

// ── Human-in-the-Loop Hook ────────────────────────────────────────────────
const supervisedAgent = await ReactiveAgents.create()
  .withModel('claude-sonnet-4-5-20250929')
  .withHook({
    phase: 'act',
    timing: 'before',
    handler: (ctx) => Effect.gen(function* () {
      const calls = ctx.metadata.pendingToolCalls as any[];
      const dangerous = ['delete-record', 'send-email', 'deploy'];
      const needsApproval = calls.some(c => dangerous.includes(c.name));

      if (needsApproval) {
        const approved = yield* Effect.tryPromise(() => askHumanForApproval(calls));
        if (!approved) {
          return yield* Effect.fail(new ExecutionError({
            message: 'Human rejected', taskId: ctx.taskId, phase: 'act',
          }));
        }
      }
      return ctx;
    }),
  })
  .build();
```

---

### Advanced API: Effect-Based Usage

```typescript
import { ReactiveAgents } from '@reactive-agents/runtime';
import { Effect, Schedule } from 'effect';

// ── Build and run in one Effect program ────────────────────────────────────
const program = Effect.gen(function* () {
  const agent = yield* ReactiveAgents.create()
    .withModel('claude-sonnet-4-5-20250929')
    .buildEffect();

  return yield* agent.runEffect('Research AI safety developments in 2025');
});

const result = await Effect.runPromise(program);

// ── Retry with exponential backoff ─────────────────────────────────────────
const resilient = Effect.gen(function* () {
  const agent = yield* ReactiveAgents.create()
    .withModel('claude-sonnet-4-5-20250929')
    .buildEffect();

  return yield* agent.runEffect('Analyze this data').pipe(
    Effect.retry({ times: 3, schedule: Schedule.exponential('2 seconds') }),
    Effect.timeout('60 seconds'),
  );
});

// ── Parallel execution ─────────────────────────────────────────────────────
const parallel = Effect.gen(function* () {
  const agent = yield* ReactiveAgents.create()
    .withModel('claude-sonnet-4-5-20250929')
    .buildEffect();

  return yield* Effect.all([
    agent.runEffect('Analyze market opportunity'),
    agent.runEffect('Analyze technical feasibility'),
    agent.runEffect('Analyze regulatory risks'),
  ], { concurrency: 3 });
});

// ── Typed error handling ───────────────────────────────────────────────────
import { MaxIterationsError, GuardrailViolationError } from '@reactive-agents/runtime';

const safe = Effect.gen(function* () {
  const agent = yield* ReactiveAgents.create()
    .withModel('claude-sonnet-4-5-20250929')
    .withGuardrails()
    .buildEffect();

  return yield* agent.runEffect('Task').pipe(
    Effect.catchTag('MaxIterationsError', (e) =>
      Effect.succeed({ output: 'Partial result', success: false, taskId: e.taskId,
                       agentId: '', metadata: { duration: 0, cost: 0, tokensUsed: 0, stepsCount: e.iterations } }),
    ),
    Effect.catchTag('GuardrailViolationError', (e) =>
      Effect.fail(new Error(`Blocked: ${e.violation}`)),
    ),
  );
});
```

---

### Multi-Agent Patterns (Builder Style)

```typescript
// ── Sequential Pipeline ────────────────────────────────────────────────────
const [researcher, writer, editor] = await Promise.all([
  ReactiveAgents.create().withName('researcher')
    .withModel('claude-sonnet-4-5-20250929').withReasoningStrategy('plan-execute').build(),
  ReactiveAgents.create().withName('writer')
    .withModel('claude-sonnet-4-5-20250929').withReasoningStrategy('reflexion').build(),
  ReactiveAgents.create().withName('editor')
    .withModel('claude-haiku-4-5').withReasoningStrategy('reactive').build(),
]);

async function publishArticle(topic: string): Promise<string> {
  const research = await researcher.run(`Research: ${topic}`);
  const draft    = await writer.run(`Write article based on: ${research.output}`);
  const final    = await editor.run(`Polish: ${draft.output}`);
  return final.output;
}

// ── Parallel Analysis Team ─────────────────────────────────────────────────
import { Effect } from 'effect';

const teamReport = await Effect.runPromise(Effect.gen(function* () {
  const [market, tech, risk] = yield* Effect.all([
    ReactiveAgents.create().withName('market').withModel('claude-sonnet-4-5-20250929').buildEffect(),
    ReactiveAgents.create().withName('tech').withModel('claude-sonnet-4-5-20250929').buildEffect(),
    ReactiveAgents.create().withName('risk').withModel('claude-sonnet-4-5-20250929').buildEffect(),
  ]);

  const [marketR, techR, riskR] = yield* Effect.all([
    market.runEffect('Analyze market opportunity for AI agents'),
    tech.runEffect('Analyze technical feasibility of AI agents'),
    risk.runEffect('Analyze regulatory risks for AI agents'),
  ], { concurrency: 3 });

  const synthesizer = yield* ReactiveAgents.create()
    .withName('synthesizer').withModel('claude-sonnet-4-5-20250929')
    .withReasoningStrategy('plan-execute').buildEffect();

  return yield* synthesizer.runEffect(`
    Synthesize: MARKET: ${marketR.output} TECHNICAL: ${techR.output} RISK: ${riskR.output}
  `);
}));
```

---

### Real-World Examples (Builder Style)

#### Self-Improving Research Assistant

```typescript
const researcher = await ReactiveAgents.create()
  .withName('research-assistant')
  .withModel('claude-sonnet-4-5-20250929')
  .withReasoningStrategy('adaptive')
  .withMemory('2')          // Semantic search: find related prior findings
  .withMaxIterations(20)
  .build();

// After 100 sessions, agent recalls relevant prior research automatically
const result = await researcher.run('Summarize recent developments in AI alignment');
// → Bootstrap phase injects semantically similar past research from memory.db
```

#### Safety-Critical Diagnostic Assistant

```typescript
import { ExecutionError } from '@reactive-agents/runtime';
import { Effect } from 'effect';

const diagnosticAgent = await ReactiveAgents.create()
  .withName('diagnostic-assistant')
  .withModel('claude-opus-4-5-20251101')   // Most capable model
  .withReasoningStrategy('reflexion')      // Triple-checks everything
  .withMaxIterations(10)                   // Up to 5 reflection cycles
  .withMemory('1')                         // Learn from similar cases
  .withGuardrails()                        // Safety contracts
  .withVerification()                      // Confidence verification
  .withAudit()                             // HIPAA-compliant audit trail
  .withHook({
    // Mandatory doctor review before any diagnosis is returned
    phase: 'complete',
    timing: 'before',
    handler: (ctx) => Effect.gen(function* () {
      const approved = yield* Effect.tryPromise(() =>
        requestDoctorReview({ diagnosis: String(ctx.metadata.lastResponse), context: ctx }),
      );
      if (!approved) return yield* Effect.fail(new ExecutionError({
        message: 'Doctor rejected AI diagnosis', taskId: ctx.taskId, phase: 'complete',
      }));
      return ctx;
    }),
  })
  .build();
```

#### Adaptive Customer Support

```typescript
const supportAgent = await ReactiveAgents.create()
  .withName('support')
  .withModel('claude-sonnet-4-5-20250929')
  .withReasoningStrategy('adaptive')
  .withMemory('1')          // Remember customer interaction history
  .withHook({
    phase: 'think',
    timing: 'before',
    handler: (ctx) => Effect.gen(function* () {
      const sentiment = ctx.metadata.customerSentiment as string;

      // Escalate to human if customer is angry
      if (sentiment === 'angry' || sentiment === 'urgent') {
        yield* Effect.tryPromise(() => escalateToHuman(ctx.taskId));
        return yield* Effect.fail(new ExecutionError({
          message: 'Escalated', taskId: ctx.taskId, phase: 'think',
        }));
      }
      return ctx;
    }),
  })
  .build();
```

---

## 3. Quick Start — Raw Effect API (Advanced)

This is the smallest possible working agent using Effect directly.
Three required layers: Core + LLM + Memory.

```typescript
import { Effect } from "effect";
import { createRuntime, ExecutionEngine } from "@reactive-agents/runtime";
import { AgentService, TaskService } from "@reactive-agents/core";

// 1. Build the runtime layer
const Runtime = createRuntime({
  agentId: "my-first-agent",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  // memoryTier defaults to "1" (FTS5 only, zero external deps)
  // maxIterations defaults to 10
});

// 2. Run a task
const result = await Effect.runPromise(
  Effect.gen(function* () {
    const agents = yield* AgentService;
    const tasks = yield* TaskService;
    const engine = yield* ExecutionEngine;

    // Create the agent record
    const agent = yield* agents.create({
      name: "my-first-agent",
      capabilities: [{ type: "reasoning", name: "reactive" }],
    });

    // Create a task
    const task = yield* tasks.create({
      agentId: agent.id,
      type: "query",
      input: { question: "Explain the concept of monads in functional programming." },
      priority: "medium",
    });

    // Execute through the full 10-phase agent loop
    return yield* engine.execute(task);
  }).pipe(Effect.provide(Runtime)),
);

console.log("Answer:", result.output);
console.log("Cost:", result.metadata.cost, "USD");
console.log("Iterations:", result.metadata.stepsCount);
```

---

## 3. createRuntime() — The Main Entry Point

`createRuntime()` lives in `@reactive-agents/runtime/src/runtime.ts`. It composes all layers
into a single Effect `Layer` that can be provided to any Effect program.

### Minimal Runtime (Phase 1 — Core + LLM + Memory)

```typescript
import { createRuntime } from "@reactive-agents/runtime";

const Runtime = createRuntime({
  agentId: "agent-001",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
});
// Provides: CoreServicesLive + AnthropicLLMLive + MemoryLayer("1") + EngineLayer
```

### With Explicit Memory Tier

```typescript
// Tier 1: FTS5 full-text search only (zero external deps, fastest)
const RuntimeTier1 = createRuntime({
  agentId: "agent-001",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  memoryTier: "1",
});

// Tier 2: FTS5 + sqlite-vec KNN vector search (requires EMBEDDING_PROVIDER)
const RuntimeTier2 = createRuntime({
  agentId: "agent-001",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  memoryTier: "2",  // Requires 'sqlite-vec' npm package + LLMService.embed()
});
```

### Full Production Runtime

```typescript
import { createRuntime } from "@reactive-agents/runtime";
import { createGuardrailsLayer } from "@reactive-agents/guardrails";
import { createVerificationLayer } from "@reactive-agents/verification";
import { createCostLayer } from "@reactive-agents/cost";
import { createObservabilityLayer } from "@reactive-agents/observability";
import { createToolsLayer } from "@reactive-agents/tools";
import { createInteractionLayer } from "@reactive-agents/interaction";
import { Layer } from "effect";

const ProductionRuntime = createRuntime({
  agentId: "prod-agent",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  memoryTier: "2",
  maxIterations: 15,
  enableGuardrails: true,
  enableVerification: true,
  enableCostTracking: true,
  enableAudit: true,
  extraLayers: Layer.mergeAll(
    createGuardrailsLayer(),
    createVerificationLayer(),
    createCostLayer({ monthlyBudgetUsd: 100 }),
    createObservabilityLayer({ serviceName: "my-agent" }),
    createToolsLayer({ mcpServers: [] }),
    createInteractionLayer({ defaultMode: "supervised" }),
  ),
});
```

### Multiple Agents with Shared Infrastructure

```typescript
import { createRuntime } from "@reactive-agents/runtime";
import { createObservabilityLayer } from "@reactive-agents/observability";
import { Layer } from "effect";

// Shared observability across all agents
const SharedLayer = createObservabilityLayer({ serviceName: "agent-cluster" });

// Each agent gets its own memory namespace via agentId
const ResearcherRuntime = createRuntime({
  agentId: "researcher-agent",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  extraLayers: SharedLayer,
});

const CoderRuntime = createRuntime({
  agentId: "coder-agent",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  extraLayers: SharedLayer,
});
```

### Architecture Note: One Runtime Per Agent

Each `createRuntime()` call produces an isolated layer graph scoped to a single `agentId`.
This means:

- **Memory isolation:** Each agent writes to its own `memory.db` under `.reactive-agents/memory/{agentId}/`.
- **No shared EventBus:** Agents in separate runtimes cannot observe each other's events directly.
- **N agents = N layer stacks.** This is by design — it guarantees agents cannot corrupt each other's state.

For **multi-agent coordination**, use `@reactive-agents/orchestration` which maintains a shared
coordination layer (workflow engine, worker pool, event sourcing) above the individual agent runtimes.
See [§14 Multi-Agent Orchestration](#14-multi-agent-orchestration) for patterns.

### OpenAI Runtime

```typescript
import { createRuntime } from "@reactive-agents/runtime";

// Use the provider option to select OpenAI directly
const OpenAIRuntime = createRuntime({
  agentId: "openai-agent",
  provider: "openai",
  apiKey: process.env.OPENAI_API_KEY!,
});
```

### Ollama (Local) Runtime

```typescript
import { createRuntime } from "@reactive-agents/runtime";

const LocalRuntime = createRuntime({
  agentId: "local-agent",
  provider: "ollama",
  baseUrl: "http://localhost:11434",
});
```

---

## 4. Agent Creation (AgentService)

`AgentService` is provided by `@reactive-agents/core` and handles agent lifecycle persistence.

### Creating an Agent

```typescript
import { Effect } from "effect";
import { AgentService } from "@reactive-agents/core";

const createAgent = Effect.gen(function* () {
  const agents = yield* AgentService;

  return yield* agents.create({
    name: "research-assistant",
    description: "Autonomous research agent with web search capabilities",
    capabilities: [
      { type: "reasoning", name: "plan-execute-reflect" },
      { type: "tool", name: "web-search" },
      { type: "tool", name: "file-read" },
      { type: "memory", name: "semantic" },
    ],
    // Initial configuration merged with RuntimeConfig
    config: {
      defaultTemperature: 0.3,
      preferredModel: "claude-sonnet-4-20250514",
    },
    initialState: {
      researchDomain: "AI safety",
    },
  });
});
```

### Agent Capability Types

```typescript
// From @reactive-agents/core src/types/agent.ts
// CapabilityType = "tool" | "skill" | "reasoning" | "memory"

const agentConfig = {
  name: "full-stack-agent",
  capabilities: [
    // Reasoning: which strategies this agent uses
    { type: "reasoning", name: "adaptive" },

    // Tools: what external integrations this agent has
    { type: "tool", name: "web-search" },
    { type: "tool", name: "code-execution" },
    { type: "tool", name: "file-operations" },
    { type: "tool", name: "mcp:filesystem" },   // MCP server tool

    // Memory: which memory types are active
    { type: "memory", name: "semantic" },
    { type: "memory", name: "episodic" },
    { type: "memory", name: "procedural" },
  ],
};
```

### Loading an Existing Agent

```typescript
const loadAgent = (agentId: AgentId) =>
  Effect.gen(function* () {
    const agents = yield* AgentService;
    const agent = yield* agents.get(agentId);

    if (!agent) {
      return yield* Effect.fail(new AgentNotFoundError({ agentId }));
    }
    return agent;
  });
```

### Updating Agent State

```typescript
const updateAgentState = (agentId: AgentId, state: unknown) =>
  Effect.gen(function* () {
    const agents = yield* AgentService;
    return yield* agents.update(agentId, { state });
  });
```

---

## 5. Task Creation and Execution

`TaskService` creates tasks; `ExecutionEngine` runs them through the 10-phase loop.

### Basic Task Types

```typescript
import { TaskService } from "@reactive-agents/core";

// TaskType = "query" | "analysis" | "generation" | "action" | "research" | "code" | "custom"

const tasks = yield* TaskService;

// Simple Q&A query
const queryTask = yield* tasks.create({
  agentId: agent.id,
  type: "query",
  input: { question: "What is the capital of France?" },
  priority: "low",
});

// Research task
const researchTask = yield* tasks.create({
  agentId: agent.id,
  type: "research",
  input: {
    topic: "Effect-TS performance benchmarks vs RxJS",
    depth: "comprehensive",
    outputFormat: "structured-report",
  },
  priority: "medium",
  metadata: {
    tags: ["typescript", "benchmarks"],
    estimatedTokens: 5000,
  },
});

// Code generation
const codeTask = yield* tasks.create({
  agentId: agent.id,
  type: "code",
  input: {
    description: "Implement a binary search tree in TypeScript with Effect-TS",
    language: "typescript",
    requirements: ["type-safe", "functional", "no mutations"],
  },
  priority: "high",
});

// Autonomous action task
const actionTask = yield* tasks.create({
  agentId: agent.id,
  type: "action",
  input: {
    goal: "Monitor GitHub repo for new PRs and summarize them daily",
    schedule: "0 9 * * *",   // cron expression
  },
  priority: "medium",
});
```

### Executing a Task

```typescript
import { ExecutionEngine } from "@reactive-agents/runtime";
import { Effect } from "effect";

const runTask = (task: Task) =>
  Effect.gen(function* () {
    const engine = yield* ExecutionEngine;
    return yield* engine.execute(task);
  });

// With error handling
const runTaskSafe = (task: Task) =>
  Effect.gen(function* () {
    const engine = yield* ExecutionEngine;
    return yield* engine.execute(task).pipe(
      Effect.catchTag("MaxIterationsError", (e) =>
        Effect.succeed({
          success: false,
          output: null,
          error: `Max iterations (${e.maxIterations}) exceeded`,
          taskId: task.id,
        }),
      ),
      Effect.catchTag("GuardrailViolationError", (e) =>
        Effect.succeed({
          success: false,
          output: null,
          error: `Guardrail violation: ${e.violation}`,
          taskId: task.id,
        }),
      ),
      Effect.catchTag("ExecutionError", (e) =>
        Effect.die(`Fatal execution error in phase ${e.phase}: ${e.message}`),
      ),
    );
  });
```

### Task Result Structure

```typescript
// TaskResult from @reactive-agents/core src/types/result.ts
interface TaskResult {
  readonly taskId: TaskId;
  readonly agentId: AgentId;
  readonly success: boolean;
  readonly output: unknown;                  // The final answer/result
  readonly error?: string;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly metadata: {
    readonly stepsCount: number;             // Loop iterations
    readonly cost: number;                   // USD
    readonly tokensUsed: number;
    readonly strategyUsed: ReasoningStrategy;
    readonly verificationScore?: number;     // 0-1, present if verification enabled
    readonly toolsUsed: string[];
    readonly memoryReadCount: number;
    readonly memoryWriteCount: number;
  };
}
```

### Cancelling a Running Task

```typescript
const cancelTask = (taskId: TaskId) =>
  Effect.gen(function* () {
    const engine = yield* ExecutionEngine;
    yield* engine.cancel(taskId);  // Fails with ExecutionError if not running
  });
```

### Checking Task Status

```typescript
const checkRunningTask = (taskId: TaskId) =>
  Effect.gen(function* () {
    const engine = yield* ExecutionEngine;
    const ctx = yield* engine.getContext(taskId);

    if (ctx === null) {
      return { status: "not-running" };
    }

    return {
      status: ctx.agentState,
      phase: ctx.phase,
      iteration: ctx.iteration,
      cost: ctx.cost,
    };
  });
```

---

## 6. LLM Provider Configuration

`createLLMLayer()` is the factory from `@reactive-agents/llm-provider`.

### Anthropic (Default)

```typescript
import { createLLMLayer } from "@reactive-agents/llm-provider";

const AnthropicLayer = createLLMLayer({
  provider: "anthropic",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  defaultModel: "claude-sonnet-4-20250514",  // Default for all requests
  maxRetries: 3,
  promptCachingEnabled: true,               // Cache memory context blocks
});
```

### OpenAI

```typescript
const OpenAILayer = createLLMLayer({
  provider: "openai",
  openaiApiKey: process.env.OPENAI_API_KEY!,
  defaultModel: "gpt-4o",
  maxRetries: 3,
});
```

### Ollama (Local)

```typescript
const OllamaLayer = createLLMLayer({
  provider: "ollama",
  ollamaEndpoint: "http://localhost:11434",
  defaultModel: "llama3.2",
});
```

### Model Presets

```typescript
// Available presets from @reactive-agents/llm-provider src/types.ts
// Use these string keys wherever ModelConfig is expected

"claude-haiku"    // Fast, cheap — $1/$5 per 1M tokens, quality 0.6
"claude-sonnet"   // Balanced — $3/$15 per 1M tokens, quality 0.85
"claude-opus"     // Best — $15/$75 per 1M tokens, quality 1.0
"gpt-4o-mini"     // OpenAI cheap — $0.15/$0.6 per 1M tokens, quality 0.55
"gpt-4o"          // OpenAI balanced — $2.5/$10 per 1M tokens, quality 0.8
```

### Manual Model Config

```typescript
import type { ModelConfig } from "@reactive-agents/llm-provider";

const customModel: ModelConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  maxTokens: 4096,
  temperature: 0.2,
  topP: 0.95,
  stopSequences: ["</answer>"],
};
```

### Embeddings Configuration (Tier 2 Memory)

```typescript
import type { EmbeddingConfig } from "@reactive-agents/llm-provider";

// Embeddings ONLY go through LLMService.embed() — no separate EmbeddingProvider service
// This config is passed when building Tier 2 memory or calling LLMService.embed() directly

const embeddingConfig: EmbeddingConfig = {
  model: "text-embedding-3-small",
  dimensions: 1536,              // Must match sqlite-vec column size in Tier 2
  provider: "openai",            // "openai" or "ollama"
  batchSize: 100,
};

// Usage via LLMService directly
const embedText = (text: string) =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    return yield* llm.embed([text], embeddingConfig);  // Returns number[][]
  });
```

### Streaming Responses

```typescript
import { LLMService } from "@reactive-agents/llm-provider";
import { Stream } from "effect";

const streamResponse = Effect.gen(function* () {
  const llm = yield* LLMService;

  const stream = llm.stream({
    messages: [{ role: "user", content: "Write a long essay about AI." }],
    model: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  });

  // Collect stream chunks
  return yield* Stream.runCollect(stream);
});
```

### Structured Output Parsing

```typescript
import { LLMService } from "@reactive-agents/llm-provider";
import { Schema } from "effect";

// Define output schema
const SentimentSchema = Schema.Struct({
  sentiment: Schema.Literal("positive", "negative", "neutral"),
  confidence: Schema.Number,
  reasoning: Schema.String,
});

const analyzeSentiment = (text: string) =>
  Effect.gen(function* () {
    const llm = yield* LLMService;

    // LLMService.structured() parses + validates against the schema
    return yield* llm.structured({
      messages: [
        { role: "user", content: `Analyze the sentiment of: "${text}"` },
      ],
      outputSchema: SentimentSchema,
      model: { provider: "anthropic", model: "claude-haiku-20241022" },
    });
    // Returns: { sentiment: "positive", confidence: 0.92, reasoning: "..." }
  });
```

---

## 7. Memory System Configuration

`createMemoryLayer(tier)` is the factory from `@reactive-agents/memory`.

### Tier 1 — FTS5 Full-Text Search (Default)

Zero external dependencies. Uses `bun:sqlite` built-in + FTS5 extension.

```typescript
import { createMemoryLayer } from "@reactive-agents/memory";

// Tier 1: bun:sqlite + FTS5 only
const MemoryTier1 = createMemoryLayer("1", {
  agentId: "my-agent",
  dbPath: ".reactive-agents/memory",   // Default storage location
});
// Creates: .reactive-agents/memory/my-agent/memory.db
//          .reactive-agents/memory/my-agent/memory.md
```

### Tier 2 — FTS5 + Vector KNN Search

Requires `sqlite-vec` npm package and OpenAI/Ollama embeddings via `LLMService.embed()`.

```typescript
// Tier 2: bun:sqlite + FTS5 + sqlite-vec KNN
const MemoryTier2 = createMemoryLayer("2", {
  agentId: "my-agent",
  embeddingDimensions: 1536,    // Must match EMBEDDING_MODEL dimensions
  // sqlite-vec vec0 column is created with this size
});
// NOTE: Tier 2 requires @reactive-agents/llm-provider on the Layer for embed() calls
```

### Using MemoryService Directly

```typescript
import { MemoryService } from "@reactive-agents/memory";

// Bootstrap: called automatically by ExecutionEngine Phase 1
const bootstrap = (agentId: AgentId) =>
  Effect.gen(function* () {
    const memory = yield* MemoryService;

    const context = yield* memory.bootstrap(agentId);
    // Returns MemoryBootstrapResult: {
    //   semanticContext: string   (from memory.md — injected into system prompt)
    //   recentEpisodes: DailyLogEntry[]
    //   activeWorkflows: ProceduralEntry[]
    // }
    return context;
  });

// Store a semantic memory (long-term knowledge)
const rememberFact = (agentId: AgentId, fact: string) =>
  Effect.gen(function* () {
    const memory = yield* MemoryService;

    yield* memory.store({
      agentId,
      type: "semantic",
      content: fact,
      importance: 0.8,                    // 0-1 importance score
      source: { type: "agent", id: agentId },
      tags: ["knowledge", "fact"],
    });
  });

// Search memory (Tier 1: FTS5, Tier 2: FTS5 + KNN)
const searchMemory = (agentId: AgentId, query: string) =>
  Effect.gen(function* () {
    const memory = yield* MemoryService;

    return yield* memory.search({
      agentId,
      query,
      types: ["semantic", "episodic"],
      limit: 5,
      useVectorSearch: false,             // true = KNN (Tier 2 only)
    });
  });

// Snapshot session (called automatically by ExecutionEngine Phase 7)
const saveSession = (agentId: AgentId, sessionId: string, messages: unknown[]) =>
  Effect.gen(function* () {
    const memory = yield* MemoryService;
    yield* memory.snapshot(sessionId, messages);
  });
```

### Working Memory

Working memory is in-process (not on disk), capacity 7 items (FIFO/LRU/importance-based eviction).

```typescript
import { WorkingMemoryService } from "@reactive-agents/memory";

const workingMemory = Effect.gen(function* () {
  const wm = yield* WorkingMemoryService;

  // Add item (auto-evicts oldest if at capacity 7)
  yield* wm.add({
    content: "User prefers concise responses",
    importance: 0.9,
    source: { type: "user", id: "user-123" },
  });

  // Get all current items (up to 7)
  const items = yield* wm.getAll();

  // Clear working memory
  yield* wm.clear();
});
```

### Zettelkasten Knowledge Graph

The Zettelkasten link graph is stored in SQLite and available in both Tier 1 and Tier 2.

```typescript
import { ZettelkastenService } from "@reactive-agents/memory";

const zettelGraph = Effect.gen(function* () {
  const zettel = yield* ZettelkastenService;

  // Auto-link: LLM-driven extraction of relationship links between memory entries
  // Called automatically by MemoryService.snapshot() in Phase 7
  yield* zettel.autoLink([memoryId1, memoryId2]);

  // Manual link: create an explicit relationship
  yield* zettel.link({
    sourceId: memoryId1,
    targetId: memoryId2,
    relationship: "supports",           // "supports" | "contradicts" | "elaborates" | "requires"
    strength: 0.85,
  });

  // Traverse graph: find related memories
  const related = yield* zettel.traverse(memoryId1, { depth: 2 });
});
```

---

## 8. Tools: MCP Servers and Custom Functions

`createToolsLayer()` is the factory from `@reactive-agents/tools`.

### Built-in Skills

```typescript
import { createToolsLayer } from "@reactive-agents/tools";

const ToolsLayer = createToolsLayer({
  // Enable built-in skills (all optional, default: none enabled)
  skills: {
    webSearch: true,                    // DuckDuckGo + other providers
    fileOperations: true,               // Read/write files in sandbox
    codeExecution: true,                // Execute code in sandboxed Bun process
    httpClient: true,                   // Make HTTP requests
  },
  // Sandbox config for code execution
  sandbox: {
    maxMemoryMb: 256,
    maxCpuMs: 5000,
    allowNetwork: false,
  },
});
```

### MCP Server Configuration

```typescript
import { createToolsLayer } from "@reactive-agents/tools";

const ToolsWithMCP = createToolsLayer({
  mcpServers: [
    // Stdio transport (local process)
    {
      name: "filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/projects"],
    },
    // SSE transport (HTTP server)
    {
      name: "brave-search",
      transport: "sse",
      endpoint: "http://localhost:8080/mcp",
    },
    // WebSocket transport
    {
      name: "remote-tools",
      transport: "websocket",
      endpoint: "ws://tools.example.com/mcp",
    },
  ],
  // Auto-discover MCP servers from environment MCP_SERVERS json
  autoDiscover: true,
});
```

### Registering Custom Function Tools

```typescript
import { ToolService } from "@reactive-agents/tools";
import { Schema } from "effect";

const registerCustomTools = Effect.gen(function* () {
  const tools = yield* ToolService;

  // Register a custom function as a tool
  yield* tools.register({
    definition: {
      name: "calculate-price",
      description: "Calculate the price of a product with tax",
      parameters: [
        {
          name: "basePrice",
          type: "number",
          description: "Base price before tax",
          required: true,
        },
        {
          name: "taxRate",
          type: "number",
          description: "Tax rate as a decimal (e.g., 0.08 for 8%)",
          required: true,
          default: 0.08,
        },
      ],
      riskLevel: "low",
      timeoutMs: 100,
      requiresApproval: false,
      source: "function",
    },
    // The handler is a pure function wrapped in Effect
    handler: (input) =>
      Effect.sync(() => ({
        total: input.basePrice * (1 + input.taxRate),
        tax: input.basePrice * input.taxRate,
      })),
  });
});
```

### Calling Tools Manually

```typescript
import { ToolService } from "@reactive-agents/tools";

const callTool = (agentId: AgentId, sessionId: string) =>
  Effect.gen(function* () {
    const tools = yield* ToolService;

    const result = yield* tools.execute({
      toolName: "web-search",
      arguments: {
        query: "Effect-TS latest version",
        maxResults: 5,
      },
      agentId,
      sessionId,
    });

    // result: { toolName, success, result, executionTimeMs, metadata }
    return result;
  });
```

---

## 9. Reasoning Strategy Configuration

`createReasoningLayer()` is the factory from `@reactive-agents/reasoning`.

### Strategy Types

```typescript
// ReasoningStrategy = "reactive" | "plan-execute-reflect" | "tree-of-thought" | "reflexion" | "adaptive"

// reactive            — Single LLM call → answer. Fast, cheap. Best for simple Q&A.
// plan-execute-reflect — Plan → Execute steps → Reflect. Best for multi-step tasks.
// tree-of-thought     — Branch multiple solution paths, prune. Best for complex reasoning.
// reflexion           — Self-critique loop until high confidence. Best for accuracy.
// adaptive            — LLM-driven strategy selection at runtime. Best for mixed workloads.
```

### Explicit Strategy Selection

```typescript
import { createRuntime } from "@reactive-agents/runtime";
import { createReasoningLayer } from "@reactive-agents/reasoning";
import { Layer } from "effect";

// Force a specific strategy for all tasks
const RuntimeWithStrategy = createRuntime({
  agentId: "planner-agent",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  extraLayers: createReasoningLayer({
    defaultStrategy: "plan-execute-reflect",
    // StrategySelector skipped — always uses defaultStrategy
  }),
});
```

### Adaptive Strategy Selection (LLM-driven)

```typescript
import { createReasoningLayer } from "@reactive-agents/reasoning";

const ReasoningLayer = createReasoningLayer({
  defaultStrategy: "adaptive",
  // StrategySelector uses task complexity, input length, and memory context
  // to pick the best strategy at runtime
  selectorConfig: {
    complexityThreshold: 0.6,     // Use plan-execute-reflect above this
    treeOfThoughtThreshold: 0.85, // Use tree-of-thought for very complex tasks
    maxReflexionIterations: 3,    // Max self-critique loops for reflexion
  },
});
```

### Using StrategySelector Directly

```typescript
import { StrategySelector } from "@reactive-agents/reasoning";

const selectStrategy = (task: Task, memoryContext: unknown) =>
  Effect.gen(function* () {
    const selector = yield* StrategySelector;

    const selection = yield* selector.select(
      { task, userPreferences: { preferAccuracy: true } },
      memoryContext,
    );
    // Returns: { strategy: "reflexion", confidence: 0.88, reasoning: "..." }

    return selection;
  });
```

---

## 10. Interaction Modes

`createInteractionLayer()` is the factory from `@reactive-agents/interaction`.

### The 5 Interaction Modes

```typescript
// InteractionModeType:
// "autonomous"    — Fire-and-forget; agent runs to completion independently
// "supervised"    — Pause at milestones; user must approve before continuing
// "collaborative" — Real-time co-working; user sees incremental progress
// "consultative"  — Advisory; agent makes suggestions, user decides
// "interrogative" — Drill-down; user explores agent reasoning step-by-step
// "adaptive"      — AI-driven; agent selects and switches modes dynamically
```

### Supervised Mode (Human Approval at Checkpoints)

```typescript
import { createInteractionLayer } from "@reactive-agents/interaction";
import { InteractionManager } from "@reactive-agents/interaction";

const InteractionLayer = createInteractionLayer({
  defaultMode: "supervised",
  checkpoints: {
    // Pause at these phases and wait for approval
    phases: ["strategy-select", "act"],
    // Pause when cost exceeds this threshold mid-execution
    costThresholdUsd: 0.50,
    // Pause if confidence drops below this
    uncertaintyThreshold: 0.6,
  },
});

// In your application: handle checkpoint events
const runWithApprovals = (task: Task) =>
  Effect.gen(function* () {
    const manager = yield* InteractionManager;
    const engine = yield* ExecutionEngine;

    // Set up approval handler
    yield* manager.onCheckpoint((checkpoint) =>
      Effect.gen(function* () {
        // In a real app: send to UI, wait for user input
        console.log(`[Approval Required] Phase: ${checkpoint.phase}`);
        console.log(`  Action: ${checkpoint.proposedAction}`);
        console.log(`  Cost so far: $${checkpoint.currentCost}`);

        // Return "approve" | "reject" | "modify"
        return { decision: "approve" as const };
      }),
    );

    return yield* engine.execute(task);
  });
```

### Collaborative Mode (Real-time Progress)

```typescript
const InteractionLayer = createInteractionLayer({
  defaultMode: "collaborative",
  streaming: {
    // Stream incremental thoughts to the user
    broadcastThoughts: true,
    broadcastToolCalls: true,
  },
});

const runCollaboratively = (task: Task) =>
  Effect.gen(function* () {
    const manager = yield* InteractionManager;
    const engine = yield* ExecutionEngine;

    // Subscribe to progress events
    yield* manager.onProgress((event) =>
      Effect.sync(() => {
        switch (event.type) {
          case "thought":
            process.stdout.write(`\n💭 ${event.content}`);
            break;
          case "tool-call":
            console.log(`\n🔧 Calling: ${event.toolName}(${JSON.stringify(event.args)})`);
            break;
          case "observation":
            console.log(`\n👁  Result: ${event.content}`);
            break;
        }
      }),
    );

    return yield* engine.execute(task);
  });
```

### Adaptive Mode Switching

```typescript
import { ModeSwitcher } from "@reactive-agents/interaction";

// The ModeSwitcher automatically escalates/de-escalates based on:
// - Task complexity changes
// - Cost spikes
// - Uncertainty increases
// - User preference patterns (PreferenceLearner)

const InteractionLayer = createInteractionLayer({
  defaultMode: "adaptive",
  adaptiveRules: {
    escalateOnHighCost: { threshold: 1.0, targetMode: "supervised" },
    escalateOnUncertainty: { threshold: 0.5, targetMode: "collaborative" },
    deEscalateAfterNSuccesses: { n: 3, targetMode: "autonomous" },
  },
});
```

### Interrupt Rules

```typescript
const InteractionLayer = createInteractionLayer({
  defaultMode: "autonomous",
  interruptRules: [
    // Always interrupt for critical decisions
    { trigger: "critical-decision", severity: "critical", enabled: true },
    // Interrupt if cost exceeds $1.00
    { trigger: "high-cost", severity: "high", threshold: 1.00, enabled: true },
    // Interrupt if confidence drops below 50%
    { trigger: "uncertainty", severity: "medium", threshold: 0.5, enabled: true },
    // Interrupt on any error (default: enabled)
    { trigger: "error", severity: "high", enabled: true },
  ],
});
```

---

## 11. Lifecycle Hooks

Lifecycle hooks fire `before`, `after`, or `on-error` for each of the 10 execution phases.
They can read and mutate the `ExecutionContext`.

### Registering Hooks via ExecutionEngine

```typescript
import { ExecutionEngine } from "@reactive-agents/runtime";
import type { LifecycleHook } from "@reactive-agents/runtime";

const setupHooks = Effect.gen(function* () {
  const engine = yield* ExecutionEngine;

  // Log every phase entry
  yield* engine.registerHook({
    phase: "bootstrap",
    timing: "before",
    handler: (ctx) =>
      Effect.gen(function* () {
        yield* Effect.log(`[${ctx.taskId}] Starting bootstrap`);
        return ctx;
      }),
  });

  // Log cost after each loop iteration
  yield* engine.registerHook({
    phase: "observe",
    timing: "after",
    handler: (ctx) =>
      Effect.gen(function* () {
        yield* Effect.log(`[Iter ${ctx.iteration}] Cost so far: $${ctx.cost.toFixed(4)}`);
        return ctx;
      }),
  });

  // Inject custom data into context before think phase
  yield* engine.registerHook({
    phase: "think",
    timing: "before",
    handler: (ctx) =>
      Effect.succeed({
        ...ctx,
        metadata: {
          ...ctx.metadata,
          injectedAt: new Date().toISOString(),
        },
      }),
  });

  // Alert on any phase error
  yield* engine.registerHook({
    phase: "act",
    timing: "on-error",
    handler: (ctx) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Tool execution failed at iteration ${ctx.iteration}`);
        return ctx;
      }),
  });
});
```

### Hooks as a Composable Layer

```typescript
import { ExecutionEngine } from "@reactive-agents/runtime";
import { Layer, Effect } from "effect";

// Package hooks into a reusable Layer
const CostAlertHookLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* ExecutionEngine;

    yield* engine.registerHook({
      phase: "cost-track",
      timing: "after",
      handler: (ctx) =>
        Effect.gen(function* () {
          if (ctx.cost > 5.0) {
            yield* Effect.logWarning(`HIGH COST ALERT: Task ${ctx.taskId} has spent $${ctx.cost}`);
          }
          return ctx;
        }),
    });
  }),
);

const AuditHookLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* ExecutionEngine;

    yield* engine.registerHook({
      phase: "complete",
      timing: "after",
      handler: (ctx) =>
        Effect.gen(function* () {
          yield* Effect.log(JSON.stringify({
            event: "task_completed",
            taskId: ctx.taskId,
            agentId: ctx.agentId,
            iterations: ctx.iteration,
            cost: ctx.cost,
          }));
          return ctx;
        }),
    });
  }),
);

// Combine hook layers with runtime
const RuntimeWithHooks = createRuntime({
  agentId: "monitored-agent",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  extraLayers: Layer.mergeAll(CostAlertHookLayer, AuditHookLayer),
});
```

---

## 12. Guardrails & Safety

`createGuardrailsLayer()` is the factory from `@reactive-agents/guardrails`.

### Basic Guardrails Configuration

```typescript
import { createGuardrailsLayer } from "@reactive-agents/guardrails";

const GuardrailsLayer = createGuardrailsLayer({
  // Behavioral contracts: what the agent must/must not do
  contracts: [
    { type: "must-not", description: "Generate harmful content", severity: "critical" },
    { type: "must-not", description: "Execute arbitrary code without approval", severity: "high" },
    { type: "must", description: "Cite sources for factual claims", severity: "medium" },
  ],

  // PII detection: redact sensitive data before LLM calls
  piiDetection: {
    enabled: true,
    patterns: ["email", "phone", "ssn", "credit-card"],
    action: "redact",   // "redact" | "block" | "warn"
  },

  // Prompt injection defense
  injectionDefense: {
    enabled: true,
    level: "strict",   // "strict" | "moderate" | "permissive"
  },
});

// Wrap any Effect with guardrail checking
import { guarded } from "@reactive-agents/guardrails";

const safeOperation = guarded(
  Effect.gen(function* () {
    // This effect runs only if guardrails pass
    const engine = yield* ExecutionEngine;
    return yield* engine.execute(task);
  }),
  { agentId: "my-agent" },
);
```

---

## 13. Cost Optimization

`createCostLayer()` is the factory from `@reactive-agents/cost`.

### Budget Enforcement

```typescript
import { createCostLayer } from "@reactive-agents/cost";

const CostLayer = createCostLayer({
  // Hard monthly budget limit
  monthlyBudgetUsd: 500,

  // Per-task budget limit
  taskBudgetUsd: 2.00,

  // Model routing: auto-select cheapest model that meets quality requirements
  routing: {
    enabled: true,
    // Simple tasks → Haiku, Complex tasks → Sonnet, Critical → Opus
    complexityThresholds: {
      simple: 0.3,    // Below 0.3 → claude-haiku
      medium: 0.7,    // 0.3-0.7 → claude-sonnet
      complex: 0.9,   // 0.7-0.9 → claude-sonnet
      critical: 1.0,  // Above 0.9 → claude-opus
    },
  },

  // Semantic caching: return cached results for similar queries
  semanticCache: {
    enabled: true,
    similarityThreshold: 0.95,   // Cosine similarity (Tier 2 only for KNN)
    ttlSeconds: 3600,             // 1 hour cache TTL
    maxEntries: 10_000,
  },

  // Prompt compression: reduce token count for long prompts
  compression: {
    enabled: true,
    targetReductionPercent: 60,   // Aim for 60% fewer tokens
    strategy: "extractive",       // "extractive" | "abstractive"
  },
});
```

### Cost Tracking

```typescript
import { CostTracker } from "@reactive-agents/cost";

const getCostReport = Effect.gen(function* () {
  const tracker = yield* CostTracker;

  // Get cost for a single task
  const taskCost = yield* tracker.getTaskCost(taskId);

  // Get agent totals
  const agentCost = yield* tracker.getAgentCost(agentId, {
    period: "month",
    year: 2026,
    month: 2,
  });

  // Get live budget status
  const budget = yield* tracker.getBudgetStatus();
  // Returns: { used: 34.50, limit: 500.00, remaining: 465.50, percentUsed: 6.9 }

  return { taskCost, agentCost, budget };
});
```

---

## 14. Multi-Agent Orchestration

`createOrchestrationLayer()` is the factory from `@reactive-agents/orchestration`.

### Workflow Patterns (6 Anthropic Patterns)

```typescript
import { WorkflowEngine } from "@reactive-agents/orchestration";
import { Effect } from "effect";

// Pattern 1: Sequential Chain (output of each step is input to next)
const sequentialWorkflow = Effect.gen(function* () {
  const workflow = yield* WorkflowEngine;

  return yield* workflow.run({
    pattern: "sequential",
    steps: [
      { agentId: "researcher", task: { type: "research", input: { topic: "AI safety" } } },
      { agentId: "writer", task: { type: "generation", input: { format: "blog-post" } } },    // receives researcher output
      { agentId: "editor", task: { type: "action", input: { action: "review" } } },           // receives writer output
    ],
  });
});

// Pattern 2: Parallel Fan-out / Fan-in
const parallelWorkflow = Effect.gen(function* () {
  const workflow = yield* WorkflowEngine;

  return yield* workflow.run({
    pattern: "parallel",
    branches: [
      { agentId: "agent-a", task: { type: "analysis", input: { aspect: "technical" } } },
      { agentId: "agent-b", task: { type: "analysis", input: { aspect: "business" } } },
      { agentId: "agent-c", task: { type: "analysis", input: { aspect: "legal" } } },
    ],
    // Merge branch results into final report
    merge: { agentId: "synthesizer", task: { type: "generation", input: { format: "report" } } },
  });
});

// Pattern 3: Router (conditional routing to specialized agents)
const routerWorkflow = Effect.gen(function* () {
  const workflow = yield* WorkflowEngine;

  return yield* workflow.run({
    pattern: "router",
    classifier: { agentId: "classifier" },    // Classifies the input
    routes: {
      "code-question": { agentId: "code-expert" },
      "math-question": { agentId: "math-expert" },
      "general-question": { agentId: "generalist" },
    },
    fallback: { agentId: "generalist" },
  });
});

// Pattern 4: Evaluator-Optimizer (generate then improve)
const evaluatorWorkflow = Effect.gen(function* () {
  const workflow = yield* WorkflowEngine;

  return yield* workflow.run({
    pattern: "evaluator-optimizer",
    generator: { agentId: "writer" },
    evaluator: { agentId: "critic" },
    maxRounds: 3,
    targetScore: 0.9,
  });
});
```

### Agent Mesh (A2A Protocol)

```typescript
import { AgentMesh } from "@reactive-agents/orchestration";

const meshExample = Effect.gen(function* () {
  const mesh = yield* AgentMesh;

  // Discover available peers
  const peers = yield* mesh.discover();

  // Send a task to a remote agent (A2A protocol)
  const response = yield* mesh.sendTask("agent-456", {
    type: "research",
    input: { topic: "quantum computing" },
  });

  // Subscribe to events from other agents
  yield* mesh.subscribe("agent-789", "task.completed", (event) =>
    Effect.log(`Remote agent completed: ${JSON.stringify(event)}`),
  );
});
```

### Durable Execution (Event Sourcing)

Tasks can survive crashes and resume from the last checkpoint.

```typescript
import { DurableExecution } from "@reactive-agents/orchestration";

const durableTask = Effect.gen(function* () {
  const durable = yield* DurableExecution;

  // Start a durable task — checkpoint saved after each phase
  const execId = yield* durable.start({
    agentId: "research-agent",
    task: longRunningResearchTask,
    checkpointAfterEachPhase: true,
    ttlDays: 7,
  });

  // Resume after crash
  const result = yield* durable.resume(execId);

  // List all inflight durable executions
  const inflight = yield* durable.listActive();
});
```

---

## 15. Observability & Tracing

`createObservabilityLayer()` is the factory from `@reactive-agents/observability`.

### OpenTelemetry Setup

```typescript
import { createObservabilityLayer } from "@reactive-agents/observability";

const ObservabilityLayer = createObservabilityLayer({
  serviceName: "my-agent-service",
  serviceVersion: "1.0.0",

  // Tracing (W3C distributed tracing)
  tracing: {
    enabled: true,
    // Export to Jaeger, Zipkin, Honeycomb, etc.
    exporter: "otlp",
    endpoint: "http://localhost:4318/v1/traces",
  },

  // Metrics
  metrics: {
    enabled: true,
    // Track: cost per task, latency per phase, token usage, accuracy
    trackCost: true,
    trackLatency: true,
    trackTokens: true,
    trackAccuracy: true,
  },

  // Structured JSON logging
  logging: {
    enabled: true,
    level: "info",    // "debug" | "info" | "warn" | "error"
    format: "json",
  },
});
```

### Accessing Metrics Programmatically

```typescript
import { MetricsService, TracingService } from "@reactive-agents/observability";

const getMetrics = Effect.gen(function* () {
  const metrics = yield* MetricsService;

  const report = yield* metrics.getReport({
    agentId: "my-agent",
    period: "7d",
  });
  // Returns: { totalCost, avgCostPerTask, avgLatencyMs, successRate, p95LatencyMs }

  return report;
});
```

---

## 16. Testing Patterns

### Unit Testing a Service

```typescript
// tests/my-service.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import { AgentService, CoreServicesLive } from "@reactive-agents/core";

describe("AgentService", () => {
  it("should create an agent", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const agents = yield* AgentService;
        return yield* agents.create({
          name: "test-agent",
          capabilities: [{ type: "reasoning", name: "reactive" }],
        });
      }).pipe(Effect.provide(CoreServicesLive)),
    );

    expect(result.name).toBe("test-agent");
    expect(result.id).toBeDefined();
  });
});
```

### Integration Testing with Mock LLM

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import { ExecutionEngine, createRuntime } from "@reactive-agents/runtime";
import { LLMService } from "@reactive-agents/llm-provider";

// Mock LLM that always returns a completed response
const MockLLMServiceLive = Layer.succeed(
  LLMService,
  {
    complete: (_req) =>
      Effect.succeed({
        content: "The answer is 42.",
        stopReason: "end_turn",
        toolCalls: [],
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          estimatedCost: 0.0001,
        },
        model: "mock",
      }),
    stream: (_req) => Stream.make({ delta: "The answer is 42.", done: true }),
    structured: (_req) => Effect.succeed({ answer: 42 }),
    embed: (_texts, _config) => Effect.succeed([[0.1, 0.2, 0.3]]),
    countTokens: (_messages) => Effect.succeed(15),
  },
);

describe("ExecutionEngine integration", () => {
  // Build a test runtime with mock LLM
  const TestRuntime = createRuntime({
    agentId: "test-agent",
    anthropicApiKey: "not-used",
    extraLayers: MockLLMServiceLive,
  });

  it("should execute a task end-to-end", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        const agents = yield* AgentService;
        const tasks = yield* TaskService;

        const agent = yield* agents.create({
          name: "test-agent",
          capabilities: [{ type: "reasoning", name: "reactive" }],
        });

        const task = yield* tasks.create({
          agentId: agent.id,
          type: "query",
          input: { question: "What is the answer to life?" },
          priority: "low",
        });

        return yield* engine.execute(task);
      }).pipe(Effect.provide(TestRuntime)),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("42");
  });
});
```

### Testing with Tool Mocks

```typescript
import { ToolService } from "@reactive-agents/tools";

const MockToolServiceLive = Layer.succeed(
  ToolService,
  {
    execute: (input) =>
      Effect.succeed({
        toolName: input.toolName,
        success: true,
        result: { data: "mocked tool result" },
        executionTimeMs: 5,
      }),
    register: (_def) => Effect.void,
    list: () => Effect.succeed([]),
  },
);
```

### Memory Test Helpers

```typescript
// Use an in-memory SQLite database for tests (not on disk)
import { createMemoryLayer } from "@reactive-agents/memory";

const TestMemoryLayer = createMemoryLayer("1", {
  agentId: "test-agent",
  dbPath: ":memory:",   // SQLite in-memory mode — no files created
});
```

---

## 17. Complete Examples

### Example A: Research Agent

A fully configured research agent with web search, semantic memory, verification, and cost controls.

```typescript
import { Effect, Layer } from "effect";
import { createRuntime, ExecutionEngine } from "@reactive-agents/runtime";
import { AgentService, TaskService } from "@reactive-agents/core";
import { createToolsLayer } from "@reactive-agents/tools";
import { createVerificationLayer } from "@reactive-agents/verification";
import { createCostLayer } from "@reactive-agents/cost";
import { createInteractionLayer } from "@reactive-agents/interaction";

// ─── Runtime Configuration ─────────────────────────────────────────────
const ResearchRuntime = createRuntime({
  agentId: "research-assistant",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  memoryTier: "2",          // Vector search for semantic memory
  maxIterations: 20,
  enableVerification: true,
  enableCostTracking: true,
  extraLayers: Layer.mergeAll(
    // Tools: web search + file write
    createToolsLayer({
      mcpServers: [
        { name: "web-search", transport: "stdio", command: "npx", args: ["-y", "mcp-web-search"] },
      ],
      skills: { fileOperations: true },
    }),
    // Verification: multi-source check for research accuracy
    createVerificationLayer({
      defaultRiskLevel: "medium",
      layers: ["semantic-entropy", "multi-source"],
    }),
    // Cost: $5 budget per task, auto-route to cheapest adequate model
    createCostLayer({
      taskBudgetUsd: 5.00,
      monthlyBudgetUsd: 500,
      routing: { enabled: true },
    }),
    // Supervised interaction: user approves tool calls >5s timeout
    createInteractionLayer({
      defaultMode: "supervised",
      checkpoints: { phases: ["act"], costThresholdUsd: 1.00 },
    }),
  ),
});

// ─── Run a Research Task ────────────────────────────────────────────────
async function research(question: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const agents = yield* AgentService;
      const tasks = yield* TaskService;
      const engine = yield* ExecutionEngine;

      const agent = yield* agents.create({
        name: "research-assistant",
        capabilities: [
          { type: "reasoning", name: "plan-execute-reflect" },
          { type: "tool", name: "web-search" },
          { type: "tool", name: "file-operations" },
          { type: "memory", name: "semantic" },
          { type: "memory", name: "episodic" },
        ],
      });

      const task = yield* tasks.create({
        agentId: agent.id,
        type: "research",
        input: {
          question,
          depth: "comprehensive",
          outputFormat: "markdown-report",
          citeSources: true,
        },
        priority: "medium",
        metadata: { tags: ["research", "web"] },
      });

      const result = yield* engine.execute(task);

      return {
        report: result.output as string,
        cost: result.metadata.cost,
        verificationScore: result.metadata.verificationScore,
        sourcesCount: result.metadata.toolsUsed.length,
      };
    }).pipe(Effect.provide(ResearchRuntime)),
  );
}

// Usage
const report = await research("What are the latest developments in AI agent frameworks?");
console.log(report.report);
console.log(`Cost: $${report.cost.toFixed(4)} | Verification: ${report.verificationScore}`);
```

---

### Example B: Code Review Agent (Autonomous + Lifecycle Hooks)

```typescript
import { Effect, Layer } from "effect";
import { createRuntime, ExecutionEngine } from "@reactive-agents/runtime";
import { AgentService, TaskService } from "@reactive-agents/core";
import { createToolsLayer } from "@reactive-agents/tools";
import { createGuardrailsLayer } from "@reactive-agents/guardrails";

// ─── Hook Layer: log every phase, alert on high cost ────────────────────
const MonitoringHookLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* ExecutionEngine;

    // Log phase entries
    for (const phase of ["bootstrap", "think", "act", "verify", "complete"] as const) {
      yield* engine.registerHook({
        phase,
        timing: "after",
        handler: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.log(`[${ctx.agentState}] Phase '${phase}' completed. Cost: $${ctx.cost.toFixed(4)}`);
            return ctx;
          }),
      });
    }

    // Cost alert
    yield* engine.registerHook({
      phase: "cost-track",
      timing: "after",
      handler: (ctx) =>
        Effect.gen(function* () {
          if (ctx.cost > 1.0) {
            yield* Effect.logWarning(`Cost exceeded $1.00 for task ${ctx.taskId}`);
          }
          return ctx;
        }),
    });
  }),
);

// ─── Runtime ────────────────────────────────────────────────────────────
const CodeReviewRuntime = createRuntime({
  agentId: "code-reviewer",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  memoryTier: "1",
  enableGuardrails: true,
  extraLayers: Layer.mergeAll(
    createToolsLayer({
      skills: { fileOperations: true, codeExecution: true },
    }),
    createGuardrailsLayer({
      contracts: [
        { type: "must-not", description: "Delete or overwrite files without approval", severity: "critical" },
        { type: "must", description: "Provide actionable feedback for each issue found", severity: "medium" },
      ],
    }),
    MonitoringHookLayer,
  ),
});

// ─── Review a Pull Request ───────────────────────────────────────────────
async function reviewCode(filePaths: string[], prDescription: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const agents = yield* AgentService;
      const tasks = yield* TaskService;
      const engine = yield* ExecutionEngine;

      const agent = yield* agents.create({
        name: "code-reviewer",
        capabilities: [
          { type: "reasoning", name: "plan-execute-reflect" },
          { type: "tool", name: "file-operations" },
          { type: "tool", name: "code-execution" },
        ],
      });

      const task = yield* tasks.create({
        agentId: agent.id,
        type: "analysis",
        input: {
          filePaths,
          prDescription,
          reviewFocus: ["correctness", "performance", "security", "style"],
          outputFormat: "structured-review",
        },
        priority: "high",
      });

      return yield* engine.execute(task);
    }).pipe(Effect.provide(CodeReviewRuntime)),
  );
}
```

---

### Example C: Minimal Custom Service Integration

Demonstrating how to inject a custom service into the Effect context alongside framework services.

```typescript
import { Effect, Context, Layer } from "effect";
import { createRuntime, ExecutionEngine } from "@reactive-agents/runtime";

// ─── Custom Service Definition ────────────────────────────────────────
// All custom services follow the same Context.Tag + Layer.effect pattern

interface DatabaseRecord { id: string; data: unknown }

class DatabaseService extends Context.Tag("DatabaseService")<
  DatabaseService,
  {
    readonly query: (sql: string) => Effect.Effect<DatabaseRecord[], never>;
    readonly insert: (record: Omit<DatabaseRecord, "id">) => Effect.Effect<DatabaseRecord, never>;
  }
>() {}

// Simulated implementation
const DatabaseServiceLive = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    const records: DatabaseRecord[] = [];
    let nextId = 1;

    return {
      query: (_sql) => Effect.succeed([...records]),
      insert: (record) =>
        Effect.gen(function* () {
          const newRecord = { id: String(nextId++), ...record };
          records.push(newRecord);
          return newRecord;
        }),
    };
  }),
);

// ─── Runtime with Custom Service ─────────────────────────────────────
const AppRuntime = createRuntime({
  agentId: "db-agent",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  extraLayers: DatabaseServiceLive,
});

// ─── Use Both Framework and Custom Services Together ──────────────────
const appProgram = Effect.gen(function* () {
  const engine = yield* ExecutionEngine;
  const db = yield* DatabaseService;

  // Custom service: fetch existing records
  const records = yield* db.query("SELECT * FROM tasks");

  // Framework service: run an analysis task
  const task = yield* TaskService.pipe(
    Effect.flatMap((tasks) =>
      tasks.create({
        agentId: "db-agent" as AgentId,
        type: "analysis",
        input: { records, analysisType: "trend-detection" },
        priority: "medium",
      }),
    ),
  );

  const result = yield* engine.execute(task);

  // Custom service: persist the result
  yield* db.insert({ data: result.output });

  return result;
}).pipe(Effect.provide(AppRuntime));
```

---

## 18. Error Handling Reference

All framework errors are `Data.TaggedError` instances — never thrown, always typed in Effect.

```typescript
// From @reactive-agents/runtime
import {
  ExecutionError,         // Phase execution failure
  HookError,              // Lifecycle hook failure
  MaxIterationsError,     // Agent loop exceeded maxIterations
  GuardrailViolationError, // Input/output violated a guardrail policy
} from "@reactive-agents/runtime";

// From @reactive-agents/core
import {
  AgentError,             // AgentService operation failure
  TaskError,              // TaskService operation failure
  EventBusError,          // EventBus publish/subscribe failure
  ContextWindowError,     // Context window overflow
} from "@reactive-agents/core";

// From @reactive-agents/llm-provider
import {
  LLMError,               // LLM API call failure
  RateLimitError,         // Rate limit hit (retried automatically)
  TokenLimitError,        // Context window exceeded
  StructuredOutputError,  // Schema validation failure on structured output
} from "@reactive-agents/llm-provider";

// From @reactive-agents/memory
import {
  MemoryError,            // SQLite read/write failure
  MemoryCapacityError,    // Working memory capacity exceeded (eviction occurred)
  EmbeddingError,         // Embedding generation failure (Tier 2)
} from "@reactive-agents/memory";

// From @reactive-agents/tools
import {
  ToolError,              // Generic tool failure
  ToolNotFoundError,      // Requested tool not registered
  ToolExecutionError,     // Tool execution failure (includes sandbox errors)
  MCPError,               // MCP protocol error
  SandboxError,           // Sandboxed execution error
} from "@reactive-agents/tools";

// Pattern: typed error handling in Effect.gen
const safeRun = (task: Task) =>
  engine.execute(task).pipe(
    Effect.catchTag("MaxIterationsError", (e) => /* handle */ Effect.succeed(fallback)),
    Effect.catchTag("GuardrailViolationError", (e) => /* handle */ Effect.succeed(fallback)),
    Effect.catchTag("ExecutionError", (e) => Effect.die(e)),   // unrecoverable
  );
```

---

## 19. Configuration Reference

### ReactiveAgentsConfig (Full)

```typescript
// From @reactive-agents/runtime src/types.ts
interface ReactiveAgentsConfig {
  // ─── Required ───
  agentId: string;                    // Agent ID (used as memory namespace)

  // ─── Agent Loop ───
  maxIterations: number;              // Max think/act/observe cycles (default: 10)

  // ─── Memory ───
  memoryTier: "1" | "2";             // "1" = FTS5 only, "2" = FTS5 + sqlite-vec (default: "1")

  // ─── Optional Phases (default: all false in Phase 1) ───
  enableGuardrails: boolean;          // Phase 2: GuardrailService.check()
  enableVerification: boolean;        // Phase 6: VerificationService.verify()
  enableCostTracking: boolean;        // Phases 3 + 8: CostRouter + CostTracker
  enableAudit: boolean;               // Phase 9: AuditService.log()

  // ─── LLM Defaults ───
  defaultModel?: ModelConfig;         // Fallback model if CostRouter not enabled
}

// Helper: sensible defaults for Phase 1
const config = defaultReactiveAgentsConfig("my-agent");
// → { maxIterations: 10, memoryTier: "1", enableGuardrails: false, ... }
```

### createRuntime() Options (Full)

```typescript
createRuntime({
  // ─── Required ───
  agentId: string,                    // Unique agent identifier (also memory namespace)
  anthropicApiKey: string,            // Anthropic API key (use "" if using OpenAI only)

  // ─── Optional ───
  memoryTier?: "1" | "2",            // Default: "1"
  maxIterations?: number,             // Default: 10
  enableGuardrails?: boolean,         // Default: false
  enableVerification?: boolean,       // Default: false
  enableCostTracking?: boolean,       // Default: false
  enableAudit?: boolean,              // Default: false
  extraLayers?: Layer.Layer<any, any>, // Additional layers merged into runtime
})
```

### Layer Factory Summary

| Factory | Package | Purpose |
|---|---|---|
| `createRuntime(opts)` | `@reactive-agents/runtime` | **Main entry point** — composes all layers |
| `CoreServicesLive` | `@reactive-agents/core` | EventBus, AgentService, TaskService, CWM |
| `createLLMLayer(opts)` | `@reactive-agents/llm-provider` | Anthropic/OpenAI/Ollama LLMService |
| `createMemoryLayer("1"\|"2", opts)` | `@reactive-agents/memory` | bun:sqlite memory system |
| `createToolsLayer(opts)` | `@reactive-agents/tools` | MCP client + built-in skills |
| `createReasoningLayer(opts)` | `@reactive-agents/reasoning` | 5 reasoning strategies |
| `createVerificationLayer(opts)` | `@reactive-agents/verification` | 5-layer hallucination detection |
| `createCostLayer(opts)` | `@reactive-agents/cost` | Budget enforcement + model routing |
| `createIdentityLayer(opts)` | `@reactive-agents/identity` | Ed25519 certs + RBAC + audit |
| `createOrchestrationLayer(opts)` | `@reactive-agents/orchestration` | Workflows + AgentMesh + A2A |
| `createObservabilityLayer(opts)` | `@reactive-agents/observability` | OpenTelemetry tracing + metrics |
| `createInteractionLayer(opts)` | `@reactive-agents/interaction` | 5 interaction modes |
| `createGuardrailsLayer(opts)` | `@reactive-agents/guardrails` | Contracts + PII + injection defense |

---

## See Also

- [START_HERE_AI_AGENTS.md](START_HERE_AI_AGENTS.md) — Build order and mandatory patterns
- [00-master-architecture.md](00-master-architecture.md) — Layer diagram and data flow
- [layer-01b-execution-engine.md](layer-01b-execution-engine.md) — ExecutionEngine + `createRuntime()` source spec
- [layer-01-core-detailed-design.md](layer-01-core-detailed-design.md) — AgentService, TaskService, EventBus
- [01.5-layer-llm-provider.md](01.5-layer-llm-provider.md) — LLMService, ModelPresets, streaming
- [02-layer-memory.md](02-layer-memory.md) — Memory tiers, MemoryService, Zettelkasten
- [08-layer-tools.md](08-layer-tools.md) — ToolService, MCP protocol, skill bundles
- [DOCUMENT_INDEX.md](DOCUMENT_INDEX.md) — Complete spec document index
