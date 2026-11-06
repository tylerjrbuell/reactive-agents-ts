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
 * Invariant (Plan 8 item 3): this step never terminates on its own authority.
 * Every exit is a PROPOSAL to the exit gate (`../exit-gate.ts`), which accepts
 * it (via `terminate()`), denies it once ("next"), or ends the run as a handoff.
 */

import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { makeStep } from "../../../kernel/capabilities/sense/step-utils.js";
import { authorityOf } from "../../../kernel/capabilities/decide/authority.js";
import { proposeExit, type ExitDisposition } from "../exit-gate.js";
import { injectSignal, recoveryTarget, requiredToolTarget } from "../../capabilities/reflect/signal-injection.js";
import {
  transitionState,
  DEFAULT_STALL_POLICY,
  type KernelState,
  type KernelInput,
  type KernelRunOptions,
} from "../../../kernel/state/kernel-state.js";
import { guidanceOf } from "../../state/guidance-channel.js";
import type { Verifier } from "../../../kernel/capabilities/verify/verifier.js";
import { deliverableToContent } from "@reactive-agents/core";
import {
  assembleDeliverable,
  deliverableTerminationReason,
  getDeliverableObservationContent,
} from "./deliverable.js";
import { isStallExemptTool } from "../../assessment/guard-adapters.js";
import { actionToolName } from "../../assessment/progress-arbiter.js";
import { guardEvidence } from "../../../kernel/utils/guard-evidence.js";
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

/**
 * Plan 9 Phase 2a — how many stall-exempt META calls (todo, brief, pulse, ...)
 * the current stall streak EXCLUDED: the meta action steps after the last
 * deliverable-candidate observation (the event that last reset the counter).
 * Pure trace evidence for the stall guard-fired record; read by nothing that
 * decides. Deterministic over `state.steps`.
 */
export function metaCallsSinceLastCandidate(state: KernelState): number {
  let count = 0;
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const step = state.steps[i];
    if (step === undefined) continue;
    if (getDeliverableObservationContent(state, step) !== null) break;
    if (step.type === "action" && isStallExemptTool(actionToolName(step))) count++;
  }
  return count;
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
  /** The live stalled-iteration threshold (trace evidence only). */
  readonly stallThreshold?: number;
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
  /** The exit gate's disposition when this step proposed an exit (the turn runner ends the pass on it). */
  readonly exit?: ExitDisposition;
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
      stallThreshold,
      maxRequiredToolNudges,
      maxFailureRecoveryRedirects,
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
    // Plan 9 2a: the meta churn this streak held (not counted) — trace evidence.
    const metaCallsExcluded = metaCallsSinceLastCandidate(state);

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
        // Decision provenance: the counter that tripped vs its live threshold.
        const nudgeEvidence = fastEscalate
          ? guardEvidence("consecutiveIgnoredNudges", consecutiveIgnoredNudges, ignoredNudgeTolerance)
          : guardEvidence("requiredToolNudgeCount", requiredToolNudgeCount, maxRequiredToolNudges);
        const escReason = fastEscalate
          ? `${consecutiveIgnoredNudges} consecutive ignored nudges (no progress on ${missingRequiredByCount.join(", ")})`
          : `${maxRequiredToolNudges} nudge attempts`;
        // Fast-escalation means the model is STUCK on a mandatory tool with no
        // progress — delivering partial artifacts would ship a result that
        // skipped a required tool. Fail honestly. The cap-exhaustion path keeps
        // its deliver-if-artifacts fallback (a longer run that may have made
        // other real progress before the budget ran out).
        // Plan 8 item 3: the guard PROPOSES; the exit gate disposes. The nudge
        // budget is the bound that just ran out, so the proposal is `cap`-kind
        // (never denied again): nothing outstanding → accept, else → handoff,
        // whose unfinished list names the missing tool. Never a bare failure.
        const d = assembleDeliverable(state);
        const delivering = totalArtifacts > 0 && !fastEscalate;
        if (delivering) {
          yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Required-tool nudges escalated (${escReason}) — delivering ${totalArtifacts} artifacts`, timestamp: new Date() });
        }
        // The guard's event rides the proposal: the gate emits it with an
        // outcome from its decision (never a pre-gate `terminate`, Task #43).
        const gated = yield* proposeExit({
          state,
          proposal: {
            proposedBy: delivering ? "stall_deliverable" : "required_tool_quota",
            kind: "cap",
            reason: deliverableTerminationReason(d),
            deliverable: d,
            extraMeta: { terminalSite: "stall-deliverable" },
            failure: { error: `Required tool quota not met after ${escReason}: ${missingRequiredByCount.join(", ")}` },
            guardEvent: {
              guard: delivering ? "stall_deliverable" : "required_tool_quota",
              reason: delivering ? deliverableTerminationReason(d) : fastEscalate ? "ignored_nudge_escalation" : "required_tool_nudge_exhausted",
              metadata: delivering
                ? { totalArtifacts, trigger: "required_tool_nudge_exhausted", consecutiveIgnoredNudges, metaCallsExcluded, ...nudgeEvidence }
                : { missing: missingRequiredByCount, totalArtifacts, escalation: escReason, ...nudgeEvidence },
            },
          },
          input: currentInput,
          maxIterations: currentOptions.maxIterations,
          taskId: currentOptions.taskId ?? state.taskId,
        });
        state = gated.state;
        return { outcome: "break", exit: gated, state, requiredToolNudgeCount, failureRecoveryRedirects };
      }
      // ── Nudge content escalation (StallPolicy C) ─────────────────────────
      const guidance = buildRequiredToolNudge(
        missingRequiredByCount,
        requiredToolNudgeCount,
        consecutiveIgnoredNudges,
        policy.escalateNudgeContent,
      );
      const nudgeSignal = yield* injectSignal(state, {
        taskId: currentOptions.taskId ?? state.taskId,
        signalKind: "nudge",
        origin: "runner.ts:875",
        content: guidance,
        target: requiredToolTarget(missingRequiredByCount),
        field: "errorRecovery",
        metadata: { missingTools: missingRequiredByCount, nudgeCount: requiredToolNudgeCount, ignoredStreak: consecutiveIgnoredNudges },
      });
      state = nudgeSignal.state;
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
        pendingGuidance: guidanceOf([{ kind: "requiredToolsPending", tools: missingRequiredByCount }, { kind: "errorRecovery", text: guidance }], nudgeSignal.pendingSignals),
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

      const recoverySignal = yield* injectSignal(state, {
        taskId: currentOptions.taskId ?? state.taskId,
        signalKind: "redirect",
        origin: "runner.ts:897",
        content: guidance,
        target: recoveryTarget(recovery),
        field: "errorRecovery",
        metadata: {
          failedTools: recovery.failedUnresolved,
          alternatives: recovery.alternativeCandidates,
          redirectCount: failureRecoveryRedirects,
        },
      });
      state = recoverySignal.state;
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
        pendingGuidance: guidanceOf([{ kind: "errorRecovery", text: guidance }], recoverySignal.pendingSignals),
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
      const candidateTerminationReason = deliverableTerminationReason(candidateDeliverable);
      // H3: no site-local verify. The verdict was computed here and DISCARDED
      // (R14: answer left `declared`); the post-loop terminal gate
      // (runner-terminal-verify-gate.ts) is the ONE boundary — it verifies this
      // deliverable (terminatedBy carried), consumes the verdict, writes the
      // ledger verdict and stamps provenance. terminate() keeps single-owner.
      // Proceed with original
      // harness fallback. terminate() preserves the single-owner invariant.
      yield* emitLog({ _tag: "warning", message: `[harness-deliverable] Assembling output from ${totalArtifacts} tool artifacts after ${consecutiveStalled} stalled iterations (source=${candidateDeliverable.source})`, timestamp: new Date() });
      // Plan 8 item 3: a soft proposal — the exit gate accepts it, denies it
      // once (naming what is outstanding), or ends the run as a handoff. The
      // guard's event rides the proposal (outcome from the gate's decision).
      const gated = yield* proposeExit({
        state,
        proposal: {
          proposedBy: "stall_deliverable",
          kind: "soft",
          reason: candidateTerminationReason,
          deliverable: candidateDeliverable,
          extraMeta: { terminalSite: "stall-deliverable" },
          guardEvent: {
            guard: "stall_deliverable",
            reason: candidateTerminationReason,
            metadata: {
              totalArtifacts, consecutiveStalled, metaCallsExcluded, source: candidateDeliverable.source,
              ...(stallThreshold !== undefined ? guardEvidence("consecutiveStalled", consecutiveStalled, stallThreshold) : {}),
            },
          },
        },
        input: currentInput,
        maxIterations: currentOptions.maxIterations,
        taskId: currentOptions.taskId ?? state.taskId,
      });
      state = gated.state;
      return {
        outcome: gated.decision === "deny-once" ? "next" : "break",
        exit: gated,
        state,
        requiredToolNudgeCount,
        failureRecoveryRedirects,
      };
    }

    return proceed();
  });
}
