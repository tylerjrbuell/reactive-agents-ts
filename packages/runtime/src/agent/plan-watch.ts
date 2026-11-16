/**
 * plan-watch.ts: observe one run's checklist on the EventBus.
 *
 * The one tracker the stream uses (`makeChecklistTracker`) folds the run's
 * ledger events; the snapshot it ends with is the run's plan (a plan IS the
 * advisory checklist). Shared by `agent.plan()` / `agent.execute()` and the
 * buffered session turn, so every non-streamed path reads the list the same way.
 */
import { Effect, type ManagedRuntime } from "effect";
import { EventBus, makeChecklistTracker, type AgentEvent, type ChecklistSnapshot, type PlanSource } from "@reactive-agents/core";

/** The services the watcher runs against (contravariant: any richer runtime fits). */
export type PlanRuntime = ManagedRuntime.ManagedRuntime<EventBus, never>;

/** What a run's checklist watcher saw. */
export interface PlanWatchResult {
  readonly snapshot: ChecklistSnapshot | undefined;
}

/** A live watch: read what it has seen, then stop it. */
export interface Watch {
  readonly result: () => PlanWatchResult;
  readonly stop: () => Promise<void>;
}

/**
 * Who wrote the plan a snapshot holds: `"harness-derived"` when any advisory row
 * carries that origin (the harness derived the plan turn's checklist from the
 * model's reply), else `"model"`. Pure.
 */
export const planSourceOf = (snapshot: ChecklistSnapshot | undefined): PlanSource =>
  snapshot?.root.rows.some((r) => r.kind === "advisory" && r.origin === "harness-derived") === true ? "harness-derived" : "model";

/** Watch `taskId`'s checklist on the bus until `stop()`. */
export const watchChecklist = (runtime: PlanRuntime, taskId: string): Promise<Watch> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      const tracker = makeChecklistTracker(taskId);
      let snapshot: ChecklistSnapshot | undefined;
      const fold = (event: AgentEvent): void => {
        snapshot = tracker.track({ ...event }) ?? snapshot;
      };
      const offs = yield* Effect.all([
        bus.on("AgentStarted", (e) => Effect.sync(() => fold(e))),
        bus.on("AgentCompleted", (e) => Effect.sync(() => fold(e))),
        bus.on("LedgerEntryAppended", (e) => Effect.sync(() => fold(e))),
      ]);
      return {
        result: (): PlanWatchResult => ({ snapshot }),
        stop: async (): Promise<void> => { for (const off of offs) off(); },
      };
    }),
  );
