/**
 * Pure terminal-outcome derivation for the plan-execute strategy.
 *
 * Extracted from the tail of `executePlanExecute`: given the run's honest
 * evidence (grounded abstention, cumulative-budget stop, joined sub-kernel
 * envelope, output presence) it decides the result status, the CLOSED
 * `terminatedBy`, the open-string `rawTerminatedBy`, and the honesty metadata
 * that crosses the result boundary. No Effect, no I/O — directly testable.
 */
import {
  capStatusToEnvelope,
  honestEnvelopeMetadata,
  type CompletionEnvelope,
} from "../../kernel/state/completion-envelope.js";
import type { BudgetLimits } from "../../kernel/capabilities/decide/arbitrator.js";
import { budgetStopReason } from "../budget/remaining-budget.js";

/** Evidence the strategy accumulated over the run. */
export interface TerminalOutcomeInput {
  readonly finalOutput: string | null;
  readonly groundedAbstained: boolean;
  readonly groundedAbstainMissing: readonly string[];
  readonly budgetStopped: boolean;
  readonly subKernelEnvelope: CompletionEnvelope;
  /** Raw terminator carried from the sub-kernels (if any) before a budget stop overrides it. */
  readonly lastRawTerminatedBy: string | undefined;
  readonly budgetLimits: BudgetLimits | undefined;
  readonly totalTokens: number;
  readonly totalCost: number;
}

/** The strategy's honest terminal verdict. */
export interface TerminalOutcome {
  readonly status: "completed" | "partial" | "failed";
  readonly terminatedBy: "abstained" | "final_answer" | "end_turn";
  /** Honesty fields to spread into the result's `extraMetadata`. */
  readonly honestyMetadata: Record<string, unknown>;
}

/**
 * Derive status / terminatedBy / honesty metadata.
 *
 * - Grounded abstention and a cumulative-budget stop are honest non-successes
 *   (`partial`); otherwise output presence ⇒ `completed`, CAPPED by the joined
 *   sub-kernel envelope (own authority may downgrade, never upgrade past it).
 * - `terminatedBy` is `abstained` / `final_answer` (envelope-blessed output) /
 *   `end_turn` (never fabricates `final_answer` on a give-up).
 */
export const deriveTerminalOutcome = (i: TerminalOutcomeInput): TerminalOutcome => {
  const status: TerminalOutcome["status"] = i.groundedAbstained || i.budgetStopped
    ? "partial"
    : i.finalOutput
      ? capStatusToEnvelope("completed", i.subKernelEnvelope)
      : "partial";

  const terminatedBy: TerminalOutcome["terminatedBy"] = i.groundedAbstained
    ? "abstained"
    : status === "completed"
      ? "final_answer"
      : "end_turn";

  // A budget stop surfaces the raw open-string reason (budget-limit:tokens:<spent>/<limit>).
  const rawFromRun = i.budgetStopped
    ? budgetStopReason(i.budgetLimits, { tokens: i.totalTokens, cost: i.totalCost }) ?? "budget-limit"
    : i.lastRawTerminatedBy;
  const rawTerminatedBy = i.groundedAbstained ? "abstained" : rawFromRun;

  const envelopeMeta = honestEnvelopeMetadata(i.subKernelEnvelope);
  // Appends to (never clobbers) a sub-kernel envelope's own verificationWarning.
  const budgetStoppedMeta: Record<string, unknown> = i.budgetStopped
    ? {
        budgetTerminalPartial: true,
        harnessAuthoredOutput: true,
        verificationWarning: [
          typeof envelopeMeta.verificationWarning === "string"
            ? envelopeMeta.verificationWarning
            : undefined,
          `Token budget exhausted at ${i.totalTokens} tokens: remaining plan steps and the reflect/synthesis passes were not launched; the output is the harness-joined step results, not a model-synthesized answer.`,
        ]
          .filter((w) => w !== undefined && w.length > 0)
          .join(" | "),
      }
    : {};

  return {
    status,
    terminatedBy,
    honestyMetadata: {
      ...envelopeMeta,
      ...budgetStoppedMeta,
      // present ONLY on a grounded abstention (projectAbstention requires BOTH
      // terminatedBy === "abstained" AND this descriptor).
      ...(i.groundedAbstained
        ? {
            abstention: {
              reason: "Required tools were never successfully executed; the answer is ungrounded.",
              missing: i.groundedAbstainMissing,
            },
          }
        : {}),
      ...(rawTerminatedBy !== undefined ? { rawTerminatedBy } : {}),
    },
  };
};
