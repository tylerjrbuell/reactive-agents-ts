/**
 * Public `.withHook()` types, keyed by phase so each handler is typed with the
 * context it actually receives.
 *
 * Two owners fire lifecycle hooks:
 *   - the execution engine fires every phase once per run (or once per
 *     reasoning pass) with the full {@link ExecutionContext};
 *   - the reasoning kernel fires `think`, `act` and `observe` once per kernel
 *     turn with a small per-turn context ({@link KernelTurnHookContext}).
 *
 * A `think` hook gets both: one engine firing around each reasoning call and
 * one kernel firing per turn. An `act` / `observe` hook gets the kernel firing
 * on kernel runs, and one engine firing only when a custom (non-kernel)
 * `ReasoningService` reported tool use. So a per-turn phase handler receives a
 * union. Narrow it with `"metadata" in ctx` (true = engine context).
 */
import type { KernelStateLike } from "@reactive-agents/core";
import type { ExecutionContext, HookTiming, LifecyclePhase } from "./types.js";
import type { RawHookResult } from "./hooks-normalize.js";

/** Phases the reasoning kernel fires once per kernel turn. */
export type KernelTurnPhase = "think" | "act" | "observe";

/** Phases only the execution engine fires (once per run). */
export type EngineLifecyclePhase = Exclude<LifecyclePhase, KernelTurnPhase>;

/**
 * Context of a kernel-fired `before` / `after` hook on `think`, `act` or
 * `observe`. It has no `metadata`, `toolResults` or other engine fields.
 */
export interface KernelTurnHookContext {
  /** Phase being fired. */
  readonly phase: KernelTurnPhase;
  /** Kernel turn number (0-indexed). */
  readonly iteration: number;
  /** Read-only kernel state at this turn: steps, `toolsUsed`, tokens, status, `taskId`. */
  readonly state: Readonly<KernelStateLike>;
}

/**
 * Context of a kernel-fired `on-error` hook on `think`, `act` or `observe`.
 * The kernel error path carries no state snapshot.
 */
export interface KernelTurnErrorHookContext {
  /** Phase that failed. */
  readonly phase: KernelTurnPhase;
  /** Kernel turn number (0-indexed). */
  readonly iteration: number;
}

/** Hook on an engine-only phase. Fires once per run with the full {@link ExecutionContext}. */
export interface EngineLifecycleHook {
  /** Engine-only lifecycle phase (bootstrap, guardrail, ..., complete). */
  readonly phase: EngineLifecyclePhase;
  /** When to invoke the hook relative to the phase. */
  readonly timing: HookTiming;
  /**
   * Return the (possibly modified) context to pass it down the phase chain,
   * or nothing to observe. Plain values, Promises and Effects are accepted.
   */
  readonly handler: (ctx: ExecutionContext) => RawHookResult;
}

/**
 * `before` / `after` hook on `think`, `act` or `observe`. The kernel fires it
 * per turn with a {@link KernelTurnHookContext}; the engine may also fire it
 * with an {@link ExecutionContext} (see the module doc). Narrow with
 * `"metadata" in ctx`. The kernel ignores the return value; only an engine
 * firing threads a returned context on.
 */
export interface KernelTurnLifecycleHook {
  /** Per-turn phase. */
  readonly phase: KernelTurnPhase;
  /** Before or after the phase. */
  readonly timing: "before" | "after";
  /** Handler invoked with the per-turn context or the engine context. */
  readonly handler: (
    ctx: KernelTurnHookContext | ExecutionContext,
  ) => RawHookResult<KernelTurnHookContext | ExecutionContext>;
}

/**
 * `on-error` hook on `think`, `act` or `observe`. The kernel fires it with a
 * {@link KernelTurnErrorHookContext} (no state); the engine fires it with an
 * {@link ExecutionContext}. Narrow with `"metadata" in ctx`.
 */
export interface KernelTurnErrorLifecycleHook {
  /** Per-turn phase. */
  readonly phase: KernelTurnPhase;
  /** Error timing. */
  readonly timing: "on-error";
  /** Handler invoked with the per-turn error context or the engine context. */
  readonly handler: (
    ctx: KernelTurnErrorHookContext | ExecutionContext,
  ) => RawHookResult<KernelTurnErrorHookContext | ExecutionContext>;
}

/**
 * Lifecycle hook registered with `.withHook()`. Discriminated by `phase` (and
 * `timing` for the per-turn phases), so the handler's `ctx` is typed with what
 * that phase delivers. Hooks run in registration order. A thrown error (or
 * rejected Promise / failed Effect) propagates as a `HookError` on engine
 * firings and is routed to `.withErrorHandler()` on kernel firings.
 *
 * @example
 * ```typescript
 * // Engine phase: full ExecutionContext.
 * const onDone: LifecycleHook = {
 *   phase: "complete",
 *   timing: "after",
 *   handler: (ctx) => { console.log(ctx.metadata.stepsCount); },
 * };
 *
 * // Per-turn phase: narrow before reading engine fields.
 * const onTurn: LifecycleHook = {
 *   phase: "act",
 *   timing: "after",
 *   handler: (ctx) => {
 *     if ("metadata" in ctx) return; // engine firing (custom ReasoningService)
 *     console.log(`Turn ${ctx.iteration}: ${[...ctx.state.toolsUsed].join(", ")}`);
 *   },
 * };
 * ```
 */
export type LifecycleHook =
  | EngineLifecycleHook
  | KernelTurnLifecycleHook
  | KernelTurnErrorLifecycleHook;

/**
 * A hook as the engine's `LifecycleHookRegistry` holds it. The engine fires
 * every phase with an {@link ExecutionContext}, so an engine-registered hook
 * (e.g. the sub-agent parent-context capture on `act`) may take only that.
 * Every {@link LifecycleHook} is assignable to it.
 */
export interface EngineRegisteredHook {
  /** Lifecycle phase. */
  readonly phase: LifecyclePhase;
  /** When to invoke the hook relative to the phase. */
  readonly timing: HookTiming;
  /** Handler; may hand back the per-turn context it was typed with. */
  readonly handler: (
    ctx: ExecutionContext,
  ) => RawHookResult<ExecutionContext | KernelTurnHookContext | KernelTurnErrorHookContext>;
}
