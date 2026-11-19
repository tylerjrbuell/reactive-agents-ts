// packages/trace/src/run-cost.ts
//
// The one reader of "what did this run cost". The billed total lives on the
// late `run-cost-finalized` record (debrief included); `run-completed` carries
// only the spend known when the result was built. Both can understate the
// spend when a call had no known price, so the reader always returns the
// completeness alongside the number.

import type { TraceEvent } from "./events.js";

/** A run's recorded cost and how far to trust it. */
export interface RunCost {
  /**
   * Known USD spend. A lower bound unless `complete` is `true`. `undefined`
   * when the trace records no cost at all (no `run-completed`, no
   * `run-cost-finalized`).
   */
  readonly totalCostUsd: number | undefined;
  /**
   * `true`: every LLM call was priced. `false`: at least one call had an
   * unknown price, so `totalCostUsd` understates the spend. `undefined`: the
   * trace predates the completeness flag and does not say.
   */
  readonly complete: boolean | undefined;
  /**
   * Which record the total came from. `run-cost-finalized` is the billed run
   * total; `run-completed` excludes the background debrief call.
   */
  readonly source: "run-cost-finalized" | "run-completed" | "none";
}

/**
 * Read a run's cost from its trace events: the last `run-cost-finalized` when
 * present, else the last `run-completed`. Pass one run's events (see
 * `runSegments` for a file that holds several runs under one runId).
 *
 * @param events One run's trace events, in recorded order.
 * @returns The total, its completeness and its source record.
 */
export function runCost(events: readonly TraceEvent[]): RunCost {
  let finalized: Extract<TraceEvent, { kind: "run-cost-finalized" }> | undefined;
  let completed: Extract<TraceEvent, { kind: "run-completed" }> | undefined;
  for (const e of events) {
    if (e.kind === "run-cost-finalized") finalized = e;
    else if (e.kind === "run-completed") completed = e;
  }
  if (finalized !== undefined) {
    return { totalCostUsd: finalized.totalCostUsd, complete: finalized.costComplete, source: "run-cost-finalized" };
  }
  if (completed !== undefined) {
    return { totalCostUsd: completed.totalCostUsd, complete: completed.costComplete, source: "run-completed" };
  }
  return { totalCostUsd: undefined, complete: undefined, source: "none" };
}

/**
 * Render a run cost for a report line: `$0.0123`, `≥$0.0123 (partial: unpriced
 * calls)` when incomplete, `$0.0123 (completeness unknown)` on a pre-flag
 * trace, `unknown` when no cost was recorded.
 *
 * @param cost A {@link RunCost} from {@link runCost}.
 */
export function renderRunCost(cost: RunCost): string {
  if (cost.totalCostUsd === undefined) return "unknown";
  const usd = `$${cost.totalCostUsd.toFixed(4)}`;
  if (cost.complete === false) return `≥${usd} (partial: unpriced calls)`;
  if (cost.complete === undefined) return `${usd} (completeness unknown)`;
  return usd;
}
