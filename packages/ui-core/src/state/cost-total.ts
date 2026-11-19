/**
 * Honest cost totals for agent UIs. A model call whose price is unknown has
 * no cost (`LLMRequestCompleted.estimatedCost` absent, `priceSource:
 * "unknown"`); it adds nothing to a total and marks the total partial, so an
 * unknown price never reads as free.
 *
 * `addCallCost` follows the same rule as `addCost` in `@reactive-agents/core`
 * (`utils/cost-sum.ts`). ui-core has no runtime dependencies, so browser
 * bundles do not pull in core; keep the two in step.
 */
import { formatCost } from "./format.js";

/** A USD total over model calls. `usd` is a lower bound when `complete` is false. */
export interface CostTotal {
  /** Sum of the known call costs in USD. */
  readonly usd: number;
  /** False when at least one call had no known price. */
  readonly complete: boolean;
}

/** The empty total: $0, complete. */
export const EMPTY_COST_TOTAL: CostTotal = { usd: 0, complete: true };

/**
 * The USD cost of one `LLMRequestCompleted` payload, or `undefined` when the
 * price is unknown: `priceSource: "unknown"`, or `estimatedCost` absent or not
 * a finite number. Payloads from before `priceSource` existed are read by
 * `estimatedCost` alone.
 */
export function llmCallCostOf(payload: Readonly<Record<string, unknown>>): number | undefined {
  if (payload["priceSource"] === "unknown") return undefined;
  const cost = payload["estimatedCost"];
  return typeof cost === "number" && Number.isFinite(cost) ? cost : undefined;
}

/**
 * Add one call's cost to a total. `undefined` (unknown price) adds nothing and
 * marks the total partial.
 */
export function addCallCost(total: CostTotal, cost: number | undefined): CostTotal {
  if (cost === undefined || !Number.isFinite(cost)) return { usd: total.usd, complete: false };
  return { usd: total.usd + cost, complete: total.complete };
}

const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * The run's final billed cost from a `RunCostFinalized` payload (core event,
 * published once per run after the background debrief call settles), or
 * `undefined` when `totalCostUsd` is not a finite number.
 */
export function finalRunCostOf(payload: Readonly<Record<string, unknown>>): CostTotal | undefined {
  const usd = finite(payload["totalCostUsd"]);
  return usd === undefined ? undefined : { usd, complete: payload["costComplete"] !== false };
}

/**
 * Fold one run event into the run's cost total (start from {@link EMPTY_COST_TOTAL}).
 * The one rule a server's stored run total and a UI's live run total share:
 *
 * - `RunCostFinalized` is the run's billed total (debrief call included) and
 *   replaces the running figure, completeness included ({@link finalRunCostOf}).
 * - Until it arrives, the total is the provisional sum of the calls seen so far:
 *   `LLMRequestCompleted` adds its known cost ({@link llmCallCostOf}); an unknown
 *   price adds nothing and marks the total partial.
 * - `AgentCompleted.costComplete === false` marks the provisional total partial.
 *   `AgentCompleted.totalCostUsd` is not read: it excludes the debrief call.
 *
 * Other events return the total unchanged.
 */
export function foldRunCost(total: CostTotal, type: string, payload: Readonly<Record<string, unknown>>): CostTotal {
  if (type === "LLMRequestCompleted") return addCallCost(total, llmCallCostOf(payload));
  if (type === "RunCostFinalized") return finalRunCostOf(payload) ?? total;
  if (type === "AgentCompleted" && payload["costComplete"] === false && total.complete) {
    return { usd: total.usd, complete: false };
  }
  return total;
}

/**
 * Cost text for a total: the amount when complete (ui-core `formatCost`), a
 * lower bound `≥ $0.012` when some calls were unpriced, and `price unknown`
 * when no call had a known price.
 */
export function formatCostTotal(usd: number, complete: boolean): string {
  if (complete) return formatCost(usd);
  return usd > 0 ? `≥ ${formatCost(usd)}` : "price unknown";
}

/** Tooltip text that explains a partial total; empty when the total is complete. */
export function partialCostNote(complete: boolean): string {
  return complete ? "" : "Partial: some model calls had no known price, so the real spend is at least this amount.";
}
