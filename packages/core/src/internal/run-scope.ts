/**
 * Run scope: all per-run state, carried by ONE FiberRef and bound at ONE
 * root entry per run (Plan 9 item 1R).
 *
 * Each package declares the run state it owns as a typed {@link RunSlot}
 * (a module-level const, created at import time). The slot declares its own
 * sub-agent policy: `inherit` (the child sees the parent's value, e.g. the
 * file root) or `reset` (the child gets `fresh()`, e.g. tool stores). A run
 * scope is an immutable map from slot to value plus the run's
 * {@link RunContext}, so every scope has a run id by type.
 *
 * - {@link withRunScope} is the root entry. It REPLACES the scope and dies
 *   if a run scope is already active on this fiber: a nested root entry is
 *   the bug class that leaked state across runs (2026-11-05).
 * - {@link childRunScope} is the only nesting (sub-agents).
 * - A read outside any run scope returns the slot's process fallback (same
 *   as the pre-1R module-level defaults) and records a miss, so replay can
 *   assert every entry bound a scope ({@link drainRunScopeMisses}).
 *
 * Internal: not exported from the package index or the `reactive-agents`
 * umbrella. Plugins get slots only through the plugin API (after Phase 4).
 */
import { Effect, Fiber, FiberRef, Option } from "effect";
import type { RunContext } from "../run-context.js";
import type { ApprovalDecision, InteractionResponse, RunControllerLike, ToolEffectRecord } from "../streaming.js";

/** How a slot's value reaches a sub-agent's scope. */
export type RunSlotPolicy<A> =
  | { readonly child: "inherit"; readonly initial: A }
  /** `fresh` builds a new value per run; never a shared mutable default. */
  | { readonly child: "reset"; readonly fresh: () => A };

/** A typed key for one piece of per-run state. Create with {@link runSlot}. */
export interface RunSlot<A> {
  readonly key: symbol;
  readonly name: string;
  readonly policy: RunSlotPolicy<A>;
}

/** One slot value for {@link withRunScope} / {@link childRunScope}. */
export interface RunBinding {
  readonly key: symbol;
  readonly value: unknown;
}

/** The active run's identity and slot values. */
export interface RunScope {
  readonly context: RunContext;
  readonly values: ReadonlyMap<symbol, unknown>;
}

// Slot declarations (process-wide by design: slots are code, not run state).
const slots = new Map<symbol, RunSlot<unknown>>();
const slotNames = new Set<string>();
const duplicateNames: string[] = [];
const fallbacks = new Map<symbol, unknown>();

/**
 * Declare a run slot. Call once per slot at module level. A duplicate name is
 * recorded (see {@link duplicateRunSlotNames}) rather than thrown.
 */
export function runSlot<A>(name: string, policy: RunSlotPolicy<A>): RunSlot<A> {
  if (slotNames.has(name)) duplicateNames.push(name);
  slotNames.add(name);
  const slot: RunSlot<A> = { key: Symbol(name), name, policy };
  slots.set(slot.key, slot as RunSlot<unknown>);
  return slot;
}

/** Names declared more than once (expected empty; asserted by tests). */
export const duplicateRunSlotNames = (): readonly string[] => [...duplicateNames];

/** Pair a slot with its value for a scope entry. */
export const bindRun = <A>(slot: RunSlot<A>, value: A): RunBinding => ({ key: slot.key, value });

const CurrentRunScope = FiberRef.unsafeMake<RunScope | null>(null);

// Diagnostic only: which slots were read with no run scope bound.
const MAX_MISSES = 256;
const misses: string[] = [];

/** Return and clear the slot names read outside any run scope since the last drain. */
export const drainRunScopeMisses = (): readonly string[] => misses.splice(0, misses.length);

const fallbackOf = <A>(slot: RunSlot<A>): A => {
  if (slot.policy.child === "inherit") return slot.policy.initial;
  if (!fallbacks.has(slot.key)) fallbacks.set(slot.key, slot.policy.fresh());
  return fallbacks.get(slot.key) as A;
};

const valueOf = <A>(scope: RunScope | null, slot: RunSlot<A>): A => {
  if (scope !== null && scope.values.has(slot.key)) return scope.values.get(slot.key) as A;
  if (misses.length < MAX_MISSES) misses.push(slot.name);
  return fallbackOf(slot);
};

const initialOf = (slot: RunSlot<unknown>): unknown =>
  slot.policy.child === "inherit" ? slot.policy.initial : slot.policy.fresh();

const withBindings = (base: Map<symbol, unknown>, bindings: readonly RunBinding[]): ReadonlyMap<symbol, unknown> => {
  for (const b of bindings) base.set(b.key, b.value);
  return base;
};

/**
 * Root entry for one run: binds a fresh scope (every declared slot at its
 * initial or `fresh()` value, then `bindings`) around `effect`. Dies if a run
 * scope is already active on this fiber; use {@link childRunScope} to nest.
 */
export const withRunScope =
  (context: RunContext, ...bindings: readonly RunBinding[]) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(FiberRef.get(CurrentRunScope), (active) => {
      if (active !== null) {
        return Effect.dieMessage(
          `withRunScope: run ${context.runId} entered inside active run ${active.context.runId}; nest with childRunScope`,
        );
      }
      const values = new Map<symbol, unknown>();
      for (const slot of slots.values()) values.set(slot.key, initialOf(slot));
      return Effect.locally(effect, CurrentRunScope, { context, values: withBindings(values, bindings) });
    });

/**
 * Root entry for a service that can run standalone or inside a runtime run
 * (e.g. `ReasoningService.execute`): inside an active run it changes nothing;
 * otherwise it is {@link withRunScope}, so standalone use is still isolated.
 */
export const ensureRunScope =
  (context: () => RunContext) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(FiberRef.get(CurrentRunScope), (active) =>
      active !== null ? effect : withRunScope(context())(effect),
    );

/**
 * Scope for a sub-run (sub-agent): `inherit` slots keep the parent's value,
 * `reset` slots get `fresh()`, then `bindings` apply. Works with no parent
 * scope (the child is then built from initial values).
 */
export const childRunScope =
  (context: RunContext, ...bindings: readonly RunBinding[]) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(FiberRef.get(CurrentRunScope), (parent) => {
      const values = new Map<symbol, unknown>();
      for (const slot of slots.values()) {
        const inherited = slot.policy.child === "inherit" && parent !== null && parent.values.has(slot.key);
        values.set(slot.key, inherited ? parent.values.get(slot.key) : initialOf(slot));
      }
      return Effect.locally(effect, CurrentRunScope, { context, values: withBindings(values, bindings) });
    });

/** The slot's value in the active run (fallback + recorded miss outside a run). */
export const getRunSlot = <A>(slot: RunSlot<A>): Effect.Effect<A> =>
  Effect.map(FiberRef.get(CurrentRunScope), (scope) => valueOf(scope, slot));

/**
 * Synchronous read for plain helpers called on a running fiber. Off-fiber or
 * outside a run it returns the fallback and records a miss (fiber-hop hazard:
 * see the RunContext notes in `run-context.ts`).
 */
export const getRunSlotSync = <A>(slot: RunSlot<A>): A => {
  const fiber = Fiber.getCurrentFiber();
  return valueOf(Option.isSome(fiber) ? fiber.value.getFiberRef(CurrentRunScope) : null, slot);
};

/** The active run's context, or null outside a run. */
export const currentRunContext: Effect.Effect<RunContext | null> = Effect.map(
  FiberRef.get(CurrentRunScope),
  (scope) => scope?.context ?? null,
);

// ─── Core run slots (Plan 9 1R stage 2) ──────────────────────────────────────
// Bound only at the run entry (runtime `startRun`) or as a child override;
// readers use getRunSlot / getRunSlotSync.

/**
 * Where this run's streamed think text goes. A per-run cell: the run's
 * consumer installs its callback once (`runStream()` its queue, or the status
 * renderer when nothing else did); a sub-agent gets a fresh, empty cell so its
 * tokens never reach the parent's stream.
 */
export interface StreamSink {
  current: ((text: string) => Effect.Effect<void, never>) | null;
}

/** The run's text-delta sink (see {@link StreamSink}). Reset for sub-agents. */
export const streamSinkSlot = runSlot<StreamSink>("core.streamSink", {
  child: "reset",
  fresh: () => ({ current: null }),
});

/**
 * The run's pause/stop controller (`runStream()`, durable runs). Inherited, so
 * stopping a run also stops the sub-agents it is waiting on.
 */
export const runControllerSlot = runSlot<RunControllerLike | null>("core.runController", {
  child: "inherit",
  initial: null,
});

/** Serialized kernel checkpoint a resumed run continues from. Never a sub-agent's. */
export const resumeStateSlot = runSlot<string | null>("core.resumeState", {
  child: "reset",
  fresh: () => null,
});

/** Model chosen for this run by `fork({ model })`. A sub-agent keeps its own model. */
export const modelOverrideSlot = runSlot<string | null>("core.modelOverride", {
  child: "reset",
  fresh: () => null,
});

/** A human's approval decision for a resumed paused run. Never a sub-agent's. */
export const approvalDecisionSlot = runSlot<ApprovalDecision | null>("core.approvalDecision", {
  child: "reset",
  fresh: () => null,
});

/** A human's answer to a resumed paused interaction. Never a sub-agent's. */
export const interactionResponseSlot = runSlot<InteractionResponse | null>("core.interactionResponse", {
  child: "reset",
  fresh: () => null,
});

/**
 * Tool effects a crashed durable run already completed, keyed by
 * `toolEffectIdentityKey`; the act phase consumes each entry once. Never a
 * sub-agent's (its calls are its own).
 */
export const recoveredToolEffectsSlot = runSlot<Map<string, ToolEffectRecord> | null>("core.recoveredToolEffects", {
  child: "reset",
  fresh: () => null,
});
