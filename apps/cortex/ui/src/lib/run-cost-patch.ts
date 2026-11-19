/**
 * A live store's run-cost fields after one event, by ui-core `foldRunCost`
 * (the rule the server stores): calls add to a provisional sum, an unpriced
 * call or `AgentCompleted.costComplete: false` marks it partial, and
 * `RunCostFinalized` sets the run's billed total and its completeness.
 */
import { foldRunCost } from "@reactive-agents/ui-core";

/** Events that can change a run's cost. */
const RUN_COST_EVENTS: ReadonlySet<string> = new Set(["LLMRequestCompleted", "AgentCompleted", "RunCostFinalized"]);

/** A store's cost fields: `costComplete` is `false` when `cost` is a lower bound, else absent. */
export interface RunCostFields {
  readonly cost: number;
  readonly costComplete: false | undefined;
}

/** The cost fields after `type`, or `undefined` when the event carries no cost. */
export function runCostPatch(
  prev: { readonly cost?: number; readonly costComplete?: boolean },
  type: string,
  payload: Readonly<Record<string, unknown>>,
): RunCostFields | undefined {
  if (!RUN_COST_EVENTS.has(type)) return undefined;
  const next = foldRunCost({ usd: prev.cost ?? 0, complete: prev.costComplete !== false }, type, payload);
  return { cost: next.usd, costComplete: next.complete ? undefined : false };
}
