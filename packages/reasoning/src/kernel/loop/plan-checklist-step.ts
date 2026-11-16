// File: src/kernel/loop/plan-checklist-step.ts
/**
 * Terminal step `plan-checklist` — the harness guarantees a plan-posture run
 * ends with a durable checklist (spec 2026-11-16-plan-execute-posture-robustness.md).
 *
 * Under plan posture, after the final reply:
 *   - the model already recorded a `todo` list  → nothing is derived;
 *   - the list is empty and the reply holds step lines → the steps are derived
 *     deterministically ({@link derivePlanSteps}) and recorded as ordinary
 *     `checklist-item` facts tagged `harnessDerived: true`; the runner's
 *     post-pipeline ledger tap publishes them, so `ChecklistUpdated` fires;
 *   - nothing derivable → an explicit `planNoSteps` signal.
 * Each outcome rides the existing `posture-applied` guard event. The step never
 * rewrites `state.output` / `state.status` (completion is unchanged) and
 * outside plan posture it is the identity.
 */
import { Effect } from "effect";
import type { KernelInput, KernelState } from "../state/kernel-state.js";
import { transitionState } from "../state/kernel-state.js";
import { recordChecklistItems } from "../ledger/emit.js";
import { startRound, viewItems } from "../capabilities/act/checklist-round.js";
import { derivePlanSteps } from "../policy/plan-steps.js";
import { POSTURE_SIGNAL_ORIGIN, emitPostureApplied, isPlanPosture, type PlanChecklistOutcome } from "../policy/run-posture.js";

/** Pure: the ledger the plan-checklist step leaves, and what it found. */
export function derivePlanChecklist(
  state: KernelState,
): { readonly state: KernelState; readonly outcome: PlanChecklistOutcome } {
  const recorded = viewItems(startRound(), state.ledger).length;
  if (recorded > 0) return { state, outcome: { planSteps: recorded, planSource: "recorded" } };
  const titles = derivePlanSteps(state.output ?? "");
  if (titles.length === 0) return { state, outcome: { planSteps: 0, planNoSteps: true } };
  const items = titles.map((title, i) => ({ id: String(i + 1), title }));
  return {
    state: transitionState(state, {
      ledger: recordChecklistItems(state.ledger, [
        { iteration: state.iteration, change: { op: "add", items }, harnessDerived: true },
      ]),
    }),
    outcome: { planSteps: items.length, planSource: "harness-derived" },
  };
}

/** The terminal step: identity outside plan posture; otherwise {@link derivePlanChecklist} plus its trace signal. */
export function runPlanChecklistStep(state: KernelState, input: Pick<KernelInput, "posture">): Effect.Effect<KernelState> {
  if (!isPlanPosture(input)) return Effect.succeed(state);
  const { state: next, outcome } = derivePlanChecklist(state);
  const signalId = (next.signalLedger ?? []).find((e) => e.origin === POSTURE_SIGNAL_ORIGIN)?.signalId;
  return emitPostureApplied({
    posture: "plan",
    ...(signalId !== undefined ? { signalId } : {}),
    taskId: next.taskId,
    iteration: next.iteration,
    steps: next.steps,
    plan: outcome,
  }).pipe(Effect.as(next));
}
