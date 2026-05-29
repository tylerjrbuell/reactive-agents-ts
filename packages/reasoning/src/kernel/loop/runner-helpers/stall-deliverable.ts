/**
 * runner-helpers/stall-deliverable.ts — Harness stall / deliverable phase-step.
 *
 * Extracted from `iterate-pass.ts` in WS-6 CORRECTION 5 (2026-05-29). When the
 * model has produced no NEW non-meta tool observations for `stallThreshold`
 * consecutive iterations (and we're past iter 2, still thinking), the harness
 * takes over completion. This step owns that takeover decision tree:
 *
 *   1. Missing required tools → nudge (or, once the nudge budget is spent,
 *      deliver accumulated artifacts / fail on quota).
 *   2. Failed tool path with viable alternatives → recovery-steering redirect.
 *   3. Otherwise, with artifacts on hand → run the verifier (emit-only; M3
 *      REWORK removed the retry) and deliver the assembled artifacts.
 *
 * Returned outcome:
 *   - `"break"`     — terminated (delivered or failed); outer loop must exit.
 *   - `"next"`      — a nudge/redirect was injected; re-run the loop body.
 *   - `"proceed"`   — stall guard didn't fire (or fired with no actionable
 *                     branch); the iteration body continues to ICS / oracle.
 *
 * The two counters this step mutates (`requiredToolNudgeCount`,
 * `failureRecoveryRedirects`) are explicit in/out params — that signature IS
 * the readability win: a reader sees exactly what stall owns.
 *
 * Invariant: `terminate()` stays the single state.status finalize owner —
 * every "break" here either calls `terminate()` or sets status:"failed" via
 * `transitionState`, exactly as the inline body did. No new finalize path.
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
import { emitHarnessSignalInjected } from "../../../kernel/utils/diagnostics.js";
import { verifyAndEmit, type Verifier } from "../../../kernel/capabilities/verify/verifier.js";
import {
  assembleDeliverable,
  deliverableTerminationReason,
} from "./deliverable.js";
import {
  buildRecoverySteeringGuidance,
  getToolFailureRecovery,
} from "./recovery-steering.js";

/** Outcome of the stall / harness-deliverable phase-step. */
export type StallOutcome = "break" | "next" | "proceed";

export interface StallStepArgs {
  readonly state: KernelState;
  readonly currentInput: KernelInput;
  readonly currentOptions: KernelRunOptions;
  /** Required tools the lane controller flagged missing this iteration. */
  readonly missingRequiredByCount: readonly string[];
  /** Whether the stall guard is eligible to fire this iteration. */
  readonly stallTriggered: boolean;
  /** Total deliverable artifacts seen this iteration. */
  readonly totalArtifacts: number;
  /** Consecutive stalled-iteration count (for the delivery log message). */
  readonly consecutiveStalled: number;
  /** Nudge budget consumed so far (mutated and returned). */
  readonly requiredToolNudgeCount: number;
  /** Recovery redirects so far (mutated and returned). */
  readonly failureRecoveryRedirects: number;
  readonly maxRequiredToolNudges: number;
  readonly maxFailureRecoveryRedirects: number;
  readonly verifier: Verifier;
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
}

export interface StallStepResult {
  readonly outcome: StallOutcome;
  readonly state: KernelState;
  readonly requiredToolNudgeCount: number;
  readonly failureRecoveryRedirects: number;
}

/**
 * Run the stall / harness-deliverable decision tree for one iteration.
 *
 * When `stallTriggered` is false the step is a no-op and returns "proceed" with
 * the inputs unchanged — keeping the gating condition at the call site readable.
 */
export function runStallDeliverableStep(
  args: StallStepArgs,
): Effect.Effect<StallStepResult, never, never> {
  return Effect.gen(function* () {
    const {
      currentInput,
      currentOptions,
      missingRequiredByCount,
      stallTriggered,
      totalArtifacts,
      consecutiveStalled,
      maxRequiredToolNudges,
      maxFailureRecoveryRedirects,
      verifier,
      emitLog,
    } = args;
    let state = args.state;
    let requiredToolNudgeCount = args.requiredToolNudgeCount;
    let failureRecoveryRedirects = args.failureRecoveryRedirects;

    const proceed = (): StallStepResult => ({
      outcome: "proceed",
      state,
      requiredToolNudgeCount,
      failureRecoveryRedirects,
    });

    if (!stallTriggered) return proceed();

    if (missingRequiredByCount.length > 0) {
      requiredToolNudgeCount++;
      if (requiredToolNudgeCount > maxRequiredToolNudges) {
        if (totalArtifacts > 0) {
          yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Required-tool nudge budget exhausted (${maxRequiredToolNudges}) — delivering ${totalArtifacts} artifacts`, timestamp: new Date() });
          const d = assembleDeliverable(state);
          state = terminate(state, {
            reason: deliverableTerminationReason(d),
            output: d.content,
          });
          return { outcome: "break", state, requiredToolNudgeCount, failureRecoveryRedirects };
        }
        state = transitionState(state, {
          status: "failed",
          error: `Required tool quota not met after ${maxRequiredToolNudges} nudge attempts: ${missingRequiredByCount.join(", ")}`,
        });
        return { outcome: "break", state, requiredToolNudgeCount, failureRecoveryRedirects };
      }
      const guidance =
        `Required tool quota not met: ${missingRequiredByCount.join(", ")}. ` +
        `Continue calling the missing required tool(s) before attempting completion.`;
      yield* emitHarnessSignalInjected({
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
        signalKind: "nudge",
        origin: "runner.ts:875",
        content: guidance,
        metadata: { missingTools: missingRequiredByCount, nudgeCount: requiredToolNudgeCount },
      });
      state = transitionState(state, {
        status: "thinking",
        steps: [...state.steps, makeStep("harness_signal", `⚠️ ${guidance}`)],
        pendingGuidance: { requiredToolsPending: missingRequiredByCount, errorRecovery: guidance },
      });
      return { outcome: "next", state, requiredToolNudgeCount, failureRecoveryRedirects };
    }

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
        "stall",
      );

      yield* emitHarnessSignalInjected({
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
        signalKind: "redirect",
        origin: "runner.ts:897",
        content: guidance,
        metadata: {
          failedTools: recovery.failedUnresolved,
          alternatives: recovery.alternativeCandidates,
          redirectCount: failureRecoveryRedirects,
        },
      });
      state = transitionState(state, {
        status: "thinking",
        steps: [...state.steps, makeStep("harness_signal", `⚠️ ${guidance}`)],
        pendingGuidance: { errorRecovery: guidance },
        meta: {
          ...state.meta,
          recoveryPending: true,
          recoveryFailedTools: recovery.failedUnresolved,
          recoveryAlternativeCandidates: recovery.alternativeCandidates,
        },
      });
      return { outcome: "next", state, requiredToolNudgeCount, failureRecoveryRedirects };
    }

    if (totalArtifacts > 0) {
      // Verifier-driven retry on harness fallback (Pivot A, 2026-05-06).
      //
      // Pre-fix: the harness assembled raw `_tool_result_*` artifacts and
      // shipped them as the final answer. The verifier never saw the
      // output (loop broke before §9.0 ran), so quality-degraded JSON
      // dumps silently passed to the user. Empirical evidence: cogito:14b
      // T5 trace 01KQZFHFQA97RHHCNXQ792VWNQ — verified=true on a raw
      // JSON dump rated 7% faithfulness by the quality scorer.
      //
      // Post-fix: run the verifier on the candidate harness output with
      // terminatedBy="harness_deliverable" so the new
      // `output-is-model-authored` check rejects it. If retry budget
      // allows, inject the verdict-driven signal and continue thinking
      // — the model gets one more chance to synthesize from the
      // artifacts before the harness ships them as-is. If retry budget
      // is exhausted (or verifier passes — should be impossible with
      // the new check), fall through to the original terminate path.
      const candidateDeliverable = assembleDeliverable(state);
      const candidateOutput = candidateDeliverable.content;
      const candidateTerminationReason = deliverableTerminationReason(candidateDeliverable);
      const availableUserToolsForFallback =
        (currentInput.availableToolSchemas ?? []).map((t) => t.name);
      // M3 REWORK (2026-05-12): the retry path was removed, so the
      // verdict isn't consumed here — we just need the emit so the
      // outer post-loop §9.0 gate can read the trace. WS-3 Phase 5a
      // routes the emit through the verify capability boundary.
      yield* verifyAndEmit({
        verifier,
        context: {
          action: "final-answer",
          content: candidateOutput,
          actionSuccess: true,
          task: currentInput.task,
          priorSteps: state.steps,
          requiredTools: currentInput.requiredTools,
          relevantTools: currentInput.relevantTools,
          toolsUsed: state.toolsUsed,
          availableUserTools: availableUserToolsForFallback,
          terminal: true,
          terminatedBy: candidateTerminationReason,
        },
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
      });
      // M3 REWORK (2026-05-12): retry loop removed per ablation verdict.
      // Verifier gate still fires (emitted above); rejection falls through
      // to the §9.0 post-loop outer gate which marks the run failed.
      // Proceed with original
      // harness fallback. terminate() preserves the single-owner invariant.
      yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Assembling output from ${totalArtifacts} tool artifacts after ${consecutiveStalled} stalled iterations (source=${candidateDeliverable.source})`, timestamp: new Date() });
      state = terminate(state, {
        reason: candidateTerminationReason,
        output: candidateOutput,
      });
      return { outcome: "break", state, requiredToolNudgeCount, failureRecoveryRedirects };
    }

    return proceed();
  });
}
