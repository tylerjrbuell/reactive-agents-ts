/**
 * Tool hints on a chat plan's steps, resolved by the framework's own checklist rules. A step's hint
 * is its explicit `tool` (the tool dropdown) or, when none is set, the `tool: name` marker its
 * title carries (`planStepToolHint`); the `tool` checklist op is how an explicit value is set or
 * cleared (`foldAdvisory`). Cortex does not re-implement that precedence: it replays the steps
 * through the fold. Pure.
 */
import { foldAdvisory, planStepToolHint, type ChecklistFact, type ChecklistItemOp, type Plan, type PlanStep } from "@reactive-agents/core";
import type { PlanStepBody } from "./chat-session-plan.js";

/**
 * The editor's steps with each `tool` resolved by the framework fold: add every step (the hint a
 * title names applies), then a `{ op: "tool" }` per step the editor gave an explicit tool or left
 * blank. A cleared dropdown therefore falls back to the title's hint, or none. Ids default to the
 * 1-based position, as `setPlan` does.
 */
export function resolveStepTools(steps: readonly PlanStepBody[]): readonly PlanStepBody[] {
  const ids = steps.map((s, i) => s.id ?? `step-${i + 1}`);
  const fact = (seq: number, change: ChecklistItemOp): ChecklistFact => ({ kind: "checklist-item", seq, iteration: 0, change });
  const facts: ChecklistFact[] = [
    fact(1, { op: "add", items: steps.map((s, i) => ({ id: ids[i]!, title: s.title })) }),
    ...steps.map((s, i) => fact(i + 2, { op: "tool", id: ids[i]!, ...(s.tool !== undefined ? { tool: s.tool } : {}) })),
  ];
  const toolOf = new Map(foldAdvisory(facts).map((item) => [item.id, item.tool] as const));
  return steps.map((s, i) => {
    const { tool: _drop, ...rest } = s;
    const tool = toolOf.get(ids[i]!);
    return tool !== undefined ? { ...rest, tool } : rest;
  });
}

/**
 * A plan whose steps lacking a `tool` take the one their title names. Covers plans a model wrote
 * or saved before the framework derived hints; the stored rows are not rewritten. Pure.
 */
export function withTitleToolHints(plan: Plan): Plan {
  if (plan.steps.every((s) => s.tool !== undefined || planStepToolHint(s.title) === undefined)) return plan;
  return { ...plan, steps: plan.steps.map((s): PlanStep => (s.tool === undefined ? hinted(s) : s)) };
}

function hinted(step: PlanStep): PlanStep {
  const tool = planStepToolHint(step.title);
  return tool === undefined ? step : { ...step, tool };
}
