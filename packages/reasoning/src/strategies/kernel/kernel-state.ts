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
import type { ResultCompressionConfig, ToolCallSpec, FinalAnswerCapture } from "@reactive-agents/tools";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { ToolSchema } from "./utils/tool-utils.js";
import type { KernelMetaToolsConfig } from "../../types/kernel-meta-tools.js";

// ── Kernel Status ────────────────────────────────────────────────────────────

export type KernelStatus = "thinking" | "acting" | "observing" | "done" | "failed" | "evaluating";

// ── KernelMessage — Provider-agnostic conversation message ───────────────────

/** Provider-agnostic conversation message for the kernel's native FC conversation history. */
export type KernelMessage =
  | { readonly role: "assistant"; readonly content: string; readonly toolCalls?: readonly ToolCallSpec[] }
  | { readonly role: "tool_result"; readonly toolCallId: string; readonly toolName: string; readonly content: string; readonly isError?: boolean }
  | { readonly role: "user"; readonly content: string };

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
  readonly meta: Readonly<Record<string, unknown>>;

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
   * Synthesized context for the next handleThinking call.
   * Set by kernel-runner after handleActing completes.
   * Consumed and cleared (null) by handleThinking — never accumulated.
   */
  readonly synthesizedContext?: import("../../context/synthesis-types.js").SynthesizedContext | null;
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
  readonly blockedTools?: readonly string[];
  /**
   * Tools that MUST be called before the agent can declare success.
   * If the agent attempts to end without using all required tools,
   * it will be redirected up to `maxRequiredToolRetries` times (default: 2)
   * before failing with a descriptive error.
   */
  readonly requiredTools?: readonly string[];
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
   * Maximum number of times the kernel will redirect the agent back to
   * "thinking" when required tools haven't been used. Default: 2.
   * After this many redirects, the kernel fails with an error listing
   * the tools that were never called.
   */
  readonly maxRequiredToolRetries?: number;
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
};

/** Minimal EventBus surface used by kernel hooks (publish only) */
export type EventBusInstance = {
  readonly publish: (event: unknown) => Effect.Effect<void, unknown>;
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
    synthesizedContext: undefined,
  };
}

/**
 * Immutable state transition — returns a new KernelState with the given patch applied.
 *
 * Since ReadonlySet and ReadonlyMap are not spreadable, they must be explicitly
 * carried forward unless overridden in the patch.
 */
export function transitionState(
  state: KernelState,
  patch: Partial<KernelState>,
): KernelState {
  return {
    ...state,
    ...patch,
    // Preserve non-spreadable collection types — patch wins if present
    toolsUsed: patch.toolsUsed ?? state.toolsUsed,
    scratchpad: patch.scratchpad ?? state.scratchpad,
  };
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
    synthesizedContext: state.synthesizedContext,
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
    synthesizedContext: raw.synthesizedContext,
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

export interface ReActKernelInput {
  /** The task description to accomplish */
  task: string;
  /** Optional custom system prompt for steering behavior */
  systemPrompt?: string;
  /** Full tool schemas — passed from execution engine via availableToolSchemas */
  availableToolSchemas?: readonly ToolSchema[];
  /**
   * Optional prior context to inject above the task.
   * Used by Reflexion (critique text), Plan-Execute (plan context), etc.
   */
  priorContext?: string;
  /** Maximum iterations before giving up. Default: 10 */
  maxIterations?: number;
  /** Model context profile controlling compaction thresholds, result sizes, etc. */
  contextProfile?: Partial<ContextProfile>;
  /** Tool result compression configuration */
  resultCompression?: ResultCompressionConfig;
  /** LLM sampling temperature */
  temperature?: number;
  /** Task ID for EventBus correlation */
  taskId?: string;
  /** Name of the calling strategy (for event tagging) */
  parentStrategy?: string;
  /** Descriptive label for this kernel invocation (e.g. "reflexion:generate", "plan-execute:step-3") */
  kernelPass?: string;
  /** Agent ID for tool execution attribution. Falls back to "reasoning-agent". */
  agentId?: string;
  /** Session ID for tool execution attribution. Falls back to "reasoning-session". */
  sessionId?: string;
  /**
   * Full unfiltered tool schemas from the registry. Used by the dynamic task
   * completion guard to detect MCP namespaces referenced in the task, even
   * when adaptive filtering has hidden some tools from the LLM prompt.
   */
  allToolSchemas?: readonly ToolSchema[];
  /**
   * Tools that MUST NOT be executed — hard code-level guard.
   * When the model requests a blocked tool, a synthetic observation is returned
   * instead of executing. Used by reflexion to prevent re-executing side-effect
   * tools (send, write, create, etc.) that already succeeded in a prior pass.
   */
  blockedTools?: readonly string[];
  /**
   * Tools that MUST be called before the agent can declare success.
   * If the agent attempts to end without using all required tools,
   * it will be redirected up to `maxRequiredToolRetries` times before failing.
   */
  requiredTools?: readonly string[];
  /** Max redirects when required tools are missing (default: 2) */
  maxRequiredToolRetries?: number;
  /** Model identifier for routing/entropy scoring */
  modelId?: string;
  /** Exit kernel loop when all scoped tools have been called successfully */
  exitOnAllToolsCalled?: boolean;
  /** Meta-tool configuration and pre-computed static data for brief/pulse/recall/find. */
  metaTools?: KernelMetaToolsConfig;
  /** Pre-built ToolCallResolver instance — injected by the kernel runner when FC is active */
  toolCallResolver?: import("@reactive-agents/tools").ToolCallResolver;
  /** Intelligent Context Synthesis config — threaded from .withReasoning() */
  synthesisConfig?: import("../../context/synthesis-types.js").SynthesisConfig;
}

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
 * Note: KernelContext is used (not PhaseContext) because phases need access to
 * compression, toolService, and other fields that PhaseContext does not expose.
 */
export type Phase = (
  state: KernelState,
  context: KernelContext,
) => Effect.Effect<KernelState, never, LLMService>;

/**
 * Immutable per-turn context passed to every phase.
 * Phases read from ctx, write only to returned KernelState.
 */
export interface PhaseContext {
  readonly input: ReActKernelInput;
  readonly profile: ContextProfile;
  readonly hooks: KernelHooks;
}
