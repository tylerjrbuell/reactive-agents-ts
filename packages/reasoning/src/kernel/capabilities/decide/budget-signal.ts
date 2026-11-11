/**
 * decide/budget-signal.ts — cost / token budget input for the Arbitrator.
 *
 * BudgetLimits, BudgetSignal, and the pure computeBudgetSignal derivation
 * (Issue #128 / North Star v5.0 Pillar 6). Moved verbatim from `arbitrator.ts`
 * (GH #220 / quality program Task 7); all three exports are still re-exported
 * from `arbitrator.ts` (emitters.ts and strategies/budget/remaining-budget.ts
 * keep importing their types through it).
 */

import type { KernelState } from "../../state/kernel-state.js";

// ─── BudgetSignal: cost / token budget input for the Arbitrator (Issue #128) ─

/**
 * BudgetLimits — declarative caps consulted by the Arbitrator's pre-intent
 * guard. Either field is optional; warnings/exceeded are computed only against
 * the limits that are declared.
 */
export interface BudgetLimits {
  /** Hard cap on cumulative tokens (sum of state.tokens). */
  readonly tokenLimit?: number;
  /** Hard cap on cumulative cost in USD (sum of state.cost). */
  readonly costLimit?: number;
  /**
   * Optional override of the warning threshold (defaults to 0.80 = warn at
   * ≥80% of any declared limit). Useful for tighter budgets where the warn
   * band should be wider.
   */
  readonly warningRatio?: number;
}

/**
 * BudgetSignal — derived budget state passed into ArbitrationContext.
 *
 * North Star v5.0 Pillar 6 (Optimal Execution Algorithm step-6) declares
 * BudgetSignal as one of the canonical Arbitrator inputs. Computed purely
 * from KernelState (tokens, cost) + declared BudgetLimits — no Effect /
 * service needed, so arbitrate() stays synchronous and pure.
 *
 * - status="exceeded" → pre-intent guard returns exit-failure
 *   (terminatedBy="budget_exceeded") dominating every intent.kind branch.
 * - status="warning" → emitted as observability but does NOT terminate;
 *   downstream consumers (e.g., RI dispatcher) may react.
 * - status="ok" → no action.
 */
export interface BudgetSignal {
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly tokenLimit?: number;
  readonly costLimit?: number;
  readonly status: "ok" | "warning" | "exceeded";
  /** Human-readable explanation when status !== "ok". */
  readonly reason?: string;
}

/** Default ratio at or above which the BudgetSignal flips to "warning". */
const DEFAULT_BUDGET_WARNING_RATIO = 0.80;

/**
 * Compute a BudgetSignal from kernel-level metrics + declared limits.
 *
 * Pure function — safe to call from arbitrate() without any service.
 * Returns `undefined` when no limits are declared (callers omit `budget`
 * from ArbitrationContext in that case so the pre-guard is a no-op).
 */
export function computeBudgetSignal(args: {
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly limits?: BudgetLimits;
}): BudgetSignal | undefined {
  const { tokensUsed, costUsd, limits } = args;
  if (!limits) return undefined;
  const { tokenLimit, costLimit, warningRatio } = limits;
  if (tokenLimit === undefined && costLimit === undefined) return undefined;

  const warn = warningRatio ?? DEFAULT_BUDGET_WARNING_RATIO;
  const reasons: string[] = [];
  let status: BudgetSignal["status"] = "ok";

  if (tokenLimit !== undefined && tokensUsed >= tokenLimit) {
    status = "exceeded";
    reasons.push(`tokens ${tokensUsed} ≥ tokenLimit ${tokenLimit}`);
  }
  if (costLimit !== undefined && costUsd >= costLimit) {
    status = "exceeded";
    reasons.push(`cost $${costUsd.toFixed(4)} ≥ costLimit $${costLimit.toFixed(4)}`);
  }
  if (status !== "exceeded") {
    if (tokenLimit !== undefined && tokensUsed >= tokenLimit * warn) {
      status = "warning";
      reasons.push(`tokens ${tokensUsed} ≥ ${(warn * 100).toFixed(0)}% of ${tokenLimit}`);
    }
    if (costLimit !== undefined && costUsd >= costLimit * warn) {
      status = "warning";
      reasons.push(`cost $${costUsd.toFixed(4)} ≥ ${(warn * 100).toFixed(0)}% of $${costLimit.toFixed(4)}`);
    }
  }

  return {
    tokensUsed,
    costUsd,
    ...(tokenLimit !== undefined ? { tokenLimit } : {}),
    ...(costLimit !== undefined ? { costLimit } : {}),
    status,
    ...(reasons.length > 0 ? { reason: reasons.join("; ") } : {}),
  };
}

/** The slice of KernelState the budget derivation reads. */
type BudgetStateView = Pick<KernelState, "tokens" | "cost" | "meta">;

/**
 * The run's BudgetSignal, derived from kernel state — the one derivation the
 * Arbitrator's pre-guard and the terminal BudgetExhausted publish both read.
 *
 * Reads `state.meta.budgetLimits` (seeded at kernel start by runner.ts); no
 * limits → `undefined` and the pre-guard is a no-op.
 *
 * Issue #231 — when the run-scoped meter is present, spend is the MAX of the
 * live meter and the per-kernel `state.tokens`/`state.cost`. The meter is the
 * authoritative run total (fed by the observable LLM wrapper on every call
 * path); `Math.max` guards any unmetered path (e.g. completeStructured, which
 * exposes no usage) so a metered run can never report LESS spend than the
 * kernel already recorded. `state.tokens`/`state.cost` stay untouched for
 * honest-partial metadata.
 *
 * Issue #231 follow-up — when the run meter is armed, the authoritative limit
 * is the run-scoped ORIGINAL limit. A multi-kernel strategy (plan-execute)
 * hands this sub-kernel a REDUCED limit via `withSpentBudget`; combining that
 * reduced limit with run-TOTAL spend halts early by up to the prior spend.
 * Fall back to `budgetLimits` when no run limit was seeded (unchanged path).
 */
export function budgetSignalOfState(state: BudgetStateView): BudgetSignal | undefined {
  const budgetLimits = state.meta.budgetLimits as BudgetLimits | undefined;
  const meter = state.meta.runBudgetMeter;
  const effectiveLimits = meter
    ? ((state.meta.runBudgetLimits as BudgetLimits | undefined) ?? budgetLimits)
    : budgetLimits;
  return computeBudgetSignal({
    tokensUsed: meter ? Math.max(meter.tokens, state.tokens ?? 0) : (state.tokens ?? 0),
    costUsd: meter ? Math.max(meter.cost, state.cost ?? 0) : (state.cost ?? 0),
    limits: effectiveLimits,
  });
}

/** One exhausted budget dimension: its kind, declared limit and spend. */
export interface ExhaustedBudget {
  /** Same vocabulary as the `budgetLimit()` killswitch: "tokens" | "cost". */
  readonly budgetType: "tokens" | "cost";
  readonly limit: number;
  readonly used: number;
}

/**
 * The budget dimensions a signal reports exceeded (spend ≥ declared limit).
 * Empty unless `status === "exceeded"`. Pure.
 */
export function exhaustedBudgets(signal: BudgetSignal | undefined): readonly ExhaustedBudget[] {
  if (signal?.status !== "exceeded") return [];
  const out: ExhaustedBudget[] = [];
  if (signal.tokenLimit !== undefined && signal.tokensUsed >= signal.tokenLimit) {
    out.push({ budgetType: "tokens", limit: signal.tokenLimit, used: signal.tokensUsed });
  }
  if (signal.costLimit !== undefined && signal.costUsd >= signal.costLimit) {
    out.push({ budgetType: "cost", limit: signal.costLimit, used: signal.costUsd });
  }
  return out;
}
