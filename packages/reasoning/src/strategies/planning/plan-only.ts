// File: src/strategies/planning/plan-only.ts
//
// Plan-only mode: a strategy that owns a plan (blueprint, plan-execute-reflect)
// stops once the plan is made and returns it unrun. One terminal for both, so
// neither strategy carries its own copy.
import type { Plan } from "../../types/plan.js";
import type { RunContract } from "../../kernel/contract/run-contract.js";
import type { StrategyEnd } from "../substrate/strategy-run.js";
import { finalCorePlan, type InputPlan } from "./input-plan.js";

/** Strategies that can run plan-only: the two that own a planner, and adaptive, which routes to one of them. */
export const canPlanOnly = (strategy: string): boolean =>
  strategy === "blueprint" || strategy === "rewoo" || strategy === "plan-execute-reflect" || strategy === "adaptive";

/**
 * The terminal of a plan-only run: no output, status `partial` (the task was not
 * done; the plan is the product), outcome `PlanOnly` (`metadata.planOnly === true`,
 * `rawTerminatedBy: "plan-only"`), and the plan in
 * `metadata.extensions.plan` (core shape, every step still `pending`).
 *
 * It deliberately carries no `plan` steps: the plan-incomplete rule judges a
 * plan the run set out to execute, and a plan-only run never does. `warning`
 * names a plan defect worth showing (blueprint's verify found the plan invalid).
 */
export const planOnlyEnd = (p: {
  readonly plan: Plan;
  readonly supplied: InputPlan | undefined;
  readonly runContract: RunContract;
  readonly warning?: string;
}): Extract<StrategyEnd, { readonly _tag: "Result" }> => ({
  _tag: "Result",
  output: null,
  status: "partial",
  outcome: { _tag: "PlanOnly", ...(p.warning !== undefined ? { warning: p.warning } : {}) },
  delivery: { runContract: p.runContract },
  corePlan: finalCorePlan(p.plan, p.supplied),
});
