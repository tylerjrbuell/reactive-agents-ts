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

/** The planning-mode message: decompose onto the to-do list, then stop for the user's go-ahead. */
export function planPrompt(task: string): string {
  return [
    "Plan first and do not carry out any step yet.",
    "Break the task into concrete steps and record each one on my to-do list with the `todo` tool (action `add`).",
    "Then reply with a short numbered summary of the plan and wait for my go-ahead.",
    "",
    `Task: ${task}`,
  ].join("\n");
}
