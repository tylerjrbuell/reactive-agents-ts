/**
 * The Execute strategy picker on the plan card. Which executor runs a plan is the framework's
 * (`agent.execute(plan, { strategy })`: `blueprint` runs the plan as a DAG without a model,
 * `plan-execute-reflect` runs each step in its own loop; named nothing, the framework chooses by
 * how rich the plan is). This only holds the choice and says, in words, what each does. Pure.
 */
import type { SelectOption } from "./select.js";
import { hasExtras, type ExtrasMap } from "./plan-extras.js";

/** The choice in the picker. */
export type PlanStrategyChoice = "auto" | "blueprint" | "plan-execute-reflect";

/** The executors the server accepts (the framework's `PlanExecutorStrategy`). */
export type PlanExecutorName = "blueprint" | "plan-execute-reflect";

/** Options for the picker's `Select`. */
export const PLAN_STRATEGY_OPTIONS: readonly SelectOption[] = [
  { value: "auto", label: "Auto", description: "The framework chooses by the plan" },
  { value: "blueprint", label: "Blueprint", description: "Run the steps as a dependency graph, no model" },
  { value: "plan-execute-reflect", label: "Plan-execute-reflect", description: "Run each step in its own loop, then reflect" },
];

/** The executor to name, or `undefined` for Auto (the field is then left out of the call). */
export const executorOf = (choice: PlanStrategyChoice): PlanExecutorName | undefined => (choice === "auto" ? undefined : choice);

/** Read a picker value; anything unknown is Auto. */
export const choiceOfValue = (value: string): PlanStrategyChoice => (value === "blueprint" || value === "plan-execute-reflect" ? value : "auto");

/**
 * Whether Execute goes through the framework's plan executor. A named strategy always does; Auto
 * does when a step carries `dependsOn` or `args` (an executable graph the framework routes). A plain
 * checklist on Auto runs as the usual streamed Execute turn.
 */
export const usesPlanExecutor = (choice: PlanStrategyChoice, extras: ExtrasMap): boolean => choice !== "auto" || hasExtras(extras);

/** One line under the picker: what Execute will do. */
export function strategyNote(choice: PlanStrategyChoice, extras: ExtrasMap): string {
  if (choice === "blueprint") return "Runs the steps as a dependency graph with no model.";
  if (choice === "plan-execute-reflect") return "Runs each step in its own loop, then reflects on the result.";
  return hasExtras(extras) ? "Steps carry dependencies or args, so the framework picks the executor." : "A plain checklist runs as the usual Execute turn.";
}
