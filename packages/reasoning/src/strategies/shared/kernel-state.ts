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
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { ToolSchema } from "./tool-utils.js";

// ── Kernel Status ────────────────────────────────────────────────────────────

export type KernelStatus = "thinking" | "acting" | "observing" | "done" | "failed";

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

  // Strategy-specific
  readonly meta: Readonly<Record<string, unknown>>;
}

// ── KernelInput — Frozen execution input ─────────────────────────────────────

export interface KernelInput {
  readonly task: string;
  readonly systemPrompt?: string;
  readonly availableToolSchemas?: readonly ToolSchema[];
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
   * Maximum number of times the kernel will redirect the agent back to
   * "thinking" when required tools haven't been used. Default: 2.
   * After this many redirects, the kernel fails with an error listing
   * the tools that were never called.
   */
  readonly maxRequiredToolRetries?: number;
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
  readonly onThought: (state: KernelState, thought: string) => Effect.Effect<void, never>;
  readonly onAction: (state: KernelState, tool: string, input: string) => Effect.Effect<void, never>;
  readonly onObservation: (state: KernelState, result: string, success: boolean) => Effect.Effect<void, never>;
  readonly onDone: (state: KernelState) => Effect.Effect<void, never>;
  readonly onError: (state: KernelState, error: string) => Effect.Effect<void, never>;
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
}

export interface KernelRunOptions {
  readonly maxIterations: number;
  readonly strategy: string;
  readonly kernelType: string;
  readonly taskId?: string;
  readonly kernelPass?: string;
  readonly meta?: Record<string, unknown>;
  readonly loopDetection?: LoopDetectionConfig;
}

// ── Factory functions ────────────────────────────────────────────────────────

/**
 * Create an initial KernelState with empty accumulation and status "thinking".
 *
 * Uses mutable Set/Map internally (they satisfy ReadonlySet/ReadonlyMap).
 */
export function initialKernelState(opts: KernelRunOptions): KernelState {
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
    meta: { ...(opts.meta ?? {}), maxIterations: opts.maxIterations },
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
  extends Omit<KernelState, "toolsUsed" | "scratchpad" | "steps"> {
  readonly toolsUsed: readonly string[];
  readonly scratchpad: Readonly<Record<string, string>>;
  readonly steps: readonly ReasoningStep[];
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
    toolsUsed: [...state.toolsUsed].sort(),
    scratchpad: Object.fromEntries(state.scratchpad),
    iteration: state.iteration,
    tokens: state.tokens,
    cost: state.cost,
    status: state.status,
    output: state.output,
    error: state.error,
    meta: state.meta,
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
    toolsUsed: new Set(raw.toolsUsed),
    scratchpad: new Map(Object.entries(raw.scratchpad)),
    iteration: raw.iteration,
    tokens: raw.tokens,
    cost: raw.cost,
    status: raw.status,
    output: raw.output,
    error: raw.error,
    meta: raw.meta,
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
};
