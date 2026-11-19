// File: src/kernel/loop/iterate-refusal-refund-seam.ts
//
// Refusal refund. A turn whose every call was refused by `duplicateGuard` did no
// work: the answer is the prior result, the model re-asked for it. Counting that
// turn against `maxIterations` burned the budget on refusals (cogito todo-heavy,
// live addendum 6: 5 of 8 refusal runs re-read twice; run 4 hit the 14-iteration
// cap at 13/14 with one output unwritten, every written value correct).
//
// So such a turn does not count: the loop bound is raised by one, the same
// mechanism and the same record as the bookkeeping refund
// (`iterate-bookkeeping-refund-seam.ts`: one actor, one total cap of half the
// ORIGINAL budget, the plan hard cap). Two bounds apply, so it cannot loop:
//   1. {@link MAX_CONSECUTIVE_REFUSAL_REFUNDS} refused turns in a row. Only a
//      call that ran resets the count, so an all-refused loop gets three free
//      turns and then spends the budget as before (the loop detector and the
//      cap then end it). Three: one refusal is the normal correction, a second
//      shows the model did not take it, a third is the last slack before the
//      same call is a loop; more is paying for a model that will not move.
//   2. The shared half-budget total cap.
// A refund is a `harness_signal` step carrying a `bookkeeping-refund`
// intervention (the record the shared cap counts), plus a guard-fired event.
//
// A turn with any call that ran, any call refused for another reason, or no
// call: undefined, nothing changes. Pure decision, deterministic, NO LLM.

import { Effect } from "effect";
import { authorityOf } from "../capabilities/decide/authority.js";
import { DUPLICATE_REFUSAL_TAG } from "../capabilities/act/guard.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import type { ReasoningStep } from "../../types/index.js";
import { notRunCallIds } from "../utils/observation-helpers.js";
import {
  transitionState,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../state/kernel-state.js";
import { emitGuardFired } from "../utils/diagnostics.js";
import {
  BOOKKEEPING_REFUND_ACTOR,
  bookkeepingRefundCap,
  bookkeepingRefundsIssued,
} from "./iterate-bookkeeping-refund-seam.js";

/** Refused turns in a row that may go unspent before the budget counts them again. */
export const MAX_CONSECUTIVE_REFUSAL_REFUNDS = 3;
/** The guard name of the refund's trace event. */
export const REFUSAL_REFUND_GUARD = "refusal_refund";
/** `whatChanged` of a refusal refund: tells it apart from a todo-round refund. */
const REFUSAL_REFUND_CHANGE = "bookkeeping-refund: the refused-duplicate round did not count against maxIterations";

const callIdOf = (step: ReasoningStep): string | undefined => {
  const id = (step.metadata?.toolCall as { id?: unknown } | undefined)?.id;
  return typeof id === "string" ? id : undefined;
};

/** True when the round's steps hold at least one call and every call was a duplicate refusal. */
export function isDuplicateRefusalRound(state: KernelState, roundSteps: readonly ReasoningStep[]): boolean {
  const notRun = notRunCallIds(state.steps);
  const refusedIds = new Set<string>();
  for (const s of roundSteps) {
    if (s.type !== "observation" || !s.content.includes(DUPLICATE_REFUSAL_TAG)) continue;
    const id = s.metadata?.toolCallId;
    if (typeof id === "string" && notRun.has(id)) refusedIds.add(id);
  }
  const actions = roundSteps.filter((s) => s.type === "action");
  return actions.length > 0 && actions.every((s) => {
    const id = callIdOf(s);
    return id !== undefined && refusedIds.has(id);
  });
}

/**
 * Refusal refunds since the last call that ran (steps read back to front:
 * thoughts and refused calls pass, a call that ran ends the streak).
 */
export function consecutiveRefusalRefunds(state: KernelState): number {
  const notRun = notRunCallIds(state.steps);
  let n = 0;
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const s = state.steps[i]!;
    if (s.type === "action") {
      const id = callIdOf(s);
      if (id === undefined || !notRun.has(id)) break;
    } else if (s.type === "harness_signal" && s.metadata?.intervention?.whatChanged === REFUSAL_REFUND_CHANGE) {
      n++;
    }
  }
  return n;
}

/**
 * The refund for the act round that just ended, or undefined when it does not
 * apply: no iteration spent, not an all-duplicate-refusal round, the run is
 * over, the harness switch is off, or a bound is reached. `roundSteps` are the
 * steps the round appended.
 */
export function proposeRefusalRefund(args: {
  readonly state: KernelState;
  readonly input: KernelInput;
  readonly options: KernelRunOptions;
  readonly roundSteps: readonly ReasoningStep[];
  readonly iterationAtPassStart: number;
}): { readonly state: KernelState; readonly options: KernelRunOptions } | undefined {
  const { state, input, options } = args;
  if (input.harness?.bookkeepingRefund === false) return undefined;
  if (state.status === "done" || state.status === "failed") return undefined;
  if (state.iteration <= args.iterationAtPassStart || !isDuplicateRefusalRound(state, args.roundSteps)) return undefined;
  if (consecutiveRefusalRefunds(state) >= MAX_CONSECUTIVE_REFUSAL_REFUNDS) return undefined;
  const issued = bookkeepingRefundsIssued(state);
  if (issued >= bookkeepingRefundCap(options.maxIterations, issued, options.configuredMaxIterations)) return undefined;
  if (options.planBudgetHardCap !== undefined && options.maxIterations + 1 > options.planBudgetHardCap) return undefined;
  const step = makeStep("harness_signal", `refused duplicate round refunded (${issued + 1})`, {
    intervention: {
      actor: BOOKKEEPING_REFUND_ACTOR,
      authorityClass: authorityOf(BOOKKEEPING_REFUND_ACTOR),
      evidence: `iteration ${state.iteration} only re-asked for results already in the conversation`,
      whatChanged: REFUSAL_REFUND_CHANGE,
      iter: state.iteration,
    },
  });
  return {
    state: transitionState(state, {
      steps: [...state.steps, step],
      meta: { ...state.meta, maxIterations: options.maxIterations + 1 },
    }),
    options: { ...options, maxIterations: options.maxIterations + 1 },
  };
}

/** Trace the refund (the step record already carries it). */
export const emitRefusalRefund = (state: KernelState, options: KernelRunOptions): Effect.Effect<void, never> =>
  emitGuardFired({
    taskId: options.taskId ?? state.taskId,
    iteration: state.iteration,
    guard: REFUSAL_REFUND_GUARD,
    outcome: "pass",
    reason: "a round of only refused duplicate calls did not count against the iteration budget",
    metadata: { maxIterations: options.maxIterations, refunds: bookkeepingRefundsIssued(state) },
  });
