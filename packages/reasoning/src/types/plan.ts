// File: src/types/plan.ts
import { Schema } from "effect";

// ─── Short ID Generator ───

export const shortId = (): string =>
  `p_${Math.random().toString(36).slice(2, 8).padEnd(4, "0").slice(0, 4)}`;

// ─── LLM Plan Step (content-only, from LLM output) ───

export const LLMPlanStepSchema = Schema.Struct({
  title: Schema.String,
  instruction: Schema.String,
  type: Schema.Literal("tool_call", "analysis", "composite"),
  toolName: Schema.optional(Schema.String),
  toolArgs: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  toolHints: Schema.optional(Schema.Array(Schema.String)),
  dependsOn: Schema.optional(Schema.Array(Schema.String)),
});
export type LLMPlanStep = typeof LLMPlanStepSchema.Type;

// ─── LLM Plan Output (top-level LLM response) ───

export const LLMPlanOutputSchema = Schema.Struct({
  steps: Schema.Array(LLMPlanStepSchema),
});
export type LLMPlanOutput = typeof LLMPlanOutputSchema.Type;

// ─── Plan Step Status ───

export const PlanStepStatusSchema = Schema.Literal(
  "pending",
  "in_progress",
  "completed",
  "failed",
  "skipped",
);
export type PlanStepStatus = typeof PlanStepStatusSchema.Type;

// ─── Plan Status ───

export const PlanStatusSchema = Schema.Literal(
  "active",
  "completed",
  "failed",
  "abandoned",
);
export type PlanStatus = typeof PlanStatusSchema.Type;

// ─── Plan Step (hydrated with metadata) ───

export interface PlanStep {
  id: string;
  seq: number;
  title: string;
  instruction: string;
  type: "tool_call" | "analysis" | "composite";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolHints?: string[];
  dependsOn?: string[];
  status: PlanStepStatus;
  result?: string;
  error?: string;
  retries: number;
  tokensUsed: number;
  startedAt?: string;
  completedAt?: string;
}

// ─── Plan ───

export interface Plan {
  id: string;
  taskId: string;
  agentId: string;
  goal: string;
  mode: "linear" | "dag";
  steps: PlanStep[];
  status: PlanStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  totalTokens: number;
  totalCost: number;
}

// ─── Plan Context (input for hydration) ───

export interface PlanContext {
  taskId: string;
  agentId: string;
  goal: string;
  planMode: "linear" | "dag";
}

// ─── Hydrate Plan ───

export const hydratePlan = (raw: LLMPlanOutput, context: PlanContext): Plan => {
  const now = new Date().toISOString();
  const steps: PlanStep[] = raw.steps.map((step, index) => ({
    id: `s${index + 1}`,
    seq: index + 1,
    title: step.title,
    instruction: step.instruction,
    type: step.type,
    toolName: step.toolName,
    toolArgs: step.toolArgs,
    toolHints: step.toolHints,
    dependsOn: step.dependsOn,
    status: "pending" as PlanStepStatus,
    retries: 0,
    tokensUsed: 0,
  }));

  return {
    id: shortId(),
    taskId: context.taskId,
    agentId: context.agentId,
    goal: context.goal,
    mode: context.planMode,
    steps,
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now,
    totalTokens: 0,
    totalCost: 0,
  };
};

// ─── Resolve Step References ───

export const resolveStepReferences = (
  args: Record<string, unknown>,
  completedSteps: PlanStep[],
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      result[key] = value.replace(
        /\{\{from_step:(s\d+)(?::summary)?\}\}/g,
        (match, stepId, _offset, _full) => {
          const isSummary = match.includes(":summary}}");
          const step = completedSteps.find((s) => s.id === stepId);
          if (!step || step.result === undefined) return match;
          if (isSummary) return step.result.slice(0, 500);
          return step.result;
        },
      );
    } else {
      result[key] = value;
    }
  }
  return result;
};
