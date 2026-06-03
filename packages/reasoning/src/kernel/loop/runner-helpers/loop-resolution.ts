/**
 * runner-helpers/loop-resolution.ts — Loop-detected resolution phase-step.
 *
 * Extracted from `iterate-pass.ts` in WS-6 CORRECTION 5 (2026-05-29). Reached
 * ONLY when the loop detector trips (`loopMsg !== null`) AND a strategy switch
 * was not taken (switching disabled, exhausted, or the evaluator declined).
 * The switch-evaluation orchestration stays inline in `runIterationPass`; this
 * step owns the "what do we do with a confirmed loop and no switch" tree:
 *
 *   1. Failed tool path with viable alternatives → recovery-steering redirect.
 *   2. Artifacts on hand:
 *        a. required-tool quota still missing → nudge (or deliver once budget
 *           is spent).
 *        b. quota met → deliver the assembled artifacts.
 *   3. No artifacts:
 *        a. tool calls were attempted → genuine failure (loopMsg in `error`).
 *        b. pure thought loop with a substantive last thought → graceful
 *           delivery of that thought.
 *        c. otherwise → failure.
 *
 * Always resolves to `"break"` or `"next"` — a confirmed loop never proceeds to
 * the rest of the iteration body. The two counters it mutates
 * (`failureRecoveryRedirects`, `requiredToolNudgeCount`) are explicit in/out
 * params — same shape as the stall step.
 *
 * Invariant: `terminate()` stays the single state.status finalize owner; every
 * "break" path here calls `terminate()` or sets status:"failed" via
 * `transitionState`, exactly as the inline body did.
 */

import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { makeStep } from "../../../kernel/capabilities/sense/step-utils.js";
import { terminate } from "../terminate.js";
import {
  transitionState,
  type KernelState,
  type KernelInput,
  type KernelRunOptions,
} from "../../../kernel/state/kernel-state.js";
import {
  emitHarnessSignalInjected,
  emitGuardFired,
} from "../../../kernel/utils/diagnostics.js";
import { missingRequiredToolsForInput } from "./state-queries.js";
import { deliverableToContent } from "@reactive-agents/core";
import {
  assembleDeliverable,
  deliverableTerminationReason,
  countDeliverableCandidates,
} from "./deliverable.js";
import {
  buildRecoverySteeringGuidance,
  getToolFailureRecovery,
} from "./recovery-steering.js";

/** Outcome of the loop-resolution phase-step. */
export type LoopResolutionOutcome = "break" | "next";

export interface LoopResolutionArgs {
  readonly state: KernelState;
  readonly currentInput: KernelInput;
  readonly currentOptions: KernelRunOptions;
  /** The loop-detector message that tripped this resolution (non-null). */
  readonly loopMsg: string;
  /** Recovery redirects so far (mutated and returned). */
  readonly failureRecoveryRedirects: number;
  /** Nudge budget consumed so far (mutated and returned). */
  readonly requiredToolNudgeCount: number;
  readonly maxFailureRecoveryRedirects: number;
  readonly maxRequiredToolNudges: number;
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
}

export interface LoopResolutionResult {
  readonly outcome: LoopResolutionOutcome;
  readonly state: KernelState;
  readonly failureRecoveryRedirects: number;
  readonly requiredToolNudgeCount: number;
}

/**
 * Resolve a confirmed loop (no switch taken) for one iteration. Always returns
 * "break" or "next" — never proceeds.
 */
export function resolveDetectedLoop(
  args: LoopResolutionArgs,
): Effect.Effect<LoopResolutionResult, never, never> {
  return Effect.gen(function* () {
    const {
      currentInput,
      currentOptions,
      loopMsg,
      maxFailureRecoveryRedirects,
      maxRequiredToolNudges,
      emitLog,
    } = args;
    let state = args.state;
    let failureRecoveryRedirects = args.failureRecoveryRedirects;
    let requiredToolNudgeCount = args.requiredToolNudgeCount;

    // Before failing: if the model has gathered artifacts, succeed with them.
    // Loops with data → deliver. Loops without data → fail.
    const recovery = getToolFailureRecovery(state, currentInput);
    const shouldNudgeRecovery =
      recovery.failedUnresolved.length > 0 &&
      failureRecoveryRedirects < maxFailureRecoveryRedirects;

    if (shouldNudgeRecovery) {
      failureRecoveryRedirects++;
      const guidance = buildRecoverySteeringGuidance(
        recovery,
        failureRecoveryRedirects,
        maxFailureRecoveryRedirects,
        "loop",
      );
      yield* emitHarnessSignalInjected({
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
        signalKind: "redirect",
        origin: "runner.ts:1173",
        content: guidance,
        metadata: {
          failedTools: recovery.failedUnresolved,
          redirectCount: failureRecoveryRedirects,
          trigger: "loop",
        },
      });
      state = transitionState(state, {
        status: "thinking",
        steps: [...state.steps, makeStep("harness_signal", `⚠️ ${guidance}`)],
        pendingGuidance: { errorRecovery: guidance },
        error: null,
      });
      return { outcome: "next", state, failureRecoveryRedirects, requiredToolNudgeCount };
    }

    const loopArtifactCount = countDeliverableCandidates(state);
    if (loopArtifactCount > 0) {
      const missingRequiredByCount = missingRequiredToolsForInput(state.steps, currentInput);
      if (missingRequiredByCount.length > 0) {
        requiredToolNudgeCount++;
        if (requiredToolNudgeCount > maxRequiredToolNudges) {
          yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Required-tool nudge budget exhausted in loop detection (${maxRequiredToolNudges}) — delivering ${loopArtifactCount} artifacts`, timestamp: new Date() });
          const d = assembleDeliverable(state);
          yield* emitGuardFired({
            taskId: currentOptions.taskId ?? state.taskId,
            iteration: state.iteration,
            guard: "loop_resolution",
            outcome: "terminate",
            reason: deliverableTerminationReason(d),
            metadata: { loopArtifactCount, trigger: "loop_required_tool_exhausted" },
          });
          state = terminate(state, {
            reason: deliverableTerminationReason(d),
            output: deliverableToContent(d),
          });
          return { outcome: "break", state, failureRecoveryRedirects, requiredToolNudgeCount };
        }
        const guidance =
          `Loop detected but required tool quota is still missing: ${missingRequiredByCount.join(", ")}. ` +
          `Call the missing required tool(s) now instead of finalizing.`;
        yield* emitHarnessSignalInjected({
          taskId: currentOptions.taskId ?? state.taskId,
          iteration: state.iteration,
          signalKind: "nudge",
          origin: "runner.ts:1199",
          content: guidance,
          metadata: { missingTools: missingRequiredByCount, trigger: "loop-with-missing-tools" },
        });
        state = transitionState(state, {
          status: "thinking",
          steps: [...state.steps, makeStep("harness_signal", `⚠️ ${guidance}`)],
          pendingGuidance: { loopDetected: true, requiredToolsPending: missingRequiredByCount, errorRecovery: guidance },
          error: null,
        });
        return { outcome: "next", state, failureRecoveryRedirects, requiredToolNudgeCount };
      }

      const loopDeliverable = assembleDeliverable(state);
      yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Loop detected but ${loopArtifactCount} artifacts gathered — delivering instead of failing (source=${loopDeliverable.source})`, timestamp: new Date() });
      yield* emitGuardFired({
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
        guard: "loop_resolution",
        outcome: "terminate",
        reason: deliverableTerminationReason(loopDeliverable),
        metadata: { loopArtifactCount, source: loopDeliverable.source },
      });
      state = terminate(state, {
        reason: deliverableTerminationReason(loopDeliverable),
        output: deliverableToContent(loopDeliverable),
      });
      return { outcome: "break", state, failureRecoveryRedirects, requiredToolNudgeCount };
    }

    // Distinguish: if no tool calls were attempted, it's a pure thought loop.
    // Degrade gracefully — deliver the last thought rather than a cryptic error.
    // If tool calls were attempted but produced no deliverable results, it IS
    // a genuine failure (the agent tried tools and got stuck).
    //
    // Output-boundary discipline (per types/step.ts isUserVisibleStep):
    // when the lastThought has no real content, do NOT substitute the
    // loop-detector diagnostic as the user-visible answer — that's a
    // harness internal. Instead, fail with the diagnostic in `error`
    // so the transitionState invariant nulls the output and the user
    // sees a structured failure rather than developer-targeted advice.
    const hasToolAttempts = state.steps.some((s) => s.type === "action");
    if (hasToolAttempts) {
      state = transitionState(state, {
        status: "failed",
        error: loopMsg,
      });
    } else {
      const lastThought = [...state.steps].reverse().find((s) => s.type === "thought");
      const lastThoughtContent = lastThought?.content;
      if (lastThoughtContent && lastThoughtContent.trim().length > 0) {
        yield* emitGuardFired({
          taskId: currentOptions.taskId ?? state.taskId,
          iteration: state.iteration,
          guard: "loop_resolution",
          outcome: "terminate",
          reason: "loop_graceful",
          metadata: { loopArtifactCount: 0, trigger: "graceful_thought" },
        });
        state = terminate(state, {
          reason: "loop_graceful",
          output: lastThoughtContent,
        });
      } else {
        state = transitionState(state, {
          status: "failed",
          error: loopMsg,
        });
      }
    }
    return { outcome: "break", state, failureRecoveryRedirects, requiredToolNudgeCount };
  });
}
