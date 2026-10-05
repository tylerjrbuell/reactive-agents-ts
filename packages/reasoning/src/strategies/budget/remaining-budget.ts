// File: src/strategies/budget/remaining-budget.ts
/**
 * Shared cumulative-budget helper for multi-kernel strategies.
 *
 * ACCOUNTING BOUNDARY (load-bearing): the kernel's Arbitrator pre-intent
 * budget guard (kernel/capabilities/decide/arbitrator.ts `computeBudgetSignal`,
 * seeded from `KernelInput.budgetLimits` in kernel/loop/runner.ts) counts
 * `state.tokens` SPENT SINCE THAT KERNEL START. A strategy that runs several
 * kernels in sequence (plan-execute's per-step sub-kernels, reflexion's
 * multi-pass loop) therefore gives each kernel a FRESH budget pool unless the
 * strategy layer accounts cumulative run spend itself. That per-kernel-invocation
 * semantics stays; this module is the strategy-side complement:
 *
 *  - {@link withSpentBudget} converts a run-scoped limit into the REMAINING
 *    budget to hand to the next kernel invocation, so the sum of what each
 *    sub-kernel may spend never exceeds the run limit;
 *  - {@link isBudgetExhausted} is the stop predicate the strategy consults
 *    before launching ANY new work (next step wave, reflect pass, refinement,
 *    synthesis, quality gate) - including spend from its own outer LLM calls,
 *    which no sub-kernel guard can ever see;
 *  - {@link budgetStopReason} formats the raw open-string termination reason
 *    (`budget-limit:tokens:<spent>/<limit>`) so a strategy-level stop reads
 *    exactly like the kernel killswitch reason on `metadata.rawTerminatedBy`.
 *
 * Pure functions, no services, no effects - trivially reusable by reflexion
 * (multi-pass gap) and any future multi-kernel strategy.
 */
import type { BudgetLimits } from "../../kernel/capabilities/decide/arbitrator.js";

/** Cumulative spend attributed to the run so far (strategy-layer accounting). */
export interface BudgetSpend {
  readonly tokens: number;
  readonly cost: number;
}

/**
 * Derive the REMAINING budget for the next kernel invocation given what the
 * run has already spent. Each declared limit is reduced by the matching spend
 * dimension and floored at 0 (a crossed limit yields 0, meaning "nothing
 * left"). Undeclared limit dimensions stay undeclared - a missing tokenLimit
 * is never invented as 0. `warningRatio` carries through unchanged.
 *
 * Returns `undefined` when no limits were declared (no gating), and an empty
 * object when the declared limits carried no numeric cap.
 */
export function withSpentBudget(
  limits: BudgetLimits | undefined,
  spent: BudgetSpend,
): BudgetLimits | undefined {
  if (!limits) return undefined;
  return {
    ...(limits.tokenLimit !== undefined
      ? { tokenLimit: Math.max(0, limits.tokenLimit - spent.tokens) }
      : {}),
    ...(limits.costLimit !== undefined
      ? { costLimit: Math.max(0, limits.costLimit - spent.cost) }
      : {}),
    ...(limits.warningRatio !== undefined ? { warningRatio: limits.warningRatio } : {}),
  };
}

/**
 * True once cumulative run spend reaches a declared cap (the same `>=` cliff
 * the kernel guard uses). No limits declared → never exhausted.
 */
export function isBudgetExhausted(
  limits: BudgetLimits | undefined,
  spent: BudgetSpend,
): boolean {
  if (!limits) return false;
  if (limits.tokenLimit !== undefined && spent.tokens >= limits.tokenLimit) return true;
  if (limits.costLimit !== undefined && spent.cost >= limits.costLimit) return true;
  return false;
}

/**
 * The raw open-string termination reason for a strategy-level budget stop,
 * shaped like the compose killswitch (`budget-limit:tokens:<spent>/<limit>`,
 * cf. compose/src/killswitches/budget-limit.ts and the kernel's
 * `rawTerminatedBy` channel) so observability downstream cannot tell the two
 * enforcement sites apart except by the numbers. `undefined` when the spend
 * has not crossed a declared limit.
 */
export function budgetStopReason(
  limits: BudgetLimits | undefined,
  spent: BudgetSpend,
): string | undefined {
  if (!isBudgetExhausted(limits, spent) || !limits) return undefined;
  if (limits.tokenLimit !== undefined && spent.tokens >= limits.tokenLimit) {
    return `budget-limit:tokens:${spent.tokens}/${limits.tokenLimit}`;
  }
  return `budget-limit:cost:${spent.cost}/${limits.costLimit ?? 0}`;
}
