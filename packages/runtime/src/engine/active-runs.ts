/**
 * active-runs.ts — the durable runs live in one agent right now.
 *
 * `agent.pauseRun(runId)` / `agent.stopRun(runId)` / `agent.activeRuns()` need
 * to reach a running run by its durable id. Each agent owns one registry
 * (made where its durable config is built, carried on that config): no module
 * state, so two agents in one process never see each other's runs. A durable
 * run registers its {@link RunController} when its row is created and releases
 * it after its end (completion or interruption) is persisted.
 */
import type { RunController } from "../run-controller.js";
import type { UserStopKind } from "./run-interrupt.js";

/** The live durable runs of one agent. */
export interface ActiveRuns {
  /** Track a live run; returns its (idempotent) release, called once the run's end is persisted. */
  readonly register: (runId: string, controller: RunController) => () => void;
  /**
   * Ask a live run to stop at its next iteration boundary and wait until its
   * end is persisted. A tool already running finishes first (its result is
   * journaled). `false` when no live run in this agent has that id.
   */
  readonly request: (runId: string, kind: UserStopKind) => Promise<boolean>;
  /** Ids of the runs live in this agent now. */
  readonly ids: () => readonly string[];
}

/** Make an empty registry. */
export const makeActiveRuns = (): ActiveRuns => {
  const live = new Map<string, { readonly controller: RunController; readonly settled: Promise<void>; readonly done: () => void }>();
  return {
    register: (runId, controller) => {
      let done: () => void = () => undefined;
      const settled = new Promise<void>((resolve) => {
        done = resolve;
      });
      const entry = { controller, settled, done };
      live.set(runId, entry);
      return () => {
        if (live.get(runId) === entry) live.delete(runId);
        entry.done();
      };
    },
    request: async (runId, kind) => {
      const entry = live.get(runId);
      if (entry === undefined) return false;
      entry.controller.stop(kind);
      await entry.settled;
      return true;
    },
    ids: () => [...live.keys()],
  };
};
