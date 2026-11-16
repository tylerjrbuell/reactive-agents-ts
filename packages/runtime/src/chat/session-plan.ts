/**
 * session-plan.ts — the chat session's view of the conversation to-do list as a
 * typed `Plan`, and the edit path (`session.setPlan`).
 *
 * The to-do list ({@link TodoCarry}) stays the one store: a session plan is that
 * list plus the few fields a checklist does not carry (id, goal, source, tool
 * hints), held here. Reading maps list -> plan; editing maps plan -> list, so the
 * next `plan -> execute` turn seeds from exactly what the user left.
 */
import { planToChecklistSeed, type Plan, type PlanRecordedEvent, type PlanStep } from "@reactive-agents/core";
import { normalizeSteps, type PlanStepInput } from "../agent/plan-facade.js";
import type { TodoSeedItem } from "./todo-seed.js";

/** What the session holds beside the list. */
export interface SessionPlanMeta {
  readonly id: string;
  readonly goal: string;
  readonly createdAt: number;
  readonly source: Plan["source"];
  /** Tool hint per step id (survives list edits the checklist cannot carry). */
  readonly tools: Readonly<Record<string, string>>;
}

const stepStatusOfSeed = (status: TodoSeedItem["status"]): PlanStep["status"] =>
  status === "completed" ? "done" : status === "in_progress" ? "in-progress" : "pending";

const isStepList = (x: Plan | readonly PlanStepInput[]): x is readonly PlanStepInput[] => Array.isArray(x);

/** The plan a to-do list is. `undefined` for an empty list (no plan yet). Pure. */
export function planOfTodo(items: readonly TodoSeedItem[], meta: SessionPlanMeta): Plan | undefined {
  if (items.length === 0) return undefined;
  const steps = items.map((i): PlanStep => {
    const tool = i.tool ?? meta.tools[i.id];
    return { id: i.id, title: i.title, status: stepStatusOfSeed(i.status), ...(tool !== undefined ? { tool } : {}) };
  });
  // The rows say who wrote them: a model-sourced session plan whose rows the harness derived is harness-derived.
  const source = meta.source === "model" && items.some((i) => i.origin === "harness-derived") ? "harness-derived" : meta.source;
  return { id: meta.id, goal: meta.goal, steps, createdAt: meta.createdAt, source };
}

/** The plan id a session's to-do list carries (`PlanRecorded` and step events agree on it). */
export const sessionPlanId = (sessionId: string): string => `plan-${sessionId}`;

/** The meta a fresh session starts with: no goal, model-sourced until the user edits. */
export const freshPlanMeta = (sessionId: string, now: number): SessionPlanMeta => ({
  id: sessionPlanId(sessionId),
  goal: "",
  createdAt: now,
  source: "model",
  tools: {},
});

/**
 * Apply a user edit: the list the next turn seeds from, the meta to hold, the
 * plan that results and its `PlanRecorded` event. Pure.
 */
export function editPlan(
  input: Plan | readonly PlanStepInput[],
  meta: SessionPlanMeta,
  now: number,
): { readonly seed: TodoSeedItem[]; readonly meta: SessionPlanMeta; readonly plan: Plan; readonly event: PlanRecordedEvent } {
  const given = isStepList(input) ? undefined : input;
  const steps = normalizeSteps(isStepList(input) ? input : input.steps);
  const plan: Plan = { id: given?.id ?? meta.id, goal: given?.goal ?? meta.goal, steps, createdAt: meta.createdAt, source: "user-edited" };
  const tools = Object.fromEntries(steps.flatMap((s) => (s.tool !== undefined ? [[s.id, s.tool] as const] : [])));
  return {
    seed: planToChecklistSeed(plan),
    meta: { id: plan.id, goal: plan.goal, createdAt: plan.createdAt, source: "user-edited", tools },
    plan,
    event: { _tag: "PlanRecorded", planId: plan.id, steps, source: "user-edited", timestamp: now },
  };
}
