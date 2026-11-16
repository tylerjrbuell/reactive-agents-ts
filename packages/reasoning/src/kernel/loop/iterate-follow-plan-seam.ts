// File: src/kernel/loop/iterate-follow-plan-seam.ts
//
// Execute-side half of the plan/execute pair (spec
// 2026-11-16-plan-execute-posture-robustness.md, contract item 6): when the run
// was SEEDED with a checklist (`input.initialAdvisory`, the conversation todo
// list carried by `chat/todo-seed.ts`) and an item is still unchecked, ONE
// advisory line tells the model to work the list. Rendered every think turn
// while steps remain.
//
// Advisory only: appended to the pending guidance, never a veto, no exit-gate
// or terminal logic. No seed, an empty seed, an all-done list, plan posture:
// returns the same state (byte-identical to a run without the mechanism).
//
// Pure, deterministic, NO LLM, NO fs.

import { appendGuidanceText } from "../state/guidance-channel.js";
import { transitionState, type KernelInput, type KernelState } from "../state/kernel-state.js";
import { startRound, viewItems } from "../capabilities/act/checklist-round.js";
import { FOLLOW_PLAN_GUIDANCE } from "../policy/plan-steps.js";
import { isPlanPosture } from "../policy/run-posture.js";

/** The follow-the-plan line, or undefined when the run has no seeded unchecked step. */
export function followPlanLine(state: KernelState, input: KernelInput): string | undefined {
  if (isPlanPosture(input) || (input.initialAdvisory?.length ?? 0) === 0) return undefined;
  const unchecked = viewItems(startRound(), state.ledger).some((item) => item.status !== "completed");
  return unchecked ? FOLLOW_PLAN_GUIDANCE : undefined;
}

/** Append the follow-the-plan line to the pending guidance when it applies (once per turn). */
export function applyFollowPlanGuidance(state: KernelState, input: KernelInput): KernelState {
  const line = followPlanLine(state, input);
  if (line === undefined || state.pendingGuidance?.icsGuidance?.includes(line) === true) return state;
  return transitionState(state, { pendingGuidance: appendGuidanceText(state.pendingGuidance, "icsGuidance", line) });
}
