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
import { authorityOf } from "../../../kernel/capabilities/decide/authority.js";
import { terminate } from "../terminate.js";
import {
  transitionState,
  DEFAULT_STALL_POLICY,
  type KernelState,
  type KernelInput,
  type KernelRunOptions,
} from "../../../kernel/state/kernel-state.js";
import {
  emitHarnessSignalInjected,
  emitGuardFired,
} from "../../../kernel/utils/diagnostics.js";
import { verifyAndEmit, type Verifier } from "../../../kernel/capabilities/verify/verifier.js";
import { deliverableToContent } from "@reactive-agents/core";
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

/**
 * Build the required-tool nudge. The first nudge is the plain reminder; repeats
 * ESCALATE (count-aware, stronger directive) when `escalate` is true — a
 * verbatim repeat the model already ignored is wasted effort (StallPolicy C).
 */
export function buildRequiredToolNudge(
  missing: readonly string[],
  nudgeCount: number,
  ignoredStreak: number,
  escalate: boolean,
): string {
  const tools = missing.join(", ");
  const base =
    `Required tool quota not met: ${tools}. ` +
    `Continue calling the missing required tool(s) before attempting completion.`;
  if (!escalate || nudgeCount <= 1) return base;
  return (
    `You have NOT called the required tool(s) [${tools}] despite ${nudgeCount} reminders` +
    (ignoredStreak > 0 ? ` (${ignoredStreak} ignored in a row)` : "") +
    `. Call ${tools} NOW with concrete arguments — do NOT call meta-tools ` +
    `(brief/pulse/find/discover-tools) or attempt a final answer until you have. ` +
    `Continuing to ignore this will fail the task.`
  );
}

/**
 * Whether a required-tool nudge was IGNORED this iteration (StallPolicy A).
 *
 * Legacy definition: the still-missing required set did NOT shrink since the
 * previous nudge (no progress toward it) — `prevMissing >= 0 && current >= prev`.
 *
 * E2 (audit 02-#6, required-tool-last): a GATHERING-phase iteration that has not
 * yet called the required (usually terminal write) tool is NOT ignoring the
 * nudge — the run is legitimately still collecting inputs it needs BEFORE it can
 * produce. Counting those iterations as "ignored" fast-escalates a
 * required-tool-LAST task to failure before the model ever reaches the write.
 * When `gatheringPhase` is true the iteration is never "ignored". OFF
 * (`gatheringPhase` falsy — profile off) → byte-identical to the legacy rule.
 */
export function isIgnoredNudge(
  gatheringPhase: boolean,
  prevMissingCount: number,
  currentMissingCount: number,
): boolean {
  if (gatheringPhase) return false;
  return prevMissingCount >= 0 && currentMissingCount >= prevMissingCount;
}

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
  /**
   * A2 — long-horizon-scaled `ignoredNudgeTolerance`, or `undefined` when the
   * profile is off. Precedence: an explicit `currentInput.stallPolicy`
   * override still wins; this only replaces the DEFAULT_STALL_POLICY floor.
   */
  readonly horizonIgnoredNudgeTolerance?: number;
  /**
   * E2 (audit 02-#6) — the run is in the GATHERING phase (from the cached
   * RunAssessment, resolved under the long-horizon profile). When true, a
   * still-missing required (usually terminal write) tool is NOT treated as an
   * "ignored" nudge: the model is legitimately collecting inputs before it can
   * produce. `undefined`/`false` (profile off) → the ignored definition is
   * byte-identical to today.
   */
  readonly gatheringPhase?: boolean;
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
      // ── Compliance tracking (StallPolicy A) ──────────────────────────────
      // A nudge is "ignored" when the still-missing required set did NOT shrink
      // since the previous nudge (the model made no progress toward it). A model
      // that ignores the same nudge repeatedly will keep ignoring it — so after
      // `ignoredNudgeTolerance` consecutive ignored nudges, fast-escalate
      // (deliver-or-fail) instead of burning iterations up to the full cap.
      // Counters persist across iterations via state.meta (no carrier change).
      const policy = { ...DEFAULT_STALL_POLICY, ...(currentInput.stallPolicy ?? {}) };
      // A2 — resolve the effective ignored-nudge tolerance. Precedence:
      // explicit user stallPolicy > long-horizon scaled value > default (2).
      const ignoredNudgeTolerance =
        currentInput.stallPolicy?.ignoredNudgeTolerance ??
        args.horizonIgnoredNudgeTolerance ??
        policy.ignoredNudgeTolerance;
      const prevMissing = (state.meta.lastMissingRequiredCount as number | undefined) ?? -1;
      // E2 (audit 02-#6): a gathering-phase iteration that hasn't yet called the
      // required (terminal write) tool is NOT ignoring the nudge — don't accrue
      // it toward fast-escalation. OFF (gatheringPhase falsy) → byte-identical.
      const ignored = isIgnoredNudge(
        args.gatheringPhase ?? false,
        prevMissing,
        missingRequiredByCount.length,
      );
      const consecutiveIgnoredNudges = ignored
        ? ((state.meta.consecutiveIgnoredNudges as number | undefined) ?? 0) + 1
        : 0;
      const fastEscalate = consecutiveIgnoredNudges >= ignoredNudgeTolerance;

      if (requiredToolNudgeCount > maxRequiredToolNudges || fastEscalate) {
        const escReason = fastEscalate
          ? `${consecutiveIgnoredNudges} consecutive ignored nudges (no progress on ${missingRequiredByCount.join(", ")})`
          : `${maxRequiredToolNudges} nudge attempts`;
        // Fast-escalation means the model is STUCK on a mandatory tool with no
        // progress — delivering partial artifacts would ship a result that
        // skipped a required tool. Fail honestly. The cap-exhaustion path keeps
        // its deliver-if-artifacts fallback (a longer run that may have made
        // other real progress before the budget ran out).
        if (totalArtifacts > 0 && !fastEscalate) {
          yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Required-tool nudges escalated (${escReason}) — delivering ${totalArtifacts} artifacts`, timestamp: new Date() });
          const d = assembleDeliverable(state);
          yield* emitGuardFired({
            taskId: currentOptions.taskId ?? state.taskId,
            iteration: state.iteration,
            guard: "stall_deliverable",
            outcome: "terminate",
            reason: deliverableTerminationReason(d),
            metadata: { totalArtifacts, trigger: fastEscalate ? "ignored_nudge_escalation" : "required_tool_nudge_exhausted", consecutiveIgnoredNudges },
          });
          state = terminate(state, {
            reason: deliverableTerminationReason(d),
            deliverable: d,
          });
          return { outcome: "break", state, requiredToolNudgeCount, failureRecoveryRedirects };
        }
        state = transitionState(state, {
          status: "failed",
          error: `Required tool quota not met after ${escReason}: ${missingRequiredByCount.join(", ")}`,
        });
        return { outcome: "break", state, requiredToolNudgeCount, failureRecoveryRedirects };
      }
      // ── Nudge content escalation (StallPolicy C) ─────────────────────────
      const guidance = buildRequiredToolNudge(
        missingRequiredByCount,
        requiredToolNudgeCount,
        consecutiveIgnoredNudges,
        policy.escalateNudgeContent,
      );
      yield* emitHarnessSignalInjected({
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
        signalKind: "nudge",
        origin: "runner.ts:875",
        content: guidance,
        metadata: { missingTools: missingRequiredByCount, nudgeCount: requiredToolNudgeCount, ignoredStreak: consecutiveIgnoredNudges },
      });
      state = transitionState(state, {
        status: "thinking",
        steps: [
          ...state.steps,
          makeStep("harness_signal", `⚠️ ${guidance}`, {
            // Spec §5b (W-Q) — StallPolicy required-tool nudge. Deterministic:
            // a contract-required tool was not called (a RunContract fact).
            intervention: {
              actor: "required-tool-nudge",
              authorityClass: authorityOf("required-tool-nudge"),
              evidence: `missing required tool(s): ${missingRequiredByCount.join(", ")}; nudge #${requiredToolNudgeCount}`,
              whatChanged: "required-tool-nudge: steered model to call missing required tool(s)",
              iter: state.iteration,
            },
          }),
        ],
        pendingGuidance: { requiredToolsPending: missingRequiredByCount, errorRecovery: guidance },
        meta: {
          ...state.meta,
          consecutiveIgnoredNudges,
          lastMissingRequiredCount: missingRequiredByCount.length,
        } as KernelState["meta"],
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
        steps: [
          ...state.steps,
          makeStep("harness_signal", `⚠️ ${guidance}`, {
            // Spec §5b (W-Q) — stall recovery redirect. Deterministic: an
            // unresolved tool failure the run must resolve (evidence-driven).
            intervention: {
              actor: "recovery-steering",
              authorityClass: authorityOf("recovery-steering"),
              evidence: `unresolved tool failure(s): ${recovery.failedUnresolved.join(", ")}; redirect #${failureRecoveryRedirects}`,
              whatChanged: "recovery-steering: injected failure-recovery steering (stall)",
              iter: state.iteration,
            },
          }),
        ],
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
      const candidateOutput = deliverableToContent(candidateDeliverable);
      const candidateTerminationReason = deliverableTerminationReason(candidateDeliverable);
      // candidateOutput is consumed by the verifier emit below (the trace the
      // §9.0 post-loop gate reads); the terminate() output write itself routes
      // the typed Deliverable through commitDeliverable.
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
      yield* emitGuardFired({
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
        guard: "stall_deliverable",
        outcome: "terminate",
        reason: candidateTerminationReason,
        metadata: { totalArtifacts, consecutiveStalled, source: candidateDeliverable.source },
      });
      state = terminate(state, {
        reason: candidateTerminationReason,
        deliverable: candidateDeliverable,
      });
      return { outcome: "break", state, requiredToolNudgeCount, failureRecoveryRedirects };
    }

    return proceed();
  });
}
