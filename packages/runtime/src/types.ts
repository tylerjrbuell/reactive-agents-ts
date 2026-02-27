import { Schema } from "effect";
import { ContextProfileSchema } from "@reactive-agents/reasoning";

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
export type ExecutionContext = typeof ExecutionContextSchema.Type;

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
   * Handler function that processes the execution context.
   * Must return the context (possibly modified) or throw an ExecutionError.
   *
   * @param ctx - Current execution context
   * @returns Effect producing the modified context
   */
  readonly handler: (
    ctx: ExecutionContext,
  ) => import("effect").Effect.Effect<
    ExecutionContext,
    import("./errors.js").ExecutionError
  >;
}

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
  /** Observability verbosity level */
  observabilityVerbosity: Schema.optional(
    Schema.Literal("minimal", "normal", "verbose", "debug"),
  ),
  /** Model-adaptive context profile overrides */
  contextProfile: Schema.optional(Schema.partial(ContextProfileSchema)),
});
export type ReactiveAgentsConfig = typeof ReactiveAgentsConfigSchema.Type;

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
