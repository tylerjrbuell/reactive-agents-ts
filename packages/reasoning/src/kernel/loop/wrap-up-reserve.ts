// File: src/kernel/loop/wrap-up-reserve.ts
//
// Wrap-up reserve: on a run seeded with a plan checklist, the last think call
// the iteration budget allows is the model's turn to answer from the evidence
// gathered and say what is unfinished, instead of one more tool call nobody
// answers ("did not finish", Cortex trace 01M7JHP80MHNZ35EVPS42JBD7T).
//
// It reuses the exit gate's ANSWER TURN (`budget-answer-turn.ts`,
// `reason/answer-turn.ts`): a `max_iterations` deny-once record stamped
// `answerTurnAt` makes the next think call ship with NO tools, and its reply
// goes through the normal model exit proposal and terminal verify gate. The
// difference from the budget answer turn: it does not wait for the contract to
// read "only the answer is outstanding". Unchecked plan steps ARE the work left
// and the answer says so; the harness never writes the answer.
//
// OPT-IN (`harness.wrapUpReserve`, `RA_WRAPUP_RESERVE=1`), default OFF until an
// ablation measures it. No seed, plan posture, no validated tool evidence, or
// not the last call: undefined, nothing changes.
// Pure, deterministic, NO LLM.

import { viewItems, startRound } from "../capabilities/act/checklist-round.js";
import { isPlanPosture } from "../policy/run-posture.js";
import type { KernelInput, KernelState } from "../state/kernel-state.js";
import { lastExitGateRecord, type ExitGateRecord } from "./exit-gate.js";
import { collectValidatedObservations } from "./runner-helpers/deliverable.js";

/** The guard name the wrap-up reserve's trace event carries (distinct from the budget answer turn's, so activation is countable). */
export const WRAP_UP_RESERVE_GUARD = "wrap_up_reserve";

/** Most unchecked steps the hint names; the count says the rest. */
const MAX_NAMED = 5;

/** A wrap-up reservation: the gate record that withholds tools, and the hint the model reads. */
export interface WrapUpReserve {
  readonly record: ExitGateRecord;
  readonly hint: string;
}

/**
 * The wrap-up reservation for this think call, or undefined when it does not
 * apply. `isLastThinkCall` is the caller's loop-bound test (it lives in
 * budget-answer-turn.ts, which imports this module).
 */
export function wrapUpReserve(
  state: KernelState,
  input: KernelInput,
  lastThinkCall: boolean,
): WrapUpReserve | undefined {
  if (input.harness?.wrapUpReserve !== true) return undefined; // opt-in
  if (isPlanPosture(input) || (input.initialAdvisory?.length ?? 0) === 0) return undefined; // seeded execute runs only
  if (state.status !== "thinking" || !lastThinkCall) return undefined;
  const llmCalls = state.llmCalls ?? 0;
  if (lastExitGateRecord(state.steps)?.answerTurnAt === llmCalls) return undefined; // already reserved
  if (collectValidatedObservations(state).length === 0) return undefined; // no evidence to answer from
  const open = viewItems(startRound(), state.ledger).filter((i) => i.status !== "completed");
  const named = open.slice(0, MAX_NAMED).map((i) => `[${i.id}] ${i.title}`);
  if (open.length > MAX_NAMED) named.push(`+${open.length - MAX_NAMED} more`);
  const unfinished = open.length === 0 ? "the final answer" : `${open.length} plan step${open.length === 1 ? "" : "s"} unchecked`;
  return {
    record: {
      proposedBy: "max_iterations",
      gateDecision: "deny-once",
      reason: "max_iterations",
      outstanding: [unfinished],
      answerTurnAt: llmCalls,
    },
    hint:
      "Out of iterations: tools are not available on this turn. Answer now from the evidence gathered" +
      (open.length === 0
        ? "."
        : `, and state plainly what is unfinished (${named.join("; ")}). Do not describe a next step or ask for permission.`),
  };
}
