import { Schema } from "effect";
import type { ChecklistItemStatus, ChecklistRow, ChecklistSnapshot } from "./checklist.js";

/**
 * Plan: the framework-level plan/execute primitive. A plan IS the advisory
 * checklist: {@link planFromChecklist} and {@link planToChecklistSeed} map
 * between the two without a second store. Steps are titled work items; nothing
 * here assumes a turn is a string (a step title describes work in any modality).
 */

/** Who authored a plan. */
export const PlanSourceSchema = Schema.Literal("model", "harness-derived", "user-edited");
/** Who authored a plan: the model, the harness (derived from state), or a user edit. */
export type PlanSource = typeof PlanSourceSchema.Type;

/** Status of one plan step. */
export const PlanStepStatusSchema = Schema.Literal("pending", "in-progress", "done", "skipped");
/** Status of one plan step. `skipped` = resolved without being done. */
export type PlanStepStatus = typeof PlanStepStatusSchema.Type;

/** One step of a plan. */
export const PlanStepSchema = Schema.Struct({
  /** Stable step id; equals the checklist item id when the plan came from a checklist. */
  id: Schema.String,
  /** One-line description of the work. */
  title: Schema.String,
  /** Name of the tool the step expects to use. Absent when the step names no tool. */
  tool: Schema.optional(Schema.String),
  /** Current status. */
  status: PlanStepStatusSchema,
});
/** One step of a plan. */
export type PlanStep = typeof PlanStepSchema.Type;

/** A plan: a goal and its ordered steps. */
export const PlanSchema = Schema.Struct({
  /** Plan id, stable across edits. */
  id: Schema.String,
  /** What the plan is for. */
  goal: Schema.String,
  /** Ordered steps. An empty plan is representable; see {@link isPlanEmpty}. */
  steps: Schema.Array(PlanStepSchema),
  /** Creation time, ms since epoch. */
  createdAt: Schema.Number,
  /** Who authored the plan. */
  source: PlanSourceSchema,
});
/** A plan: a goal and its ordered steps. */
export type Plan = typeof PlanSchema.Type;

/** True when the plan has no steps. An empty plan is valid data but cannot be executed. */
export const isPlanEmpty = (plan: Pick<Plan, "steps">): boolean => plan.steps.length === 0;

/** Checklist-seed item shape (structurally the runtime `TodoSeedItem`). */
export interface PlanChecklistSeedItem {
  readonly id: string;
  readonly title: string;
  readonly status: ChecklistItemStatus;
  /** Tool hint for the step. Absent when the step names no tool. */
  readonly tool?: string;
}

/** Plan fields a checklist snapshot does not carry. */
export interface PlanFromChecklistMeta {
  readonly id: string;
  readonly goal: string;
  readonly createdAt: number;
  readonly source: PlanSource;
  /** Tool hint per step id. Overrides the row's own `tool`; steps with neither get no `tool`. */
  readonly tools?: Readonly<Record<string, string>>;
}

const stepStatusOfRow = (status: ChecklistRow["status"]): PlanStepStatus =>
  status === "done" ? "done" : status === "in_progress" ? "in-progress" : "pending";

const seedStatusOfStep = (status: PlanStepStatus): ChecklistItemStatus =>
  status === "done" || status === "skipped" ? "completed" : status === "in-progress" ? "in_progress" : "pending";

/**
 * Build a plan from the root group's advisory rows (requirement rows are gate
 * truth, not plan steps). Row `blocked` maps to `pending`. Row order, ids and
 * titles are kept; `tool` comes from `meta.tools`.
 */
export function planFromChecklist(snapshot: ChecklistSnapshot, meta: PlanFromChecklistMeta): Plan {
  const steps = snapshot.root.rows
    .filter((row) => row.kind === "advisory")
    .map((row): PlanStep => {
      const tool = meta.tools?.[row.id] ?? row.tool;
      return { id: row.id, title: row.title, status: stepStatusOfRow(row.status), ...(tool !== undefined ? { tool } : {}) };
    });
  return { id: meta.id, goal: meta.goal, steps, createdAt: meta.createdAt, source: meta.source };
}

/**
 * Project a plan onto checklist seed items (ids, titles, status, tool hint).
 * Lossy by design: `skipped` becomes `completed`.
 */
export function planToChecklistSeed(plan: Plan): PlanChecklistSeedItem[] {
  return plan.steps.map((step) => ({
    id: step.id,
    title: step.title,
    status: seedStatusOfStep(step.status),
    ...(step.tool !== undefined ? { tool: step.tool } : {}),
  }));
}
