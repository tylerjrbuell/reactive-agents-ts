// File: src/strategies/substrate/answer-acceptance.ts
/**
 * A strategy's own acceptance of its answer, applied to the run's facts.
 *
 * Every run contract carries the `answer` floor (question-answered, acceptance
 * `self-critique`). A kernel pass satisfies it only when its terminal gate
 * accepts a final answer. A pass that ended at its own iteration cap with no
 * draft leaves it outstanding, twice: on its completion envelope
 * (`outstandingCriteria`) and as a declared, never-satisfied ledger requirement.
 *
 * A strategy that judges its answer itself (reflexion's critique, which runs
 * after the capped pass handed back its evidence) owns that verdict. When it
 * accepted the answer it ships, the floor is met: the run ledger records the
 * accepted terminal verdict (which satisfies `answer`) and the standing
 * envelope stops listing `answer`. Before this, trace
 * 01M7T3GGGZTYN79G1T0JSW4G5V shipped a critique-accepted report and the
 * runtime vetoed the run to failure ("unmet requirements: answer").
 *
 * Only the `answer` floor moves. Deterministic criteria, honesty markers
 * (budget-terminal, harness-authored, warnings) and the envelope status still
 * cap the run, so a budget-capped pass keeps the run at `partial`.
 *
 * Pure functions, no services.
 */
import type { CompletionEnvelope } from "../../kernel/state/completion-envelope.js";
import { answerSatisfiedIn } from "../../kernel/state/terminal-outcome.js";
import { recordTerminalVerdict } from "../../kernel/ledger/emit.js";
import type { RunLedger } from "../../kernel/ledger/run-ledger.js";

/** Id of the run contract's question-answered floor requirement. */
const ANSWER_REQUIREMENT_ID = "answer";

/**
 * The run ledger after the strategy accepted its answer: an accepted terminal
 * verdict (model-graded, it names the strategy) when the `answer` floor is
 * still unmet, which satisfies it. Unchanged when the floor is already met or
 * was never declared.
 */
export function ledgerWithAcceptedAnswer(ledger: RunLedger, strategy: string, iteration: number): RunLedger {
  if (answerSatisfiedIn(ledger) !== false) return ledger;
  return recordTerminalVerdict(ledger, {
    verified: true,
    iteration,
    reason: `${strategy}: the strategy's own check accepted the answer`,
    authorityClass: "model-grade",
  });
}

/** The envelope without the `answer` floor among its outstanding criteria (deterministic ids stay). */
export function envelopeWithAcceptedAnswer(envelope: CompletionEnvelope): CompletionEnvelope {
  const outstanding = envelope.outstandingCriteria?.filter((id) => id !== ANSWER_REQUIREMENT_ID);
  if (outstanding === undefined || outstanding.length === envelope.outstandingCriteria?.length) return envelope;
  const { outstandingCriteria: _answer, ...rest } = envelope;
  return outstanding.length > 0 ? { ...rest, outstandingCriteria: outstanding } : rest;
}
