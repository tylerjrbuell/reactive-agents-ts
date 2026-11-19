/**
 * A USD total built from per-call cost readings
 * (`LLMRequestCompleted.estimatedCost`) that may be absent.
 */
export interface CostSum {
  /** Sum of the known costs in USD. A lower bound when `complete` is false. */
  readonly usd: number;
  /**
   * `true` when every reading had a known cost. `false` when at least one
   * reading was absent (price unknown) or not a finite number, so `usd`
   * understates the real spend.
   */
  readonly complete: boolean;
}

/** The empty total: $0, complete. Start value for {@link addCost}. */
export const EMPTY_COST_SUM: CostSum = { usd: 0, complete: true };

/**
 * Add one cost reading to a running total. An absent or non-finite reading
 * adds nothing and marks the total incomplete, so an unknown price is never
 * counted as free.
 */
export function addCost(total: CostSum, cost: number | undefined): CostSum {
  if (cost === undefined || !Number.isFinite(cost)) {
    return { usd: total.usd, complete: false };
  }
  return { usd: total.usd + cost, complete: total.complete };
}

/**
 * Sum per-call cost readings. Absent readings (unknown price) add nothing and
 * set `complete: false`; never read `usd` as the full spend without checking it.
 * An empty input sums to `{ usd: 0, complete: true }`.
 */
export function sumCosts(costs: Iterable<number | undefined>): CostSum {
  let total = EMPTY_COST_SUM;
  for (const cost of costs) total = addCost(total, cost);
  return total;
}
