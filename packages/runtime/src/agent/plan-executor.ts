/**
 * plan-executor.ts: which executor runs a supplied `Plan`, and how the plan
 * reaches it (spec 2026-11-16-planning-unification.md, phase 3).
 *
 * One plan artifact, pluggable executors:
 *
 *  - a FREE plan (titles, status, optional tool hints) runs in the ReAct loop
 *    with the plan seeded as the advisory checklist (`plan-facade.ts`, as ever);
 *  - a RICH plan (any step with `dependsOn` or `args`: an executable DAG) runs
 *    in `blueprint` (0-LLM DAG worker) unless the caller asks for
 *    `plan-execute-reflect`;
 *  - an explicit `strategy` ("blueprint" | "plan-execute-reflect") always wins,
 *    and an agent whose strategy setting already is one of those two adopts the
 *    plan in it.
 *
 * Everything here is pure; the engine reads {@link executorStrategy} in
 * strategy-select and {@link adoptedPlan} where it builds the reasoning request.
 * The carrier rides `task.metadata.context.planExec`.
 */
import { Either, Schema } from "effect";
import { PlanSchema, findPlanDependencyProblem, isPlanEmpty, type Plan, type Task } from "@reactive-agents/core";
import { PlanInvalidError } from "../errors/plan-invalid-error.js";

/** The strategies that adopt a supplied plan instead of planning. */
export type PlanExecutorStrategy = "blueprint" | "plan-execute-reflect";

/** A plan handed to a run, with the executor the caller asked for (absent: decided by richness and the strategy setting). */
export interface PlanExecution {
  readonly plan: Plan;
  readonly strategy?: PlanExecutorStrategy;
}

/** Options-bag mixin: the run executes a supplied plan in a strategy (set by `agent.execute`, `run(input, { plan })`). */
export interface PlanExecOption {
  readonly planExec?: PlanExecution;
}

/** Options-bag mixin: pick the executor of `agent.execute(plan, { strategy })`. */
export interface PlanStrategyOption {
  /** `"blueprint"` runs the plan as a 0-LLM DAG; `"plan-execute-reflect"` runs each step in a sub-kernel. Absent: chosen by the plan's richness. */
  readonly strategy?: PlanExecutorStrategy;
}

/** Key under `task.metadata.context` that carries the supplied plan into the engine. */
export const PLAN_EXEC_CONTEXT_KEY = "planExec";

/** True for the two strategies that adopt a supplied plan. */
export const isPlanExecutorStrategy = (s: unknown): s is PlanExecutorStrategy => s === "blueprint" || s === "plan-execute-reflect";

/** A rich plan has an executable DAG: some step carries `dependsOn` or `args`. A tool hint alone is advisory. Pure. */
export const isRichPlan = (plan: Pick<Plan, "steps">): boolean =>
  plan.steps.some((s) => (s.dependsOn !== undefined && s.dependsOn.length > 0) || s.args !== undefined);

/**
 * Validate a supplied plan at the boundary: it must decode as a `Plan` and its
 * `dependsOn` graph must be sound. Returns the typed error, or `undefined` when
 * the plan can run. An empty plan is valid (it runs as a plain run). Pure.
 */
export function invalidPlan(plan: unknown): PlanInvalidError | undefined {
  const decoded = Schema.decodeUnknownEither(PlanSchema)(plan);
  if (Either.isLeft(decoded)) return new PlanInvalidError({ reason: "it is not a valid Plan (id, goal, steps, createdAt and source are required; each step needs id, title and status)." });
  const problem = findPlanDependencyProblem(decoded.right);
  return problem === undefined ? undefined : new PlanInvalidError({ reason: problem });
}

/** Spread-ready forwarder of the options' supplied plan (`{}` when absent: bytes identical). */
export const planExecCarry = (o: PlanExecOption | undefined): PlanExecOption => (o?.planExec !== undefined ? { planExec: o.planExec } : {});

/** Spread into `task.metadata.context`: the supplied plan under {@link PLAN_EXEC_CONTEXT_KEY}, or nothing. */
export const planExecContext = (o: PlanExecOption | undefined): Record<string, unknown> =>
  o?.planExec !== undefined && !isPlanEmpty(o.planExec.plan) ? { [PLAN_EXEC_CONTEXT_KEY]: o.planExec } : {};

/** Read the supplied plan back off a task. Undefined when absent or empty. */
export function readPlanExec(task: Pick<Task, "metadata">): PlanExecution | undefined {
  const raw: unknown = task.metadata?.context?.[PLAN_EXEC_CONTEXT_KEY];
  if (typeof raw !== "object" || raw === null) return undefined;
  const decoded = Schema.decodeUnknownEither(PlanSchema)((raw as { plan?: unknown }).plan);
  if (Either.isLeft(decoded) || isPlanEmpty(decoded.right)) return undefined;
  const strategy = (raw as { strategy?: unknown }).strategy;
  return { plan: decoded.right, ...(isPlanExecutorStrategy(strategy) ? { strategy } : {}) };
}

/**
 * The strategy a supplied plan runs in, given the strategy the run would
 * otherwise use. Undefined means the loop executor (the seeded checklist, as
 * today). Pure.
 *
 *   explicit strategy            -> that strategy
 *   selected blueprint / per     -> that strategy (it adopts the plan)
 *   rich plan                    -> blueprint
 *   otherwise                    -> undefined (loop)
 */
export function executorStrategy(exec: PlanExecution | undefined, selected: string | undefined): PlanExecutorStrategy | undefined {
  if (exec === undefined) return undefined;
  if (exec.strategy !== undefined) return exec.strategy;
  if (isPlanExecutorStrategy(selected)) return selected;
  return isRichPlan(exec.plan) ? "blueprint" : undefined;
}

/** The plan to forward to `ReasoningService.execute` for the run's selected strategy: the supplied plan when that strategy adopts it, else undefined. Pure. */
export const adoptedPlan = (exec: PlanExecution | undefined, selected: string | undefined): Plan | undefined =>
  executorStrategy(exec, selected) === selected && isPlanExecutorStrategy(selected) ? exec?.plan : undefined;

/** What `result.metadata.extensions` may carry from a plan-owning strategy. */
export interface PlanResultLike {
  readonly metadata?: { readonly extensions?: Readonly<Record<string, unknown>> };
}

/** The run's final plan (core shape, each step's final status) from `result.metadata.extensions.plan`, when a strategy set it. */
export function planFromExtensions(result: PlanResultLike): Plan | undefined {
  const raw = result.metadata?.extensions?.["plan"];
  if (raw === undefined) return undefined;
  const decoded = Schema.decodeUnknownEither(PlanSchema)(raw);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

/**
 * The plan to report after a strategy run. The strategy's own final plan is
 * authoritative (it knows what its executor did); the checklist watch adds
 * information only where the strategy left a step open (`pending`) that the
 * checklist shows moved on. The plan keeps the caller's identity, goal, time,
 * source and findings; a step the user marked skipped stays skipped.
 */
export function mergeFinalPlan(final: Plan, watched: Plan, supplied: Plan): Plan {
  const seen = new Map(watched.steps.map((s) => [s.id, s.status] as const));
  const skipped = new Set(supplied.steps.filter((s) => s.status === "skipped").map((s) => s.id));
  const steps = final.steps.map((s) => {
    const via = seen.get(s.id);
    const status = s.status === "pending" && via !== undefined && via !== "pending" ? via : s.status;
    return status === "done" && skipped.has(s.id) ? { ...s, status: "skipped" as const } : status === s.status ? s : { ...s, status };
  });
  return {
    ...final,
    steps,
    id: supplied.id,
    goal: supplied.goal,
    createdAt: supplied.createdAt,
    source: supplied.source,
    ...(supplied.findings !== undefined && supplied.findings.length > 0 ? { findings: supplied.findings } : {}),
  };
}
