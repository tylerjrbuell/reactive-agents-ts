/**
 * decide/budget-signal.ts — cost / token budget input for the Arbitrator.
 *
 * BudgetLimits, BudgetSignal, and the pure computeBudgetSignal derivation
 * (Issue #128 / North Star v5.0 Pillar 6). Moved verbatim from `arbitrator.ts`
 * (GH #220 / quality program Task 7); all three exports are still re-exported
 * from `arbitrator.ts` (emitters.ts and strategies/budget/remaining-budget.ts
 * keep importing their types through it).
 */

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
