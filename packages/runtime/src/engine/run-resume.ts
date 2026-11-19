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
import { foldAdvisory, type ChecklistFact } from "@reactive-agents/core";
import {
  appendGuidanceText,
  deserializeKernelState,
  resumeMaxIterations,
  serializeKernelState,
  type KernelState,
} from "@reactive-agents/reasoning";
import { DEFAULT_RESUME_ITERATIONS, prepareLoopStopResume, withResumedCap, type LoopStopResume } from "./loop-stop-resume.js";
import { stopKindOf, type RunStopKind, type RunStopSummary } from "../loop-stop-summary.js";

/**
 * The id of a `resumeRun(id, { newRun: true })` continuation: `${runId}-cont-<8 hex>`,
 * distinct from the parent by construction (same entropy width as fork ids).
 */
export const mintContinuationRunId = (runId: string): string => `${runId}-cont-${crypto.randomUUID().slice(0, 8)}`;

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

const MAX_LISTED_ROWS = 5;

/**
 * One guidance line naming the run's own open to-do rows, or undefined when none.
 * The kernel's wrap-up turn is opt-in and once per run; a continued run would
 * otherwise finish with its list untouched. Sub-agent rows are not the run's own.
 */
const openTodoGuidance = (state: KernelState): string | undefined => {
  const facts: ChecklistFact[] = [];
  for (const e of state.ledger ?? []) {
    if (e.kind === "checklist-item" && !(e.pass ?? "").startsWith("sub-agent:")) facts.push(e);
  }
  const open = foldAdvisory(facts).filter((i) => i.status === "pending" || i.status === "in_progress");
  if (open.length === 0) return undefined;
  const listed = open.slice(0, MAX_LISTED_ROWS).map((i) => `[${i.id}] ${i.title}`);
  if (open.length > MAX_LISTED_ROWS) listed.push(`+${open.length - MAX_LISTED_ROWS} more`);
  return (
    `${open.length} to-do item${open.length === 1 ? " is" : "s are"} still open: ${listed.join(", ")}. ` +
    "Mark finished ones done, remove ones no longer needed, or finish them, then give your final answer."
  );
};

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
  let state: KernelState;
  try {
    state = deserializeKernelState(params.stateJson);
  } catch {
    return { stateJson: params.stateJson };
  }
  const openRows = openTodoGuidance(state);
  const guidance = [
    ...(isUserStop(kind) ? [CONTINUE_TEXT] : []),
    ...(openRows !== undefined ? [openRows] : []),
    ...(note !== undefined && note.length > 0 ? [`The user adds: ${note}`] : []),
  ];
  const maxIterations = resumeCap(state, params.extraIterations);
  if (guidance.length === 0 && maxIterations === undefined) return { stateJson: params.stateJson };

  const guided = guidance.reduce<KernelState>(
    (s, text) => ({ ...s, pendingGuidance: appendGuidanceText(s.pendingGuidance, "errorRecovery", text) }),
    state,
  );
  const capped = maxIterations !== undefined ? withResumedCap(guided, maxIterations) : guided;
  return {
    stateJson: capped !== state ? serializeKernelState(capped) : params.stateJson,
    ...(maxIterations !== undefined ? { maxIterations } : {}),
  };
};

/**
 * The iteration cap of a continued run. The counters carry over and gate the
 * loop, so a spent cap (the run's own `meta.maxIterations`, a plan-budget
 * raised one included) would end the resume at once: it gets `extra` more
 * (default {@link DEFAULT_RESUME_ITERATIONS}) past the restored iteration.
 * A run that stopped with cap left (a pause, an error) keeps its own cap
 * unless the caller asked for `extra`.
 */
const resumeCap = (state: KernelState, extra: number | undefined): number | undefined => {
  if (extra !== undefined) return resumeMaxIterations(state, extra);
  const cap = state.meta.maxIterations;
  const spent = cap === undefined || Math.max(state.iteration, state.llmCalls ?? 0) >= cap - 1;
  return spent ? resumeMaxIterations(state, DEFAULT_RESUME_ITERATIONS) : undefined;
};
