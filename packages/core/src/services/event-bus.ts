import { Effect, Context, Layer, Ref } from "effect";
import type { Message } from "../types/message.js";

// ─── Event Types ───

/**
 * Union of all possible agent events.
 * Includes task lifecycle, execution phases, LLM requests, tool calls, memory events, reasoning steps, agent lifecycle, and custom events.
 * Each event variant has a discriminant `_tag` field for type narrowing.
 *
 * @example
 * ```typescript
 * const event: AgentEvent = {
 *   _tag: "AgentStarted",
 *   taskId: "task-123",
 *   agentId: "agent-456",
 *   provider: "anthropic",
 *   model: "claude-opus-4-20250514",
 *   timestamp: Date.now()
 * };
 * ```
 */
export type AgentEvent =
  // ─── Core task/agent events ───
  | {
      /**
       * Task was created but not yet started.
       * Fired when a new task ID is generated before execution begins.
       */
      readonly _tag: "TaskCreated";
      /** Unique task identifier correlating all events for a single execution */
      readonly taskId: string;
    }
  | {
      /**
       * Task execution completed successfully or with failure.
       * Fired after the agent finishes its execution loop.
       */
      readonly _tag: "TaskCompleted";
      /** Unique task identifier */
      readonly taskId: string;
      /** True if execution succeeded, false if error occurred */
      readonly success: boolean;
    }
  | {
      /**
       * Task execution failed with an error.
       * Fired when an exception is raised during execution and not caught.
       */
      readonly _tag: "TaskFailed";
      /** Unique task identifier */
      readonly taskId: string;
      /** Error message describing the failure */
      readonly error: string;
    }
  | {
      /**
       * Agent instance was created.
       * Fired when ReactiveAgent.create() completes or ReactiveAgentBuilder.build() finishes.
       */
      readonly _tag: "AgentCreated";
      /** Agent identifier assigned during creation */
      readonly agentId: string;
    }
  | {
      /**
       * A message was sent via the InteractionManager.
       * Fired when agent.send() is called or collaboration event occurs.
       */
      readonly _tag: "MessageSent";
      /** The Message object that was sent */
      readonly message: Message;
    }
  // ─── Execution Engine events (from @reactive-agents/runtime) ───
  | {
      /**
       * Execution entered a specific phase (bootstrap, strategy, think, act, observe, etc).
       * Fired at the start of each phase in the ExecutionEngine loop.
       */
      readonly _tag: "ExecutionPhaseEntered";
      /** Unique task identifier */
      readonly taskId: string;
      /** Phase name: "bootstrap", "guardrail", "strategy", "think", "act", "observe", "memory-flush", "verify", "audit", "complete" */
      readonly phase: string;
    }
  | {
      /**
       * An execution hook (before/after) was fired.
       * Fired when ExecutionHook lifecycle callbacks execute.
       */
      readonly _tag: "ExecutionHookFired";
      /** Unique task identifier */
      readonly taskId: string;
      /** Phase in which hook fired */
      readonly phase: string;
      /** Timing information: "before" or "after" */
      readonly timing: string;
    }
  | {
      /**
       * The reasoning loop iteration counter incremented.
       * Fired after each complete ReAct/Plan-Execute/ToT loop cycle.
       */
      readonly _tag: "ExecutionLoopIteration";
      /** Unique task identifier */
      readonly taskId: string;
      /** Current iteration number (1-indexed) */
      readonly iteration: number;
    }
  | {
      /**
       * Execution was cancelled externally.
       * Fired when ReactiveAgent.stop() is called during execution.
       */
      readonly _tag: "ExecutionCancelled";
      /** Unique task identifier */
      readonly taskId: string;
    }
  // ─── Memory events (from @reactive-agents/memory) ───
  | {
      /**
       * Memory service initialized and loaded prior state.
       * Fired when MemoryService.bootstrap() completes successfully.
       */
      readonly _tag: "MemoryBootstrapped";
      /** Agent identifier */
      readonly agentId: string;
      /** Memory tier that was bootstrapped: "working", "semantic", "episodic", "procedural" */
      readonly tier: string;
    }
  | {
      /**
       * Memory was flushed to persistent storage.
       * Fired after MemoryService.flush() writes all pending updates to disk.
       */
      readonly _tag: "MemoryFlushed";
      /** Agent identifier */
      readonly agentId: string;
    }
  | {
      /**
       * Memory snapshot was saved to persistent storage.
       * Fired when MemoryService.saveSnapshot() completes.
       */
      readonly _tag: "MemorySnapshotSaved";
      /** Agent identifier */
      readonly agentId: string;
      /** Session identifier under which snapshot was saved */
      readonly sessionId: string;
    }
  // ─── LLM events (from @reactive-agents/llm-provider) ───
  | {
      /**
       * An LLM request completed (succeeded or failed).
       * Fired after LLMService.complete() returns (in think phase).
       */
      readonly _tag: "LLMRequestCompleted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Request ID for correlating request/response pairs */
      readonly requestId: string;
      /** LLM model used (e.g., "claude-opus-4-20250514", "gpt-4o") */
      readonly model: string;
      /** LLM provider (e.g., "anthropic", "openai", "ollama", "gemini") */
      readonly provider: string;
      /** Request round-trip time in milliseconds */
      readonly durationMs: number;
      /** Total tokens used in request + response */
      readonly tokensUsed: number;
      /** Estimated cost in USD */
      readonly estimatedCost: number;
    }
  // ─── Tool execution events (from @reactive-agents/runtime) ───
  | {
      /**
       * A tool call was initiated.
       * Fired when ExecutionEngine enters the act phase and begins tool invocation.
       */
      readonly _tag: "ToolCallStarted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Tool name (e.g., "file-read", "web-search", "code-execute") */
      readonly toolName: string;
      /** Unique tool call identifier for correlating start/completed pair */
      readonly callId: string;
    }
  | {
      /**
       * A tool call completed.
       * Fired after tool handler returns, whether success or error.
       */
      readonly _tag: "ToolCallCompleted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Tool name */
      readonly toolName: string;
      /** Unique tool call identifier matching ToolCallStarted */
      readonly callId: string;
      /** Tool execution duration in milliseconds */
      readonly durationMs: number;
      /** True if tool executed successfully, false if error */
      readonly success: boolean;
      /** Which kernel pass produced this call (e.g. "reflexion:generate", "plan-execute:step-2") */
      readonly kernelPass?: string;
    }
  // ─── Phase completion events (from @reactive-agents/runtime) ───
  | {
      /**
       * A phase completed.
       * Fired when any of the 10 ExecutionEngine phases finishes.
       */
      readonly _tag: "ExecutionPhaseCompleted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Phase name: "bootstrap", "guardrail", "strategy", "think", "act", "observe", "memory-flush", "verify", "audit", "complete" */
      readonly phase: string;
      /** Phase execution duration in milliseconds */
      readonly durationMs: number;
    }
  // ─── Reasoning step events (from @reactive-agents/reasoning) ───
  | {
      /**
       * A reasoning step completed.
       * Fired after each step in a reasoning strategy (ReAct iteration, ToT node, plan step, etc).
       * Emitted by the strategy via EventBus within the think phase.
       */
      readonly _tag: "ReasoningStepCompleted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Reasoning strategy name: "reactive", "plan-execute", "tree-of-thought", "reflexion", "adaptive" */
      readonly strategy: string;
      /** Current step number within this execution */
      readonly step: number;
      /** Total steps completed so far */
      readonly totalSteps: number;
      /** Model thought/reasoning text from this step (optional, depends on strategy) */
      readonly thought?: string;
      /** Action/tool call text from this step (optional) */
      readonly action?: string;
      /** Tool result/observation from this step (optional) */
      readonly observation?: string;
      /** Which kernel pass produced this step (e.g. "reflexion:improve-1", "tree-of-thought:execute") */
      readonly kernelPass?: string;
      /** Full LLM prompt trace for debug observability (system + user message) */
      readonly prompt?: { readonly system: string; readonly user: string };
    }
  // ─── Iteration progress (from @reactive-agents/reasoning) ───
  | {
      /**
       * A reasoning iteration completed within the kernel loop.
       * Fired after each Think→Act→Observe cycle, enabling real-time progress reporting.
       */
      readonly _tag: "ReasoningIterationProgress";
      /** Unique task identifier */
      readonly taskId: string;
      /** Current iteration number (1-based) */
      readonly iteration: number;
      /** Max iterations allowed for this execution */
      readonly maxIterations: number;
      /** Active reasoning strategy */
      readonly strategy: string;
      /** Tool names called in this iteration (may be empty if pure thinking step) */
      readonly toolsThisStep: readonly string[];
    }
  // ─── Agent lifecycle events (from @reactive-agents/guardrails) ───
  | {
      /**
       * Agent execution was paused.
       * Fired when ReactiveAgent.pause() completes successfully.
       */
      readonly _tag: "AgentPaused";
      /** Agent identifier */
      readonly agentId: string;
      /** Unique task identifier for correlation */
      readonly taskId: string;
    }
  | {
      /**
       * Agent execution was resumed.
       * Fired when ReactiveAgent.resume() completes successfully.
       */
      readonly _tag: "AgentResumed";
      /** Agent identifier */
      readonly agentId: string;
      /** Unique task identifier for correlation */
      readonly taskId: string;
    }
  | {
      /**
       * Agent stopping was initiated.
       * Fired when ReactiveAgent.stop() is called (before actual termination).
       */
      readonly _tag: "AgentStopping";
      /** Agent identifier */
      readonly agentId: string;
      /** Unique task identifier for correlation */
      readonly taskId: string;
      /** Reason for stopping (e.g., "user_requested", "timeout") */
      readonly reason: string;
    }
  | {
      /**
       * Agent execution stopped cleanly.
       * Fired when ReactiveAgent.stop() completes (graceful shutdown).
       */
      readonly _tag: "AgentStopped";
      /** Agent identifier */
      readonly agentId: string;
      /** Unique task identifier for correlation */
      readonly taskId: string;
      /** Reason for stopping */
      readonly reason: string;
    }
  | {
      /**
       * Agent was forcibly terminated.
       * Fired when ReactiveAgent.terminate() completes (force kill).
       */
      readonly _tag: "AgentTerminated";
      /** Agent identifier */
      readonly agentId: string;
      /** Unique task identifier for correlation */
      readonly taskId: string;
      /** Reason for termination */
      readonly reason: string;
    }
  // ─── Execution lifecycle (bookends) ───
  | {
      /**
       * Agent execution started.
       * Fired at the very beginning of ReactiveAgent.run() or agent.execute().
       * Bookend pair with AgentCompleted.
       */
      readonly _tag: "AgentStarted";
      /** Unique task identifier correlating all events for this execution */
      readonly taskId: string;
      /** Agent identifier */
      readonly agentId: string;
      /** LLM provider name */
      readonly provider: string;
      /** LLM model name (may be updated after first LLM response) */
      readonly model: string;
      /** Unix timestamp in milliseconds when execution started */
      readonly timestamp: number;
    }
  | {
      /**
       * Agent execution completed.
       * Fired at the very end of ReactiveAgent.run() or agent.execute(), after all cleanup.
       * Bookend pair with AgentStarted.
       */
      readonly _tag: "AgentCompleted";
      /** Unique task identifier matching AgentStarted */
      readonly taskId: string;
      /** Agent identifier */
      readonly agentId: string;
      /** True if execution succeeded without fatal errors, false otherwise */
      readonly success: boolean;
      /** Total reasoning loop iterations completed */
      readonly totalIterations: number;
      /** Total tokens used across all LLM calls */
      readonly totalTokens: number;
      /** Total execution duration in milliseconds */
      readonly durationMs: number;
    }
  // ─── LLM request lifecycle ───
  | {
      /**
       * An LLM request was initiated.
       * Fired when LLMService.complete() is called (before the request is sent).
       * Bookend pair with LLMRequestCompleted.
       */
      readonly _tag: "LLMRequestStarted";
      /** Unique task identifier */
      readonly taskId: string;
      /** Request ID for correlating start/completed pair */
      readonly requestId: string;
      /** LLM model being called */
      readonly model: string;
      /** LLM provider */
      readonly provider: string;
      /** Context window size (tokens) being sent to the LLM */
      readonly contextSize: number;
    }
  // ─── Final answer milestone ───
  | {
      /**
       * The reasoning strategy produced a final answer.
       * Fired when the reasoning loop terminates with a conclusion (not early exit or max iterations).
       */
      readonly _tag: "FinalAnswerProduced";
      /** Unique task identifier */
      readonly taskId: string;
      /** Reasoning strategy that produced the answer */
      readonly strategy: string;
      /** The final answer text */
      readonly answer: string;
      /** Iteration number at which final answer was produced */
      readonly iteration: number;
      /** Total tokens used up to this point */
      readonly totalTokens: number;
      /** Which kernel pass produced this answer (e.g. "reflexion:generate", "plan-execute:step-2") */
      readonly kernelPass?: string;
    }
  // ─── Reasoning failure event ───
  | {
      /**
       * The reasoning kernel terminated with a failure status.
       * Fired by the kernel runner when status === "failed" (not "done").
       * Enables observability of reasoning failures distinct from task-level failures.
       */
      readonly _tag: "ReasoningFailed";
      /** Unique task identifier */
      readonly taskId: string;
      /** Active reasoning strategy at time of failure */
      readonly strategy: string;
      /** Error message describing the failure */
      readonly error: string;
      /** Iteration number at which the failure occurred */
      readonly iteration: number;
    }
  // ─── Safety / guardrail events ───
  | {
      /**
       * A guardrail check detected policy violations.
       * Fired by GuardrailService after running injection/PII/toxicity/jailbreak checks.
       */
      readonly _tag: "GuardrailViolationDetected";
      /** Unique task identifier */
      readonly taskId: string;
      /** Array of violation types detected (e.g., ["injection", "pii"]) */
      readonly violations: readonly string[];
      /** Aggregate violation score (0-1) */
      readonly score: number;
      /** True if violations were severe enough to block execution */
      readonly blocked: boolean;
    }
  // ─── Gateway events (from @reactive-agents/gateway) ───
  | {
      /**
       * Gateway started and is listening for events.
       * Fired when GatewayService.start() completes initialization.
       */
      readonly _tag: "GatewayStarted";
      /** Agent identifier */
      readonly agentId: string;
      /** Event source names that are active (e.g., ["heartbeat", "cron", "webhook"]) */
      readonly sources: readonly string[];
      /** Policy names applied to this gateway (e.g., ["daily-token-budget", "rate-limit"]) */
      readonly policies: readonly string[];
      /** Unix timestamp in milliseconds when gateway started */
      readonly timestamp: number;
    }
  | {
      /**
       * Gateway stopped and is no longer listening.
       * Fired when GatewayService.stop() completes shutdown.
       */
      readonly _tag: "GatewayStopped";
      /** Agent identifier */
      readonly agentId: string;
      /** Reason for stopping (e.g., "user_requested", "budget_exhausted", "error") */
      readonly reason: string;
      /** Total uptime in milliseconds */
      readonly uptime: number;
      /** Unix timestamp in milliseconds when gateway stopped */
      readonly timestamp: number;
    }
  | {
      /**
       * An external event was received by the gateway.
       * Fired when any event source delivers an event to the input router.
       */
      readonly _tag: "GatewayEventReceived";
      /** Agent identifier */
      readonly agentId: string;
      /** Event source that produced this event (e.g., "heartbeat", "webhook", "cron") */
      readonly source: string;
      /** Unique event identifier for correlation */
      readonly eventId: string;
      /** Unix timestamp in milliseconds when event was received */
      readonly timestamp: number;
    }
  | {
      /**
       * A proactive action was initiated by the gateway.
       * Fired when the gateway dispatches a task to the agent based on a received event.
       */
      readonly _tag: "ProactiveActionInitiated";
      /** Agent identifier */
      readonly agentId: string;
      /** Event source that triggered this action */
      readonly source: string;
      /** Description of the task the agent will execute */
      readonly taskDescription: string;
      /** Unix timestamp in milliseconds when action was initiated */
      readonly timestamp: number;
    }
  | {
      /**
       * A proactive action completed.
       * Fired after the agent finishes executing a gateway-initiated task.
       */
      readonly _tag: "ProactiveActionCompleted";
      /** Agent identifier */
      readonly agentId: string;
      /** Event source that triggered the original action */
      readonly source: string;
      /** True if the action executed successfully */
      readonly success: boolean;
      /** Total tokens consumed by this action */
      readonly tokensUsed: number;
      /** Total duration in milliseconds */
      readonly durationMs: number;
      /** Unix timestamp in milliseconds when action completed */
      readonly timestamp: number;
    }
  | {
      /**
       * A proactive action was suppressed by policy.
       * Fired when the policy engine blocks an event from triggering an action.
       */
      readonly _tag: "ProactiveActionSuppressed";
      /** Agent identifier */
      readonly agentId: string;
      /** Event source that produced the suppressed event */
      readonly source: string;
      /** Human-readable reason for suppression */
      readonly reason: string;
      /** Policy name that triggered the suppression */
      readonly policy: string;
      /** Event identifier that was suppressed */
      readonly eventId: string;
      /** Unix timestamp in milliseconds when suppression occurred */
      readonly timestamp: number;
    }
  | {
      /**
       * A policy engine made a decision about an event.
       * Fired for every policy evaluation, whether allowed or denied.
       */
      readonly _tag: "PolicyDecisionMade";
      /** Agent identifier */
      readonly agentId: string;
      /** Policy name that made the decision */
      readonly policy: string;
      /** Decision outcome (e.g., "allow", "deny", "defer") */
      readonly decision: string;
      /** Event identifier being evaluated */
      readonly eventId: string;
      /** Unix timestamp in milliseconds when decision was made */
      readonly timestamp: number;
    }
  | {
      /**
       * A heartbeat tick was skipped.
       * Fired when the heartbeat scheduler decides to skip based on policy (adaptive/conservative).
       */
      readonly _tag: "HeartbeatSkipped";
      /** Agent identifier */
      readonly agentId: string;
      /** Reason for skipping (e.g., "no_changes", "rate_limited", "conservative_policy") */
      readonly reason: string;
      /** Number of consecutive skips including this one */
      readonly consecutiveSkips: number;
      /** Unix timestamp in milliseconds when skip occurred */
      readonly timestamp: number;
    }
  | {
      /**
       * Multiple events were merged into a single action.
       * Fired when the event deduplication/merge logic combines events within the merge window.
       */
      readonly _tag: "EventsMerged";
      /** Agent identifier */
      readonly agentId: string;
      /** Number of events that were merged */
      readonly mergedCount: number;
      /** Key used for merging (e.g., source + event type) */
      readonly mergeKey: string;
      /** Unix timestamp in milliseconds when merge occurred */
      readonly timestamp: number;
    }
  | {
      /**
       * A budget (token or action) was exhausted.
       * Fired when policy enforcement detects that a budget limit has been reached.
       */
      readonly _tag: "BudgetExhausted";
      /** Agent identifier */
      readonly agentId: string;
      /** Type of budget exhausted (e.g., "daily-tokens", "hourly-actions") */
      readonly budgetType: string;
      /** Budget limit that was reached */
      readonly limit: number;
      /** Amount used when limit was reached */
      readonly used: number;
      /** Unix timestamp in milliseconds when budget was exhausted */
      readonly timestamp: number;
    }
  // ─── Reactive Intelligence ───
  | {
      readonly _tag: "EntropyScored";
      readonly taskId: string;
      readonly iteration: number;
      readonly composite: number;
      readonly sources: {
        readonly token: number | null;
        readonly structural: number;
        readonly semantic: number | null;
        readonly behavioral: number;
        readonly contextPressure: number;
      };
      readonly trajectory: {
        readonly derivative: number;
        readonly shape: "converging" | "flat" | "diverging" | "v-recovery" | "oscillating";
        readonly momentum: number;
      };
      readonly confidence: "high" | "medium" | "low";
      readonly modelTier: "frontier" | "local" | "unknown";
      readonly iterationWeight: number;
    }
  | {
      readonly _tag: "ContextWindowWarning";
      readonly taskId: string;
      readonly modelId: string;
      readonly utilizationPct: number;
      readonly compressionHeadroom: number;
      readonly atRiskSections: readonly string[];
    }
  | {
      readonly _tag: "CalibrationDrift";
      readonly taskId: string;
      readonly modelId: string;
      readonly expectedMean: number;
      readonly observedMean: number;
      readonly deviationSigma: number;
    }
  | {
      readonly _tag: "ReactiveDecision";
      readonly taskId: string;
      readonly iteration: number;
      readonly decision: "early-stop" | "branch" | "compress" | "switch-strategy" | "attribute";
      readonly reason: string;
      readonly entropyBefore: number;
      readonly entropyAfter?: number;
    }
  // ─── Channel / messaging events ───
  | {
      /**
       * An incoming message was received from a messaging channel.
       * Fired by ToolService when an MCP server sends a notifications/message notification.
       */
      readonly _tag: "ChannelMessageReceived";
      /** Sender identifier (phone number, user ID, etc.) */
      readonly sender: string;
      /** Messaging platform name (e.g., "signal", "telegram") */
      readonly platform: string;
      /** Message text content */
      readonly message: string;
      /** Unix timestamp in milliseconds */
      readonly timestamp: number;
      /** MCP server name that received the message */
      readonly mcpServer: string;
      /** Optional group identifier */
      readonly groupId?: string;
    }
  // ─── Custom/extension events ───
  | {
      /**
       * A custom application-defined event.
       * Fired by user code extending the framework with custom observability.
       */
      readonly _tag: "Custom";
      /** Custom event type identifier */
      readonly type: string;
      /** Arbitrary custom payload */
      readonly payload: unknown;
    }
  // ─── Strategy switching events (from @reactive-agents/reasoning) ───
  | {
      /**
       * A strategy switch evaluator ran and produced a recommendation.
       * Fired regardless of whether the evaluator decided to switch — allows
       * observing "evaluator ran but decided not to switch" scenarios.
       */
      readonly _tag: "StrategySwitchEvaluated";
      /** Unique task identifier */
      readonly taskId: string;
      /** Whether the evaluator recommends switching */
      readonly shouldSwitch: boolean;
      /** Strategy the evaluator recommends switching to (empty string if shouldSwitch is false) */
      readonly recommendedStrategy: string;
      /** Brief explanation from the evaluator */
      readonly reasoning: string;
      /** Unix timestamp in milliseconds */
      readonly timestamp: number;
    }
  | {
      /**
       * A strategy switch actually occurred.
       * Fired when the kernel transitions from one reasoning strategy to another.
       */
      readonly _tag: "StrategySwitched";
      /** Unique task identifier */
      readonly taskId: string;
      /** Strategy name being switched from */
      readonly from: string;
      /** Strategy name being switched to */
      readonly to: string;
      /** Human-readable reason for the switch */
      readonly reason: string;
      /** Unix timestamp in milliseconds */
      readonly timestamp: number;
    }
  // ─── Streaming events ───
  | {
      /**
       * A complete text response arrived from the LLM (end of streaming).
       * Fired once per LLM call after content_complete — NOT per token.
       * For per-token events, subscribe to agent.runStream() TextDelta events instead.
       */
      readonly _tag: "TextDeltaReceived";
      readonly taskId: string;
      readonly text: string;
      readonly timestamp: number;
    }
  | {
      /**
       * Agent stream started.
       * Fired at the beginning of agent.runStream() execution.
       */
      readonly _tag: "AgentStreamStarted";
      readonly taskId: string;
      readonly agentId: string;
      readonly density: string;
      readonly timestamp: number;
    }
  | {
      /**
       * Agent stream completed.
       * Fired when the stream reaches StreamCompleted or StreamError.
       */
      readonly _tag: "AgentStreamCompleted";
      readonly taskId: string;
      readonly agentId: string;
      readonly success: boolean;
      readonly durationMs: number;
    };

/**
 * Discriminant tag union of all agent event types.
 * Derived directly from `AgentEvent["_tag"]` so it stays in sync with the union automatically.
 * Useful for writing generic event handlers, type guards, and filtering logic.
 *
 * @example
 * ```typescript
 * function onEvent(tag: AgentEventTag, handler: (event: AgentEvent) => void) {
 *   // tag is strictly one of the 32 event type names
 * }
 * ```
 *
 * @see AgentEvent — the full event union this tag set is derived from
 * @see EventBus.on — typed subscription method that accepts an AgentEventTag
 */
export type AgentEventTag = AgentEvent["_tag"];

/**
 * Typed handler for a specific event.
 * The `event` parameter is automatically narrowed to the matching variant via `Extract<AgentEvent, { _tag: T }>`.
 * No `_tag` type guard needed inside the handler body.
 *
 * @typeParam T — The event tag/discriminant to filter on
 * @param event — The narrowed event object matching tag `T`
 * @returns An Effect that completes when the handler finishes
 *
 * @example
 * ```typescript
 * const handler: TypedEventHandler<"AgentCompleted"> = (event) => {
 *   // event: { _tag: "AgentCompleted"; totalTokens: number; ... }
 *   return Effect.sync(() => console.log(event.totalTokens));
 * };
 * ```
 *
 * @see EventBus.on — pass this handler type to bus.on(tag, handler)
 * @see AgentEventTag — the set of valid values for type parameter T
 */
export type TypedEventHandler<T extends AgentEventTag> = (
  event: Extract<AgentEvent, { _tag: T }>,
) => Effect.Effect<void, never>;

/**
 * Catch-all handler that receives any `AgentEvent`.
 * Used when you want to handle all events uniformly without tag-based filtering.
 * For tag-filtered subscriptions with automatic type narrowing, prefer `TypedEventHandler<T>`.
 *
 * @param event — The full AgentEvent union (no narrowing — discriminate on `event._tag` yourself)
 * @returns An Effect that completes when the handler finishes
 *
 * @see TypedEventHandler — narrowed alternative for tag-specific subscriptions
 * @see EventBus.subscribe — accepts this handler type for catch-all subscriptions
 */
export type EventHandler = (event: AgentEvent) => Effect.Effect<void, never>;

// ─── Service Tag ───

/**
 * EventBus service — central publish-subscribe hub for all agent lifecycle events.
 * Enables decoupled observability, metrics collection, tracing, and custom integrations.
 * All events flow through EventBus: task lifecycle, execution phases, LLM requests, tool calls, memory events, etc.
 *
 * Consumers subscribe via `on(tag, handler)` for type-safe tag-filtered subscriptions
 * or `subscribe(handler)` for a catch-all handler receiving every event.
 * Publishers call `publish(event)` to broadcast an `AgentEvent` to all current subscribers.
 *
 * @example
 * ```typescript
 * const bus = yield* EventBus;
 * yield* bus.publish({
 *   _tag: "AgentStarted",
 *   taskId: "task-123",
 *   agentId: "agent-456",
 *   provider: "anthropic",
 *   model: "claude-opus-4-20250514",
 *   timestamp: Date.now()
 * });
 *
 * const unsub = yield* bus.on("AgentCompleted", (event) => {
 *   return Effect.sync(() => console.log(event.totalTokens));
 * });
 * ```
 *
 * @see AgentEvent — union of all event variants the bus can carry
 * @see EventBusLive — default Effect-TS Layer implementation
 * @see TypedEventHandler — type for tag-filtered event handlers
 */
export class EventBus extends Context.Tag("EventBus")<
  EventBus,
  {
    /**
     * Publish an event to all subscribed handlers.
     * All handlers execute concurrently; failures in one do not prevent others from running.
     *
     * @param event — The AgentEvent to broadcast
     * @returns Effect that completes once all handlers have started (does not wait for completion)
     *
     * @example
     * ```typescript
     * yield* bus.publish({ _tag: "TaskCreated", taskId: "task-123" });
     * ```
     */
    readonly publish: (event: AgentEvent) => Effect.Effect<void, never>;

    /**
     * Subscribe a catch-all handler for all events.
     * Handler receives every event published on the bus.
     *
     * @param handler — Function to invoke for every event
     * @returns Effect that yields an unsubscribe function. Call the returned function to stop listening.
     *
     * @example
     * ```typescript
     * const unsub = yield* bus.subscribe((event) => {
     *   return Effect.sync(() => console.log("Event:", event._tag));
     * });
     * // Later:
     * unsub();
     * ```
     */
    readonly subscribe: (
      handler: EventHandler,
    ) => Effect.Effect<() => void, never>;

    /**
     * Subscribe a handler to events matching a specific tag.
     * Type-safe: the handler receives only events of the specified tag, automatically narrowed.
     * No `_tag` type guard needed inside the handler.
     *
     * @typeParam T — The AgentEventTag to filter on
     * @param tag — Event discriminant (e.g., "AgentCompleted", "ToolCallStarted")
     * @param handler — Function receiving the narrowed event type
     * @returns Effect that yields an unsubscribe function
     *
     * @example
     * ```typescript
     * const unsub = yield* bus.on("AgentCompleted", (event) => {
     *   // event: { _tag: "AgentCompleted"; totalTokens: number; ... }
     *   return Effect.sync(() => console.log("Tokens:", event.totalTokens));
     * });
     *
     * const unsub2 = yield* bus.on("ToolCallStarted", (event) => {
     *   // event: { _tag: "ToolCallStarted"; toolName: string; ... }
     *   return Effect.sync(() => console.log("Tool:", event.toolName));
     * });
     * ```
     */
    readonly on: <T extends AgentEventTag>(
      tag: T,
      handler: TypedEventHandler<T>,
    ) => Effect.Effect<() => void, never>;
  }
>() {}

// ─── Live Implementation ───

/**
 * EventBusLive — default Effect-TS Layer implementation of EventBus.
 * Uses an Effect Ref to maintain subscriber list.
 * All handlers execute concurrently with unbounded concurrency per publish call.
 * Subscribers are stored as closures, so identity (===) is used for unsubscribe.
 *
 * @example
 * ```typescript
 * const runtime = yield* Effect.provide(EventBusLive)(myEffect);
 * ```
 */
export const EventBusLive = Layer.effect(
  EventBus,
  Effect.gen(function* () {
    const handlers = yield* Ref.make<EventHandler[]>([]);

    return {
      /**
       * Publish implementation — broadcasts event to all registered handlers concurrently.
       * Failures in individual handlers do not stop other handlers from running.
       *
       * @internal
       */
      publish: (event: AgentEvent) =>
        Effect.gen(function* () {
          const hs = yield* Ref.get(handlers);
          yield* Effect.all(
            hs.map((h) => h(event)),
            { concurrency: "unbounded" },
          );
        }),

      /**
       * Subscribe implementation — registers a catch-all handler.
       * Calls Ref.update to append handler to list.
       * Returns unsubscribe function via Effect.runSync.
       *
       * @internal
       */
      subscribe: (handler: EventHandler) =>
        Effect.gen(function* () {
          yield* Ref.update(handlers, (hs) => [...hs, handler]);
          return () => {
            Effect.runSync(
              Ref.update(handlers, (hs) => hs.filter((h) => h !== handler)),
            );
          };
        }),

      /**
       * On implementation — registers a tag-filtered handler.
       * Creates a wrapper handler that only calls the user's handler if event._tag matches.
       * Type cast is safe because the filter guarantees the tag matches.
       *
       * @internal
       */
      on: <T extends AgentEventTag>(tag: T, handler: TypedEventHandler<T>) =>
        Effect.gen(function* () {
          // The outer filter ensures `event._tag === tag` before calling handler,
          // so the cast to the narrowed type is always safe.
          const filtered: EventHandler = (event) =>
            event._tag === tag
              ? handler(event as Extract<AgentEvent, { _tag: T }>)
              : Effect.void;
          yield* Ref.update(handlers, (hs) => [...hs, filtered]);
          return () => {
            Effect.runSync(
              Ref.update(handlers, (hs) => hs.filter((h) => h !== filtered)),
            );
          };
        }),
    };
  }),
);
