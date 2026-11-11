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
import type { PlanStep } from "../../types/plan.js";

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
 * The cause of a grounded abstention, carried on `result.error`. The
 * abstention ships no output (owner decision 2026-11-10: the harness never
 * writes text into output); this sentence used to be prepended to the model's
 * reflection as the output.
 */
export const groundedAbstentionCause = (missing: readonly string[]): string =>
  `Unable to verify an answer: the required tools (${missing.join(", ")}) were never successfully executed.`;

/** Shared with blueprint; lives in planning/plan-text.ts. */
export { joinedStepResults } from "../planning/plan-text.js";

/**
 * The cause of a plan that ended with no output and no budget stop (no step
 * completed with a result, no synthesized answer): each failed or superseded
 * step and the first line of its error. Carried on `result.error` (owner
 * decision 2026-11-10: the harness never writes text into output); without it
 * the mint's generic empty-run cause read as a budget stop.
 */
export const unansweredPlanCause = (steps: readonly PlanStep[]): string => {
  const detail = steps
    .filter((s): s is PlanStep & { readonly error: string } =>
      (s.status === "failed" || s.status === "skipped") && typeof s.error === "string" && s.error.length > 0)
    .map((s) => `${s.id} (${s.title}): ${s.error.split("\n")[0]}`)
    .join("; ");
  return detail.length > 0 ? `The plan produced no result: ${detail}` : "The plan produced no result.";
};

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
