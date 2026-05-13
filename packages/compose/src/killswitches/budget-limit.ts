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
      const tokens = (ctx.state as { tokens?: number }).tokens ?? 0;
      if (maxTokens !== undefined && tokens >= maxTokens) {
        return { abort: onTrigger, reason: `budget-limit:tokens:${tokens}/${maxTokens}` };
      }
      if (maxCostUSD !== undefined) {
        const estimatedCost = tokens * costPerToken;
        if (estimatedCost >= maxCostUSD) {
          return { abort: onTrigger, reason: `budget-limit:cost:${estimatedCost.toFixed(4)}/${maxCostUSD}` };
        }
      }
      return undefined;
    });
  };
}
