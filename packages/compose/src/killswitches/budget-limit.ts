import type { Harness } from '@reactive-agents/core';

export interface BudgetLimitOptions {
  maxTokens?: number;
  maxCostUSD?: number;
  /** Per-token cost in USD. Default: 0.000001 (rough frontier estimate). */
  costPerToken?: number;
  onTrigger?: 'stop' | 'terminate';
}

export function budgetLimit(options: BudgetLimitOptions): (harness: Harness) => void {
  const { maxTokens, maxCostUSD, costPerToken = 0.000001, onTrigger = 'stop' } = options;
  return (harness: Harness) => {
    harness.before('think', (ctx) => {
      // Issue #233 — prefer the run-scoped meter (`state.meta.runBudgetMeter`,
      // `{ tokens, cost }`) over the per-kernel `state.tokens` so `budgetLimit()`
      // halts at the same run boundary as `.withBudget()`. Read structurally:
      // compose must not import from `@reactive-agents/reasoning`. Max the two
      // so a metered run can never report less spend than the kernel recorded
      // (unmetered paths such as `completeStructured` leave `state.tokens`
      // ahead). Fall back to `state.tokens` when no meter is armed.
      const state = ctx.state as {
        tokens?: number;
        meta?: { runBudgetMeter?: { tokens: number; cost: number } };
      };
      const meter = state.meta?.runBudgetMeter;
      const tokens = meter ? Math.max(meter.tokens, state.tokens ?? 0) : (state.tokens ?? 0);
      if (maxTokens !== undefined && tokens >= maxTokens) {
        return {
          abort: onTrigger,
          reason: `budget-limit:tokens:${tokens}/${maxTokens}`,
          meta: { budgetType: 'tokens', limit: maxTokens, used: tokens },
        };
      }
      if (maxCostUSD !== undefined) {
        // Prefer the meter's real cost when it has one; otherwise estimate from
        // the (meter-aware) token count at `costPerToken`.
        const estimatedCost = meter && meter.cost > 0 ? meter.cost : tokens * costPerToken;
        if (estimatedCost >= maxCostUSD) {
          return {
            abort: onTrigger,
            reason: `budget-limit:cost:${estimatedCost.toFixed(4)}/${maxCostUSD}`,
            meta: { budgetType: 'cost', limit: maxCostUSD, used: estimatedCost },
          };
        }
      }
      return undefined;
    });
  };
}
