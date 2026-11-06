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
 * Invariant (Plan 8 item 3): every guard exit here is a PROPOSAL to the exit
 * gate (`../exit-gate.ts`), which accepts, denies once ("next"), or hands off.
 * The protocol terminal (`tool_call_unresolved`) is not a guard exit, it is the
 * shaped-reply contract: a harness-authority proposal the gate accepts outright
 * (Plan 9 Phase 4). Every gate disposition rides back as `exit`.
 */

import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { makeStep } from "../../../kernel/capabilities/sense/step-utils.js";
import { authorityOf } from "../../../kernel/capabilities/decide/authority.js";
import { hasUnresolvedThoughts, lastDeliverableText } from "../../capabilities/reflect/unresolved-steps.js";
import { injectSignal, recoveryTarget, requiredToolTarget } from "../../capabilities/reflect/signal-injection.js";
import { UNRESOLVED_DELIVERABLE, carriedProtocolStrikes } from "../../capabilities/reason/unresolved-tool-call.js";
import {
  transitionState,
  type KernelState,
  type KernelInput,
  type KernelRunOptions,
} from "../../../kernel/state/kernel-state.js";
import { guidanceOf } from "../../state/guidance-channel.js";
import {
  emitGuardFired,
} from "../../../kernel/utils/diagnostics.js";
import { missingRequiredToolsForInput } from "./state-queries.js";
import type { LoopDetection } from "../../capabilities/reflect/loop-detector.js";
import { modelSynthesisDeliverable, sentinelDeliverable, type Deliverable } from "@reactive-agents/core";
import {
  outstandingItems,
  proposeExit,
  proposeHarnessExit,
  type ExitDisposition,
  type ExitProposal,
} from "../exit-gate.js";
import {
  loopProgressAwareEnabled,
  progressSinceLastLoopVerdict,
  redirectRepeatAfterProgress,
} from "./loop-progress.js";
import type { TerminateReason } from "../terminate-reason.js";
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
  /** The detection behind `loopMsg` (pattern id + counter evidence), for trace provenance only. */
  readonly detection?: LoopDetection | null;
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
  /** The exit gate's disposition when this step proposed an exit (the turn runner ends the pass on it). */
  readonly exit?: ExitDisposition;
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
    // Decision provenance spread into every terminal `loop_resolution` record.
    const det = args.detection;
    const loopMeta = det ? { pattern: det.pattern.id, patternName: det.pattern.name, ...det.evidence } : {};
    let state = args.state;
    let failureRecoveryRedirects = args.failureRecoveryRedirects;
    let requiredToolNudgeCount = args.requiredToolNudgeCount;
    // Plan 8 item 3: every guard exit below is a proposal to the exit gate.
    // With nothing to hand off, the first soft proposal is still denied once
    // (a "write the final answer" nudge); after that the loop's honest failure
    // (loopMsg) stands, and
    // it is STAMPED with the loop's reason (K2, 2026-11-04): unstamped, the
    // failed run carried no terminatedBy, so it narrowed to `max_iterations`,
    // its terminal authority read `none-recorded`, and the user was told the
    // budget ran out at iteration 4 of 16.
    const propose = (kind: ExitProposal["kind"], reason: TerminateReason, deliverable: Deliverable) =>
      Effect.map(
        proposeExit({
          state,
          proposal: {
            proposedBy: "loop_resolution", kind, reason, deliverable,
            extraMeta: { terminalSite: "loop-resolution" },
            failure: { error: loopMsg, stampReason: true },
            detail: loopMsg,
          },
          input: currentInput,
          maxIterations: currentOptions.maxIterations,
          taskId: currentOptions.taskId ?? state.taskId,
        }),
        (gated): LoopResolutionResult => ({
          outcome: gated.decision === "deny-once" ? "next" : "break",
          exit: gated,
          state: gated.state,
          failureRecoveryRedirects,
          requiredToolNudgeCount,
        }),
      );

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
      const recoverySignal = yield* injectSignal(state, {
        taskId: currentOptions.taskId ?? state.taskId,
        signalKind: "redirect",
        origin: "runner.ts:1173",
        content: guidance,
        target: recoveryTarget(recovery),
        field: "errorRecovery",
        metadata: {
          failedTools: recovery.failedUnresolved,
          redirectCount: failureRecoveryRedirects,
          trigger: "loop",
        },
      });
      state = recoverySignal.state;
      state = transitionState(state, {
        status: "thinking",
        steps: [
          ...state.steps,
          makeStep("harness_signal", `⚠️ ${guidance}`, {
            // Spec §5b (W-Q) — loop recovery redirect. Deterministic: an
            // unresolved tool failure the run must resolve (evidence-driven).
            intervention: {
              actor: "recovery-steering",
              authorityClass: authorityOf("recovery-steering"),
              evidence: `unresolved tool failure(s): ${recovery.failedUnresolved.join(", ")}; redirect #${failureRecoveryRedirects}`,
              whatChanged: "recovery-steering: injected failure-recovery steering (loop)",
              iter: state.iteration,
            },
          }),
        ],
        pendingGuidance: guidanceOf([{ kind: "errorRecovery", text: guidance }], recoverySignal.pendingSignals),
        error: null,
      });
      return { outcome: "next", state, failureRecoveryRedirects, requiredToolNudgeCount };
    }

    // Plan 9 item 2f (lift-gated, harness switch, default OFF): an identical
    // repeat that follows new ledger progress since the previous loop verdict
    // is a stutter, not a loop. Redirect with the outstanding work instead of
    // proposing an exit. No progress in between: resolve as below.
    if (
      det?.pattern.id === "a" &&
      loopProgressAwareEnabled(currentInput.harness) &&
      progressSinceLastLoopVerdict(state)
    ) {
      const outstanding = outstandingItems(state, currentInput, assembleDeliverable(state));
      if (outstanding.length > 0) {
        state = yield* redirectRepeatAfterProgress({
          state, taskId: currentOptions.taskId ?? state.taskId, outstanding, loopMeta,
        });
        return { outcome: "next", state, failureRecoveryRedirects, requiredToolNudgeCount };
      }
    }

    const loopArtifactCount = countDeliverableCandidates(state);
    if (loopArtifactCount > 0) {
      const missingRequiredByCount = missingRequiredToolsForInput(state, currentInput);
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
            metadata: { loopArtifactCount, trigger: "loop_required_tool_exhausted", ...loopMeta },
          });
          // The nudge budget is spent: a `cap`-kind proposal (accept or handoff).
          return yield* propose("cap", deliverableTerminationReason(d), d);
        }
        const guidance =
          `Loop detected but required tool quota is still missing: ${missingRequiredByCount.join(", ")}. ` +
          `Call the missing required tool(s) now instead of finalizing.`;
        const nudgeSignal = yield* injectSignal(state, {
          taskId: currentOptions.taskId ?? state.taskId,
          signalKind: "nudge",
          origin: "runner.ts:1199",
          content: guidance,
          target: requiredToolTarget(missingRequiredByCount),
          field: "errorRecovery",
          metadata: { missingTools: missingRequiredByCount, trigger: "loop-with-missing-tools" },
        });
        state = nudgeSignal.state;
        state = transitionState(state, {
          status: "thinking",
          steps: [
            ...state.steps,
            makeStep("harness_signal", `⚠️ ${guidance}`, {
              // Spec §5b (W-Q) — loop-with-missing-required-tools nudge.
              // Deterministic: a loop AND a still-missing required tool (facts).
              intervention: {
                actor: "loop-missing-tools",
                authorityClass: authorityOf("loop-missing-tools"),
                evidence: `loop detected; missing required tool(s): ${missingRequiredByCount.join(", ")}`,
                whatChanged: "loop-missing-tools: steered model to call missing required tool(s)",
                iter: state.iteration,
              },
            }),
          ],
          pendingGuidance: guidanceOf([{ kind: "loopDetected", detected: true }, { kind: "requiredToolsPending", tools: missingRequiredByCount }, { kind: "errorRecovery", text: guidance }], nudgeSignal.pendingSignals),
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
        metadata: { loopArtifactCount, source: loopDeliverable.source, ...loopMeta },
      });
      return yield* propose("soft", deliverableTerminationReason(loopDeliverable), loopDeliverable);
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
    // Plan 8 item 3: a loop with no usable answer used to fail bare here
    // (loopMsg in `error`). It is now a soft proposal carrying a sentinel: the
    // gate denies it once (naming the missing answer) or hands off — the handoff
    // synthesis writes what the evidence supports plus the unfinished list.
    const noAnswer = sentinelDeliverable("no_substantive_output", loopMsg.slice(0, 200));
    if (hasToolAttempts) {
      yield* emitGuardFired({
        taskId: currentOptions.taskId ?? state.taskId, iteration: state.iteration,
        guard: "loop_resolution", outcome: "terminate", reason: "loop_failed",
        metadata: { loopArtifactCount: 0, trigger: "loop_with_tool_attempts", ...loopMeta },
      });
      return yield* propose("soft", "loop_graceful", noAnswer);
    }
    // Shaped-reply artifacts (tagged unresolved-tool-call thoughts + twins) are
    // never model prose: skip them, and if ONLY they exist terminate honestly.
    const lastThoughtContent = lastDeliverableText(state.steps);
    if (!lastThoughtContent && (hasUnresolvedThoughts(state.steps) || carriedProtocolStrikes(state.ledger) > 0)) {
      const exit = proposeHarnessExit(state, {
        proposedBy: "harness",
        end: { via: "terminate", options: { reason: "tool_call_unresolved", deliverable: UNRESOLVED_DELIVERABLE } },
      });
      return { outcome: "break", exit, state: exit.state, failureRecoveryRedirects, requiredToolNudgeCount };
    }
    if (lastThoughtContent && lastThoughtContent.trim().length > 0) {
      yield* emitGuardFired({
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
        guard: "loop_resolution",
        outcome: "terminate",
        reason: "loop_graceful",
        metadata: { loopArtifactCount: 0, trigger: "graceful_thought", ...loopMeta },
      });
      // Model-authored trailing thought → model_synthesis provenance.
      return yield* propose(
        "soft",
        "loop_graceful",
        modelSynthesisDeliverable({ type: "thought", content: lastThoughtContent, iteration: state.iteration }),
      );
    }
    yield* emitGuardFired({
      taskId: currentOptions.taskId ?? state.taskId, iteration: state.iteration,
      guard: "loop_resolution", outcome: "terminate", reason: "loop_failed",
      metadata: { loopArtifactCount: 0, trigger: "loop_no_thought_content", ...loopMeta },
    });
    return yield* propose("soft", "loop_graceful", noAnswer);
  });
}
