/** `/plan` argument handling. Pure so the executor and the tests share one parser. */

export type PlanArg =
  | { readonly kind: "mode" }
  | { readonly kind: "show" }
  | { readonly kind: "hide" }
  | { readonly kind: "task"; readonly task: string };

/**
 * `""` switches the session to Plan mode, `show` / `hide` toggle the to-do dock, anything else
 * is a task: switch to Plan mode and send it as the first plan turn.
 */
export function parsePlanArg(arg: string): PlanArg {
  const a = arg.trim();
  const word = a.toLowerCase();
  if (a === "") return { kind: "mode" };
  if (word === "show") return { kind: "show" };
  if (word === "hide") return { kind: "hide" };
  return { kind: "task", task: a };
}

/** The follow-up turn the plan card's Execute action sends after switching the session to Execute. */
export const EXECUTE_MESSAGE = "Execute the plan.";
