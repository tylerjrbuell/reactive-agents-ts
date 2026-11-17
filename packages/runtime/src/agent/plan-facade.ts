/**
 * Plan / execute facade: `agent.plan()`, `agent.execute()` and
 * `agent.run(input, { plan })` (spec 2026-11-16-plan-execute-posture-robustness.md).
 *
 * A plan IS the advisory checklist (core `planFromChecklist` /
 * `planToChecklistSeed`), so nothing here keeps a second store:
 *
 *  - {@link planFacade}   runs the task under plan posture, watches the run's
 *                         checklist on the EventBus and returns the `Plan`
 *                         (the kernel's terminal step guarantees steps or an
 *                         explicit none; none rejects with `PlanNoStepsError`);
 *  - {@link executeFacade} validates the plan at the boundary (`PlanInvalidError`),
 *                         seeds a run from its checklist (the follow-the-list
 *                         guidance rides that seed), hands the plan to the executor
 *                         `plan-executor.ts` picks (loop, blueprint or
 *                         plan-execute-reflect) and reports `result.plan` with
 *                         per-step status, publishing `PlanStepStatusChanged`.
 *
 * Pure parts ({@link toolHintOf}, {@link planFromWatch}, {@link stepChanges},
 * {@link normalizeSteps}) hold the mapping rules; the class shell only delegates.
 */
import { Effect } from "effect";
import {
  EventBus,
  generateTaskId,
  isPlanEmpty,
  planFromChecklist,
  planToChecklistSeed,
  type AgentEvent,
  type Plan,
  type PlanFinding,
  type PlanSource,
  type PlanStep,
  type PlanStepStatusChangedEvent,
  type RunOrigin,
} from "@reactive-agents/core";
import { PlanNoStepsError } from "../errors/plan-no-steps-error.js";
import { taskInputText, type TaskInput } from "./task-input.js";
import type { TodoSeedItem } from "../chat/todo-seed.js";
import type { ChatMessage } from "../chat.js";
import { planSourceOf, watchChecklist, type PlanRuntime, type PlanWatchResult } from "./plan-watch.js";
import { invalidPlan, mergeFinalPlan, planFromExtensions, type PlanExecOption, type PlanExecution, type PlanExecutorStrategy, type PlanResultLike, type PlanStrategyOption } from "./plan-executor.js";

/** What the facade adds to the caller's run options: the task id it watches, the posture, the seed and the supplied plan. */
export interface PlanRunSeed extends PlanExecOption {
  readonly taskId: string;
  readonly posture?: "plan";
  readonly initialTodo?: readonly TodoSeedItem[];
  readonly planFindings?: readonly PlanFinding[];
}

/** Options of `agent.execute(plan, options?)`: the run options plus the executor to run the plan in. */
export type PlanExecuteOptions = PlanRunOptions & PlanStrategyOption;

/** What the facade needs of the agent (the agent passes itself): its runtime, its id and its own `run()`. */
export interface PlanHost<R, O extends object> {
  readonly runtime: PlanRuntime;
  readonly agentId: string;
  readonly run: (input: TaskInput, options: O & PlanRunSeed) => Promise<R>;
}

/** Options shared by `agent.plan()` and `agent.execute()`. */
export interface PlanRunOptions {
  /** Prior conversation, oldest first (same as `run({ history })`). */
  readonly history?: readonly ChatMessage[];
  /** Caller origin recorded on `run-started.origin`. */
  readonly origin?: RunOrigin;
  /**
   * `agent.plan()` only: plan with this strategy's own planner (`"blueprint"`
   * or `"plan-execute-reflect"`) instead of the posture loop. No tool runs;
   * the plan comes from the strategy (every step pending). The strategy is
   * named, not selected (no classify call).
   */
  readonly strategy?: PlanExecutorStrategy;
}

/** Options-bag mixin: `agent.run(input, { plan })` executes seeded from the plan. */
export interface PlanRunOption {
  /** Run seeded from this plan's checklist; the result gains `plan` with per-step status. Absent or empty: a plain run. */
  readonly plan?: Plan;
}

/** Steps accepted by `session.setPlan()`: a title, or a title with an optional tool hint and status. */
export type PlanStepInput = string | { readonly title: string; readonly tool?: string; readonly status?: PlanStep["status"]; readonly id?: string };

const TOOL_HINT = /\btool\s*:\s*`?([A-Za-z0-9_.-]+)`?/i;

/** The tool a step names with a `tool: name` marker, if any. Pure. */
export function toolHintOf(title: string): string | undefined {
  return TOOL_HINT.exec(title)?.[1];
}

/** Tool hints for each step (by id): the plan's own `tool`, else the title's `tool: name` marker. */
const toolsOf = (steps: ReadonlyArray<Pick<PlanStep, "id" | "title" | "tool">>): Record<string, string> =>
  Object.fromEntries(steps.flatMap((s) => { const t = s.tool ?? toolHintOf(s.title); return t === undefined ? [] : [[s.id, t] as const]; }));

/**
 * Build the plan a run left behind. Pure.
 * `fallback` supplies the steps (and tool hints) when the run touched no checklist.
 */
export function planFromWatch(
  watch: PlanWatchResult,
  meta: { readonly id: string; readonly goal: string; readonly createdAt: number; readonly source: PlanSource; readonly findings?: ReadonlyArray<PlanFinding> },
  known: ReadonlyArray<PlanStep> = [],
): Plan {
  if (watch.snapshot === undefined) {
    const { findings, ...rest } = meta;
    return { ...rest, steps: known, ...(findings && findings.length > 0 ? { findings } : {}) };
  }
  const base = planFromChecklist(watch.snapshot, { ...meta, tools: toolsOf(known) });
  // A step titled `tool: x` keeps its hint even when the checklist row is new to `known`.
  const hinted = base.steps.map((s) => (s.tool === undefined && toolHintOf(s.title) !== undefined ? { ...s, tool: toolHintOf(s.title) as string } : s));
  // A step the user marked skipped stays skipped when the run finishes it (the seed maps skipped to completed).
  const skipped = new Set(known.filter((s) => s.status === "skipped").map((s) => s.id));
  return { ...base, steps: hinted.map((s) => (s.status === "done" && skipped.has(s.id) ? { ...s, status: "skipped" as const } : s)) };
}

/** One `PlanStepStatusChanged` per step present in both plans whose status differs. Pure. */
export function stepChanges(
  before: Plan,
  after: Plan,
  stamp: { readonly agentId?: string; readonly taskId?: string; readonly sessionId?: string; readonly timestamp: number },
): readonly PlanStepStatusChangedEvent[] {
  const prior = new Map(before.steps.map((s) => [s.id, s.status] as const));
  return after.steps.flatMap((s): PlanStepStatusChangedEvent[] => {
    const from = prior.get(s.id);
    return from === undefined || from === s.status
      ? []
      : [{ _tag: "PlanStepStatusChanged", planId: after.id, stepId: s.id, from, to: s.status, ...stamp }];
  });
}

/**
 * Normalise caller-supplied steps (titles or step objects) to plan steps with
 * stable ids: an explicit `id` is kept; otherwise the 1-based position
 * (matching the harness-derived checklist ids). Pure.
 */
export function normalizeSteps(steps: readonly PlanStepInput[]): readonly PlanStep[] {
  const seen = new Set<string>();
  return steps.flatMap((raw, i): PlanStep[] => {
    const step: Exclude<PlanStepInput, string> = typeof raw === "string" ? { title: raw } : raw;
    const title = step.title.trim();
    if (title.length === 0) return [];
    const wanted = step.id ?? String(i + 1);
    const id = seen.has(wanted) ? `${wanted}-${i + 1}` : wanted;
    seen.add(id);
    const tool = step.tool ?? toolHintOf(title);
    return [{ id, title, status: step.status ?? "pending", ...(tool !== undefined ? { tool } : {}) }];
  });
}

const publish = (runtime: PlanRuntime, event: AgentEvent): Promise<void> =>
  runtime.runPromise(EventBus.pipe(Effect.flatMap((bus) => bus.publish(event)), Effect.catchAll(() => Effect.void)));

/**
 * `agent.plan()`: run `input` under plan posture, return the recorded `Plan`.
 * Rejects with {@link PlanNoStepsError} when the run left no steps.
 */
export async function planFacade<R extends PlanResultLike & { readonly output: string }>(
  host: PlanHost<R, PlanRunOptions>,
  input: TaskInput,
  options?: PlanRunOptions,
): Promise<Plan> {
  const taskId = String(generateTaskId());
  if (options?.strategy !== undefined) return strategyPlan(host, input, options, options.strategy, taskId);
  const watch = await watchChecklist(host.runtime, taskId);
  let result: R;
  try {
    result = await host.run(input, { ...options, taskId, posture: "plan" });
  } finally {
    await watch.stop();
  }
  const seen = watch.result();
  const goal = taskInputText(input);
  const plan = planFromWatch(seen, { id: `plan-${taskId}`, goal, createdAt: Date.now(), source: planSourceOf(seen.snapshot), findings: seen.findings });
  if (isPlanEmpty(plan)) throw new PlanNoStepsError({ goal, reply: result.output });
  await publish(host.runtime, { _tag: "PlanRecorded", planId: plan.id, steps: plan.steps, source: plan.source, ...(plan.findings ? { findings: plan.findings } : {}), agentId: host.agentId, taskId, timestamp: Date.now() });
  return plan;
}

/**
 * `agent.plan(input, { strategy })`: the strategy's own planner (reasoning
 * `planOnly`) produces the plan; the run's result is `partial` with
 * `metadata.planOnly` and the plan in `metadata.extensions.plan` (core `Plan`,
 * every step pending). The engine does not judge that empty output
 * (`execute-success-invariants.ts`); this reads the plan off the result.
 */
async function strategyPlan<R extends PlanResultLike & { readonly output: string }>(
  host: PlanHost<R, PlanRunOptions>,
  input: TaskInput,
  options: PlanRunOptions,
  strategy: PlanExecutorStrategy,
  taskId: string,
): Promise<Plan> {
  const { strategy: _named, ...rest } = options;
  const result = await host.run(input, { ...rest, taskId, planOnly: strategy });
  const plan = planFromExtensions(result);
  const goal = taskInputText(input);
  if (plan === undefined || isPlanEmpty(plan)) throw new PlanNoStepsError({ goal, reply: result.output });
  await publish(host.runtime, { _tag: "PlanRecorded", planId: plan.id, steps: plan.steps, source: plan.source, ...(plan.findings ? { findings: plan.findings } : {}), agentId: host.agentId, taskId, timestamp: Date.now() });
  return plan;
}

/**
 * `agent.execute(plan)` / `agent.run(input, { plan })`: run seeded from `plan`'s
 * checklist and report `plan` with per-step status. An empty plan runs unseeded
 * (identical to a run without a plan) and reports itself unchanged.
 */
export async function executeFacade<R extends PlanResultLike, O extends object>(
  host: PlanHost<R, O>,
  input: TaskInput,
  plan: Plan,
  options?: O & PlanStrategyOption,
): Promise<R & { readonly plan: Plan }> {
  const invalid = invalidPlan(plan);
  if (invalid !== undefined) throw invalid;
  const strategy = options?.strategy;
  const taskId = String(generateTaskId());
  const seed = planToChecklistSeed(plan);
  // The executor (blueprint / plan-execute-reflect / the loop) is chosen in the engine (`plan-executor.ts`).
  const planExec: PlanExecution | undefined = isPlanEmpty(plan) ? undefined : { plan, ...(strategy !== undefined ? { strategy } : {}) };
  const watch = await watchChecklist(host.runtime, taskId);
  let result: R;
  try {
    result = await host.run(input, { ...options, taskId, ...(seed.length > 0 ? { initialTodo: seed } : {}), ...(plan.findings && plan.findings.length > 0 ? { planFindings: plan.findings } : {}), ...(planExec !== undefined ? { planExec } : {}) } as O & PlanRunSeed);
  } finally {
    await watch.stop();
  }
  // The plan keeps its findings: an execute run records none of its own.
  const watched = isPlanEmpty(plan) ? plan : planFromWatch({ ...watch.result(), findings: plan.findings ?? [] }, { id: plan.id, goal: plan.goal, createdAt: plan.createdAt, source: plan.source, findings: plan.findings }, plan.steps);
  // A strategy that owns a plan reports its final one (`extensions.plan`); the checklist watch fills in only what it left open.
  const final = planFromExtensions(result);
  const after = final !== undefined && !isPlanEmpty(plan) ? mergeFinalPlan(final, watched, plan) : watched;
  const stamp = { agentId: host.agentId, taskId, timestamp: Date.now() };
  for (const event of stepChanges(plan, after, stamp)) await publish(host.runtime, event);
  return { ...result, plan: after };
}
