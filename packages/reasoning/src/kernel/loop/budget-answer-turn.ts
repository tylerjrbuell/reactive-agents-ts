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
 * OPT-IN (`harness.budgetAnswerTurn`, `RA_BUDGET_ANSWER_TURN=1`): ablation
 * wiki/Research/Ablations/2026-11-10-budget-answer-turn-ablation.md measured
 * +1.9pp over 3 tiers, within noise.
 *
 * Recorded like every gate decision: a `deny-once` exit-gate record (with
 * `answerTurnAt`) on the step record, an `exit_gate` guard-fired event, and a
 * `budget_answer_turn` guard-fired event naming the reservation.
 */
import { Effect } from "effect";
import { deliverableToContent } from "@reactive-agents/core";
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
  if (input.harness?.budgetAnswerTurn !== true) return undefined; // opt-in (ablation 2026-11-10)
  if (state.status !== "thinking" || !isLastThinkCall(state, maxIterations)) return undefined;
  const llmCalls = state.llmCalls ?? 0;
  if (lastExitGateRecord(state.steps)?.answerTurnAt === llmCalls) return undefined; // already reserved
  if (collectValidatedObservations(state).length === 0) return undefined; // no evidence to answer from
  const judged = assembleDeliverable(state);
  // Tool work left (a required tool, a write target): the last call keeps its tools.
  if (contractOutstanding(state, input, deliverableToContent(judged)).length > 0) return undefined;
  // An answer-only contract can miss an action the task asks for ("file a
  // report using the report tool"): while one is undone, the call keeps its tools.
  const tools = (input.availableToolSchemas ?? []).map((t) => t.name);
  if (requestedActionTools(input.task, tools, succeededToolNames(state.steps)).length > 0) return undefined;
  const outstanding = outstandingItems(state, input, judged);
  if (outstanding.length === 0) return undefined;
  return { proposedBy: "max_iterations", gateDecision: "deny-once", reason: "max_iterations", outstanding, answerTurnAt: llmCalls };
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
    const record = budgetAnswerTurnRecord(state, args.input, maxIterations);
    if (record === undefined) return state;
    yield* emitGuardFired({
      taskId,
      iteration: state.iteration,
      guard: BUDGET_ANSWER_TURN_GUARD,
      outcome: "block",
      reason: "last think call of the iteration budget reserved for the answer",
      metadata: { llmCalls: record.answerTurnAt, maxIterations, outstanding: record.outstanding },
    });
    yield* emitDisposition(taskId, state, record);
    return transitionState(state, {
      steps: [...state.steps, gateStep(record, state.iteration)],
      pendingGuidance: contributeGuidance(state.pendingGuidance, [
        { kind: "qualityGateHint", text: gateContent(record).replace(/^⚠️ /, "") },
      ]),
    });
  });
}
