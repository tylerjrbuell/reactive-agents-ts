// File: src/kernel/loop/iterate-follow-plan-seam.ts
//
// Execute-side half of the plan/execute pair (spec
// 2026-11-16-plan-execute-posture-robustness.md, contract item 6): when the run
// was SEEDED with a checklist (`input.initialAdvisory`, the conversation todo
// list carried by `chat/todo-seed.ts`) and an item is still unchecked, ONE
// advisory line tells the model to work the list. Rendered every think turn
// while steps remain.
//
// A second line (proposeDoneLine, spec item 7) proposes marking a step done when
// its seeded tool hint names a tool that succeeded this pass.
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

/**
 * The propose-done line (spec item 7): the first unchecked seeded step whose
 * tool hint names a tool that SUCCEEDED in the steps at/after `fromStep`.
 * Undefined when no step carries a hint, no hinted tool succeeded this pass,
 * or the run is not an execute run with a seed. Advisory: the model decides.
 */
export function proposeDoneLine(state: KernelState, input: KernelInput, fromStep: number): string | undefined {
  if (isPlanPosture(input) || (input.initialAdvisory?.length ?? 0) === 0) return undefined;
  const succeeded = new Set<string>();
  for (const s of state.steps.slice(fromStep)) {
    const r = s.type === "observation" ? s.metadata?.observationResult : undefined;
    if (r?.success === true && typeof r.toolName === "string") succeeded.add(r.toolName);
  }
  if (succeeded.size === 0) return undefined;
  const hit = viewItems(startRound(), state.ledger).find(
    (item) => item.status !== "completed" && item.tool !== undefined && succeeded.has(item.tool),
  );
  return hit === undefined
    ? undefined
    : `Step ${hit.id} ("${hit.title}") named tool ${hit.tool}, which just succeeded: if the step is complete, mark it done with todo.`;
}

/**
 * Append the follow-the-plan line, then the propose-done line, to the pending
 * guidance when each applies (each at most once per turn).
 */
export function applyFollowPlanGuidance(state: KernelState, input: KernelInput, fromStep: number = state.steps.length): KernelState {
  let next = state;
  for (const line of [followPlanLine(state, input), proposeDoneLine(state, input, fromStep)]) {
    if (line === undefined || next.pendingGuidance?.icsGuidance?.includes(line) === true) continue;
    next = transitionState(next, { pendingGuidance: appendGuidanceText(next.pendingGuidance, "icsGuidance", line) });
  }
  return next;
}
