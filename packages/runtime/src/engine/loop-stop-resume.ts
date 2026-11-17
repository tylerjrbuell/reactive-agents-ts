/**
 * loop-stop-resume.ts — continue a run a loop guard stopped (`agent.resumeRun`).
 *
 * The kernel leaves a typed stop record and a FINAL checkpoint on a loop-stopped
 * run (reasoning `kernel/loop/loop-stop.ts`). This module is the runtime side:
 *
 *   - {@link prepareLoopStopResume} turns that checkpoint into a resumable
 *     state: `resumeFromStop` (status back to `thinking`, guard epoch reset,
 *     corrective guidance with the original task as the goal), the caller's
 *     note appended to that guidance, and the iteration cap a resume needs
 *     (`resumeMaxIterations`). Pure; `undefined` when the checkpoint is not a
 *     loop stop.
 *   - {@link tapLoopStop} / {@link surfaceLoopStop} read the stop off a durable
 *     run's checkpoint rail as it ends, stamp it on the run row and surface it
 *     (with the run id and a `resumable` flag) on the `AgentResult`.
 *
 * Completed steps ride the restored state verbatim, so no completed tool step
 * is re-run.
 */
import { Effect } from "effect";
import {
  deserializeKernelState,
  isLoopStopped,
  resumeFromStop,
  resumeMaxIterations,
  serializeKernelState,
  type KernelState,
  type LoopStopRecord,
} from "@reactive-agents/reasoning";
import { emitErrorSwallowed, errorTag, type RunControllerLike } from "@reactive-agents/core";
import type { AgentResult } from "../builder/agent-result.js";
import { RunStoreLive, RunStoreService } from "../services/run-store.js";
import { summarizeLoopStop } from "../loop-stop-summary.js";

/** Extra iterations a resume gets when the caller does not say (the stopped run's own cap is spent). */
export const DEFAULT_RESUME_ITERATIONS = 10;

/** Options of `agent.resumeRun(runId, opts)` for a loop-stopped run. */
export interface ResumeRunOptions {
  /** Extra guidance for the resumed run, appended to the corrective guidance. */
  readonly note?: string;
  /** How many more iterations the resumed run may take (default {@link DEFAULT_RESUME_ITERATIONS}). */
  readonly extraIterations?: number;
}

/** What a loop-stop resume runs with. */
export interface LoopStopResume {
  /** Codec-serialized resumed state: the `resumeState` of the continued run. */
  readonly stateJson: string;
  /** The iteration cap for the continued run (`ExecutionContext.maxIterations`). */
  readonly maxIterations: number;
}

const readState = (stateJson: string): KernelState | undefined => {
  try {
    return deserializeKernelState(stateJson);
  } catch {
    return undefined;
  }
};

/** The loop-stop record of a serialized state, when it ended by a loop guard. */
export const loopStopOfState = (stateJson: string): LoopStopRecord | undefined => {
  if (!stateJson.includes("loopStop") && !stateJson.includes("loop_")) return undefined;
  const state = readState(stateJson);
  return state !== undefined && isLoopStopped(state) ? state.meta.loopStop : undefined;
};

/**
 * Build the resume of a loop-stopped checkpoint. `goal` is the run's original
 * task. Returns `undefined` when the checkpoint did not end by a loop guard.
 */
export const prepareLoopStopResume = (params: {
  readonly stateJson: string;
  readonly goal: string;
  readonly note?: string;
  readonly extraIterations?: number;
}): LoopStopResume | undefined => {
  const state = readState(params.stateJson);
  if (state === undefined || !isLoopStopped(state)) return undefined;
  const resumed = resumeFromStop(state, { goal: params.goal });
  const note = params.note?.trim();
  const guidance = resumed.pendingGuidance;
  const withNote: KernelState =
    note !== undefined && note.length > 0
      ? {
          ...resumed,
          pendingGuidance: {
            ...guidance,
            errorRecovery: `${guidance?.errorRecovery ?? ""}\nThe user adds: ${note}`.trim(),
          },
        }
      : resumed;
  return {
    stateJson: serializeKernelState(withNote),
    maxIterations: resumeMaxIterations(state, params.extraIterations ?? DEFAULT_RESUME_ITERATIONS),
  };
};

/**
 * Remember the last serialized state a run checkpoints, by wrapping the
 * controller's `onCheckpoint` (installed by the durable wiring before the run
 * is built). The terminal state of a loop-stopped run is its last checkpoint.
 * Returns a reader; `() => undefined` when the run has no checkpoint rail.
 */
export const tapLoopStop = (controller: RunControllerLike | undefined): (() => LoopStopRecord | undefined) => {
  const inner = controller?.onCheckpoint?.bind(controller);
  if (controller === undefined || inner === undefined) return () => undefined;
  let last: string | undefined;
  controller.onCheckpoint = (serialized, iteration) => {
    last = serialized;
    inner(serialized, iteration);
  };
  return () => (last === undefined ? undefined : loopStopOfState(last));
};

/**
 * Stamp the run id on the result and, for a loop-stopped durable run, the stop
 * summary + `resumable` flag; the same summary goes on the run row. Best-effort
 * store write (a failure is reported as a swallowed error, never fails the run).
 */
export const surfaceLoopStop = (
  result: AgentResult,
  params: { readonly runId?: string; readonly dbPath?: string; readonly record: LoopStopRecord | undefined },
): Effect.Effect<AgentResult> => {
  const { runId, dbPath, record } = params;
  const withRunId = runId !== undefined ? { ...result, runId } : result;
  if (record === undefined) return Effect.succeed(withRunId);
  const loopStop = summarizeLoopStop(record);
  const durable = runId !== undefined && dbPath !== undefined;
  const write = durable
    ? Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.setLoopStop(runId, loopStop);
      }).pipe(
        Effect.provide(RunStoreLive(dbPath)),
        Effect.catchAllDefect((defect) =>
          emitErrorSwallowed({ site: "runtime/src/engine/loop-stop-resume.ts:setLoopStop", tag: errorTag(defect) }),
        ),
      )
    : Effect.void;
  return write.pipe(Effect.as({ ...withRunId, loopStop, ...(durable ? { resumable: true } : {}) }));
};
