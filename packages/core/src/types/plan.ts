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
  /**
   * Ids of steps that must finish before this one. Absent when the step has no
   * prerequisites. Ids must name other steps of the same plan; portable imports
   * reject unknown ids, self references and cycles (see `findPlanDependencyProblem`).
   */
  dependsOn: Schema.optional(Schema.Array(Schema.String)),
  /**
   * Arguments the step passes to its tool, as a JSON-serializable record. Absent
   * when the step carries none. The values are opaque to core.
   */
  args: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});
/** One step of a plan. */
export type PlanStep = typeof PlanStepSchema.Type;

/**
 * A fact learned during plan recon: the result of a bounded read-only tool call
 * (for example a website id from a list call). Findings travel with the plan and
 * seed execution.
 */
export const PlanFindingSchema = Schema.Struct({
  /** Stable finding id, unique within the plan. */
  id: Schema.String,
  /** Name of the tool that produced the finding. */
  tool: Schema.String,
  /** Short text of what was learned. */
  summary: Schema.String,
  /** When the finding was recorded, ms since epoch. Absent when unknown. */
  at: Schema.optional(Schema.Number),
});
/** A fact learned during plan recon. See {@link PlanFindingSchema}. */
export type PlanFinding = typeof PlanFindingSchema.Type;

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
  /**
   * Facts gathered by plan recon. Absent when the plan ran no recon. Findings
   * alone never make a plan non-empty (see {@link isPlanEmpty}).
   */
  findings: Schema.optional(Schema.Array(PlanFindingSchema)),
});
/** A plan: a goal and its ordered steps. */
export type Plan = typeof PlanSchema.Type;

/** True when the plan has no steps. An empty plan is valid data but cannot be executed. */
export const isPlanEmpty = (plan: Pick<Plan, "steps">): boolean => plan.steps.length === 0;

/**
 * Check a plan's `dependsOn` graph. Returns a human-readable problem (unknown
 * id, self reference or cycle) or `undefined` when the graph is valid.
 */
export function findPlanDependencyProblem(plan: Pick<Plan, "steps">): string | undefined {
  const byId = new Map(plan.steps.map((s) => [s.id, s] as const));
  for (const s of plan.steps) {
    for (const d of s.dependsOn ?? []) {
      if (d === s.id) return `Step "${s.id}" depends on itself.`;
      if (!byId.has(d)) return `Step "${s.id}" depends on unknown step "${d}".`;
    }
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string): string | undefined => {
    const st = state.get(id);
    if (st === "done") return undefined;
    if (st === "visiting") return `Dependency cycle through step "${id}".`;
    state.set(id, "visiting");
    for (const d of byId.get(id)?.dependsOn ?? []) {
      const r = visit(d);
      if (r !== undefined) return r;
    }
    state.set(id, "done");
    return undefined;
  };
  for (const s of plan.steps) {
    const r = visit(s.id);
    if (r !== undefined) return r;
  }
  return undefined;
}

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
  /** Prerequisite step ids per step id. Steps without an entry (or with an empty list) get no `dependsOn`. */
  readonly dependsOn?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Tool arguments per step id. Steps without an entry get no `args`. */
  readonly args?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Recon findings to carry on the plan. Absent or empty = the plan has no `findings`. */
  readonly findings?: ReadonlyArray<PlanFinding>;
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
      const deps = meta.dependsOn?.[row.id];
      const args = meta.args?.[row.id];
      return {
        id: row.id,
        title: row.title,
        status: stepStatusOfRow(row.status),
        ...(tool !== undefined ? { tool } : {}),
        ...(deps !== undefined && deps.length > 0 ? { dependsOn: deps } : {}),
        ...(args !== undefined ? { args } : {}),
      };
    });
  return {
    id: meta.id,
    goal: meta.goal,
    steps,
    createdAt: meta.createdAt,
    source: meta.source,
    ...(meta.findings !== undefined && meta.findings.length > 0 ? { findings: meta.findings } : {}),
  };
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
