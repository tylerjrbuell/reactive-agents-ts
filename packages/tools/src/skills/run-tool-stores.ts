/**
 * Run-scoped meta-tool stores.
 *
 * `recall` (scratchpad), `checkpoint`, and `discover-tools` keep per-run
 * state. That state lives in a {@link RunToolStores} bundle held by the
 * {@link runToolStoresSlot} run slot (Plan 9 item 1R), so each agent run gets
 * its own stores.
 *
 * The slot is bound by the run entry's `withRunScope` (every root run gets
 * `fresh()` stores) and reset for sub-agents (`childRunScope`). Outside any
 * run scope, readers get the run-scope process fallback: a single bundle
 * shared by every un-scoped caller (CLI, tests, scripts), with the read
 * recorded as a miss (`drainRunScopeMisses`).
 *
 * The run scope is a FiberRef, so tool handlers on fibers forked from the
 * run see the same stores. Work scheduled on a separate runtime (e.g. a
 * nested `Effect.runPromise`) does NOT inherit them.
 */
import { Effect, Ref } from "effect";
import { getRunSlot, runSlot, type RunSlot } from "@reactive-agents/core/internal/run-scope";

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
 * Allocate a fresh, empty {@link RunToolStores} bundle (synchronous; the
 * slot's `fresh` factory).
 */
export const makeRunToolStoresSync = (): RunToolStores => ({
  scratchpad: Ref.unsafeMake(new Map<string, string>()),
  checkpoint: Ref.unsafeMake(new Map<string, string>()),
  discoveredTools: Ref.unsafeMake(new Set<string>()),
});

/**
 * Run slot holding the current run's {@link RunToolStores}. Policy `reset`:
 * every root run and every sub-agent gets a fresh bundle from
 * {@link makeRunToolStoresSync}; never a shared default object.
 */
export const runToolStoresSlot: RunSlot<RunToolStores> = runSlot<RunToolStores>("tools.runToolStores", {
  child: "reset",
  fresh: makeRunToolStoresSync,
});

/** The current run's full {@link RunToolStores} bundle. */
export const currentRunToolStores: Effect.Effect<RunToolStores> = getRunSlot(runToolStoresSlot);

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
 * current run's store from {@link runToolStoresSlot}. Internal helper for the
 * handler factories.
 */
export const resolveStore = <A>(
  explicit: Ref.Ref<A> | undefined,
  current: Effect.Effect<Ref.Ref<A>>,
): Effect.Effect<Ref.Ref<A>> => (explicit !== undefined ? Effect.succeed(explicit) : current);
