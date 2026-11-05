/**
 * Deterministic plan-enforcement helpers for the plan-execute strategy.
 *
 * Extracted from `executePlanExecute` (pure, no Effect/LLM): they repair a
 * freshly generated plan so classifier- and caller-declared tool requirements
 * are guaranteed to appear as `tool_call` steps. All three mutate
 * `plan.steps` in place (the plan object is owned by the caller's loop).
 */
import type { Plan, PlanStep } from "../../types/plan.js";
import type { ToolSchema } from "../../kernel/capabilities/attend/tool-formatting.js";
import { fromStepRe } from "../../assembly/ref-grammar.js";

/** `tool_call` steps whose `rationale.why` is absent or blank. */
export const stepsMissingRationale = (p: Plan): readonly PlanStep[] =>
  p.steps.filter(
    (s) =>
      s.type === "tool_call" &&
      (!s.rationale || typeof s.rationale.why !== "string" || s.rationale.why.trim().length === 0),
  );

/**
 * Append a synthetic `tool_call` step for each required tool no step plans.
 * `file-write` steps get smart defaults: a path parsed from the task text
 * (falling back to `./output.md`) and the previous step's output as content.
 */
export const injectMissingRequiredToolSteps = (
  plan: Plan,
  requiredTools: readonly string[],
  taskText: string,
): void => {
  if (requiredTools.length === 0) return;
  const plannedTools = new Set(
    plan.steps.filter((s) => s.type === "tool_call" && s.toolName).map((s) => s.toolName!),
  );
  const missingTools = requiredTools.filter((t) => !plannedTools.has(t));
  if (missingTools.length === 0) return;

  const lastStep = plan.steps[plan.steps.length - 1];
  for (const tool of missingTools) {
    const stepNum = plan.steps.length + 1;
    let toolArgs: Record<string, unknown> = {};
    let instruction = `Call ${tool} to complete the task. Use the results from previous steps as needed.`;

    if (tool === "file-write" || tool === "file-operations/write") {
      const pathMatch = taskText.match(
        /(?:write\s+(?:it\s+)?to|save\s+(?:it\s+)?to|output\s+to)\s+([.\w\-\/]+\.\w+)/i,
      );
      const filePath = pathMatch?.[1] ?? "./output.md";
      toolArgs = {
        path: filePath,
        content: lastStep ? `{{from_step:${lastStep.id}}}` : "",
      };
      instruction = `Write the report/results from the previous step to ${filePath}.`;
    }

    plan.steps.push({
      id: `s${stepNum}`,
      seq: stepNum,
      title: `Execute ${tool}`,
      instruction,
      type: "tool_call",
      toolName: tool,
      toolArgs,
      dependsOn: lastStep ? [lastStep.id] : [],
      status: "pending",
      retries: 0,
      tokensUsed: 0,
    });
  }
};

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);

/** Render a known argument for a step instruction; `{{from_step:sN}}` becomes "the result of step sN". */
const describeKnownArg = (value: unknown): string => {
  if (typeof value !== "string") return JSON.stringify(value);
  const refs = [...value.matchAll(fromStepRe())].map((m) => m[1]!);
  return refs.length > 0 ? `the result of step ${refs.join(", ")}` : JSON.stringify(value);
};

/**
 * Turn each `tool_call` step that lacks a required argument (per the tool's
 * schema) into a `composite` step scoped to that tool. A direct dispatch of
 * such a step can only fail on the missing argument, and the steps that
 * depend on it then run on nothing. As a composite step, one ReAct pass calls
 * the tool and fills the argument from the goal and prior results. Known
 * arguments move into the instruction and their step references into
 * `dependsOn`. Steps for tools with no schema are left alone.
 */
export const routeUnderspecifiedToolSteps = (plan: Plan, schemas: readonly ToolSchema[]): void => {
  const byName = new Map(schemas.map((s) => [s.name, s]));
  plan.steps = plan.steps.map((step) => {
    if (step.type !== "tool_call" || step.toolName === undefined) return step;
    const schema = byName.get(step.toolName);
    if (schema === undefined) return step;
    const args = step.toolArgs ?? {};
    const missing = schema.parameters.filter((p) => p.required === true && isBlank(args[p.name])).map((p) => p.name);
    if (missing.length === 0) return step;
    const known = Object.entries(args).filter(([, v]) => !isBlank(v));
    const refIds = known.flatMap(([, v]) =>
      typeof v === "string" ? [...v.matchAll(fromStepRe())].map((m) => m[1]!) : [],
    );
    const knownText =
      known.length > 0 ? ` Known arguments: ${known.map(([k, v]) => `${k} = ${describeKnownArg(v)}`).join("; ")}.` : "";
    const { toolArgs: _dropped, ...rest } = step;
    return {
      ...rest,
      type: "composite",
      toolHints: [step.toolName],
      instruction: `${step.instruction} Call ${step.toolName}; supply ${missing.join(", ")} from the goal.${knownText}`,
      dependsOn: [...new Set([...(step.dependsOn ?? []), ...refIds])],
    };
  });
};

/**
 * Pad the plan with synthetic `tool_call` steps so each tool in `quantities`
 * appears at least its required number of times.
 */
export const injectQuantityDeficitSteps = (
  plan: Plan,
  quantities: Readonly<Record<string, number>>,
): void => {
  for (const [toolName, requiredCount] of Object.entries(quantities)) {
    const existingCount = plan.steps.filter(
      (s) => s.type === "tool_call" && s.toolName === toolName,
    ).length;
    const deficit = requiredCount - existingCount;
    for (let i = 0; i < deficit; i++) {
      const stepNum = plan.steps.length + 1;
      plan.steps.push({
        id: `s${stepNum}`,
        seq: stepNum,
        title: `${toolName} (additional #${existingCount + i + 1})`,
        instruction: `Call ${toolName} to fetch additional data needed for the goal. The classifier determined this tool should be called at least ${requiredCount} times to cover all entities.`,
        type: "tool_call",
        toolName,
        toolArgs: {},
        dependsOn: [],
        status: "pending",
        retries: 0,
        tokensUsed: 0,
      });
    }
  }
};
