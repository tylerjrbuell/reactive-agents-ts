/**
 * The chat plan card's editing rules. The pure list rules (add, remove, reorder, reword, "was it
 * edited") are `@reactive-agents/ui-core`'s, shared with every builder's own chat UI; this adds the
 * body `PUT /api/chat/sessions/:id/plan` takes. The plan's meaning (what `session.setPlan` seeds,
 * `PlanRecorded`) is the framework's.
 */
import type { PlanDraftStep, PlanStepStatusWire } from "@reactive-agents/ui-core";

export {
  addStep,
  moveStep,
  nextStepId,
  planEdited,
  planProgressLine,
  removeStep,
  setStepTitle,
  setStepTool,
  stepStatusLabel,
} from "@reactive-agents/ui-core";

/** One step in the editor (the same shape the framework plan holds). */
export type DraftStep = PlanDraftStep;

/** A step as the plan route takes it. */
export interface PlanStepBody {
  readonly id: string;
  readonly title: string;
  readonly tool?: string;
  readonly status: PlanStepStatusWire;
}

/** The body the plan route takes for these steps. */
export const toPlanBody = (steps: readonly DraftStep[]): readonly PlanStepBody[] =>
  steps.map((s) => ({ id: s.id, title: s.title, status: s.status, ...(s.tool !== undefined ? { tool: s.tool } : {}) }));
