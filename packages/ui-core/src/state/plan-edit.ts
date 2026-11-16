/**
 * Pure editing rules for a plan's step list: add, remove, reorder and reword steps, and tell
 * whether a draft differs from what was saved. Any chat UI that lets a person edit a framework
 * `Plan` before running it needs these; the plan's meaning (what `session.setPlan` seeds, the
 * `PlanRecorded` event) stays the framework's, this only shapes the list the person edits.
 */
import type { PlanStepStatusWire, PlanStepWire } from "../protocol/events.js";

/** One step in a plan editor (the same shape the framework plan holds). */
export type PlanDraftStep = PlanStepWire;

/** A fresh step id no step in `steps` has: the editor's own `step-<n>`, so it never collides with the framework's 1-based ids. */
export function nextStepId(steps: readonly PlanDraftStep[]): string {
  const taken = new Set(steps.map((s) => s.id));
  let n = steps.length + 1;
  while (taken.has(`step-${n}`)) n += 1;
  return `step-${n}`;
}

/** Add a pending step at the end. A blank title adds nothing (the same list comes back). */
export function addStep(steps: readonly PlanDraftStep[], title: string, tool?: string): readonly PlanDraftStep[] {
  const t = title.trim();
  if (t === "") return steps;
  const hint = tool?.trim() ?? "";
  return [...steps, { id: nextStepId(steps), title: t, status: "pending", ...(hint !== "" ? { tool: hint } : {}) }];
}

/** Remove the step with this id. */
export const removeStep = (steps: readonly PlanDraftStep[], id: string): readonly PlanDraftStep[] => steps.filter((s) => s.id !== id);

/** Move the step with this id by `delta` places (negative = earlier), clamped to the list. An unknown id or no move returns the same list. */
export function moveStep(steps: readonly PlanDraftStep[], id: string, delta: number): readonly PlanDraftStep[] {
  const from = steps.findIndex((s) => s.id === id);
  if (from < 0) return steps;
  const to = Math.min(steps.length - 1, Math.max(0, from + delta));
  if (to === from) return steps;
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as PlanDraftStep);
  return next;
}

/** Reword a step. An empty title keeps the old one (use {@link removeStep} to delete). */
export function setStepTitle(steps: readonly PlanDraftStep[], id: string, title: string): readonly PlanDraftStep[] {
  const t = title.trim();
  return t === "" ? steps : steps.map((s) => (s.id === id ? { ...s, title: t } : s));
}

/** Set (or, blank, clear) a step's tool hint. */
export function setStepTool(steps: readonly PlanDraftStep[], id: string, tool: string): readonly PlanDraftStep[] {
  const hint = tool.trim();
  return steps.map((s) => {
    if (s.id !== id) return s;
    const { tool: _old, ...rest } = s;
    return hint === "" ? rest : { ...rest, tool: hint };
  });
}

/** True when the draft differs from the saved steps (ids, order, titles, tools or statuses). */
export function planEdited(saved: readonly PlanDraftStep[], draft: readonly PlanDraftStep[]): boolean {
  return saved.length !== draft.length || saved.some((s, i) => s.id !== draft[i]?.id || s.title !== draft[i]?.title || s.tool !== draft[i]?.tool || s.status !== draft[i]?.status);
}

const STATUS_WORDS: Readonly<Record<PlanStepStatusWire, string>> = { pending: "pending", "in-progress": "in progress", done: "done", skipped: "skipped" };

/** A step status in words (for aria labels and tooltips). */
export const stepStatusLabel = (status: PlanStepStatusWire): string => STATUS_WORDS[status];

/** One line for a plan header: how far it is. `3 of 5 done`; `skipped` steps count as resolved. */
export function planProgressLine(steps: readonly PlanDraftStep[]): string {
  if (steps.length === 0) return "No steps yet";
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return `${done} of ${steps.length} done`;
}
