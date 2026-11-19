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
// or terminal logic. An all-done list, plan posture: returns the same state
// (byte-identical to a run without the mechanism). No seed: the model's own
// list is ticked from tool evidence with no guidance text
// (tickModelListFromEvidence, verify/checklist-evidence.ts).
//
// Pure, deterministic, NO LLM, NO fs.

import type { AdvisoryItem } from "@reactive-agents/core";
import { recordChecklistItems } from "../ledger/emit.js";
import { appendGuidanceText } from "../state/guidance-channel.js";
import { transitionState, type KernelInput, type KernelState } from "../state/kernel-state.js";
import { startRound, viewItems } from "../capabilities/act/checklist-round.js";
import { FOLLOW_PLAN_GUIDANCE } from "../policy/plan-steps.js";
import { isPlanPosture } from "../policy/run-posture.js";
import { evidenceTicks, tickFacts, toolHintMatches } from "../capabilities/verify/checklist-evidence.js";

/** The follow-the-plan line, or undefined when the run has no seeded unchecked step. */
export function followPlanLine(state: KernelState, input: KernelInput): string | undefined {
  if (isPlanPosture(input) || (input.initialAdvisory?.length ?? 0) === 0) return undefined;
  const unchecked = viewItems(startRound(), state.ledger).some((item) => item.status !== "completed");
  return unchecked ? FOLLOW_PLAN_GUIDANCE : undefined;
}

/** Tools whose calls SUCCEEDED in the steps at/after `fromStep`. */
function succeededSince(state: KernelState, fromStep: number): ReadonlySet<string> {
  const succeeded = new Set<string>();
  for (const s of state.steps.slice(fromStep)) {
    const r = s.type === "observation" ? s.metadata?.observationResult : undefined;
    if (r?.success === true && typeof r.toolName === "string") succeeded.add(r.toolName);
  }
  return succeeded;
}

/** Unchecked seeded steps whose tool hint names a tool that succeeded this pass (an execute run with a seed only). */
function hintedHits(state: KernelState, input: KernelInput, fromStep: number): readonly AdvisoryItem[] {
  if (isPlanPosture(input) || (input.initialAdvisory?.length ?? 0) === 0) return [];
  const succeeded = succeededSince(state, fromStep);
  if (succeeded.size === 0) return [];
  return viewItems(startRound(), state.ledger).filter((item) => {
    const hint = item.tool;
    return item.status !== "completed" && hint !== undefined && [...succeeded].some((tool) => toolHintMatches(hint, tool));
  });
}

/**
 * The propose-done line (spec item 7): the first unchecked seeded step whose
 * tool hint names a tool that SUCCEEDED in the steps at/after `fromStep`.
 * Undefined when no step carries a hint, no hinted tool succeeded this pass,
 * or the run is not an execute run with a seed. Advisory: the model decides.
 * {@link autoTickSteps} settles the unambiguous matches first; this line is
 * what is left, a tool several unchecked steps share.
 */
export function proposeDoneLine(state: KernelState, input: KernelInput, fromStep: number): string | undefined {
  const hit = hintedHits(state, input, fromStep)[0];
  return hit === undefined
    ? undefined
    : `Step ${hit.id} ("${hit.title}") named tool ${hit.tool}, which just succeeded: if the step is complete, mark it done with todo.`;
}

/**
 * Auto-tick (execute-phase iteration efficiency): a seeded step whose tool hint
 * names a tool that SUCCEEDED this pass, and that NO other unchecked step names,
 * is marked done by the harness itself, so the model spends no turn on the
 * bookkeeping. The status is a `checklist-item` ledger fact, which the runner's
 * ledger tap publishes as `ChecklistUpdated`; the item's origin is untouched
 * (a status change never carries one). Ambiguous matches (a tool two or more
 * unchecked steps share) stay advisory ({@link proposeDoneLine}). Idempotent: a
 * ticked step is no longer unchecked. Inert without a seed or tool hints, and in
 * plan posture (state identity). Deterministic, no LLM.
 */
export function autoTickSteps(
  state: KernelState,
  input: KernelInput,
  fromStep: number,
): { readonly state: KernelState; readonly ticked: readonly AdvisoryItem[] } {
  if (input.harness?.autoTick === false) return { state, ticked: [] };
  const hits = hintedHits(state, input, fromStep);
  if (hits.length === 0) return { state, ticked: [] };
  const unchecked = viewItems(startRound(), state.ledger).filter((item) => item.status !== "completed");
  const ticked = hits.filter((hit) => unchecked.filter((item) => item.tool === hit.tool).length === 1);
  if (ticked.length === 0) return { state, ticked: [] };
  const ledger = recordChecklistItems(
    state.ledger,
    ticked.map((item) => ({ iteration: state.iteration, change: { op: "status" as const, id: item.id, status: "completed" as const } })),
  );
  return { state: transitionState(state, { ledger }), ticked };
}

/**
 * A list the model built itself (no seed): the harness ticks every row whose
 * tool hint names a tool that succeeded since the row was added
 * ({@link evidenceTicks}, provenance `harness:evidence` + the call id). Silent:
 * no guidance text, so the prompt is unchanged; the model sees the ticks the
 * next time it reads the list. Same kill switch as {@link autoTickSteps};
 * inert in plan posture. Idempotent; state identity when nothing ticks.
 */
export function tickModelListFromEvidence(state: KernelState, input: KernelInput): KernelState {
  if (input.harness?.autoTick === false || isPlanPosture(input)) return state;
  const ticks = evidenceTicks(state.ledger);
  if (ticks.length === 0) return state;
  return transitionState(state, { ledger: recordChecklistItems(state.ledger, tickFacts(ticks, state.iteration)) });
}

/**
 * Settle the unambiguous hinted steps ({@link autoTickSteps}), then append the
 * follow-the-plan line, the auto-tick note and the propose-done line to the
 * pending guidance when each applies (each at most once per turn). Without a
 * seed: {@link tickModelListFromEvidence} only.
 */
export function applyFollowPlanGuidance(state: KernelState, input: KernelInput, fromStep: number = state.steps.length): KernelState {
  if ((input.initialAdvisory?.length ?? 0) === 0) return tickModelListFromEvidence(state, input);
  const auto = autoTickSteps(state, input, fromStep);
  const tickedLine =
    auto.ticked.length === 0
      ? undefined
      : `Marked done by the harness (the named tool succeeded): ${auto.ticked.map((i) => `step ${i.id} ("${i.title}")`).join(", ")}. Do not repeat them or mark them yourself.`;
  let next = auto.state;
  for (const line of [followPlanLine(next, input), tickedLine, proposeDoneLine(next, input, fromStep)]) {
    if (line === undefined || next.pendingGuidance?.icsGuidance?.includes(line) === true) continue;
    next = transitionState(next, { pendingGuidance: appendGuidanceText(next.pendingGuidance, "icsGuidance", line) });
  }
  return next;
}
