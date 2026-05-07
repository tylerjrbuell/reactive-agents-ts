/**
 * PhaseDeps — the shared dependency bundle every phase receives.
 *
 * This consolidates the long-lived services, config, and cross-phase mutable state
 * (refs) that the current `ExecutionEngineLive` closure captures. Extracting phases
 * one-by-one means this interface grows incrementally; do not pre-populate fields
 * that no phase consumes yet.
 *
 * Design rules:
 * - Add a field only when an extracted phase needs it.
 * - `services` are runtime-resolved Effect services (may be `null` when optional).
 * - `state` holds `Ref`-wrapped mutable values shared across phases (e.g. cached
 *   tool defs, resolved calibration). Phase-local computation never goes here.
 * - `config` is the immutable `ReactiveAgentsConfig` for this run.
 */
import type { Ref, Effect, Context } from "effect";
import type {
  ReactiveAgentsConfig,
  ExecutionContext,
  LifecyclePhase,
  HookTiming,
} from "../types.js";
import type { LifecycleHookRegistry } from "../hooks.js";
import type { HookError } from "../errors.js";
import type { AgentEvent, Task } from "@reactive-agents/core";

/**
 * Resolved-service value for the lifecycle hook registry. Phases receive this
 * unwrapped object (not the `Context.Tag` class); the engine yields the tag once
 * via `Effect.gen` and threads the result through `PhaseDeps`.
 */
export type HookRegistryValue = Context.Tag.Service<typeof LifecycleHookRegistry>;

/**
 * Service tag references are kept opaque to phases. The engine resolves them once
 * via `Effect.serviceOption` and threads the resolved value through `PhaseDeps`.
 * Phase code never imports `Context.Tag`s directly — that's the engine's job.
 */
type ServiceLike = unknown;
type KillSwitchService = ServiceLike;
type GuardrailService = ServiceLike;
type BehavioralContractService = ServiceLike;
type ToolService = ServiceLike;

/**
 * Narrow type for ObservabilityService. The full service has more methods than the
 * engine uses; this slice keeps the surface area honest.
 */
export type ObsLike = {
  withSpan: <A, E>(name: string, effect: Effect.Effect<A, E>, attrs?: Record<string, unknown>) => Effect.Effect<A, E>;
  incrementCounter: (name: string, value?: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  recordHistogram: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  setGauge: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  captureSnapshot: (agentId: string, state: Record<string, unknown>) => Effect.Effect<unknown, never>;
  debug: (msg: string, meta?: Record<string, unknown>) => Effect.Effect<void, never>;
  info: (msg: string, meta?: Record<string, unknown>) => Effect.Effect<void, never>;
  getTraceContext: () => Effect.Effect<{ traceId: string; spanId: string }, never>;
  flush: () => Effect.Effect<void, never>;
  verbosity: () => string;
};

/**
 * Narrow type for EventBus. Only `publish` and `on` are used by phases.
 */
export type EbLike = {
  publish: (event: AgentEvent) => Effect.Effect<void, never>;
  on: <T extends AgentEvent["_tag"]>(
    tag: T,
    handler: (event: Extract<AgentEvent, { _tag: T }>) => Effect.Effect<void, never>,
  ) => Effect.Effect<() => void, never>;
};

/**
 * Mutable state shared across phases. Each ref is owned by the engine and passed
 * to phases through `PhaseDeps.state`. Phases mutate via `Ref.update`/`Ref.set`.
 *
 * INVARIANT: Every entry here represents state that is set in one phase and read
 * in a later phase. Phase-local computation MUST stay inside the phase.
 */
export interface PhaseStateRefs {
  /** Cancelled task IDs — populated by `cancel()`, checked by lifecycle guard. */
  readonly cancelledTasks: Ref.Ref<Set<string>>;
  /** Currently-running execution contexts by taskId — populated for `getContext()`. */
  readonly runningContexts: Ref.Ref<Map<string, ExecutionContext>>;
}

/**
 * The dependency bundle every phase receives. Grows as phases are extracted.
 */
export interface PhaseDeps {
  /** The task being executed — phase modules read `task.input`, `task.type`, etc. */
  readonly task: Task;

  /** Immutable run-scoped config. */
  readonly config: ReactiveAgentsConfig;

  /** Resolved lifecycle hook registry — runner uses for before/after/on-error firing. */
  readonly hooks: HookRegistryValue;

  /** Observability service (null when no observability backend wired). */
  readonly obs: ObsLike | null;

  /** Event bus (null when no event bus wired). */
  readonly eb: EbLike | null;

  /** Kill-switch service (null when not wired) — checked by lifecycle guard. */
  readonly ks: KillSwitchService | null;

  /** Guardrail service (null when not wired). */
  readonly guardrail: GuardrailService | null;

  /** Behavioral contract service (null when not wired). */
  readonly behavioral: BehavioralContractService | null;

  /** Tool service (null when not wired). */
  readonly tools: ToolService | null;

  /** Cross-phase mutable state. */
  readonly state: PhaseStateRefs;

  /** Whether observability output is at "normal" verbosity (used for log gating). */
  readonly isNormal: boolean;

  /** Wall-clock start of this execution (ms since epoch). */
  readonly executionStartMs: number;
}
