/**
 * loop-stop.ts — a loop-detection stop that can be continued.
 *
 * A run ended by a loop guard (`loop_graceful`, `loop_detected:*`,
 * `loop_detected_with_veto`, `dispatcher-early-stop`, ...) used to leave a dead
 * terminal state: no record of WHY it stopped, no final checkpoint, and a
 * naive restart re-tripped at once (the old guard steps still sat in the
 * window and still counted as spent guidance cycles). This module owns the
 * three missing pieces:
 *
 *   1. {@link LoopStopRecord} — the typed stop record on `meta.loopStop`:
 *      reason, tripped pattern, the repeated call, the iteration, the tools
 *      that already succeeded, the unfinished checklist rows, the goal.
 *      Built deterministically from the steps and ledger (no LLM).
 *   2. The `loop-stop` terminal-pipeline step (`terminal-pipeline.ts`): stamps
 *      the record on any guard-stop terminal and writes the FINAL state to the
 *      durable `onCheckpoint` rail, mirroring the paused-state checkpoint
 *      (`iterate-run-ctl-checkpoint.ts`): `iteration + 1`, so it always wins
 *      `latestCheckpoint`.
 *   3. {@link resumeFromStop} — the kernel entry that continues such a state:
 *      status back to `thinking`, terminal meta cleared, a guard epoch marker
 *      (`capabilities/reflect/loop-resume-epoch.ts`) so the old steps stop
 *      counting, and corrective `pendingGuidance` naming what was done, what
 *      is unfinished and what not to repeat. The caller resumes the run by
 *      passing the returned state as `KernelInput.resumeState`.
 *
 * Completed steps are never re-run: `state.steps` / `messages` / `ledger` are
 * carried verbatim, and the guidance says so.
 */
import { Effect } from "effect";
import { getRunSlot, runControllerSlot } from "@reactive-agents/core/internal/run-scope";
import { authorityOf } from "../capabilities/decide/authority.js";
import { actionToolName } from "../assessment/progress-arbiter.js";
import {
  classifyActions,
  normalizeActionContent,
  type LoopDetection,
} from "../capabilities/reflect/loop-detector.js";
import { LOOP_RESUME_ACTOR } from "../capabilities/reflect/loop-resume-epoch.js";
import { ownItems } from "../capabilities/reflect/checklist-reminder.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { serializeKernelState } from "../state/kernel-codec.js";
import { contributeGuidance } from "../state/guidance-channel.js";
import { transitionState, type KernelState } from "../state/kernel-state.js";

/** How many trailing actions the repeated-call read looks at. */
const REPEAT_WINDOW = 6;
const MAX_LISTED = 6;
const MAX_CALL_CHARS = 120;
const MAX_TASK_CHARS = 300;

/** A tool that already produced a substantive result, with how many times. */
export interface LoopStopToolDone {
  readonly tool: string;
  readonly calls: number;
}

/** Why a run was stopped by a loop guard, and what it left behind. Plain data (codec round-trips it). */
export interface LoopStopRecord {
  /** The terminal reason that ended the run (`terminatedBy`, or the reason the loop exit was proposed with). */
  readonly reason: string;
  /** The loop pattern that tripped, when the stop came from the loop detector. */
  readonly pattern?: { readonly id: string; readonly name: string };
  /** The tool the run kept repeating, when the trailing actions repeat one call. */
  readonly repeatedTool?: string;
  /** The repeated call itself (normalized, truncated). */
  readonly repeatedCall?: string;
  /** The iteration the run stopped at. */
  readonly iteration: number;
  /** Tools that already returned substantive results: not to be re-run. */
  readonly toolsDone: readonly LoopStopToolDone[];
  /** Titles of checklist rows still open at the stop. */
  readonly unfinished: readonly string[];
  /** The original task, when the run knew it (`meta.entropy.taskDescription`); the resume caller may supply it. */
  readonly goal?: string;
}

const LOOP_STOP_REASONS: ReadonlySet<string> = new Set(["loop_graceful", "loop_detected_with_veto", "dispatcher-early-stop"]);
const LOOP_STOP_PREFIXES: readonly string[] = ["loop_detected:", "controller_early_stop:"];

/** True when a terminal reason is a loop-guard / controller early stop (the stops a resume can continue). */
export const isLoopStopReason = (reason: string | undefined): boolean =>
  reason !== undefined && (LOOP_STOP_REASONS.has(reason) || LOOP_STOP_PREFIXES.some((p) => reason.startsWith(p)));

/** True when the state ended by a loop guard (a record is on it, or its `terminatedBy` names a loop stop). */
export const isLoopStopped = (state: KernelState): boolean =>
  state.meta.loopStop !== undefined ||
  ((state.status === "done" || state.status === "failed") && isLoopStopReason(state.meta.terminatedBy));

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}...` : text);

/** The repeated call among the last {@link REPEAT_WINDOW} actions: the last action's call when it occurs at least twice. */
function repeatedCallOf(steps: KernelState["steps"]): Pick<LoopStopRecord, "repeatedTool" | "repeatedCall"> {
  const actions = steps.filter((s) => s.type === "action").slice(-REPEAT_WINDOW);
  const last = actions[actions.length - 1];
  if (last === undefined) return {};
  const signature = normalizeActionContent(last.content);
  if (actions.filter((a) => normalizeActionContent(a.content) === signature).length < 2) return {};
  const tool = actionToolName(last);
  const args = last.metadata?.toolCall?.arguments;
  const shown = args !== undefined ? JSON.stringify(args) : signature;
  return { ...(tool !== undefined ? { repeatedTool: tool } : {}), repeatedCall: truncate(shown, MAX_CALL_CHARS) };
}

/**
 * Build the stop record from a state. Pure and deterministic. `prior` (a record
 * stamped earlier, e.g. with the detector's pattern at the loop-resolution site)
 * keeps its `pattern`; everything else is re-read from the final state.
 */
export function buildLoopStopRecord(
  state: KernelState,
  from: {
    readonly reason?: string;
    readonly detection?: LoopDetection | null;
    readonly prior?: LoopStopRecord;
    readonly goal?: string;
  } = {},
): LoopStopRecord {
  const verdicts = classifyActions(state.steps);
  const calls = new Map<string, number>();
  for (const s of state.steps) {
    if (s.type !== "action" || verdicts.get(s)?.kind !== "substantive") continue;
    const tool = actionToolName(s);
    if (tool !== undefined) calls.set(tool, (calls.get(tool) ?? 0) + 1);
  }
  const pattern = from.detection?.pattern ?? from.prior?.pattern;
  const goal = from.goal ?? from.prior?.goal ?? state.meta.entropy?.taskDescription;
  return {
    reason: from.reason ?? from.prior?.reason ?? state.meta.terminatedBy ?? "loop_graceful",
    ...(pattern !== undefined ? { pattern: { id: pattern.id, name: pattern.name } } : {}),
    ...repeatedCallOf(state.steps),
    iteration: state.iteration,
    toolsDone: [...calls].map(([tool, n]) => ({ tool, calls: n })),
    unfinished: ownItems(state.ledger)
      .filter((i) => i.status === "pending" || i.status === "in_progress")
      .map((i) => i.title),
    ...(goal !== undefined && goal.length > 0 ? { goal } : {}),
  };
}

/** Stamp the record on a loop-stopped state; identity for any other state. */
export function stampLoopStop(state: KernelState): KernelState {
  if (!isLoopStopped(state)) return state;
  return transitionState(state, {
    meta: { ...state.meta, loopStop: buildLoopStopRecord(state, { prior: state.meta.loopStop }) },
  });
}

/**
 * Write the final loop-stopped state to the durable checkpoint rail so it can
 * be resumed. No-op for other states and when the run has no checkpoint
 * observer. Fire-and-forget through the same observer contract as every other
 * checkpoint: a throwing observer is logged, never fatal.
 */
export function checkpointLoopStop(state: KernelState): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (state.meta.loopStop === undefined) return;
    const ctl = yield* getRunSlot(runControllerSlot);
    if (!ctl?.onCheckpoint) return;
    try {
      // iteration + 1: a DISTINCT row that always wins `latestCheckpoint`
      // (ORDER BY iteration DESC); the stateJson keeps its real iteration.
      ctl.onCheckpoint(serializeKernelState(state), state.iteration + 1);
    } catch (err) {
      yield* Effect.logWarning(
        `[durable-checkpoint] loop-stop onCheckpoint threw at iteration ${state.iteration}: ${String(err)}`,
      );
    }
  });
}

/** The terminal-pipeline step: stamp the stop record, then checkpoint the final state. */
export const runLoopStopStep = (state: KernelState): Effect.Effect<KernelState> =>
  Effect.gen(function* () {
    const stamped = stampLoopStop(state);
    yield* checkpointLoopStop(stamped);
    return stamped;
  });

const REASON_TEXT = (record: LoopStopRecord): string => {
  if (record.reason === "dispatcher-early-stop" || record.reason.startsWith("controller_early_stop")) {
    return "the controller judged it was making no progress";
  }
  return record.pattern !== undefined
    ? `loop detection (${record.pattern.name}: repeating without progress)`
    : "loop detection (repeating without progress)";
};

/** The corrective guidance a resume hands the next think. Pure; exported for pins. */
export function loopResumeGuidanceText(record: LoopStopRecord): string {
  const parts: string[] = [`The previous attempt stopped because of ${REASON_TEXT(record)} at iteration ${record.iteration}.`];
  if (record.repeatedCall !== undefined) {
    parts.push(`It kept repeating: ${record.repeatedTool !== undefined ? `${record.repeatedTool} ` : ""}${record.repeatedCall}. Do not make that call again.`);
  }
  if (record.toolsDone.length > 0) {
    const done = record.toolsDone.slice(0, MAX_LISTED).map((t) => `${t.tool} x${t.calls}`).join(", ");
    parts.push(`Already done (results are in the conversation; do not redo): ${done}.`);
  }
  if (record.unfinished.length > 0) {
    const open = record.unfinished.slice(0, MAX_LISTED).join("; ");
    const more = record.unfinished.length > MAX_LISTED ? ` (+${record.unfinished.length - MAX_LISTED} more)` : "";
    parts.push(`Unfinished: ${open}${more}.`);
  }
  parts.push(
    `Take a different approach and continue toward the original goal${record.goal !== undefined ? `: ${truncate(record.goal, MAX_TASK_CHARS)}` : ""}. ` +
      "Deliver the answer as soon as the goal is met.",
  );
  return parts.join(" ");
}

/** Terminal meta a resume clears: the run is live again, none of these describe it any more. */
const CLEARED_TERMINAL_META = {
  terminatedBy: undefined,
  previousTerminatedBy: undefined,
  terminationRationale: undefined,
  loopStop: undefined,
  assessment: undefined,
  deliverableProvenance: undefined,
  deliverableDecision: undefined,
  verificationWarning: undefined,
} as const;

/**
 * Continue a loop-stopped state. Pass the result as `KernelInput.resumeState`.
 *
 * - status back to `thinking`, output / error cleared, terminal meta cleared;
 * - a loop-guard epoch marker, so the steps that tripped the guard stop
 *   counting (detector window and spent guidance cycles);
 * - corrective `pendingGuidance` ({@link loopResumeGuidanceText}) for the next
 *   think; steps, messages and ledger carried verbatim, so no completed tool
 *   step is re-run.
 *
 * `opts.goal`: the original task text (the state does not carry it unless the
 * run set `meta.entropy.taskDescription`); the runtime passes `input.task`.
 *
 * Returns the state unchanged when it did not end by a loop guard
 * ({@link isLoopStopped}); callers that must know check that first.
 */
export function resumeFromStop(state: KernelState, opts: { readonly goal?: string } = {}): KernelState {
  if (!isLoopStopped(state)) return state;
  const stored = state.meta.loopStop ?? buildLoopStopRecord(state);
  const record: LoopStopRecord = opts.goal !== undefined && opts.goal.length > 0 ? { ...stored, goal: opts.goal } : stored;
  const text = loopResumeGuidanceText(record);
  return transitionState(state, {
    status: "thinking",
    output: null,
    error: null,
    steps: [
      ...state.steps,
      makeStep("harness_signal", `Resumed after a loop stop: ${text}`, {
        intervention: {
          actor: LOOP_RESUME_ACTOR,
          authorityClass: authorityOf(LOOP_RESUME_ACTOR),
          evidence: `stopped by ${record.reason} at iteration ${record.iteration}`,
          whatChanged: "loop-stop-resume: guard epoch reset, corrective guidance for the next turn",
          iter: state.iteration,
        },
      }),
    ],
    pendingGuidance: contributeGuidance(state.pendingGuidance, [{ kind: "errorRecovery", text }]),
    meta: { ...state.meta, ...CLEARED_TERMINAL_META },
  });
}

/**
 * The `maxIterations` a resumed run needs to get `extra` more turns: the
 * iteration and LLM-call counters carry over and both gate the loop, so a cap
 * the stopped run already reached would end the resume at once.
 */
export const resumeMaxIterations = (state: KernelState, extra: number): number =>
  Math.max(state.iteration, state.llmCalls ?? 0) + Math.max(1, extra);
