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
    drain: () => Ref.get(ref),
  };
});
