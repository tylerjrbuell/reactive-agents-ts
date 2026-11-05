/**
 * Pure terminal-outcome derivation for the plan-execute strategy.
 *
 * The strategy substrate owns the status cap (worst-of envelope under the
 * plan's delivery verdict), the `final_answer` / `end_turn` claim, the raw
 * terminator relay and the honesty markers. What only plan-execute knows is
 * whether it ended in its OWN abstention (required tools never ran) or its own
 * cumulative-budget stop; this module turns that evidence into the substrate's
 * `StrategyOutcome`. No Effect, no I/O — directly testable.
 */
import type { BudgetLimits } from "../../kernel/capabilities/decide/arbitrator.js";
import { budgetStopReason } from "../budget/remaining-budget.js";
import type { StrategyOutcome, StrategySpend } from "../substrate/strategy-run.js";

/** Evidence the strategy accumulated over the run. */
export interface PlanOutcomeInput {
  readonly groundedAbstained: boolean;
  readonly groundedAbstainMissing: readonly string[];
  readonly budgetStopped: boolean;
  readonly budgetLimits: BudgetLimits | undefined;
  /** The run's spend at the terminal (names the budget-limit reason). */
  readonly spend: Pick<StrategySpend, "tokens" | "cost">;
}

/** Reason recorded on a grounded abstention's descriptor. */
export const GROUNDED_ABSTENTION_REASON = "Required tools were never successfully executed; the answer is ungrounded.";

/**
 * The plan's own terminal outcome, or `undefined` for a normal end (the
 * substrate then judges status under the delivery verdict).
 *
 * - Grounded abstention → `Abstained` with the still-missing tools.
 * - Cumulative-budget stop → `BudgetStopped` with the raw open-string reason
 *   (`budget-limit:tokens:<spent>/<limit>`) and the harness warning.
 */
export const planTerminalOutcome = (i: PlanOutcomeInput): StrategyOutcome | undefined => {
  if (i.groundedAbstained) {
    return { _tag: "Abstained", reason: GROUNDED_ABSTENTION_REASON, missing: i.groundedAbstainMissing };
  }
  if (i.budgetStopped) {
    return {
      _tag: "BudgetStopped",
      rawReason: budgetStopReason(i.budgetLimits, { tokens: i.spend.tokens, cost: i.spend.cost }) ?? "budget-limit",
      warning: `Token budget exhausted at ${i.spend.tokens} tokens: remaining plan steps and the reflect/synthesis passes were not launched; the output is the harness-joined step results, not a model-synthesized answer.`,
    };
  }
  return undefined;
};
