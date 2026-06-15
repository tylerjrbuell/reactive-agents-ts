import { Schema } from "effect";
import {
  ContextProfileSchema,
  SynthesisConfigJsonSchema,
  KernelMetaToolsSchema,
} from "@reactive-agents/reasoning";
import type { SynthesisConfigJson, SynthesisStrategy } from "@reactive-agents/reasoning";
import {
  ReasoningOptionsJsonSchema,
  type ReasoningOptionsEncoded,
} from "./reasoning-options-schema.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { TaskComplexity } from "./telemetry-enrichment.js";
import type { RawHookResult } from "./hooks-normalize.js";
export type { RawHookResult } from "./hooks-normalize.js";

/**
 * Calibration mode for `.withCalibration()`:
 *  - `"skip"` (default): no calibration lookup, use pure tier-based adapters.
 *  - `"auto"`: load pre-baked or cached calibration for the resolved modelId, if any.
 *  - `ModelCalibration` object: use the supplied calibration directly.
 */
export type CalibrationMode = "auto" | "skip" | ModelCalibration;

/**
 * Lifecycle phases — execution stages an agent goes through to process a task.
 *
 * The ExecutionEngine runs phases in sequence, calling lifecycle hooks before/after each phase.
 * Phases provide structure for observability, auditing, and control (pause/resume).
 *
 * Order of execution:
 * 1. `bootstrap` — Initialize execution context, load memories, prepare execution
 * 2. `guardrail` — Check for injection attacks, PII, policy violations
 * 3. `cost-route` — Estimate task complexity and route to appropriate strategy
 * 4. `strategy-select` — Choose reasoning strategy based on task and history
 * 5. `think` — Run multi-step reasoning loop (iterations of LLM + tool calls)
 * 6. `act` — Execute tool calls from reasoning
 * 7. `observe` — Process tool results and update context
 * 8. `verify` — Check answer quality and confidence (semantic verification)
 * 9. `memory-flush` — Persist new memories (episodic, procedural, experiences)
 * 10. `cost-track` — Record token usage and cost metrics
 * 11. `audit` — Log events for compliance and monitoring
 * 12. `complete` — Finalize execution, return result
 */
export const LifecyclePhase = Schema.Literal(
  /** Initialize execution context, load memories, prepare execution */
  "bootstrap",
  /** Check for injection attacks, PII, policy violations */
  "guardrail",
  /** Estimate task complexity and route to appropriate strategy */
  "cost-route",
  /** Choose reasoning strategy based on task and history */
  "strategy-select",
  /** Run multi-step reasoning loop (iterations of LLM + tool calls) */
  "think",
  /** Execute tool calls from reasoning */
  "act",
  /** Process tool results and update context */
  "observe",
  /** Check answer quality and confidence (semantic verification) */
  "verify",
  /** Persist new memories (episodic, procedural, experiences) */
  "memory-flush",
  /** Record token usage and cost metrics */
  "cost-track",
  /** Log events for compliance and monitoring */
  "audit",
  /** Finalize execution, return result */
  "complete",
);
export type LifecyclePhase = typeof LifecyclePhase.Type;

/**
 * When a lifecycle hook is invoked relative to its phase.
 *
 * - `"before"` — Called before the phase executes (can inspect context, add logging)
 * - `"after"` — Called after the phase completes (can inspect results, enforce post-conditions)
 * - `"on-error"` — Called only if the phase threw an error (can log, recover, re-throw)
 */
export const HookTiming = Schema.Literal(
  /** Invoked before the phase executes */
  "before",
  /** Invoked after the phase completes successfully */
  "after",
  /** Invoked only if the phase threw an error */
  "on-error",
);
export type HookTiming = typeof HookTiming.Type;

/**
 * Agent lifecycle state machine — represents the current state of an agent instance.
 *
 * State transitions:
 * - `idle` → `bootstrapping` → `running` → ...
 * - `running` → `paused` → `running` (via pause/resume)
 * - `running` → `verifying` → ...
 * - `verifying` → `flushing` → `completed` or `failed`
 * - Any state → `failed` (on error)
 */
export const AgentState = Schema.Literal(
  /** Not executing (initial or after completion) */
  "idle",
  /** Initializing context, loading memories */
  "bootstrapping",
  /** Actively executing reasoning/tool calls */
  "running",
  /** Paused at a phase boundary (can resume) */
  "paused",
  /** Running semantic verification on answer */
  "verifying",
  /** Flushing memories to persistent storage */
  "flushing",
  /** Successfully completed */
  "completed",
  /** Failed due to error or guard violation */
  "failed",
);
export type AgentState = typeof AgentState.Type;

/**
 * Execution context passed between lifecycle phases.
 *
 * Represents the current state of task execution. Hooks receive and can modify the context.
 * The context is accumulated throughout the execution, preserving message history, tool results,
 * metadata, and timing information.
 *
 * @example
 * ```typescript
 * interface ExecutionContext {
 *   taskId: "task-12345",
 *   agentId: "agent-1",
 *   phase: "act",
 *   iteration: 3,
 *   messages: [...],
 *   tokensUsed: 1250,
 *   cost: 0.00123,
 *   metadata: { tags: ["important"], reasoning: "..." }
 * }
 * ```
 */
export const ExecutionContextSchema = Schema.Struct({
  /** Unique task ID (generated at start of execution) */
  taskId: Schema.String,
  /** Agent ID this task belongs to */
  agentId: Schema.String,
  /** Session ID for grouping related tasks */
  sessionId: Schema.String,
  /** Current lifecycle phase */
  phase: LifecyclePhase,
  /** Current agent state (running, paused, etc.) */
  agentState: AgentState,
  /** Current iteration number (0-indexed) in the reasoning loop */
  iteration: Schema.Number,
  /** Maximum iterations allowed before stopping */
  maxIterations: Schema.Number,
  /** Conversation messages (system, user, assistant, tool results) */
  messages: Schema.Array(Schema.Unknown),
  /** Context from memory systems (episodic, semantic, procedural) — optional for memory tier 1 */
  memoryContext: Schema.optional(Schema.Unknown),
  /** Name of the selected reasoning strategy (e.g., "reactive", "tree-of-thought") */
  selectedStrategy: Schema.optional(Schema.String),
  /** Model object used for this execution (updated after LLM call) */
  selectedModel: Schema.optional(Schema.Unknown),
  /** LLM provider name (e.g., "anthropic", "openai") */
  provider: Schema.optional(Schema.String),
  /** Array of tool call results from this iteration */
  toolResults: Schema.Array(Schema.Unknown),
  /** Cumulative cost in USD */
  cost: Schema.Number,
  /** Cumulative tokens consumed */
  tokensUsed: Schema.Number,
  /** Timestamp when execution started */
  startedAt: Schema.DateFromSelf,
  /** Arbitrary metadata (tags, custom data, state) */
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  /** Last LLM request (populated by execution engine before after-hooks) */
  lastLLMRequest: Schema.optional(Schema.Unknown),
  /** Last LLM response (populated by execution engine before after-hooks) */
  lastLLMResponse: Schema.optional(Schema.Unknown),
  /** Names of tools available in this iteration */
  availableTools: Schema.optional(Schema.Array(Schema.String)),
  /** Trace ID for correlating logs across phases */
  traceId: Schema.optional(Schema.String),
});

/**
 * Well-known fields written to / read from `ExecutionContext.metadata` by the
 * execution engine and its phase modules. The index signature `[key: string]:
 * unknown` preserves backward-compat for hooks and extensions that attach
 * arbitrary values.
 */
export interface ExecutionContextMetadata {
  // ── Reasoning path ─────────────────────────────────────────────────────
  /** Normalized result from ReasoningService.execute() (reasoning path only) */
  reasoningResult?: {
    output: unknown;
    status: string;
    strategy?: string;
    steps?: readonly {
      id: string;
      type: string;
      content: string;
      metadata?: {
        toolUsed?: string;
        duration?: number;
        observationResult?: { success?: boolean; toolName?: string };
      };
    }[];
    metadata: {
      cost: number;
      tokensUsed: number;
      /** Prompt/input tokens (optional — strategy/provider may not split). */
      inputTokens?: number;
      /** Completion/output tokens (optional — see inputTokens). */
      outputTokens?: number;
      stepsCount: number;
      duration?: number;
      strategyFallback?: boolean;
      confidence?: number;
      llmCalls?: number;
      terminatedBy?: string;
      /**
       * Open-string channel preserving raw kernel `state.meta.terminatedBy`
       * BEFORE narrowing to the closed TerminatedBy 5-value enum. Carries
       * dynamic killswitch reasons (e.g. "budget-limit:tokens:1/0") and the
       * enumerable TerminateReason values. Distinct from `terminatedBy`
       * above which is the closed-enum normalized result.
       */
      rawTerminatedBy?: string;
      reflexionCritiques?: string[];
      finalAnswerCapture?: unknown;
    };
  };
  /** Flattened step array written after reasoning completes */
  reasoningSteps?: readonly {
    id: string;
    type: string;
    content: string;
    metadata?: {
      toolUsed?: string;
      duration?: number;
      observationResult?: { success?: boolean; toolName?: string };
    };
  }[];
  /** Total number of reasoning steps taken */
  stepsCount?: number;

  // ── Direct-LLM path ─────────────────────────────────────────────────────
  /** Final text response from the direct-LLM path */
  lastResponse?: string;
  /** Tool calls accumulated but not yet executed (direct-LLM path) */
  pendingToolCalls?: readonly unknown[];
  /** Whether the direct-LLM path has reached a terminal state */
  isComplete?: boolean;
  /** Number of LLM calls made on the direct-LLM path */
  llmCalls?: number;

  // ── Verification ────────────────────────────────────────────────────────
  /** Result written by the verify phase (runtime VerificationService shape) */
  verificationResult?: {
    passed?: boolean;
    overallScore?: number;
    recommendation?: string;
    layerResults?: readonly { passed?: boolean; layerName?: string; details?: string }[];
  };
  /** How many verification retries have been attempted this run */
  verificationRetryCount?: number;
  /** Feedback string from the most-recent failed verification */
  verificationFeedback?: string;
  /** Guardrail score recorded by the guardrail phase */
  guardrailScore?: number;
  /** Verification score (alias of verificationResult.overallScore, written by verify phase) */
  verificationScore?: number;

  // ── Skill / learning ────────────────────────────────────────────────────
  /** Serialized skill catalog XML injected into the system prompt */
  skillCatalogXml?: string;
  /** Skills resolved for this task */
  resolvedSkills?: readonly { name?: string; description?: string }[];
  /** ID of the skill that was applied this run */
  appliedSkillId?: string;
  /** Mean entropy of the applied skill */
  appliedSkillMeanEntropy?: number;

  // ── Cache ────────────────────────────────────────────────────────────────
  /** Set to true by cache-check phase when a semantic cache hit is returned */
  cacheHit?: boolean;

  // ── Complexity / budget ──────────────────────────────────────────────────
  /** Complexity classification written by memory-flush-dispatch */
  taskComplexity?: TaskComplexity;
  /** Set when the token/cost budget is exceeded */
  budgetExceeded?: boolean;

  // ── Termination ─────────────────────────────────────────────────────────
  /**
   * Closed-enum termination reason narrowed at the reasoning-strategy
   * boundary. One of the 5 TerminatedBy values.
   */
  terminatedBy?: string;
  /**
   * Raw kernel termination reason preserved BEFORE narrowing. Carries
   * dynamic killswitch reasons (e.g. "budget-limit:tokens:1/0") and the
   * enumerable TerminateReason values. Surfaced to consumers via
   * AgentCompleted.terminationReason.
   */
  rawTerminatedBy?: string;

  // ── Free-form for hooks / extensions ────────────────────────────────────
  [key: string]: unknown;
}

/**
 * Execution context passed between lifecycle phases.
 *
 * The `metadata` field is typed as {@link ExecutionContextMetadata} at the
 * TypeScript level while remaining `Record<string, unknown>` at the Effect
 * Schema / runtime level. The Omit & intersection pattern avoids touching the
 * Schema definition so encoding/decoding is unaffected.
 */
export type ExecutionContext = Omit<typeof ExecutionContextSchema.Type, "metadata"> & {
  metadata: ExecutionContextMetadata;
};

/**
 * Result from a single tool call — captured and stored in execution context.
 *
 * Tool results are logged to episodic memory and included in the context window
 * for the next reasoning iteration.
 */
export const ToolResultSchema = Schema.Struct({
  /** Unique identifier for this tool call */
  toolCallId: Schema.String,
  /** Name of the tool that was called */
  toolName: Schema.String,
  /** Result data from the tool (any JSON-serializable value) */
  result: Schema.Unknown,
  /** Error message if the tool call failed — if present, result may be undefined */
  error: Schema.optional(Schema.String),
  /** Wall-clock duration in milliseconds */
  durationMs: Schema.Number,
});
export type ToolResult = typeof ToolResultSchema.Type;

/**
 * Lifecycle hook — code executed at specific phases of agent execution.
 *
 * Hooks can be registered via `.withHook()` on the builder. Multiple hooks can be registered;
 * they execute in registration order. Hooks receive the execution context and can inspect
 * or modify it. An after-hook receives the context with results from the phase.
 *
 * @example
 * ```typescript
 * const hook: LifecycleHook = {
 *   phase: "think",
 *   timing: "after",
 *   handler: (ctx) => Effect.sync(() => {
 *     console.log(`Iteration ${ctx.iteration}: ${ctx.selectedStrategy}`);
 *     return ctx; // Must return the (possibly modified) context
 *   })
 * };
 * ```
 */
export interface LifecycleHook {
  /** Lifecycle phase to hook into */
  readonly phase: LifecyclePhase;
  /** When to invoke the hook relative to the phase */
  readonly timing: HookTiming;
  /**
   * Handler invoked with the current execution context.
   *
   * Return the (possibly modified) context to pass it down the phase chain,
   * or return nothing to observe without changing it. Plain values, Promises,
   * and Effects are all accepted — you do NOT need to import Effect:
   *
   * ```ts
   * handler: (ctx) => { console.log(ctx.iteration); }          // observe
   * handler: (ctx) => ({ ...ctx, foo: 1 })                      // modify
   * handler: async (ctx) => { await save(ctx); return ctx; }    // async
   * ```
   *
   * A thrown error (or rejected Promise / failed Effect) propagates as a
   * `HookError`.
   */
  readonly handler: (ctx: ExecutionContext) => RawHookResult;
}

/**
 * Model parameters for the builder's `.withModel()` method.
 * Allows setting model name along with thinking mode, temperature, and maxTokens.
 *
 * @example
 * ```typescript
 * builder.withModel({ model: "qwen3.5", thinking: true, temperature: 0.5 })
 * ```
 */
export const ModelParamsSchema = Schema.Struct({
  /** Model identifier (provider-specific) */
  model: Schema.String,
  /** Enable/disable thinking mode (auto-detect if omitted) */
  thinking: Schema.optional(Schema.Boolean),
  /** Sampling temperature 0.0-1.0 */
  temperature: Schema.optional(Schema.Number),
  /** Maximum output tokens */
  maxTokens: Schema.optional(Schema.Number),
  /** Context window size for local providers (Ollama `options.num_ctx`); ignored by hosted providers */
  numCtx: Schema.optional(Schema.Number),
});
export type ModelParams = typeof ModelParamsSchema.Type;

/**
 * Looser `withModel()` input that allows omitting `model` — used to apply
 * `thinking`/`temperature`/`maxTokens`/`numCtx` while letting the provider
 * default the model. `ModelParams` is assignable to this type.
 */
export type ModelParamsInput = Omit<ModelParams, "model"> & { model?: string };

/**
 * Internal configuration for the Reactive Agents runtime.
 *
 * This is produced from RuntimeOptions and passed to ExecutionEngine and other core services.
 * It encodes all feature flags and behavioral settings required by the execution layer.
 */
export const ReactiveAgentsConfigSchema = Schema.Struct({
  /** Maximum iterations before stopping */
  maxIterations: Schema.Number,
  /** Default LLM model */
  defaultModel: Schema.optional(Schema.Unknown),
  /** LLM provider name */
  provider: Schema.optional(Schema.String),
  /** Memory system tier: "1" (light) or "2" (full) */
  memoryTier: Schema.Literal("1", "2"),
  /** Enable guardrails layer */
  enableGuardrails: Schema.Boolean,
  /** Enable verification layer */
  enableVerification: Schema.Boolean,
  /** Enable cost tracking */
  enableCostTracking: Schema.Boolean,
  /** Enable audit logging */
  enableAudit: Schema.Boolean,
  /** Enable kill switch service */
  enableKillSwitch: Schema.optional(Schema.Boolean),
  /** Enable behavioral contracts */
  enableBehavioralContracts: Schema.optional(Schema.Boolean),
  /** Enable self-improvement */
  enableSelfImprovement: Schema.optional(Schema.Boolean),
  /** Agent ID */
  agentId: Schema.String,
  /** Custom system prompt */
  systemPrompt: Schema.optional(Schema.String),
  /** Custom environment context key-value pairs injected into system prompt */
  environmentContext: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  /** Observability verbosity level */
  observabilityVerbosity: Schema.optional(
    Schema.Literal("minimal", "normal", "verbose", "debug"),
  ),
  /** Log full model prompts and responses (default: true when debug, false otherwise) */
  logModelIO: Schema.optional(Schema.Boolean),
  /** Model-adaptive context profile overrides */
  contextProfile: Schema.optional(Schema.partial(ContextProfileSchema)),
  /** Default reasoning strategy when no StrategySelector is present */
  defaultStrategy: Schema.optional(Schema.String),
  /** Enable/disable thinking mode for thinking-capable models (auto-detect if omitted) */
  thinking: Schema.optional(Schema.Boolean),
  /** Override default temperature for LLM requests */
  temperature: Schema.optional(Schema.Number),
  /** Override default maxTokens for LLM requests */
  maxTokens: Schema.optional(Schema.Number),
  /** Context window size for local providers (Ollama `options.num_ctx`); ignored by hosted providers */
  numCtx: Schema.optional(Schema.Number),
  /** Tool result compression config — controls preview size, overflow storage keys, and pipe transforms */
  resultCompression: Schema.optional(
    Schema.Struct({
      budget: Schema.optional(Schema.Number),
      previewItems: Schema.optional(Schema.Number),
      autoStore: Schema.optional(Schema.Boolean),
      codeTransform: Schema.optional(Schema.Boolean),
    })
  ),
  /** Default stream density for runStream() — "tokens" emits only TextDelta, "full" emits all events */
  streamDensity: Schema.optional(Schema.Literal("tokens", "full")),
  /** Prefix prepended to all observability log lines (used for sub-agent indentation) */
  logPrefix: Schema.optional(Schema.String),
  /** Maximum retries when verification rejects the response (default: 1). Only used when enableVerification is true. */
  maxVerificationRetries: Schema.optional(Schema.Number),
  /** Minimum iterations with at least one tool call before final-answer is allowed. */
  minIterations: Schema.optional(Schema.Number),
  /** Inject background data into reasoning context (separate from system prompt instructions). */
  taskContext: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  /** Persist partial run state every N iterations for resumable long-running agents. */
  progressCheckpoint: Schema.optional(Schema.Struct({
    /** Checkpoint interval — save state every N iterations. */
    every: Schema.Number,
    /** Automatically resume from the latest checkpoint on next run (default: false). */
    autoResume: Schema.optional(Schema.Boolean),
  })),
  /** Run a verification pass after the initial answer before accepting the result. */
  verificationStep: Schema.optional(Schema.Struct({
    /** "reflect" = single LLM review call (default); "loop" = re-enter ReAct loop with tools. */
    mode: Schema.Union(Schema.Literal("reflect"), Schema.Literal("loop")),
    /** Custom verification prompt. Defaults to a standard completeness-check question. */
    prompt: Schema.optional(Schema.String),
  })),
  /** When true, only task-relevant tools are shown to the agent — reducing context noise for small models. All tools remain callable by name. */
  adaptiveToolFiltering: Schema.optional(Schema.Boolean),
  /** Required tools configuration — tools that MUST be called before the agent can declare success. */
  requiredTools: Schema.optional(
    Schema.Struct({
      /** Tool names that must be called during execution */
      tools: Schema.optional(Schema.Array(Schema.String)),
      /** When true, the LLM analyzes the task + available tools before reasoning to infer which tools are required. Inferred tools are merged with any explicitly listed tools. */
      adaptive: Schema.optional(Schema.Boolean),
      /** Max redirects when required tools are missing (default: 2) */
      maxRetries: Schema.optional(Schema.Number),
    })
  ),
  /** Enable memory layer — set to true when .withMemory() is called. Controls debrief synthesis. */
  enableMemory: Schema.optional(Schema.Boolean),
  /** Enable ExperienceStore cross-agent learning (records and queries tool-use patterns). */
  enableExperienceLearning: Schema.optional(Schema.Boolean),
  /** Enable MemoryConsolidatorService background memory intelligence. */
  enableMemoryConsolidation: Schema.optional(Schema.Boolean),
  /** Configuration for MemoryConsolidatorService. */
  consolidationConfig: Schema.optional(
    Schema.Struct({
      threshold: Schema.optional(Schema.Number),
      decayFactor: Schema.optional(Schema.Number),
      pruneThreshold: Schema.optional(Schema.Number),
    })
  ),
  /** Per-execution timeout in milliseconds. If set, execution is aborted after this duration. */
  executionTimeoutMs: Schema.optional(Schema.Number),
  /** LLM call retry policy for transient errors (rate limits, network failures). */
  retryPolicy: Schema.optional(
    Schema.Struct({
      maxRetries: Schema.Number,
      backoffMs: Schema.Number,
    })
  ),
  /** Semantic cache TTL in milliseconds. Cached responses older than this are evicted. */
  cacheTimeoutMs: Schema.optional(Schema.Number),
  /** Session persistence configuration. When persist is true, SessionStoreLive must be
   *  in the runtime layer (requires memory layer to be active). */
  session: Schema.optional(
    Schema.Struct({
      /** Enable SQLite-backed session persistence. Default: false */
      persist: Schema.optional(Schema.Boolean),
      /** Max age of sessions to retain in days. Default: 30 */
      maxAgeDays: Schema.optional(Schema.Number),
    })
  ),
  /**
   * Declarative budget limits consulted by the Arbitrator's pre-intent guard
   * (Issue #128 / North Star v5.0 Pillar 6). Populated by `.withBudget()` on
   * `ReactiveAgentBuilder`; threaded into `KernelInput.budgetLimits` at the
   * runtime → kernel boundary. When `tokenLimit` or `costLimit` is reached,
   * the Arbitrator returns exit-failure with `terminatedBy="budget_exceeded"`.
   */
  budgetLimits: Schema.optional(
    Schema.Struct({
      tokenLimit: Schema.optional(Schema.Number),
      costLimit: Schema.optional(Schema.Number),
      warningRatio: Schema.optional(Schema.Number),
    })
  ),
  /**
   * Opt-in numeric evidence-grounding. Absent ⇒ grounding off (default).
   * Populated by `.withGrounding()`; threaded into `KernelInput.grounding`.
   */
  grounding: Schema.optional(
    Schema.Struct({
      mode: Schema.Literal("block", "warn"),
      tolerance: Schema.optional(Schema.Number),
      maxRetries: Schema.optional(Schema.Number),
    })
  ),
  /**
   * Opt-in durable run persistence (Phase B). Absent ⇒ off (zero overhead).
   * Populated by `.withDurableRuns()`; when set, the runtime persists a
   * serialized kernel-state snapshot to a SQLite RunStore every
   * `checkpointEvery` iterations so a crashed run can be resumed (Phase C).
   */
  durableRuns: Schema.optional(
    Schema.Struct({
      dir: Schema.optional(Schema.String),
      checkpointEvery: Schema.optional(Schema.Number),
    })
  ),
  /** Dynamic strategy switching configuration. When enabled, the kernel automatically
   *  switches reasoning strategies on loop detection instead of failing immediately. */
  strategySwitching: Schema.optional(
    Schema.Struct({
      /** Enable automatic strategy switching when a loop is detected (default: true) */
      enabled: Schema.Boolean,
      /** Maximum number of strategy switches per run (default: 1) */
      maxSwitches: Schema.optional(Schema.Number),
      /** Skip LLM evaluation and switch directly to this strategy */
      fallbackStrategy: Schema.optional(Schema.String),
    })
  ),
  /** Enable the Reactive Intelligence layer (entropy sensing + telemetry). */
  enableReactiveIntelligence: Schema.optional(Schema.Boolean),
  /** Reactive Intelligence configuration (telemetry, controller, learning). */
  reactiveIntelligenceOptions: Schema.optional(Schema.Unknown),
  /** `.withReasoning()` options — JSON-serializable fields validated here; `synthesisStrategy` is runtime-only. */
  reasoningOptions: Schema.optional(ReasoningOptionsJsonSchema),
  /** Legacy flattened ICS config when no `reasoningOptions` (e.g. tests). Prefer `.withReasoning()`. */
  synthesisConfig: Schema.optional(SynthesisConfigJsonSchema),
  /** Resolved Conductor's Suite payload for the reasoning kernel (after harness resolution). */
  metaTools: Schema.optional(KernelMetaToolsSchema),
  /** Logging configuration for execution observability */
  logging: Schema.optional(
    Schema.Struct({
      /**
       * Stream events in real-time (true) or buffer until end (false).
       * Default: true
       */
      live: Schema.optional(Schema.Boolean),

      mode: Schema.optional(Schema.Union(Schema.Literal("stream"), Schema.Literal("status"))),

      /**
       * Minimum log level to emit: 'debug' | 'info' | 'warn' | 'error'
       * Default: 'info'
       */
      minLevel: Schema.optional(
        Schema.Union(
          Schema.Literal("debug"),
          Schema.Literal("info"),
          Schema.Literal("warn"),
          Schema.Literal("error"),
        ),
      ),

      /**
       * Output destinations for logs.
       * Default: ['console']
       */
      destinations: Schema.optional(
        Schema.Array(
          Schema.Union(
            Schema.Literal("console"),
            Schema.Literal("file"),
            Schema.Literal("custom"),
          ),
        ),
      ),

      /**
       * File path if 'file' is in destinations.
       */
      filePath: Schema.optional(Schema.String),
    }),
  ),
});

/**
 * Options for `.withReasoning()` — all fields optional, merged with framework defaults.
 * JSON encode/decode uses {@link ReasoningOptionsJsonSchema} (excludes `synthesisStrategy`).
 */
export type ReasoningOptions = ReasoningOptionsEncoded & {
  /** Custom synthesis pipeline — runtime-only; not persisted in AgentConfig JSON. */
  readonly synthesisStrategy?: SynthesisStrategy;
};

/**
 * Runtime config: schema-decodable fields plus optional non-serializable ICS strategy on `synthesisConfig`.
 */
export type ReactiveAgentsConfig = Schema.Schema.Type<typeof ReactiveAgentsConfigSchema> & {
  readonly reasoningOptions?: ReasoningOptions;
  readonly synthesisConfig?: SynthesisConfigJson & { readonly synthesisStrategy?: SynthesisStrategy };
  /** User-defined predicate called after each reasoning result. If it returns false, the agent re-runs. */
  readonly customTermination?: (state: { output: string }) => boolean;
  /**
   * Custom verifier injected at the terminal §9.0 gate. When set, replaces
   * `defaultVerifier` for both in-loop retry and final-answer verification.
   * Set to `noopVerifier` by lean harness mode to bypass the gate entirely.
   */
  readonly verifier?: import("@reactive-agents/reasoning").Verifier;
  /** Validate the final output before accepting. On failure, feedback is injected and the agent retries. */
  readonly outputValidator?: (output: string) => { valid: boolean; feedback?: string };
  /** Options for `outputValidator` — controls retry count. */
  readonly outputValidatorOptions?: { maxRetries?: number };
  /**
   * Allowlist of tool names. When set, only these tools appear in the LLM prompt AND
   * execution of any non-listed (non-meta) tool is blocked. Use for hard agent restrictions.
   * Framework meta-tools (final-answer, recall, brief, etc.) always bypass this gate.
   */
  readonly allowedTools?: readonly string[];
  /**
   * Prompt-only tool guidance. When set, only these tools appear in the LLM prompt.
   * Unlike allowedTools, this does NOT block execution — other tools remain callable.
   * Use for soft guidance without hard restrictions. Takes precedence over allowedTools
   * for prompt visibility when both are set.
   */
  readonly focusedTools?: readonly string[];
  /**
   * Tool names a `.withContract({ tools: [{ kind: "forbidden", name }] })`
   * declares MUST NOT be visible to the LLM (TaskContract definition,
   * task-contract.ts:33-34). These names are EXCLUDED from the execute-time
   * exposed tool schema in `prepareReasoningToolSchemas` — applied AFTER
   * MCP/discover-tools discovery, so discovered forbidden tools are also
   * removed (closing the build-time static-approximation hole). Derived via
   * `contractForbiddenTools` at construction (realization-plan P2b).
   */
  readonly forbiddenTools?: readonly string[];
  /**
   * Opt-in for built-in tools in the base schema. See `ToolsOptions.builtins`
   * for full semantics. Default `undefined`/`false`: built-ins are excluded
   * from the LLM-facing schema (still registered + discoverable via
   * `discover-tools`).
   */
  readonly builtins?: boolean | readonly string[];
  /**
   * Per-model calibration mode. Resolved to a `ModelCalibration` in execution-engine
   * and forwarded to the kernel for steering channel selection and context tuning.
   */
  readonly calibration?: CalibrationMode;
  /**
   * Compiled harness pipeline forwarded from `.withHarness()` builder registrations.
   * Wave B kernel chokepoints call `pipeline.transform(tag, defaultValue, ctx)` at
   * system-prompt, loop-detected, healing-failure, tool-result, and observation sites.
   * Absent when no `.withHarness()` calls were made (pass-through mode).
   */
  readonly harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
  /**
   * Logging configuration for execution observability
   */
  readonly logging?: {
    /**
     * Stream events in real-time (true) or buffer until end (false).
     * Default: true
     */
    readonly live?: boolean;

    /**
     * Output mode: 'stream' emits events live, 'status' shows a single updating TUI line.
     * Auto-detected from process.stdout.isTTY when not set.
     */
    readonly mode?: "stream" | "status";

    /**
     * Opt out of auto-enabling 'status' mode even when stdout is a TTY.
     * Tests, CI runs, and headless services should set this to `true` so
     * the runtime never spins up the TUI renderer behind their back.
     *
     * Also honored via the `REACTIVE_AGENTS_DISABLE_STATUS_MODE=true`
     * environment variable for cases where the embedding host can't
     * thread the option through the builder.
     *
     * Default: `false`.
     */
    readonly disableStatusMode?: boolean;

    /**
     * Minimum log level to emit: 'debug' | 'info' | 'warn' | 'error'
     * Default: 'info'
     */
    readonly minLevel?: "debug" | "info" | "warn" | "error";

    /**
     * Output destinations for logs.
     * Default: ['console']
     */
    readonly destinations?: Array<"console" | "file" | "custom">;

    /**
     * File path if 'file' is in destinations.
     */
    readonly filePath?: string;
  };
};

/**
 * Create a default ReactiveAgentsConfig with standard settings.
 *
 * All optional features default to `false`; memory defaults to tier "1".
 * Provides a sensible starting point that can be partially overridden.
 *
 * @param agentId - Required agent identifier
 * @param overrides - Partial config to override defaults
 * @returns A complete ReactiveAgentsConfig
 *
 * @example
 * ```typescript
 * const config = defaultReactiveAgentsConfig("my-agent", {
 *   enableReasoning: true,
 *   maxIterations: 15
 * });
 * ```
 */
export const defaultReactiveAgentsConfig = (
  agentId: string,
  overrides?: Partial<ReactiveAgentsConfig>,
): ReactiveAgentsConfig => ({
  maxIterations: 10,
  memoryTier: "1",
  enableGuardrails: false,
  enableVerification: false,
  enableCostTracking: false,
  enableAudit: false,
  agentId,
  ...overrides,
});

// ─── Meta-Tools Types ───

export type HarnessSkillConfig =
  | boolean
  | string
  | { frontier?: boolean | string; local?: boolean | string };

export interface RecallConfig {
  previewLength?: number;
  autoFullThreshold?: number;
  maxEntries?: number;
  maxTotalBytes?: number;
}

export interface FindConfig {
  autoStoreThreshold?: number;
  minRagScore?: number;
  webFallback?: boolean;
  preferredScope?: "documents" | "web";
}

export interface PulseConfig {
  useLLMRecommendation?: boolean;
  includeControllerDecisions?: boolean;
  includeBehavior?: boolean;
}

export interface MetaToolsConfig {
  brief?: boolean;
  find?: boolean;
  pulse?: boolean;
  recall?: boolean;
  harnessSkill?: HarnessSkillConfig;
  findConfig?: FindConfig;
  pulseConfig?: PulseConfig;
  recallConfig?: RecallConfig;
}
