/**
 * Deterministic plan-enforcement helpers for the plan-execute strategy.
 *
 * Extracted from `executePlanExecute` (pure, no Effect/LLM): they repair a
 * freshly generated plan so classifier- and caller-declared tool requirements
 * are guaranteed to appear as `tool_call` steps. All three mutate
 * `plan.steps` in place (the plan object is owned by the caller's loop).
 * `repairGeneratedPlan` runs the ref normalization (planning/plan-refs.ts), the
 * fan-out split (planning/fanout-split.ts) and then all three, in order; it is
 * an Effect only for their guard events.
 */
import { Effect } from "effect";
import type { Plan, PlanStep } from "../../types/plan.js";
import type { ToolSchema } from "../../kernel/capabilities/attend/tool-formatting.js";
import { plansToolCall, routeUnderspecifiedToolSteps } from "../../kernel/policy/plan-args.js";
import { applyFanOutSplit } from "../planning/fanout-split.js";
import { applyPlanRefNormalization } from "../planning/plan-refs.js";

/** The plan-execute input fields the repair reads. */
export interface PlanRepairInput {
  readonly requiredTools?: readonly string[];
  readonly taskDescription?: string;
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
  readonly availableToolSchemas?: readonly ToolSchema[];
}

/**
 * Deterministic repair of a freshly generated plan, in place: rewrite keyed
 * from_step refs to the grammar (planning/plan-refs.ts), split fan-out
 * producers (one copy per target file), add a step for each unplanned required
 * tool, pad tool quantities, and run underspecified tool_call steps as composites.
 */
export const repairGeneratedPlan = (plan: Plan, input: PlanRepairInput, taskId: string): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    yield* applyPlanRefNormalization(plan, taskId);
    yield* applyFanOutSplit(plan, taskId);
    injectMissingRequiredToolSteps(plan, input.requiredTools ?? [], input.taskDescription ?? "");
    injectQuantityDeficitSteps(plan, input.requiredToolQuantities ?? {});
    routeUnderspecifiedToolSteps(plan, input.availableToolSchemas ?? []);
  });

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
    plan.steps.filter(plansToolCall).map((s) => s.toolName!),
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

// A tool_call step missing a required argument runs as a composite step: the one
// home for this repair is policy/plan-args.ts (it also defers ungrounded dates).
export { routeUnderspecifiedToolSteps };

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
      (s) => plansToolCall(s) && s.toolName === toolName,
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
