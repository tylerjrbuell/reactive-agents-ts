/**
 * run-resume.ts — the state a continued run starts from, for every kind of stop.
 *
 * `agent.resumeRun(runId, { note?, extraIterations? })` continues any run that
 * did not complete. What it hands the kernel depends on how the run stopped:
 *
 *   - a loop stop: the corrective resume of `loop-stop-resume.ts` (guard epoch
 *     reset, what was done / unfinished / not to repeat);
 *   - a user stop or pause: the last finished iteration's state plus a plain
 *     "continue where you left off" (nothing went wrong, nothing to correct);
 *   - an error, a spent budget, a timeout or a crash: the state as it is (the
 *     failing step was never recorded as done), plus the caller's note.
 *
 * Completed steps ride the restored state verbatim and the effect journal
 * serves completed tool calls, so no completed step runs again.
 */
import {
  appendGuidanceText,
  deserializeKernelState,
  resumeMaxIterations,
  serializeKernelState,
  type KernelState,
} from "@reactive-agents/reasoning";
import { prepareLoopStopResume, type LoopStopResume } from "./loop-stop-resume.js";
import { stopKindOf, type RunStopKind, type RunStopSummary } from "../loop-stop-summary.js";

/** What a continued run starts from; `maxIterations` only when the caller bounded it (`extraIterations`) or a loop resume needs a fresh budget. */
export interface RunResume {
  /** Codec-serialized state: the `resumeState` of the continued run. */
  readonly stateJson: string;
  /** The iteration cap of the continued run, when it differs from the agent's. */
  readonly maxIterations?: number;
}

const CONTINUE_TEXT =
  "The run was interrupted by the user and is continuing. Pick up exactly where you left off. " +
  "Results of tool calls already made are in the conversation; do not redo them.";

/** True for the stops a person asked for. */
const isUserStop = (kind: RunStopKind | undefined): boolean => kind === "user-paused" || kind === "user-stopped";

/**
 * Build the resume of a stopped run's final checkpoint. `stop` is the run
 * row's stop record (absent for a crash: a run that never wrote one).
 */
export const prepareResume = (params: {
  readonly stateJson: string;
  readonly goal: string;
  readonly stop?: RunStopSummary;
  readonly note?: string;
  readonly extraIterations?: number;
}): RunResume => {
  const loop: LoopStopResume | undefined = prepareLoopStopResume({
    stateJson: params.stateJson,
    goal: params.goal,
    ...(params.note !== undefined ? { note: params.note } : {}),
    ...(params.extraIterations !== undefined ? { extraIterations: params.extraIterations } : {}),
  });
  if (loop !== undefined) return loop;

  const note = params.note?.trim();
  const kind = params.stop !== undefined ? stopKindOf(params.stop) : undefined;
  const guidance = [
    ...(isUserStop(kind) ? [CONTINUE_TEXT] : []),
    ...(note !== undefined && note.length > 0 ? [`The user adds: ${note}`] : []),
  ];
  if (guidance.length === 0 && params.extraIterations === undefined) return { stateJson: params.stateJson };

  let state: KernelState;
  try {
    state = deserializeKernelState(params.stateJson);
  } catch {
    return { stateJson: params.stateJson };
  }
  const guided = guidance.reduce<KernelState>(
    (s, text) => ({ ...s, pendingGuidance: appendGuidanceText(s.pendingGuidance, "errorRecovery", text) }),
    state,
  );
  return {
    stateJson: guidance.length > 0 ? serializeKernelState(guided) : params.stateJson,
    ...(params.extraIterations !== undefined ? { maxIterations: resumeMaxIterations(state, params.extraIterations) } : {}),
  };
};
