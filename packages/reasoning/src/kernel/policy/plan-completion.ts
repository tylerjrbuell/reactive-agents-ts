/**
 * policy/plan-completion.ts — the completion invariant of a strategy plan.
 *
 * A strategy run may not finish `completed` with plan steps left pending. Every
 * step ends `done`, `skipped` or `failed` in the result; a step that is still
 * `pending` / `in_progress` is OPEN, and an open step raises `plan-incomplete`:
 * the loop executor (the strategy's own step executor) finishes the remainder,
 * and what is still open at the terminal caps the run at `partial` (the shared
 * terminal in `strategies/substrate/strategy-run.ts` applies it, so no strategy
 * carries its own copy).
 *
 * The one step that may finish without running is a PURE analysis step (no tool
 * named, no tool hints): the strategy's synthesis answers it, so it is `done`
 * once an answer exists ({@link settlePlanSteps}).
 */
import type { PlanStep } from "../../types/plan.js";

/** Trace `guard` name of the plan-incomplete signal (rides `GuardFiredEmitted`). */
export const PLAN_INCOMPLETE_GUARD = "plan-incomplete";

/** How a plan step ended. */
export type PlanStepEnding = "done" | "skipped" | "failed";

/** The plan-step fields the invariant reads. */
export type PlanStepLike = Pick<PlanStep, "id" | "title" | "status" | "type" | "toolName" | "toolHints">;

/** One step's ending in the result. */
export interface PlanStepEnd {
  readonly id: string;
  readonly title: string;
  readonly ending: PlanStepEnding;
}

/** True when the step is neither done, skipped nor failed. */
export const isOpenPlanStep = (s: Pick<PlanStep, "status">): boolean => s.status === "pending" || s.status === "in_progress";

/** The steps still open. */
export const openPlanSteps = <S extends Pick<PlanStep, "status">>(steps: readonly S[]): readonly S[] => steps.filter(isOpenPlanStep);

/** True for a step the strategy's synthesis answers: analysis with no tool named. */
export const isSynthesisStep = (s: PlanStepLike): boolean => s.type === "analysis" && s.toolName === undefined && (s.toolHints ?? []).length === 0;

/**
 * The steps with each pure analysis step still open marked `completed` when the
 * run `answered` (its synthesis wrote the answer). Every other step is returned
 * as is: a pending tool or composite step never becomes done by being skipped over.
 */
export function settlePlanSteps(steps: readonly PlanStep[], answered: boolean): PlanStep[] {
  return steps.map((s) => (answered && isOpenPlanStep(s) && isSynthesisStep(s) ? { ...s, status: "completed" as const } : s));
}

/** What the invariant found over a plan's steps. */
export interface PlanSettlement {
  /** Each settled step's ending, in plan order. */
  readonly steps: readonly PlanStepEnd[];
  /** The steps with no ending: open. */
  readonly open: readonly PlanStepLike[];
}

/** Each step's ending (`completed`→done, `skipped`, `failed`), and the steps left open. */
export function settlePlan(steps: readonly PlanStepLike[]): PlanSettlement {
  const ended: PlanStepEnd[] = [];
  const open: PlanStepLike[] = [];
  for (const s of steps) {
    if (isOpenPlanStep(s)) open.push(s);
    else ended.push({ id: s.id, title: s.title, ending: s.status === "completed" ? "done" : s.status === "skipped" ? "skipped" : "failed" });
  }
  return { steps: ended, open };
}

/**
 * The reflection feedback that sends the plan loop back for steps that never
 * ran (a SATISFIED verdict on an unfinished plan is not accepted); undefined
 * when every step ended.
 */
export const unrunStepsFeedback = (steps: readonly Pick<PlanStep, "id" | "title" | "status">[]): string | undefined => {
  const open = openPlanSteps(steps);
  return open.length === 0 ? undefined : `UNSATISFIED: plan steps never ran: ${open.map((s) => `${s.id} (${s.title})`).join("; ")}.`;
};

/** The `plan-incomplete` signal's reason text for the steps left open. */
export const planIncompleteReason = (open: readonly Pick<PlanStep, "id" | "title">[]): string =>
  `${open.length} plan step${open.length === 1 ? "" : "s"} never ran: ${open.map((s) => `${s.id} (${s.title})`).join("; ")}`;
