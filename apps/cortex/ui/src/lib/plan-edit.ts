/**
 * The chat plan card's editing rules. The pure list rules (add, remove, reorder, reword, "was it
 * edited") are `@reactive-agents/ui-core`'s, shared with every builder's own chat UI; this adds the
 * body `PUT /api/chat/sessions/:id/plan` takes. The plan's meaning (what `session.setPlan` seeds,
 * `PlanRecorded`) is the framework's.
 */
import type { PlanDraftStep, PlanStepStatusWire } from "@reactive-agents/ui-core";
import { NO_EXTRAS, type ExtrasMap, type StepExtras } from "./plan-extras.js";

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

/** A step as the plan route takes it (`dependsOn` and `args`: `lib/plan-extras.ts`). */
export interface PlanStepBody extends StepExtras {
  readonly id: string;
  readonly title: string;
  readonly tool?: string;
  readonly status: PlanStepStatusWire;
}

/** The body the plan route takes for these steps and their extras. */
export const toPlanBody = (steps: readonly DraftStep[], extras: ExtrasMap = NO_EXTRAS): readonly PlanStepBody[] =>
  steps.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    ...(s.tool !== undefined ? { tool: s.tool } : {}),
    ...(extras[s.id]?.dependsOn !== undefined ? { dependsOn: extras[s.id]?.dependsOn } : {}),
    ...(extras[s.id]?.args !== undefined ? { args: extras[s.id]?.args } : {}),
  }));
