import type { KernelStateLike } from "@reactive-agents/core";

/**
 * State shape visible to RI intervention handlers.
 *
 * `KernelStateLike` (in @reactive-agents/core) is the trimmed structural type
 * shared across the boundary; the real kernel state object carries additional
 * run-tracking fields that handlers need to read:
 *
 *   - `controllerDecisionLog` — the decisions the dispatcher APPLIED earlier in
 *     the run (the kernel observer appends after dispatch, so the decision
 *     being dispatched is not in it yet).
 *   - `currentStrategy`    — legacy fixture alias of `strategy`; some tests
 *     pass it instead of the canonical `strategy` field.
 *
 * Extending `KernelStateLike` in `@reactive-agents/core` would cross packages
 * and propagate optional fields to every consumer of the structural type. The
 * local widening keeps the scope inside `reactive-intelligence` and gives
 * handlers proper field types without per-site `(state as any)` reads.
 */
export type HandlerState = Readonly<KernelStateLike> & {
  readonly controllerDecisionLog?: readonly string[];
  readonly currentStrategy?: string;
};

/**
 * Single named boundary cast. Intervention handlers receive
 * `Readonly<KernelStateLike>`; this widens to `HandlerState` so the extra
 * log fields can be read with proper types. Use this function in every
 * handler instead of inline `(state as any)` or `as unknown as { ... }`
 * narrowings.
 */
export const asHandlerState = (
  state: Readonly<KernelStateLike>,
): HandlerState => state as HandlerState;
