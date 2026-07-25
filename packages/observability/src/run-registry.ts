import { Context, Effect, Ref } from "effect";

/**
 * One sub-agent's rolled-up dashboard data, accumulated by `ChildDashboardRegistry`
 * so the ROOT agent's single end-of-run `flush()` can print it as a nested
 * "Sub-agent: <name>" section instead of the sub-agent printing its own.
 */
export interface ChildDashboardEntry {
  readonly name: string;
  /** Opaque `DashboardData` — kept `unknown` here to avoid a dependency cycle
   *  with the caller (runtime package); the console exporter knows the shape. */
  readonly data: unknown;
  /**
   * Name of the immediate parent sub-agent that spawned this one, when this
   * dispatch happened FROM WITHIN a sub-agent's own execution (nesting depth
   * >= 2). Undefined for a direct child of the root. Every descendant records
   * into the same flat, root-level list (see class doc below), so without
   * this field a grandchild renders as a misleading SIBLING of its parent in
   * the console exporter instead of nested underneath it.
   */
  readonly parentName?: string;
}

/**
 * Run-scoped registry that accumulates dashboard data from every sub-agent
 * dispatched during a run. Created ONCE by the root's runtime construction and
 * threaded down to every `createLightRuntime` call for sub-agents — mirroring
 * how `sharedEventBus` propagates (see `runtime.ts`'s `eventBusLayer` and
 * `sub-agent-executor.ts`'s `SubAgentRuntimeShared`) — so `record()` always
 * appends to ONE place regardless of nesting depth, and the root's `drain()`
 * (at `execution-engine.ts`, gated by `!lp` — root only) sees every descendant.
 */
export class ChildDashboardRegistry extends Context.Tag("ChildDashboardRegistry")<
  ChildDashboardRegistry,
  {
    readonly record: (entry: ChildDashboardEntry) => Effect.Effect<void, never>;
    readonly drain: () => Effect.Effect<readonly ChildDashboardEntry[], never>;
  }
>() {}

/** Build a fresh `ChildDashboardRegistry` backed by a `Ref`. */
export const makeChildDashboardRegistry = Effect.gen(function* () {
  const ref = yield* Ref.make<ChildDashboardEntry[]>([]);
  return {
    record: (entry: ChildDashboardEntry) => Ref.update(ref, (xs) => [...xs, entry]),
    // `getAndSet` reads AND atomically clears in one step. This registry is
    // minted ONCE per built agent (inside `createRuntime`, materialized once
    // by `ManagedRuntime.make`) — NOT once per `run()` call — so it persists
    // across every `.run()` on the same built agent instance. A plain
    // `Ref.get` here would let run N's dashboard leak stale entries from
    // run N-1 (or accumulate across every run ever executed on this agent).
    // Draining must clear so every run starts the next drain from empty.
    drain: () => Ref.getAndSet(ref, []),
  };
});
