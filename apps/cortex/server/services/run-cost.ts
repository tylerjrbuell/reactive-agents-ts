/**
 * A run's stored USD cost. The rule is ui-core `foldRunCost` (shared with the
 * UI's live run total): the framework's `RunCostFinalized` event (published once
 * per run, after the background debrief call settles) is the run's billed total
 * and sets it; until it arrives the stored figure is the provisional sum of the
 * calls seen so far (an unpriced call adds nothing and marks it partial). The
 * rebuild (`recomputeRunStats`) folds it directly; live ingest applies the same
 * rule as `updateRunStats` fields through {@link runCostPatchOf}.
 *
 * Runs stored before `RunCostFinalized` existed have no such event; a rebuild
 * of one keeps the rule they were stored under ({@link foldLegacyRunCost}).
 */
import { finalRunCostOf, foldRunCost, llmCallCostOf, type CostTotal } from "@reactive-agents/ui-core";

const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** `updateRunStats` cost fields for one event. */
export interface RunCostPatch {
  /** Additive: a priced call's USD cost (provisional until the final total). */
  readonly cost?: number;
  /** The run's final billed total (`RunCostFinalized`): sets cost_usd and cost_complete. */
  readonly costFinal?: CostTotal;
  /** A call had no known price, or the framework said the run is incomplete: cost_usd is a lower bound. */
  readonly costIncomplete?: true;
}

/**
 * The `updateRunStats` cost fields for one event (the ui-core `foldRunCost`
 * rule as SQL patches); `{}` when the event carries no cost.
 */
export function runCostPatchOf(type: string, payload: Readonly<Record<string, unknown>>): RunCostPatch {
  if (type === "LLMRequestCompleted") {
    const cost = llmCallCostOf(payload);
    return cost === undefined ? { costIncomplete: true } : { cost };
  }
  if (type === "RunCostFinalized") {
    const final = finalRunCostOf(payload);
    return final === undefined ? {} : { costFinal: final };
  }
  if (type === "AgentCompleted" && payload["costComplete"] === false) return { costIncomplete: true };
  return {};
}

/**
 * The rule runs were stored under before `RunCostFinalized`: `foldRunCost`, plus
 * `AgentCompleted.totalCostUsd` raising a smaller per-call sum (it excludes the
 * debrief call, so it was only ever a floor). Only `recomputeRunStats` uses it,
 * for a run with no `RunCostFinalized` event.
 */
export function foldLegacyRunCost(total: CostTotal, type: string, payload: Readonly<Record<string, unknown>>): CostTotal {
  const next = foldRunCost(total, type, payload);
  if (type !== "AgentCompleted") return next;
  const meter = finite(payload["totalCostUsd"]);
  return meter !== undefined && meter > next.usd ? { usd: meter, complete: next.complete } : next;
}
