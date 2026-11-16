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
 *  - {@link executeFacade} seeds a run from a plan's checklist (the follow-the-list
 *                         guidance rides that seed) and reports `result.plan` with
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

/** What the facade adds to the caller's run options: the task id it watches, the posture and the seed. */
export interface PlanRunSeed {
  readonly taskId: string;
  readonly posture?: "plan";
  readonly initialTodo?: readonly TodoSeedItem[];
  readonly planFindings?: readonly PlanFinding[];
}

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
export async function planFacade<R extends { readonly output: string }>(
  host: PlanHost<R, PlanRunOptions>,
  input: TaskInput,
  options?: PlanRunOptions,
): Promise<Plan> {
  const taskId = String(generateTaskId());
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
 * `agent.execute(plan)` / `agent.run(input, { plan })`: run seeded from `plan`'s
 * checklist and report `plan` with per-step status. An empty plan runs unseeded
 * (identical to a run without a plan) and reports itself unchanged.
 */
export async function executeFacade<R, O extends object>(
  host: PlanHost<R, O>,
  input: TaskInput,
  plan: Plan,
  options?: O,
): Promise<R & { readonly plan: Plan }> {
  const taskId = String(generateTaskId());
  const seed = planToChecklistSeed(plan);
  const watch = await watchChecklist(host.runtime, taskId);
  let result: R;
  try {
    result = await host.run(input, { ...options, taskId, ...(seed.length > 0 ? { initialTodo: seed } : {}), ...(plan.findings && plan.findings.length > 0 ? { planFindings: plan.findings } : {}) } as O & PlanRunSeed);
  } finally {
    await watch.stop();
  }
  // The plan keeps its findings: an execute run records none of its own.
  const after = isPlanEmpty(plan) ? plan : planFromWatch({ ...watch.result(), findings: plan.findings ?? [] }, { id: plan.id, goal: plan.goal, createdAt: plan.createdAt, source: plan.source, findings: plan.findings }, plan.steps);
  const stamp = { agentId: host.agentId, taskId, timestamp: Date.now() };
  for (const event of stepChanges(plan, after, stamp)) await publish(host.runtime, event);
  return { ...result, plan: after };
}
