/**
 * act/guard-refusal.ts — answer one call the act-phase guard pipeline refused.
 *
 * The single-call and parallel-batch paths of `act.ts` refuse a guarded call
 * the same way: an action + harness-authored observation step pair, the
 * `onAction` / `onObservation` hook pair, and one `guard-fired` event
 * (`outcome: "block"`, `guard` = the refusing guard's name). The event is the
 * same shape the think-phase tool gate emits, so trace readers
 * (`mechanismActivity`: `guard:<guard>:block`) count act-phase guards too.
 * Before this, a `repetitionGuard` block left no event and a default-on guard
 * read as never firing (H3 2026-11-19, F4).
 */
import { Effect } from "effect";
import type { ToolCallSpec } from "@reactive-agents/tools";
import { transitionState, type KernelHooks, type KernelState } from "../../state/kernel-state.js";
import type { ReasoningStep } from "../../../types/index.js";
import { blockedCallSteps } from "../../utils/observation-helpers.js";
import { emitGuardFired } from "../../utils/diagnostics.js";

/** The `guard-fired` name of a refusal from a guard that does not name itself (a custom `Guard`). */
export const UNNAMED_GUARD = "tool_guard";

/** A guard refusal: the model-visible answer and the refusing guard's name. */
export interface GuardRefusal {
  readonly observation: string;
  readonly guard?: string;
  /** A cached replay of an earlier successful result (`duplicateGuard`), not a denial. */
  readonly replay?: true;
}

/** A missing tool is a hard failure; every other refusal answers the call successfully. */
function isGuardHardFailure(observation: string): boolean {
  return observation.includes("is not available in this run");
}

/**
 * Record a refused call and emit its `guard-fired` event.
 *
 * @param state Act-entry state (hook state, task id, iteration).
 * @param steps The round's steps so far; the observation hook sees them plus the action step.
 * @returns The action + observation steps to append to the round.
 */
export function refuseGuardedCall(
  state: KernelState,
  steps: readonly ReasoningStep[],
  call: ToolCallSpec,
  refusal: GuardRefusal,
  hooks: KernelHooks,
): Effect.Effect<readonly [ReasoningStep, ReasoningStep], never> {
  return Effect.gen(function* () {
    const pair = blockedCallSteps(call, refusal.observation, !isGuardHardFailure(refusal.observation), { guard: true, toolUsed: true });
    yield* hooks.onAction(state, call.name, JSON.stringify(call.arguments), { callId: call.id, rationale: call.rationale });
    // A harness reply to a call that never ran is not an ok:true receipt,
    // except a cached replay: it returns the earlier successful result, and a
    // failed receipt showed exact re-fetches as denied calls (owner trace 01M7T08Q64H1).
    const replay = refusal.replay === true;
    yield* hooks.onObservation(
      transitionState(state, { steps: [...steps, pair[0]] }),
      refusal.observation,
      replay,
    );
    yield* emitGuardFired({
      taskId: state.taskId,
      iteration: state.iteration,
      guard: refusal.guard ?? UNNAMED_GUARD,
      outcome: replay ? "redirect" : "block",
      reason: refusal.observation,
      metadata: { toolName: call.name, toolCallId: call.id },
    });
    return pair;
  });
}
