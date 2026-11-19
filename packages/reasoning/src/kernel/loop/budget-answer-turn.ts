// File: src/kernel/loop/budget-answer-turn.ts
/**
 * Budget answer turn: the last think call a kernel run can make is the
 * model's turn to write the answer (Cortex runs 01M743KQ5KKKQQ9998SQGW9V66,
 * 01M7447E9X95FGRB3H2RW81EWY).
 *
 * The runner's loop bound is `iteration < max && llmCalls < max`. A think call
 * made when `llmCalls === max - 1` or `iteration === max - 1` is the last one:
 * if it calls a tool, the result arrives after the loop ends and nobody answers
 * it, and the run fails with "stopped (max_iterations) before the model wrote a
 * final answer". When the run already holds validated tool evidence and only
 * the answer is outstanding, this module turns that last call into the exit
 * gate's ANSWER TURN (`reason/answer-turn.ts`): one think call with no tools
 * and the gate's own "write the answer now" guidance.
 *
 * The harness never writes the answer. The model's text then goes through the
 * normal model exit proposal and terminal verify gate. When the turn ends at
 * the cap with nothing outstanding, the cap ends it as the model's final
 * answer (`proposeCapExit`), not as a partial handoff. No evidence, required
 * tool work left, an action the task asks for not yet done
 * (`requestedActionTools`), or nothing outstanding: no reservation, the run
 * ends as before.
 *
 * A guard stop before the last call (dispatcher early-stop, no-progress) on
 * such a run gets the same answer turn once, even after an earlier denial
 * (`disposeExit`'s `answerTurnGiven`).
 *
 * DEFAULT ON (`harness.budgetAnswerTurn`; `false` or `RA_BUDGET_ANSWER_TURN=0`
 * turns it off): owner decision 2026-11-19 after Cortex trace
 * 01M7TERZAVP2RS489WEBJ3HY7H ended answerless at the cap with the evidence
 * gathered; measured afterwards. Ablation
 * wiki/Research/Ablations/2026-11-10-budget-answer-turn-ablation.md measured
 * +1.9pp over 3 tiers, within noise (M5b, 2026-11-16: not exercised).
 *
 * Recorded like every gate decision: a `deny-once` exit-gate record (with
 * `answerTurnAt`) on the step record, an `exit_gate` guard-fired event, and a
 * `budget_answer_turn` guard-fired event naming the reservation.
 */
import { Effect } from "effect";
import { deliverableToContent, type Deliverable } from "@reactive-agents/core";
import { transitionState, type KernelInput, type KernelState } from "../state/kernel-state.js";
import { contributeGuidance } from "../state/guidance-channel.js";
import { emitGuardFired } from "../utils/diagnostics.js";
import {
  contractOutstanding,
  emitDisposition,
  gateContent,
  gateStep,
  lastExitGateRecord,
  outstandingItems,
  type ExitGateRecord,
} from "./exit-gate.js";
import { wrapUpReserve, WRAP_UP_RESERVE_GUARD } from "./wrap-up-reserve.js";
import { assembleDeliverable, collectValidatedObservations } from "./runner-helpers/deliverable.js";
import { requestedActionTools, succeededToolNames } from "../capabilities/verify/claimed-actions.js";

/** The guard name the reservation's trace event carries. */
export const BUDGET_ANSWER_TURN_GUARD = "budget_answer_turn";

/**
 * True when the next think call is the last one the loop bound allows
 * (`iteration < max && llmCalls < max`, checked before each pass).
 */
export function isLastThinkCall(state: Pick<KernelState, "iteration" | "llmCalls">, maxIterations: number): boolean {
  return state.iteration >= maxIterations - 1 || (state.llmCalls ?? 0) >= maxIterations - 1;
}

/**
 * The exit-gate record that reserves this think call as the answer turn, or
 * undefined when the reservation does not apply. Pure.
 */
export function budgetAnswerTurnRecord(
  state: KernelState,
  input: KernelInput,
  maxIterations: number,
): ExitGateRecord | undefined {
  if (input.harness?.budgetAnswerTurn !== true) return undefined; // off by config / env (default on)
  if (state.status !== "thinking" || !isLastThinkCall(state, maxIterations)) return undefined;
  const llmCalls = state.llmCalls ?? 0;
  if (lastExitGateRecord(state.steps)?.answerTurnAt === llmCalls) return undefined; // already reserved
  // A pass of a multi-pass run (`withRunBudget`): only the RUN's last call is
  // reserved. With run calls left after this one, the pending batch runs
  // (pending-batch.ts) and a later pass answers; a call past the run budget
  // (a pass floor) belongs to the strategy's own wrap-up (reflexion synthesis).
  const runLeft = state.meta.runIterationsLeft;
  if (runLeft !== undefined && runLeft - Math.max(state.iteration, llmCalls) !== 1) return undefined;
  const judged = toolWorkSettled(state, input);
  if (judged === undefined) return undefined;
  const outstanding = outstandingItems(state, input, judged);
  if (outstanding.length === 0) return undefined;
  return { proposedBy: "max_iterations", gateDecision: "deny-once", reason: "max_iterations", outstanding, answerTurnAt: llmCalls };
}

/**
 * The judged deliverable when no TOOL work is left, so only the answer can be
 * outstanding: the run holds validated tool evidence, the contract has no
 * blocking item (a required tool, a write target), and no action the task asks
 * for is undone. Undefined otherwise. Pure. Shared by the budget answer turn
 * and the lean final turn (`reason/lean-final-turn.ts`).
 */
export function toolWorkSettled(state: KernelState, input: KernelInput): Deliverable | undefined {
  if (collectValidatedObservations(state).length === 0) return undefined; // no evidence to answer from
  const judged = assembleDeliverable(state);
  // Tool work left (a required tool, a write target): the call keeps its tools.
  if (contractOutstanding(state, input, deliverableToContent(judged)).length > 0) return undefined;
  // An answer-only contract can miss an action the task asks for ("file a
  // report using the report tool"): while one is undone, the call keeps its tools.
  const tools = (input.availableToolSchemas ?? []).map((t) => t.name);
  if (requestedActionTools(input.task, tools, succeededToolNames(state.steps)).length > 0) return undefined;
  return judged;
}

/**
 * Reserve the last think call as the answer turn when {@link budgetAnswerTurnRecord}
 * applies: append the gate record, add its guidance, and trace both events.
 * Otherwise returns `state` unchanged.
 */
export function reserveBudgetAnswerTurn(args: {
  readonly state: KernelState;
  readonly input: KernelInput;
  readonly maxIterations: number;
  readonly taskId: string;
}): Effect.Effect<KernelState, never, never> {
  return Effect.gen(function* () {
    const { state, maxIterations, taskId } = args;
    // A seeded plan run's wrap-up reserve (wrap-up-reserve.ts, opt-in) takes the
    // call first when it applies; otherwise the budget answer turn (default on)
    // may. Both are the same tools-withheld answer turn.
    const wrapUp = wrapUpReserve(state, args.input, isLastThinkCall(state, maxIterations));
    const budgeted = wrapUp === undefined ? budgetAnswerTurnRecord(state, args.input, maxIterations) : undefined;
    const record = wrapUp?.record ?? budgeted;
    if (record === undefined) return state;
    yield* emitGuardFired({
      taskId,
      iteration: state.iteration,
      guard: wrapUp === undefined ? BUDGET_ANSWER_TURN_GUARD : WRAP_UP_RESERVE_GUARD,
      outcome: "block",
      reason: wrapUp === undefined
        ? "last think call of the iteration budget reserved for the answer"
        : "last think call of the iteration budget reserved for a wrap-up answer (seeded plan run)",
      metadata: { llmCalls: record.answerTurnAt, maxIterations, outstanding: record.outstanding },
    });
    yield* emitDisposition(taskId, state, record);
    return transitionState(state, {
      steps: [...state.steps, gateStep(record, state.iteration)],
      pendingGuidance: contributeGuidance(state.pendingGuidance, [
        { kind: "qualityGateHint", text: wrapUp?.hint ?? gateContent(record).replace(/^⚠️ /, "") },
      ]),
    });
  });
}
