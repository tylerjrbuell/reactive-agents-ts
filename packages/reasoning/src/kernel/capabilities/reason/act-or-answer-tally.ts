/**
 * Act-or-answer tally — the per-run counts that let calibration learn whether
 * forcing a tool call helps a model (`calibration.actOrAnswer`).
 *
 * `act-or-answer.ts` is the only writer (it counts in every mode, `false`
 * included, so an unforced run still measures its stall rate). The kernel
 * terminal relay (`strategies/substrate/strategy-run.ts` `kernelTerminalMetadata`)
 * reads {@link actOrAnswerTally} once and puts it on
 * `result.metadata.extensions.actOrAnswer`, beside `signalTally`.
 *
 * Strategies that run several kernel passes (plan-execute steps, reflexion,
 * tree-of-thought) relay the SUM over every pass ({@link sumActOrAnswerTally},
 * accumulated in the substrate's `run.pass`), not one pass's counts.
 *
 * Counts:
 *  - `unforcedToolWorkTurns`: native-FC turns whose request was NOT forced,
 *    sent while tool work was outstanding and a domain tool was on the wire.
 *    The stall-rate denominator: a stall is a property of the model when it is
 *    not forced, so a forced request measures nothing about it.
 *  - `noCallStalls`: of those, replies with no tool call (prose, not cut off).
 *    A forced reply with no call is not one (it shows in `forced - forcedCalled`).
 *  - `forced`:requests sent with `toolChoice: "required"` (retry or proactive).
 *  - `forcedCalled`: forced replies that contained a domain tool call
 *    (a `final-answer`-only reply is not one: work was still outstanding).
 *  - `forcedCallSucceeded`: of those, replies whose every call ran and
 *    returned a successful result (read from the run's observation steps).
 */
import type { KernelState } from "../../state/kernel-state.js";
import type { ReasoningStep } from "../../../types/index.js";
import { isToolGateRefusal } from "../../utils/observation-helpers.js";

/** What `KernelMeta.actOrAnswerTally` holds while the pass runs. */
export interface ActOrAnswerTallyState {
  readonly noCallStalls: number;
  readonly unforcedToolWorkTurns: number;
  readonly forced: number;
  /** One entry per forced reply that contained a domain call: that reply's call ids. */
  readonly forcedCallIds: readonly (readonly string[])[];
}

/** The end-of-run summary on `result.metadata.extensions.actOrAnswer`. */
export interface ActOrAnswerTally {
  readonly noCallStalls: number;
  readonly unforcedToolWorkTurns: number;
  readonly forced: number;
  readonly forcedCalled: number;
  readonly forcedCallSucceeded: number;
}

const EMPTY: ActOrAnswerTallyState = { noCallStalls: 0, unforcedToolWorkTurns: 0, forced: 0, forcedCallIds: [] };

/** One turn's contribution to the tally. */
export interface ActOrAnswerTallyDelta {
  readonly stall?: boolean;
  /** The turn's unforced request was sent with tool work outstanding. */
  readonly unforcedToolWork?: boolean;
  readonly forced?: number;
  /** Call ids of a forced reply's domain calls (absent or empty = no domain call). */
  readonly forcedCallIds?: readonly string[];
}

/** `state` with `delta` added to its tally. Same object when the delta is empty. Pure. */
export function addActOrAnswerTally<S extends Pick<KernelState, "meta">>(state: S, delta: ActOrAnswerTallyDelta): S {
  const forced = delta.forced ?? 0;
  const ids = delta.forcedCallIds ?? [];
  if (delta.stall !== true && delta.unforcedToolWork !== true && forced === 0 && ids.length === 0) return state;
  const prev = state.meta.actOrAnswerTally ?? EMPTY;
  const next: ActOrAnswerTallyState = {
    noCallStalls: prev.noCallStalls + (delta.stall === true ? 1 : 0),
    unforcedToolWorkTurns: prev.unforcedToolWorkTurns + (delta.unforcedToolWork === true ? 1 : 0),
    forced: prev.forced + forced,
    forcedCallIds: ids.length > 0 ? [...prev.forcedCallIds, ids] : prev.forcedCallIds,
  };
  return { ...state, meta: { ...state.meta, actOrAnswerTally: next } };
}

/** True when every call in `ids` ran and its observation reports success. */
function replySucceeded(ids: readonly string[], steps: readonly ReasoningStep[]): boolean {
  return ids.every((id) =>
    steps.some(
      (s) =>
        s.type === "observation" &&
        s.metadata?.toolCallId === id &&
        s.metadata.observationResult?.success === true &&
        !isToolGateRefusal(s),
    ),
  );
}

/** The run's act-or-answer summary, all zeros when nothing was counted. Pure. */
export function actOrAnswerTally(state: Pick<KernelState, "meta" | "steps">): ActOrAnswerTally {
  const t = state.meta.actOrAnswerTally ?? EMPTY;
  return {
    noCallStalls: t.noCallStalls,
    unforcedToolWorkTurns: t.unforcedToolWorkTurns,
    forced: t.forced,
    forcedCalled: t.forcedCallIds.length,
    forcedCallSucceeded: t.forcedCallIds.filter((ids) => replySucceeded(ids, state.steps)).length,
  };
}

const ZERO: ActOrAnswerTally = { noCallStalls: 0, unforcedToolWorkTurns: 0, forced: 0, forcedCalled: 0, forcedCallSucceeded: 0 };

/**
 * Field-by-field sum of per-pass summaries (all zeros for none). Each pass's
 * success count is already read against its own steps, so the sum is exact.
 * Pure.
 */
export function sumActOrAnswerTally(tallies: readonly ActOrAnswerTally[]): ActOrAnswerTally {
  return tallies.reduce(
    (a, b) => ({
      noCallStalls: a.noCallStalls + b.noCallStalls,
      unforcedToolWorkTurns: a.unforcedToolWorkTurns + b.unforcedToolWorkTurns,
      forced: a.forced + b.forced,
      forcedCalled: a.forcedCalled + b.forcedCalled,
      forcedCallSucceeded: a.forcedCallSucceeded + b.forcedCallSucceeded,
    }),
    ZERO,
  );
}
