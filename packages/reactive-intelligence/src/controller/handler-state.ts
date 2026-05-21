import type { KernelStateLike } from "@reactive-agents/core";

/**
 * State shape visible to RI intervention handlers.
 *
 * `KernelStateLike` (in @reactive-agents/core) is the trimmed structural type
 * shared across the boundary; the real kernel state object carries additional
 * patch-managed and run-tracking fields that handlers need to read:
 *
 *   - `currentOptions`     — managed by `patch-applier.ts:20,37` (set-temperature patches).
 *   - `activatedSkills`    — managed by `patch-applier.ts:64` (inject-skill-content patches).
 *   - `controllerDecisionLog` — carried by `act.ts:181,204`; declared on
 *     `ArbitratorContext`/`VetoEvaluatorContext` in arbitrator.ts.
 *   - `currentStrategy`    — legacy fixture alias of `strategy`; some tests
 *     pass it instead of the canonical `strategy` field.
 *
 * Extending `KernelStateLike` in `@reactive-agents/core` would cross packages
 * and propagate optional fields to every consumer of the structural type. The
 * local widening (mirroring `PatchedState` at `patch-applier.ts:4`) keeps the
 * scope inside `reactive-intelligence` and gives handlers proper field types
 * without per-site `(state as any)` reads.
 */
export type HandlerState = Readonly<KernelStateLike> & {
  readonly currentOptions?: { readonly temperature?: number } & Readonly<Record<string, unknown>>;
  readonly activatedSkills?: ReadonlyArray<{ readonly id: string; readonly content: string }>;
  readonly controllerDecisionLog?: readonly string[];
  readonly currentStrategy?: string;
};

/**
 * Single named boundary cast. Intervention handlers receive
 * `Readonly<KernelStateLike>`; this widens to `HandlerState` so the extra
 * patch-managed / log fields can be read with proper types. Use this
 * function in every handler instead of inline `(state as any)` or
 * `as unknown as { ... }` narrowings.
 */
export const asHandlerState = (
  state: Readonly<KernelStateLike>,
): HandlerState => state as HandlerState;
