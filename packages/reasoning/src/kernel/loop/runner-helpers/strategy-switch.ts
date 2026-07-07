/**
 * runner-helpers/strategy-switch.ts — Shared strategy-switch application.
 *
 * Extracted from `iterate-pass.ts` in WS-6 CORRECTION 5 (2026-05-29). Both the
 * dispatcher-requested switch (`dispatcher-strategy-switch`) and the
 * loop-detector-triggered switch reinitialise the kernel for a new strategy
 * with IDENTICAL machinery:
 *
 *   1. fire `onStrategySwitched` hook
 *   2. build the handoff summary (9-line block)
 *   3. bump switchCount + push the new strategy onto triedStrategies
 *   4. re-seed `currentOptions` with the new strategy + `initialKernelState`
 *   5. inject synthetic "permanently unavailable" observation steps so the new
 *      strategy doesn't rediscover broken tools via wasted retries
 *   6. fold the handoff into `currentInput.priorContext`, drop failed tools
 *      from requiredTools, and rebuild `currentContext`
 *   7. reset the five per-loop counters (prevActionCount, requiredToolRedirects,
 *      consecutiveStalled, prevArtifactCount, failureRecoveryRedirects)
 *
 * Pre-CORRECTION-5 this block was duplicated near-verbatim at two call sites
 * (~80 LOC each). The ONLY differences were the `fromStrategy` fallback and the
 * failure-reason string; both are now explicit parameters.
 *
 * Invariants preserved:
 *   - transitionState() discipline — the synthetic-step append routes through
 *     `transitionState`, never a direct mutation.
 *   - No new state.status writer — `initialKernelState` seeds "thinking"; the
 *     terminate single-owner invariant is untouched (this helper never finalizes).
 */

import { Effect } from "effect";
import { makeStep } from "../../../kernel/capabilities/sense/step-utils.js";
import { buildHandoff } from "../../../kernel/capabilities/reflect/strategy-evaluator.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type KernelHooks,
} from "../../../kernel/state/kernel-state.js";

/** Per-loop counters that a strategy switch resets to zero. */
export interface SwitchResetCounters {
  readonly prevActionCount: number;
  readonly requiredToolRedirects: number;
  readonly consecutiveStalled: number;
  readonly prevArtifactCount: number;
  readonly failureRecoveryRedirects: number;
}

/** All zero — the fixed reset every switch applies to the five per-loop counters. */
export const SWITCH_RESET_COUNTERS: SwitchResetCounters = {
  prevActionCount: 0,
  requiredToolRedirects: 0,
  consecutiveStalled: 0,
  prevArtifactCount: 0,
  failureRecoveryRedirects: 0,
};

export interface ApplyStrategySwitchArgs {
  /** State at the point the switch fires (pre-reinit). */
  readonly state: KernelState;
  /** Input carrying the current task + priorContext + requiredTools. */
  readonly currentInput: KernelInput;
  /** Original context built pre-loop — base for the rebuilt context. */
  readonly context: KernelContext;
  /** Original options — base for the re-seeded currentOptions. */
  readonly options: KernelRunOptions;
  /** Hooks bundle — `onStrategySwitched` fires inside. */
  readonly hooks: KernelHooks;
  /** Strategy names tried so far (mutated in place: the new one is pushed). */
  readonly triedStrategies: string[];
  /** Switch count BEFORE this switch (handoff uses switchCount + 1). */
  readonly switchCount: number;
  /** The strategy we're leaving (each site resolves its own fallback). */
  readonly fromStrategy: string;
  /** The strategy we're switching to. */
  readonly toStrategy: string;
  /** Human-readable reason — `pending.reason` (dispatcher) or `loopMsg` (loop). */
  readonly failureReason: string;
}

export interface ApplyStrategySwitchResult {
  readonly state: KernelState;
  readonly currentInput: KernelInput;
  readonly currentContext: KernelContext;
  readonly currentOptions: KernelRunOptions;
  /** New switch count (= input switchCount + 1). */
  readonly switchCount: number;
  /** The five per-loop counters, all reset to zero. */
  readonly resetCounters: SwitchResetCounters;
}

/**
 * Apply a strategy switch: fire the hook, reinit kernel state for the new
 * strategy, carry forward handoff context, and reset per-loop counters.
 *
 * `triedStrategies` is mutated in place (the new strategy is pushed) — matching
 * the pre-extraction behaviour where it was a reference-stable array.
 */
export function applyStrategySwitch(
  args: ApplyStrategySwitchArgs,
): Effect.Effect<ApplyStrategySwitchResult, never, never> {
  return Effect.gen(function* () {
    const {
      state: priorState,
      currentInput: priorInput,
      context,
      options,
      hooks,
      triedStrategies,
      switchCount,
      fromStrategy,
      toStrategy,
      failureReason,
    } = args;

    yield* hooks.onStrategySwitched(priorState, fromStrategy, toStrategy, failureReason);

    const handoff = buildHandoff(
      priorState,
      priorInput.task ?? "",
      fromStrategy,
      failureReason,
      switchCount + 1,
      priorInput.requiredTools ?? [],
    );

    const handoffSummary = [
      `Strategy Switch Handoff (switch #${handoff.switchNumber}):`,
      `Previous strategy: ${handoff.previousStrategy}`,
      `Steps completed: ${handoff.stepsCompleted}`,
      `Failure reason: ${handoff.failureReason}`,
      `Tools called: ${handoff.toolsCalled.join(", ") || "none"}`,
      handoff.permanentlyFailedTools.length > 0
        ? `Permanently unavailable tools (do not retry — synthesize without them): ${handoff.permanentlyFailedTools.join(", ")}`
        : null,
      `Key observations:\n${handoff.keyObservations.join("\n") || "(none)"}`,
    ].filter(Boolean).join("\n");

    const nextSwitchCount = switchCount + 1;
    triedStrategies.push(toStrategy);

    const currentOptions: KernelRunOptions = { ...options, strategy: toStrategy };

    // Reset state — fresh iteration count, carry forward toolsUsed.
    let state = initialKernelState(currentOptions);

    // P4 (2026-07-07, A2 #3): carry successful tool observations AND the
    // toolsUsed ledger across the switch. Without them the new strategy both
    // lacks the data (only 5 compressed keyObservations lines survive in
    // priorContext) and gets redirected by the required-tools gate to re-call
    // tools that already succeeded — observed ~2× run cost from re-executing
    // completed tool calls after an escalation switch.
    const carriedObservations = priorState.steps
      .filter((s) => {
        if (s.type !== "observation") return false;
        const obs = s.metadata?.observationResult as { success?: boolean } | undefined;
        return obs?.success === true;
      })
      .slice(-8);
    if (carriedObservations.length > 0 || priorState.toolsUsed.size > 0) {
      state = transitionState(state, {
        steps: [...state.steps, ...carriedObservations],
        toolsUsed: new Set(priorState.toolsUsed),
      });
    }

    // Inject synthetic failure observations so the new strategy immediately
    // knows which required tools are permanently unavailable, without having
    // to rediscover this through wasted retry iterations.
    if (handoff.permanentlyFailedTools.length > 0) {
      const failedSteps = handoff.permanentlyFailedTools.map((toolName) =>
        makeStep(
          "observation",
          `[Carried from prior strategy] Tool "${toolName}" is permanently unavailable — every call failed. Do not retry it; synthesize your answer without this data.`,
          {
            observationResult: {
              toolName,
              success: false,
              displayText: `Tool "${toolName}" permanently unavailable (carried from prior strategy)`,
              category: "error" as const,
              resultKind: "error" as const,
              preserveOnCompaction: false,
              // S2.3 — error observations carry framework-generated text only,
              // safe to render inline. Mark as trusted with grandfather note.
              trustLevel: "trusted" as const,
              trustJustification: "grandfather-phase-1",
            },
          },
        ),
      );
      state = transitionState(state, { steps: [...state.steps, ...failedSteps] });
    }

    // Build updated input with handoff context. Also drop permanently-failed
    // tools from requiredTools — the lane controller uses this list to decide
    // whether to nudge, and nudging for a known-broken tool only causes retry loops.
    const existingPrior = priorInput.priorContext
      ? `${priorInput.priorContext}\n\n${handoffSummary}`
      : handoffSummary;

    const failedSet = new Set(handoff.permanentlyFailedTools);
    const currentInput: KernelInput = {
      ...priorInput,
      priorContext: existingPrior,
      requiredTools: failedSet.size > 0
        ? (priorInput.requiredTools ?? []).filter((t) => !failedSet.has(t))
        : priorInput.requiredTools,
    };

    const currentContext: KernelContext = { ...context, input: currentInput };

    return {
      state,
      currentInput,
      currentContext,
      currentOptions,
      switchCount: nextSwitchCount,
      resetCounters: SWITCH_RESET_COUNTERS,
    };
  });
}
