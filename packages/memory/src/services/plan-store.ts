import { Effect, Context, Layer } from "effect";
import { DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Local Types (avoid circular dep on @reactive-agents/reasoning) ───

export interface PlanStep {
  id: string;
  seq: number;
  title: string;
  instruction: string;
  type: "tool_call" | "analysis" | "composite";
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolHints?: string[];
  dependsOn?: string[];
  result?: string;
  error?: string;
  retries: number;
  tokensUsed: number;
  startedAt?: string;
  completedAt?: string;
}

export interface Plan {
  id: string;
  taskId: string;
  agentId: string;
  goal: string;
  mode: "linear" | "dag";
  steps: PlanStep[];
  status: "active" | "completed" | "failed" | "abandoned";
  version: number;
  createdAt: string;
  updatedAt: string;
  totalTokens: number;
  totalCost: number;
}

// ─── Service Tag ───

export class PlanStoreService extends Context.Tag("PlanStoreService")<
  PlanStoreService,
  {
    /** Save a plan with all its steps. */
    readonly savePlan: (plan: Plan) => Effect.Effect<void, DatabaseError>;

    /** Get a plan by ID, including all steps. */
    readonly getPlan: (
      id: string,
    ) => Effect.Effect<Plan | null, DatabaseError>;

    /** Get the active plan for a given agent and task. */
    readonly getActivePlan: (
      agentId: string,
      taskId: string,
    ) => Effect.Effect<Plan | null, DatabaseError>;

    /** Update the status of a single step. */
    readonly updateStepStatus: (
      stepId: string,
      update: {
        status: string;
        result?: string;
        error?: string;
        tokensUsed?: number;
      },
    ) => Effect.Effect<void, DatabaseError>;

    /** Replace remaining steps from a given seq onward. */
    readonly patchRemainingSteps: (
      planId: string,
      fromSeq: number,
      newSteps: PlanStep[],
    ) => Effect.Effect<void, DatabaseError>;

    /** Get recent plans for an agent, ordered by creation date descending. */
    readonly getRecentPlans: (
      agentId: string,
      limit: number,
    ) => Effect.Effect<Plan[], DatabaseError>;
  }
>() {}

// ─── Helpers ───

const rowToPlan = (
  r: Record<string, unknown>,
  steps: PlanStep[],
): Plan => ({
  id: r.id as string,
  taskId: r.task_id as string,
  agentId: r.agent_id as string,
  goal: r.goal as string,
  mode: r.mode as Plan["mode"],
  status: r.status as Plan["status"],
  version: r.version as number,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  totalTokens: (r.total_tokens as number) ?? 0,
  totalCost: (r.total_cost as number) ?? 0,
  steps,
});

const rowToStep = (r: Record<string, unknown>): PlanStep => ({
  id: r.id as string,
  seq: r.seq as number,
  title: r.title as string,
  instruction: r.instruction as string,
  type: r.type as PlanStep["type"],
  status: r.status as PlanStep["status"],
  toolName: (r.tool_name as string | null) ?? undefined,
  toolArgs: r.tool_args ? JSON.parse(r.tool_args as string) : undefined,
  toolHints: r.tool_hints ? JSON.parse(r.tool_hints as string) : undefined,
  dependsOn: r.depends_on ? JSON.parse(r.depends_on as string) : undefined,
  result: (r.result as string | null) ?? undefined,
  error: (r.error as string | null) ?? undefined,
  retries: (r.retries as number) ?? 0,
  tokensUsed: (r.tokens_used as number) ?? 0,
  startedAt: (r.started_at as string | null) ?? undefined,
  completedAt: (r.completed_at as string | null) ?? undefined,
});

// ─── Live Implementation ───

export const PlanStoreServiceLive = Layer.effect(
  PlanStoreService,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    const hydratePlan = (
      planRow: Record<string, unknown>,
    ): Effect.Effect<Plan, DatabaseError> =>
      db
        .query(
          `SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY seq ASC`,
          [planRow.id],
        )
        .pipe(
          Effect.map((stepRows) =>
            rowToPlan(planRow, stepRows.map(rowToStep)),
          ),
        );

    return {
      savePlan: (plan) =>
        Effect.gen(function* () {
          yield* db.exec(
            `INSERT OR REPLACE INTO plans
             (id, task_id, agent_id, goal, mode, status, version, created_at, updated_at, total_tokens, total_cost)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              plan.id,
              plan.taskId,
              plan.agentId,
              plan.goal,
              plan.mode,
              plan.status,
              plan.version,
              plan.createdAt,
              plan.updatedAt,
              plan.totalTokens,
              plan.totalCost,
            ],
          );
          for (const step of plan.steps) {
            yield* db.exec(
              `INSERT OR REPLACE INTO plan_steps
               (id, plan_id, seq, title, instruction, type, status, tool_name, tool_args, tool_hints, depends_on, result, error, retries, tokens_used, started_at, completed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                step.id,
                plan.id,
                step.seq,
                step.title,
                step.instruction,
                step.type,
                step.status,
                step.toolName ?? null,
                step.toolArgs ? JSON.stringify(step.toolArgs) : null,
                step.toolHints ? JSON.stringify(step.toolHints) : null,
                step.dependsOn ? JSON.stringify(step.dependsOn) : null,
                step.result ?? null,
                step.error ?? null,
                step.retries,
                step.tokensUsed,
                step.startedAt ?? null,
                step.completedAt ?? null,
              ],
            );
          }
        }),

      getPlan: (id) =>
        Effect.gen(function* () {
          const rows = yield* db.query(
            `SELECT * FROM plans WHERE id = ?`,
            [id],
          );
          if (rows.length === 0) return null;
          return yield* hydratePlan(rows[0]!);
        }),

      getActivePlan: (agentId, taskId) =>
        Effect.gen(function* () {
          const rows = yield* db.query(
            `SELECT * FROM plans WHERE agent_id = ? AND task_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
            [agentId, taskId],
          );
          if (rows.length === 0) return null;
          return yield* hydratePlan(rows[0]!);
        }),

      updateStepStatus: (stepId, update) =>
        Effect.gen(function* () {
          const sets: string[] = ["status = ?"];
          const params: unknown[] = [update.status];

          if (update.result !== undefined) {
            sets.push("result = ?");
            params.push(update.result);
          }
          if (update.error !== undefined) {
            sets.push("error = ?");
            params.push(update.error);
          }
          if (update.tokensUsed !== undefined) {
            sets.push("tokens_used = ?");
            params.push(update.tokensUsed);
          }

          if (update.status === "completed" || update.status === "failed") {
            sets.push("completed_at = ?");
            params.push(new Date().toISOString());
          }
          if (update.status === "in_progress") {
            sets.push("started_at = ?");
            params.push(new Date().toISOString());
          }

          params.push(stepId);
          yield* db.exec(
            `UPDATE plan_steps SET ${sets.join(", ")} WHERE id = ?`,
            params,
          );
        }),

      patchRemainingSteps: (planId, fromSeq, newSteps) =>
        Effect.gen(function* () {
          // Delete steps with seq > fromSeq (keep completed steps up to and including fromSeq)
          yield* db.exec(
            `DELETE FROM plan_steps WHERE plan_id = ? AND seq > ?`,
            [planId, fromSeq],
          );
          // Insert new steps
          for (const step of newSteps) {
            yield* db.exec(
              `INSERT INTO plan_steps
               (id, plan_id, seq, title, instruction, type, status, tool_name, tool_args, tool_hints, depends_on, result, error, retries, tokens_used, started_at, completed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                step.id,
                planId,
                step.seq,
                step.title,
                step.instruction,
                step.type,
                step.status,
                step.toolName ?? null,
                step.toolArgs ? JSON.stringify(step.toolArgs) : null,
                step.toolHints ? JSON.stringify(step.toolHints) : null,
                step.dependsOn ? JSON.stringify(step.dependsOn) : null,
                step.result ?? null,
                step.error ?? null,
                step.retries,
                step.tokensUsed,
                step.startedAt ?? null,
                step.completedAt ?? null,
              ],
            );
          }
          // Update plan's updated_at and bump version
          yield* db.exec(
            `UPDATE plans SET updated_at = ?, version = version + 1 WHERE id = ?`,
            [new Date().toISOString(), planId],
          );
        }),

      getRecentPlans: (agentId, limit) =>
        Effect.gen(function* () {
          const rows = yield* db.query(
            `SELECT * FROM plans WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`,
            [agentId, limit],
          );
          const plans: Plan[] = [];
          for (const row of rows) {
            plans.push(yield* hydratePlan(row));
          }
          return plans;
        }),
    };
  }),
);
