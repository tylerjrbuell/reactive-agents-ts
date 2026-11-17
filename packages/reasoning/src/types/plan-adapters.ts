// File: src/types/plan-adapters.ts
//
// Pure adapters between the core `Plan` (the portable, user-editable plan) and
// the strategy `Plan` (the executor's working plan). Adapters instead of a
// rename: the strategy shape carries executor extras (seq, instruction, type,
// retries, tokens) that core must not know. ONE mapping table below.
//
//   core PlanStep        strategy PlanStep
//   id                   id
//   title                title, instruction (= title)
//   tool                 toolName            (type = tool ? "tool_call" : "analysis")
//   args                 toolArgs
//   dependsOn            dependsOn
//   status "done"        "completed"
//   status "in-progress" "in_progress"
//   status "pending"     "pending"
//   status "skipped"     "skipped"           ("failed" -> "skipped" on the way out)
//   (index)              seq (index + 1)
import type {
  Plan as CorePlan,
  PlanStep as CorePlanStep,
  PlanStepStatus as CorePlanStepStatus,
} from "@reactive-agents/core";
import { shortId } from "./plan.js";
import type { Plan, PlanContext, PlanStep, PlanStepStatus } from "./plan.js";

const STATUS_IN: Readonly<Record<CorePlanStepStatus, PlanStepStatus>> = {
  pending: "pending",
  "in-progress": "in_progress",
  done: "completed",
  skipped: "skipped",
};

const STATUS_OUT: Readonly<Record<PlanStepStatus, CorePlanStepStatus>> = {
  pending: "pending",
  in_progress: "in-progress",
  completed: "done",
  failed: "skipped",
  skipped: "skipped",
};

/** True for a core plan (has `source`), false for a strategy plan (has `mode`). */
export const isCorePlan = (plan: CorePlan | Plan): plan is CorePlan => "source" in plan;

/**
 * Core plan to strategy plan. Pure; does not validate (see `adoptInputPlan` in
 * `strategies/planning/input-plan.ts`). `instruction` = title; step `type` is
 * `tool_call` when the step names a tool, else `analysis`; `seq` is the index.
 */
export const fromCorePlan = (core: CorePlan, ctx: PlanContext): Plan => {
  const iso = new Date(core.createdAt).toISOString();
  const steps: PlanStep[] = core.steps.map((s, i) => ({
    id: s.id,
    seq: i + 1,
    title: s.title,
    instruction: s.title,
    type: s.tool !== undefined ? "tool_call" : "analysis",
    ...(s.tool !== undefined ? { toolName: s.tool } : {}),
    ...(s.args !== undefined ? { toolArgs: s.args } : {}),
    ...(s.dependsOn !== undefined ? { dependsOn: s.dependsOn } : {}),
    status: STATUS_IN[s.status],
    retries: 0,
    tokensUsed: 0,
  }));
  return {
    id: core.id || shortId(),
    taskId: ctx.taskId,
    agentId: ctx.agentId,
    goal: ctx.goal || core.goal,
    mode: ctx.planMode,
    steps,
    status: "active",
    version: 1,
    createdAt: iso,
    updatedAt: iso,
    totalTokens: 0,
    totalCost: 0,
  };
};

/**
 * Strategy plan to core plan. Pure. `failed` steps become `skipped` (core has
 * no failed state); executor extras (seq, instruction, type, retries, tokens,
 * results) are dropped.
 */
export const toCorePlan = (plan: Plan): CorePlan => {
  const created = Date.parse(plan.createdAt);
  return {
    id: plan.id,
    goal: plan.goal,
    steps: plan.steps.map((s): CorePlanStep => ({
      id: s.id,
      title: s.title,
      status: STATUS_OUT[s.status],
      ...(s.toolName !== undefined ? { tool: s.toolName } : {}),
      ...(s.dependsOn !== undefined && s.dependsOn.length > 0 ? { dependsOn: s.dependsOn } : {}),
      ...(s.toolArgs !== undefined ? { args: s.toolArgs } : {}),
    })),
    createdAt: Number.isNaN(created) ? 0 : created,
    source: "model",
  };
};
