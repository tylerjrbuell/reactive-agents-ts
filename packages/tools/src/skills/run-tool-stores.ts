/**
 * Run-scoped meta-tool stores.
 *
 * `recall` (scratchpad), `checkpoint`, and `discover-tools` keep per-run
 * state. That state lives in a {@link RunToolStores} bundle held by the
 * {@link RunToolStoresRef} FiberRef, so each agent run can get its own
 * stores instead of sharing process-wide ones.
 *
 * Isolation requires the wrapper: run the agent's effect inside
 * {@link withRunToolStores}. Outside it, handlers fall back to
 * {@link defaultRunToolStores} — a single process-wide bundle, which keeps
 * single-run use (CLI, tests, scripts) working with no setup, but is shared
 * by every un-wrapped run in the process.
 *
 * FiberRef values are inherited by forked child fibers, so tool handlers
 * executed on fibers forked from the wrapped effect see the same run's
 * stores. Work scheduled on a separate runtime (e.g. a nested
 * `Effect.runPromise`) does NOT inherit them.
 */
import { Effect, FiberRef, Ref } from "effect";

/**
 * The per-run mutable stores backing the stateful meta-tools.
 */
export interface RunToolStores {
  /** `recall` scratchpad (also receives `find` auto-stores and `_tool_result_*` entries). */
  readonly scratchpad: Ref.Ref<Map<string, string>>;
  /** `checkpoint` store — survives context compaction. */
  readonly checkpoint: Ref.Ref<Map<string, string>>;
  /** Tool names surfaced by `discover-tools`, consulted by schema pruning. */
  readonly discoveredTools: Ref.Ref<Set<string>>;
}

/**
 * Process-wide fallback stores used when no {@link withRunToolStores}
 * wrapper is active. Shared by every un-wrapped run in the process.
 */
export const defaultRunToolStores: RunToolStores = {
  scratchpad: Ref.unsafeMake(new Map<string, string>()),
  checkpoint: Ref.unsafeMake(new Map<string, string>()),
  discoveredTools: Ref.unsafeMake(new Set<string>()),
};

/**
 * FiberRef holding the current run's {@link RunToolStores}. Defaults to
 * {@link defaultRunToolStores}; {@link withRunToolStores} installs fresh
 * stores for the duration of an effect.
 */
export const RunToolStoresRef: FiberRef.FiberRef<RunToolStores> =
  FiberRef.unsafeMake<RunToolStores>(defaultRunToolStores);

/**
 * Allocate a fresh, empty {@link RunToolStores} bundle.
 */
export const makeRunToolStores: Effect.Effect<RunToolStores> = Effect.gen(function* () {
  return {
    scratchpad: yield* Ref.make(new Map<string, string>()),
    checkpoint: yield* Ref.make(new Map<string, string>()),
    discoveredTools: yield* Ref.make(new Set<string>()),
  };
});

/**
 * Run `effect` with FRESH, empty run-scoped stores. Everything the effect
 * (and fibers it forks) does through the stateful meta-tools is isolated
 * from other runs, sequential or concurrent. The stores are discarded when
 * the effect completes.
 */
export const withRunToolStores = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.flatMap(makeRunToolStores, (stores) => Effect.locally(effect, RunToolStoresRef, stores));

/** The current run's full {@link RunToolStores} bundle. */
export const currentRunToolStores: Effect.Effect<RunToolStores> = FiberRef.get(RunToolStoresRef);

/** The current run's `recall` scratchpad store. */
export const currentScratchpadStore: Effect.Effect<Ref.Ref<Map<string, string>>> = Effect.map(
  currentRunToolStores,
  (s) => s.scratchpad,
);

/** The current run's `checkpoint` store. */
export const currentCheckpointStore: Effect.Effect<Ref.Ref<Map<string, string>>> = Effect.map(
  currentRunToolStores,
  (s) => s.checkpoint,
);

/** The current run's `discover-tools` discovered-name set. */
export const currentDiscoveredToolsStore: Effect.Effect<Ref.Ref<Set<string>>> = Effect.map(
  currentRunToolStores,
  (s) => s.discoveredTools,
);

/**
 * Resolve a store: the explicitly supplied Ref when given, otherwise the
 * current run's store from {@link RunToolStoresRef}. Internal helper for the
 * handler factories.
 */
export const resolveStore = <A>(
  explicit: Ref.Ref<A> | undefined,
  current: Effect.Effect<Ref.Ref<A>>,
): Effect.Effect<Ref.Ref<A>> => (explicit !== undefined ? Effect.succeed(explicit) : current);
