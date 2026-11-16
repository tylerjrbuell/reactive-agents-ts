/**
 * Pure editing rules for the chat plan card: add, remove, reorder and reword steps of the
 * framework `Plan` (`PlanWire`), and the body `PUT /api/chat/sessions/:id/plan` takes. The plan's
 * meaning (what `session.setPlan` seeds, `PlanRecorded`) is the framework's; this only shapes the
 * list the user edits.
 */
import type { PlanStepWire, PlanStepStatusWire } from "@reactive-agents/ui-core";

/** One step in the editor (the same shape the framework plan holds). */
export type DraftStep = PlanStepWire;

/** A step as the plan route takes it. */
export interface PlanStepBody {
  readonly id: string;
  readonly title: string;
  readonly tool?: string;
  readonly status: PlanStepStatusWire;
}

/** A fresh step id no step in `steps` has: the editor's own `step-<n>`, so it never collides with the framework's 1-based ids. */
export function nextStepId(steps: readonly DraftStep[]): string {
  const taken = new Set(steps.map((s) => s.id));
  let n = steps.length + 1;
  while (taken.has(`step-${n}`)) n += 1;
  return `step-${n}`;
}

/** Add a pending step at the end. A blank title adds nothing. */
export function addStep(steps: readonly DraftStep[], title: string, tool?: string): readonly DraftStep[] {
  const t = title.trim();
  if (t === "") return steps;
  const hint = tool?.trim() ?? "";
  return [...steps, { id: nextStepId(steps), title: t, status: "pending", ...(hint !== "" ? { tool: hint } : {}) }];
}

/** Remove the step with this id. */
export const removeStep = (steps: readonly DraftStep[], id: string): readonly DraftStep[] => steps.filter((s) => s.id !== id);

/** Move the step with this id by `delta` places (negative = earlier), clamped to the list. */
export function moveStep(steps: readonly DraftStep[], id: string, delta: number): readonly DraftStep[] {
  const from = steps.findIndex((s) => s.id === id);
  if (from < 0) return steps;
  const to = Math.min(steps.length - 1, Math.max(0, from + delta));
  if (to === from) return steps;
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as DraftStep);
  return next;
}

/** Reword a step. An empty title keeps the old one (use {@link removeStep} to delete). */
export function setStepTitle(steps: readonly DraftStep[], id: string, title: string): readonly DraftStep[] {
  const t = title.trim();
  return t === "" ? steps : steps.map((s) => (s.id === id ? { ...s, title: t } : s));
}

/** Set (or, blank, clear) a step's tool hint. */
export function setStepTool(steps: readonly DraftStep[], id: string, tool: string): readonly DraftStep[] {
  const hint = tool.trim();
  return steps.map((s) => {
    if (s.id !== id) return s;
    const { tool: _old, ...rest } = s;
    return hint === "" ? rest : { ...rest, tool: hint };
  });
}

/** The body the plan route takes for these steps. */
export const toPlanBody = (steps: readonly DraftStep[]): readonly PlanStepBody[] =>
  steps.map((s) => ({ id: s.id, title: s.title, status: s.status, ...(s.tool !== undefined ? { tool: s.tool } : {}) }));

/** True when the draft differs from the saved steps (ids, order, titles, tools or statuses). */
export function planEdited(saved: readonly DraftStep[], draft: readonly DraftStep[]): boolean {
  return saved.length !== draft.length || saved.some((s, i) => s.id !== draft[i]?.id || s.title !== draft[i]?.title || s.tool !== draft[i]?.tool || s.status !== draft[i]?.status);
}

const STATUS_WORDS: Readonly<Record<PlanStepStatusWire, string>> = { pending: "pending", "in-progress": "in progress", done: "done", skipped: "skipped" };

/** A step status in words (for aria labels and tooltips). */
export const stepStatusLabel = (status: PlanStepStatusWire): string => STATUS_WORDS[status];

/** One line for the card header: how far the plan is. `3 of 5 done`, `skipped` steps count as resolved. */
export function planProgressLine(steps: readonly DraftStep[]): string {
  if (steps.length === 0) return "No steps yet";
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return `${done} of ${steps.length} done`;
}
