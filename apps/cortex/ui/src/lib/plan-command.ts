/** `/plan` argument handling. Pure so the executor and the tests share one parser. */

export type PlanArg =
  | { readonly kind: "show" }
  | { readonly kind: "hide" }
  | { readonly kind: "task"; readonly task: string };

/** `""` and `show` reveal the plan, `hide` hides it, anything else is a task to plan. */
export function parsePlanArg(arg: string): PlanArg {
  const a = arg.trim();
  const word = a.toLowerCase();
  if (a === "" || word === "show") return { kind: "show" };
  if (word === "hide") return { kind: "hide" };
  return { kind: "task", task: a };
}

/** Message `/go` sends to proceed after a plan-posture turn (an execute turn, no wrapper). */
export const GO_MESSAGE = "Go ahead with the plan.";
