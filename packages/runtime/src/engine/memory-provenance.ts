/**
 * Memory provenance for runtime writes: which task and run wrote a memory row.
 *
 * Every memory write the runtime makes inside a run (memory-flush extraction,
 * local-learning skill fragments, tool-driven `AgentMemory` writes through the
 * guardrails wrapper) stamps the row with `taskId` / `runId`, so
 * `agent.memory()` and Cortex can answer "which run wrote this?".
 *
 * Source: the active run scope (`currentRunContext`, opened by `startRun` /
 * `childRunScope`). A root run's `runId` is its task id; a sub-agent's `runId`
 * descends from its parent's and its task id is its own (`runTaskId`).
 * Fields the writer already set win: an explicit value is the authority, the
 * run scope is the fallback (core `run-context.ts`). Outside a run nothing is
 * added, so the row stores NULL rather than a guessed id.
 */
import { Effect } from "effect";
import { runTaskId } from "@reactive-agents/core";
import { currentRunContext } from "@reactive-agents/core/internal/run-scope";

/** The provenance pair persisted with semantic and procedural memory rows. */
export interface RunMemoryProvenance {
  readonly taskId?: string;
  readonly runId?: string;
}

/** The active run's provenance; `{}` outside a run. */
export const currentRunProvenance: Effect.Effect<RunMemoryProvenance> = Effect.map(
  currentRunContext,
  (rc) => (rc === null ? {} : { taskId: runTaskId(rc), runId: rc.runId }),
);

/**
 * Fill `taskId` / `runId` on `entry` from `explicit`, then the active run,
 * keeping any field the entry already carries. Returns the entry unchanged
 * when there is nothing to add.
 */
export const withRunProvenance = <T extends RunMemoryProvenance>(
  entry: T,
  explicit: RunMemoryProvenance = {},
): Effect.Effect<T> =>
  Effect.map(currentRunProvenance, (ambient) => {
    const taskId = entry.taskId ?? explicit.taskId ?? ambient.taskId;
    const runId = entry.runId ?? explicit.runId ?? ambient.runId;
    if (taskId === entry.taskId && runId === entry.runId) return entry;
    return {
      ...entry,
      ...(taskId !== undefined ? { taskId } : {}),
      ...(runId !== undefined ? { runId } : {}),
    };
  });
