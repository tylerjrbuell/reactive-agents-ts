/**
 * shared/kernel-state.ts — Immutable state, ThoughtKernel contract, and KernelHooks.
 *
 * Foundation of the composable kernel architecture. Every reasoning strategy
 * operates on a single `KernelState` value that flows through a `ThoughtKernel`
 * function. The state is immutable — each iteration produces a new state via
 * `transitionState()`. Serialization helpers support persistence and debugging.
 */
import { Effect } from "effect";
import type { ReasoningStep } from "../../types/index.js";
import type { ContextProfile } from "../../context/context-profile.js";
import type { ResultCompressionConfig, ToolCallSpec, FinalAnswerCapture, ToolCallResolver, ToolCallingDriver } from "@reactive-agents/tools";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { SemanticEntry, MemoryId } from "@reactive-agents/memory";
import type { ToolSchema } from "../../kernel/capabilities/attend/tool-formatting.js";
import type { EntropyScoreLike } from "../../kernel/loop/output-assembly.js";
import type { KernelMetaToolsConfig } from "../../types/kernel-meta-tools.js";
import type {
  ToolElaborationInjectionConfig,
  NextMovesPlanningConfig,
} from "../../kernel/capabilities/act/tool-gating.js";

// ── Kernel Status ────────────────────────────────────────────────────────────

export type KernelStatus = "thinking" | "acting" | "observing" | "done" | "failed" | "evaluating";

// ── KernelMessage — Provider-agnostic conversation message ───────────────────

/** Provider-agnostic conversation message for the kernel's native FC conversation history. */
export type KernelMessage =
  | { readonly role: "assistant"; readonly content: string; readonly toolCalls?: readonly ToolCallSpec[] }
  | { readonly role: "tool_result"; readonly toolCallId: string; readonly toolName: string; readonly content: string; readonly isError?: boolean; readonly storedKey?: string }
  | { readonly role: "user"; readonly content: string };

// ── PendingGuidance — harness signals for the next think turn ────────────────

/**
 * Typed harness signals collected during act/guard phases.
 * Rendered deterministically in the system prompt Guidance: section by think.ts.
 * All fields are optional so callers only set what applies to the current signal.
 */
export interface PendingGuidance {
  /** Required tool names flagged by a quota-violation escalation (not normal pending state). */
  readonly requiredToolsPending?: readonly string[];
  /** True when loop detection fired and the agent is repeating without progress. */
  readonly loopDetected?: boolean;
  /** Guidance produced by the ICS coordinator (synthesis/strategy signals). */
  readonly icsGuidance?: string;
  /** Guidance from the oracle / quality gate (e.g. readyToAnswer nudge). */
  readonly oracleGuidance?: string;
  /** Recovery hint when tool failures or errors occurred on the previous round. */
  readonly errorRecovery?: string;
  /** Post-act harness reminder (e.g. "you must still call X", "required tools satisfied"). */
  readonly actReminder?: string;
  /** Adapter quality-check hint rendered before accepting a prose final answer. */
  readonly qualityGateHint?: string;
  /** Reserved for Task 17 — evidence grounding redirect when claims lack tool support. */
  readonly evidenceGap?: string;
}

// ── KernelMeta — typed strategy-specific metadata bag ─────────────────────────

/** Entropy sensor metadata accumulated during kernel execution. */
export interface KernelEntropyMeta {
  readonly taskDescription?: string;
  readonly modelId?: string;
  readonly temperature?: number;
  readonly taskCategory?: string;
  readonly lastLogprobs?: readonly { token: string; logprob: number; topLogprobs?: readonly { token: string; logprob: number }[] }[];
  readonly entropyHistory?: readonly EntropyScoreLike[];
  readonly controllerConfig?: {
    readonly earlyStop: boolean;
    readonly contextCompression: boolean;
    readonly strategySwitch: boolean;
  };
  /** Latest entropy snapshot for brief/pulse meta-tools. */
  readonly latest?: { readonly composite: number; readonly shape: string; readonly momentum: number; readonly history?: readonly number[] };
  /** Latest composite score for termination oracle. */
  readonly latestScore?: unknown;
  /** Latest trajectory shape for termination oracle. */
  readonly latestTrajectory?: unknown;
}

/** Reactive controller decision stored on meta for oracle consumption. */
export interface ControllerDecisionLike {
  readonly decision: string;
  readonly reason?: string;
  readonly sections?: readonly string[];
  readonly skillName?: string;
}

/** Typed metadata bag for KernelState. Every field is optional. */
export interface KernelMeta {
  // ── Entropy / reactive intelligence ──
  readonly entropy?: KernelEntropyMeta;
  readonly controllerDecisions?: readonly ControllerDecisionLike[];

  // ── Iteration control ──
  readonly maxIterations?: number;
  readonly requiredTools?: readonly string[];

  // ── Termination tracking ──
  readonly terminatedBy?: string;
  /** Prior terminatedBy value when the post-loop harness-deliverable promotion overrides it. */
  readonly previousTerminatedBy?: string;
  readonly redirectCount?: number;
  /** Temperature override dispatched by the intervention dispatcher — kernel-runner applies on next iteration. */
  readonly dispatchedTemperature?: number;
  /** Strategy switch requested by the intervention dispatcher — kernel-runner executes the switch. */
  readonly dispatchedStrategySwitch?: { readonly to: string; readonly reason: string };

  // ── Native FC handoff between think → act ──
  readonly pendingNativeToolCalls?: readonly ToolCallSpec[];
  readonly lastThought?: string;
  readonly lastThinking?: string | null;

  // ── Quality / output gates ──
  readonly qualityCheckDone?: boolean;
  readonly evidenceGroundingDone?: boolean;
  readonly gateBlockedTools?: readonly string[];
  readonly outputSynthesized?: boolean;
  /** True once the "required tools satisfied" completion nudge has been emitted for this run. */
  readonly completionNudgeSent?: boolean;
  readonly outputFormatValidated?: boolean;
  readonly outputFormatReason?: string;
  readonly evaluator?: string;
  readonly allVerdicts?: ReadonlyArray<{ evaluator: string; verdict: unknown }>;

  // ── Execution lane ──
  readonly executionLane?: string;
  readonly missingRequiredTools?: readonly string[];

  // ── Recovery ──
  readonly recoveryPending?: boolean;
  readonly recoveryFailedTools?: readonly string[];
  readonly recoveryAlternativeCandidates?: readonly string[];

  // ── Kernel identity / pass ──
  readonly kernelPass?: string;

  // ── Final answer ──
  readonly finalAnswerCapture?: FinalAnswerCapture;

  // ── Resolver dialect telemetry ──
  /** Which resolver dialect tier fired for the most recent tool call (if any). */
  readonly lastDialectObserved?: string;

  // ── Arbitrator escalation (Sprint 3.3 — Sole Termination Authority) ──
  /** Strategy the Arbitrator chose to escalate to via its "escalate" Verdict. */
  readonly escalateTo?: string;
  /** Reason the Arbitrator emitted with the escalate Verdict. */
  readonly escalationReason?: string;

  // ── Sprint 3.4 Scaffold 3 — synthesis-grounding retry counter ──
  /**
   * How many corrective iterations the Arbitrator has triggered for
   * synthesis-grounding failures. Capped at 1 by default; the Arbitrator
   * stops escalating once this exceeds the cap.
   */
  readonly synthesisRetryCount?: number;

  // ── Stage 5 W3 — RI dispatcher budget (FIX-23) ──
  /**
   * Per-run intervention budget threaded through dispatch context. Each
   * dispatched patch increments `interventionsFiredThisRun`; the total
   * cost reported by the dispatcher accumulates into
   * `tokensSpentOnInterventions`. Suppression gates at
   * `dispatcher.ts:69-76` (`maxFiresPerRun`, `maxInterventionTokenBudget`)
   * read these values to decide whether to fire or suppress.
   *
   * Prior to W3 these were hardcoded to 0 every iteration, making the
   * gates unreachable. See AUDIT-overhaul-2026.md §11 #23 + M1 mechanism.
   */
  readonly riBudget?: {
    readonly interventionsFiredThisRun: number;
    readonly tokensSpentOnInterventions: number;
  };

}

// ── KernelState — Immutable, serializable reasoning state ────────────────────

export interface KernelState {
  // Identity
  readonly taskId: string;
  readonly strategy: string;
  readonly kernelType: string;

  // Accumulation
  readonly steps: readonly ReasoningStep[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly scratchpad: ReadonlyMap<string, string>;

  // Metrics
  readonly iteration: number;
  readonly tokens: number;
  readonly cost: number;

  // Control
  readonly status: KernelStatus;
  readonly output: string | null;
  readonly error: string | null;

  // Termination oracle
  readonly priorThought?: string;
  readonly llmCalls: number;

  // Strategy-specific
  readonly meta: KernelMeta;

  /** Accumulated controller decisions this run, formatted as "decision: reason" strings. */
  readonly controllerDecisionLog: readonly string[];

  /**
   * The LLM conversation thread — what gets sent to the model.
   * Grows with each tool call (assistant turn + tool results appended).
   * Compacted via sliding window when approaching token budget.
   * Separate from steps[] which is the observability record.
   */
  readonly messages: readonly KernelMessage[];

  /**
   * Pending guidance signals from the harness (ICS, oracle, recovery, loop detection).
   * Rendered in the Guidance: section of the system prompt by the think phase.
   * Cleared after each think turn so stale signals don't leak across iterations.
   */
  readonly pendingGuidance?: PendingGuidance;

  /**
   * Count of consecutive iterations with token-delta < 500.
   * Used by the token-delta diminishing-returns guard.
   */
  readonly consecutiveLowDeltaCount?: number;

  /**
   * Stage 1 max_output_tokens recovery: override token limit to 64k for one re-run.
   * Set when the LLM first hits its output token limit. The runner re-executes the
   * same think phase with this value passed as maxTokens to the LLM call.
   */
  readonly maxOutputTokensOverride?: number;

  /**
   * Stage 2 max_output_tokens recovery: count of recovery message injections.
   * Incremented each time a recovery user-turn is injected. Capped at 3.
   * When this reaches 3 and max_tokens fires again, the run fails.
   */
  readonly maxOutputTokensRecoveryCount?: number;

  /**
   * Count of iterations where the pulse oracle returned readyToAnswer=true
   * but the model has not yet called final-answer.
   * Stage 1: inject mandatory steering nudge.
   * Stage 2: after 2 nudges, force-exit with terminatedBy: "oracle_forced".
   */
  readonly readyToAnswerNudgeCount?: number;

  /**
   * The last meta-tool that was called (brief, pulse, find, recall).
   * Used by the meta-tool dedup guard to detect consecutive identical calls.
   */
  readonly lastMetaToolCall?: string;

  /**
   * Number of consecutive times `lastMetaToolCall` has been called in a row.
   * Resets to 1 when a different meta-tool or non-meta tool is called.
   */
  readonly consecutiveMetaToolCount?: number;
}

// ── KernelInput — Frozen execution input ─────────────────────────────────────

export interface KernelInput {
  readonly task: string;
  readonly systemPrompt?: string;
  readonly availableToolSchemas?: readonly ToolSchema[];
  /** Full unfiltered tool schemas — used by completion guard to detect all MCP namespaces */
  readonly allToolSchemas?: readonly ToolSchema[];
  readonly priorContext?: string;
  readonly contextProfile?: Partial<ContextProfile>;
  readonly resultCompression?: ResultCompressionConfig;
  readonly temperature?: number;
  readonly agentId?: string;
  readonly sessionId?: string;
  /** LLM provider name (e.g. "ollama", "anthropic"). Used to derive the default
   *  context profile tier when no explicit contextProfile.tier is provided.
   *  Ollama providers default to "local" tier (maxSameTool=2) instead of "mid" (3). */
  readonly providerName?: string;
  readonly blockedTools?: readonly string[];
  /**
   * Tools that MUST be called before the agent can declare success.
   * If the agent attempts to end without using all required tools,
   * it will be redirected up to `maxRequiredToolRetries` times (default: 2)
   * before failing with a descriptive error.
   */
  readonly requiredTools?: readonly string[];
  /**
   * Minimum number of times each required tool must be called before the task is
   * considered complete. Populated by the tool classifier from its per-tool minCalls
   * field. The repetition guard and final-answer gate use this instead of hardcoded
   * thresholds — e.g. `{ "http-get": 4 }` means the agent must call http-get at
   * least 4 times (once per currency) before final-answer is accepted.
   */
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
  /**
   * Tools identified as relevant/supplementary for the task (LLM-classified).
   * These are allowed through the required-tools gate even when required tools
   * are still pending — they provide supplementary research without blocking progress.
   */
  readonly relevantTools?: readonly string[];
  /**
   * Maximum number of times each tool may be called in a single run.
   * Enforced by the gate before any other logic.
   * Example: `{ "web-search": 3, "http-get": 4 }` bounds research loops.
   */
  readonly maxCallsPerTool?: Readonly<Record<string, number>>;
  /**
   * Enforce a strict required-tool dependency chain.
   * When false/omitted, the gate may allow one exploratory non-required tool call
   * while still steering the model back toward missing required tools.
   */
  readonly strictToolDependencyChain?: boolean;
  /**
   * Maximum number of times the kernel will redirect the agent back to
   * "thinking" when required tools haven't been used. Default: 2.
   * After this many redirects, the kernel fails with an error listing
   * the tools that were never called.
   */
  readonly maxRequiredToolRetries?: number;
  /**
   * Maximum number of times the kernel will redirect the agent back to
   * "thinking" when the verifier rejects a candidate final-answer
   * (Sprint 3.5 Stage 2 — verifier-driven retry). Default: 1.
   *
   * On rejection, the kernel injects the verdict's failure reason as a
   * harness signal step so the model gets specific feedback (e.g., "agent
   * shipped output without calling any data tool") rather than retrying
   * blind. Setting to 0 disables retry — the verifier remains a final
   * gate that fails the run on rejection.
   */
  readonly maxVerifierRetries?: number;
  /**
   * Custom verifier — overrides {@link defaultVerifier} for both the in-loop
   * retry gate and the §9.0 terminal gate. Developers can implement domain-
   * specific verification (e.g., schema-validated outputs, JSON-shape checks,
   * regex-based grounding) without touching kernel internals.
   *
   * Pass-through types are exported from `@reactive-agents/reasoning`:
   *   import { type Verifier, defaultVerifier } from "@reactive-agents/reasoning";
   */
  readonly verifier?: import("../capabilities/verify/verifier.js").Verifier;
  /**
   * Custom retry policy — controls WHEN the kernel retries on verifier
   * rejection. Returns `{ retry, signalText?, reason? }`. The default policy
   * retries any rejection while the budget allows; developers can suppress
   * retry for known-regressing task classes (e.g., long-form synthesis where
   * re-rolling adds more fabricated content) or customize the harness
   * signal text per failure mode.
   */
  readonly verifierRetryPolicy?: import("../capabilities/verify/verifier.js").VerifierRetryPolicy;
  /** Custom environment context key-value pairs injected into the system prompt */
  readonly environmentContext?: Readonly<Record<string, string>>;
  /**
   * Optional seed messages for the LLM conversation thread.
   * When provided, `state.messages` is initialized from these instead of starting empty.
   * Allows the execution engine to inject prior conversation context (e.g. chat history).
   */
  readonly initialMessages?: readonly KernelMessage[];
  /**
   * Context synthesis (ICS) — from .withReasoning({ synthesis: ... }).
   * Omitted defaults to `{ mode: "auto" }` in kernel-runner.
   */
  readonly synthesisConfig?: import("../../context/synthesis-types.js").SynthesisConfig;
  /** Meta-tool configuration and pre-computed static data for brief/pulse/recall/find. */
  readonly metaTools?: KernelMetaToolsConfig;
  /** Lightweight tool elaboration injection shown in system prompt for better tool selection. */
  readonly toolElaboration?: ToolElaborationInjectionConfig;
  /** Short-term next-moves planner for optional native tool batch execution windows. */
  readonly nextMovesPlanning?: NextMovesPlanningConfig;
  /**
   * Runtime-resolved skills (e.g. SkillResolver) merged into `brief` alongside
   * `metaTools.staticBriefInfo.availableSkills` — resolved wins on name collision.
   */
  readonly briefResolvedSkills?: readonly { readonly name: string; readonly purpose: string }[];
  /**
   * When enabled, runs a lightweight LLM extraction pass on large tool results
   * to distill key facts before compression. The extracted summary is prepended
   * to the compressed preview so the model sees both distilled data and recall hints.
   * - `true`: always extract for results that exceed the compression budget
   * - `false`: never extract (heuristic compression only)
   * - `"auto"`: extract only for local/mid tiers when results exceed budget
   */
  readonly observationSummary?: boolean | "auto";
  /**
   * The model identifier (e.g. "gemma4:e4b", "gpt-4o") for this kernel run.
   * Passed to selectAdapter so calibrated adapters can be looked up by modelId.
   * Falls back to tier-based adapter selection when absent.
   */
  readonly modelId?: string;
  /**
   * Optional pre-resolved model calibration. When present, the ContextManager and
   * adapter selection may use the calibration fields (steeringCompliance,
   * parallelCallCapability, observationHandling, etc.) to tune per-turn behavior.
   * When absent, tier-based defaults apply (and `selectAdapter` may still load
   * a pre-baked calibration by modelId internally).
   */
  readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
  /** Maximum iterations before giving up. Default: 10 */
  readonly maxIterations?: number;
  /** Task ID for EventBus correlation */
  readonly taskId?: string;
  /** Name of the calling strategy (for event tagging) */
  readonly parentStrategy?: string;
  /** Descriptive label for this kernel invocation (e.g. "reflexion:generate", "plan-execute:step-3") */
  readonly kernelPass?: string;
  /** Exit kernel loop when all scoped tools have been called successfully */
  readonly exitOnAllToolsCalled?: boolean;
  /** Pre-built ToolCallResolver instance — injected by the kernel runner when FC is active */
  readonly toolCallResolver?: ToolCallResolver;
}

// ── Narrow service types ─────────────────────────────────────────────────────

export type MaybeService<T> = { _tag: "Some"; value: T } | { _tag: "None" };

/** Minimal ToolService surface used by kernel calls (execute + getTool) */
export type ToolServiceInstance = {
  readonly execute: (input: {
    toolName: string;
    arguments: Record<string, unknown>;
    agentId: string;
    sessionId: string;
  }) => Effect.Effect<{ result: unknown; success?: boolean }, unknown>;
  readonly getTool: (name: string) => Effect.Effect<{
    parameters: Array<{ name: string; type: string; required?: boolean }>;
  }, unknown>;
  readonly listTools: (filter?: {
    category?: string;
    source?: string;
    riskLevel?: string;
  }) => Effect.Effect<readonly { readonly name: string }[], never>;
};

/** Minimal EventBus surface used by kernel hooks (publish only) */
export type EventBusInstance = {
  readonly publish: (event: unknown) => Effect.Effect<void, unknown>;
};

/**
 * Minimal MemoryService surface used by kernel tool-execution.
 *
 * Only `storeSemantic` is needed — tool-execution populates the semantic memory
 * layer during reasoning so cross-iteration recall works. Other memory methods
 * (bootstrap, flush, snapshot, logEpisode) are used exclusively by the runtime
 * execution engine, not by the kernel itself.
 */
export type MemoryServiceInstance = {
  readonly storeSemantic: (
    entry: SemanticEntry,
  ) => Effect.Effect<MemoryId, unknown>;
};

// ── KernelHooks — Lifecycle hooks for observability wiring ───────────────────

export interface KernelHooks {
  readonly onThought: (
    state: KernelState,
    thought: string,
    prompt?: {
      system: string;
      user: string;
      /** Full FC conversation thread with role labels — present when logModelIO is enabled */
      messages?: readonly { readonly role: string; readonly content: string }[];
      /** Raw LLM response before parsing */
      rawResponse?: string;
    },
  ) => Effect.Effect<void, never>;
  readonly onAction: (state: KernelState, tool: string, input: string) => Effect.Effect<void, never>;
  readonly onObservation: (state: KernelState, result: string, success: boolean) => Effect.Effect<void, never>;
  readonly onDone: (state: KernelState) => Effect.Effect<void, never>;
  readonly onError: (state: KernelState, error: string) => Effect.Effect<void, never>;
  readonly onIterationProgress: (state: KernelState, toolsThisStep: readonly string[]) => Effect.Effect<void, never>;
  readonly onStrategySwitched: (state: KernelState, from: string, to: string, reason: string) => Effect.Effect<void, never>;
  readonly onStrategySwitchEvaluated: (
    state: KernelState,
    evaluation: { shouldSwitch: boolean; recommendedStrategy: string; reasoning: string }
  ) => Effect.Effect<void, never>;
  /**
   * After ICS completes — publish observability before the next LLM call.
   */
  readonly onContextSynthesized: (
    synthesized: import("../../context/synthesis-types.js").SynthesizedContext,
    taskId: string,
    agentId: string,
  ) => Effect.Effect<void, never>;
}

// ── KernelContext — Injected into every kernel call ──────────────────────────

export interface KernelContext {
  readonly input: KernelInput;
  readonly profile: ContextProfile;
  readonly compression: ResultCompressionConfig;
  readonly toolService: MaybeService<ToolServiceInstance>;
  readonly hooks: KernelHooks;
  /** Driver selected from calibration toolCallDialect ("native-fc" → NativeFCDriver, else TextParseDriver). */
  readonly toolCallingDriver: ToolCallingDriver;
  /** Memory service for semantic storage of successful tool results. None when
   *  the memory layer is not registered. Store calls are forked (non-blocking). */
  readonly memoryService: MaybeService<MemoryServiceInstance>;
}

// ── ThoughtKernel — The core computation type ────────────────────────────────

/**
 * A ThoughtKernel takes immutable state + context, performs one reasoning step
 * (think, act, or observe), and returns the next state. The kernel runner calls
 * this in a loop until `state.status` is "done" or "failed".
 */
export type ThoughtKernel = (
  state: KernelState,
  context: KernelContext,
) => Effect.Effect<KernelState, never, LLMService>;

// ── KernelRunOptions — Configuration for the kernel runner ───────────────────

/** Loop detection configuration for kernel execution. */
export interface LoopDetectionConfig {
  /** Max consecutive calls to the same tool with the same args before aborting (default: 3) */
  readonly maxSameToolCalls?: number;
  /** Max identical thought strings in the last N steps before aborting (default: 3) */
  readonly maxRepeatedThoughts?: number;
  /** Max consecutive thought steps without any tool action before aborting (default: 3) */
  readonly maxConsecutiveThoughts?: number;
}

export interface KernelRunOptions {
  readonly maxIterations: number;
  readonly strategy: string;
  readonly kernelType: string;
  readonly taskId?: string;
  readonly kernelPass?: string;
  readonly meta?: Record<string, unknown>;
  readonly loopDetection?: LoopDetectionConfig;
  /** Dynamic strategy switching configuration */
  readonly strategySwitching?: {
    /** Enable automatic strategy switching when a loop is detected */
    readonly enabled: boolean;
    /** Maximum number of strategy switches allowed (default: 1) */
    readonly maxSwitches?: number;
    /** Skip the LLM evaluator and switch directly to this strategy */
    readonly fallbackStrategy?: string;
    /** Strategies available to switch to */
    readonly availableStrategies?: readonly string[];
  };
  /** Task description for entropy-based intelligence routing */
  readonly taskDescription?: string;
  /** Model identifier for entropy-based intelligence routing */
  readonly modelId?: string;
  /** LLM temperature for entropy-based intelligence routing */
  readonly temperature?: number;
  /** Task category for per-category entropy scoring adjustments */
  readonly taskCategory?: string;
  /** When true, exit the kernel loop as soon as all scoped tools have been called successfully.
   *  Used by plan-execute composite steps to avoid looping after all tool hints are satisfied. */
  readonly exitOnAllToolsCalled?: boolean;
}

// ── Factory functions ────────────────────────────────────────────────────────

/**
 * Create an initial KernelState with empty accumulation and status "thinking".
 *
 * Uses mutable Set/Map internally (they satisfy ReadonlySet/ReadonlyMap).
 */
export function initialKernelState(opts: KernelRunOptions): KernelState {
  // Build entropy meta only when at least one entropy field is provided
  const hasEntropy = opts.taskDescription !== undefined || opts.modelId !== undefined || opts.temperature !== undefined || opts.taskCategory !== undefined;
  const entropyMeta = hasEntropy
    ? {
        ...(opts.taskDescription !== undefined ? { taskDescription: opts.taskDescription } : {}),
        ...(opts.modelId !== undefined ? { modelId: opts.modelId } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.taskCategory !== undefined ? { taskCategory: opts.taskCategory } : {}),
      }
    : undefined;

  return {
    taskId: opts.taskId ?? "",
    strategy: opts.strategy,
    kernelType: opts.kernelType,
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 0,
    tokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: {
      ...(opts.meta ?? {}),
      maxIterations: opts.maxIterations,
      ...(entropyMeta ? { entropy: entropyMeta } : {}),
    },
    controllerDecisionLog: [],
    messages: [],
    pendingGuidance: undefined,
    consecutiveLowDeltaCount: 0,
    readyToAnswerNudgeCount: 0,
    lastMetaToolCall: undefined,
    consecutiveMetaToolCount: 0,
  };
}

/**
 * Immutable state transition — returns a new KernelState with the given patch applied.
 *
 * Since ReadonlySet and ReadonlyMap are not spreadable, they must be explicitly
 * carried forward unless overridden in the patch.
 *
 * State-machine invariant: status="failed" implies output=null. A failed run
 * has no valid deliverable; whatever was pre-populated (lastThought from a
 * loop_graceful path, harness-assembled artifacts, etc.) is invalidated by
 * the failure. Callers who need to preserve a payload alongside a failure
 * (e.g. arbitrator.applyTermination forwarding verdict.output) MUST pass
 * `output` explicitly in the patch — `undefined` triggers the invariant.
 */
export function transitionState(
  state: KernelState,
  patch: Partial<KernelState>,
): KernelState {
  const transitionToFailed =
    patch.status === "failed" && state.status !== "failed";
  const outputUnspecified = !("output" in patch);
  const next = {
    ...state,
    ...patch,
    toolsUsed: patch.toolsUsed ?? state.toolsUsed,
    scratchpad: patch.scratchpad ?? state.scratchpad,
  };
  if (transitionToFailed && outputUnspecified) {
    return { ...next, output: null };
  }
  return next;
}

// ── Serialization ────────────────────────────────────────────────────────────

/** JSON-safe representation of KernelState (Set → array, Map → object) */
export interface SerializedKernelState
  extends Omit<KernelState, "toolsUsed" | "scratchpad" | "steps" | "messages"> {
  readonly toolsUsed: readonly string[];
  readonly scratchpad: Readonly<Record<string, string>>;
  readonly steps: readonly ReasoningStep[];
  readonly messages: readonly KernelMessage[];
  readonly controllerDecisionLog: readonly string[];
}

/**
 * Convert KernelState to a JSON-serializable form.
 * ReadonlySet → sorted array, ReadonlyMap → plain object.
 */
export function serializeKernelState(state: KernelState): SerializedKernelState {
  return {
    taskId: state.taskId,
    strategy: state.strategy,
    kernelType: state.kernelType,
    steps: state.steps,
    messages: state.messages,
    toolsUsed: [...state.toolsUsed].sort(),
    scratchpad: Object.fromEntries(state.scratchpad),
    iteration: state.iteration,
    tokens: state.tokens,
    cost: state.cost,
    status: state.status,
    output: state.output,
    error: state.error,
    llmCalls: state.llmCalls,
    priorThought: state.priorThought,
    meta: state.meta,
    controllerDecisionLog: state.controllerDecisionLog,
    pendingGuidance: state.pendingGuidance,
    consecutiveLowDeltaCount: state.consecutiveLowDeltaCount,
  };
}

/**
 * Reconstruct KernelState from its serialized form.
 * Array → Set, object → Map.
 */
export function deserializeKernelState(raw: SerializedKernelState): KernelState {
  return {
    taskId: raw.taskId,
    strategy: raw.strategy,
    kernelType: raw.kernelType,
    steps: raw.steps,
    messages: raw.messages,
    toolsUsed: new Set(raw.toolsUsed),
    scratchpad: new Map(Object.entries(raw.scratchpad)),
    iteration: raw.iteration,
    tokens: raw.tokens,
    cost: raw.cost,
    status: raw.status,
    output: raw.output,
    error: raw.error,
    llmCalls: raw.llmCalls,
    priorThought: raw.priorThought,
    meta: raw.meta,
    controllerDecisionLog: (raw.controllerDecisionLog as string[]) ?? [],
    pendingGuidance: raw.pendingGuidance,
    consecutiveLowDeltaCount: raw.consecutiveLowDeltaCount,
  };
}

// ── Noop hooks ───────────────────────────────────────────────────────────────

/** KernelHooks with all no-op implementations — safe default for tests/simple runs. */
export const noopHooks: KernelHooks = {
  onThought: () => Effect.void,
  onAction: () => Effect.void,
  onObservation: () => Effect.void,
  onDone: () => Effect.void,
  onError: () => Effect.void,
  onIterationProgress: () => Effect.void,
  onStrategySwitched: () => Effect.void,
  onStrategySwitchEvaluated: () => Effect.void,
  onContextSynthesized: () => Effect.void,
};

// ─── ReAct Kernel Input / Output ─────────────────────────────────────────────

/** @deprecated Use KernelInput directly. Preserved as alias for existing consumers. */
export type ReActKernelInput = KernelInput;

export interface ReActKernelResult {
  /** Final answer text */
  output: string;
  /** All reasoning steps (thought / action / observation) */
  steps: ReasoningStep[];
  /** Total tokens consumed across all LLM calls */
  totalTokens: number;
  /** Total estimated cost */
  totalCost: number;
  /** Distinct tool names that were called at least once */
  toolsUsed: string[];
  /** Number of iterations completed */
  iterations: number;
  /** How the loop terminated */
  terminatedBy: "final_answer" | "final_answer_tool" | "max_iterations" | "end_turn" | "llm_error";
  /** Captured final-answer tool payload — present when terminatedBy === "final_answer_tool" */
  finalAnswerCapture?: FinalAnswerCapture;
}

// ─── Phase Pipeline Types ─────────────────────────────────────────────────────

/**
 * A single step in the kernel turn pipeline.
 *
 * Pure state transition: takes the current immutable KernelState and a read-only
 * KernelContext, returns an Effect that produces the next KernelState.
 *
 * Composable: custom kernels substitute individual phases via makeKernel({ phases }).
 *
 * Phases receive the full KernelContext (compression, toolService, hooks, etc.).
 */
export type Phase = (
  state: KernelState,
  context: KernelContext,
) => Effect.Effect<KernelState, never, LLMService>;

