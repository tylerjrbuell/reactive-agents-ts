/**
 * shared/termination-oracle.ts — Scored signal pipeline for ReAct kernel exit logic.
 *
 * Replaces scattered if/else exit conditions with a composable evaluator chain.
 * Each TerminationSignalEvaluator inspects TerminationContext and returns a
 * SignalVerdict (or null to abstain). The resolver aggregates verdicts with
 * short-circuit semantics for high-confidence signals.
 */

import { Effect } from "effect";
import { emitBudgetSignalCollected } from "../../utils/diagnostics.js";
import { deriveRequirementEvidence } from "../verify/requirement-state.js";

// ── Sibling decide/ modules (GH #220 / quality program Task 7) ──────────────
// The signal-evaluator zoo, the oracle vocabulary types, the budget-signal
// derivation, and the Arbitrator's internal gate helpers moved verbatim into
// these modules. The imports below are what the retained authority code (the
// terminal gate) uses; the re-export shim after them keeps every existing
// import path resolving through `./arbitrator.js` UNCHANGED — no consumer
// (think pipeline, control/, loop/, src/index.ts, tests) had to be touched.

import { computeBudgetSignal } from "./budget-signal.js";
import { shouldVetoSuccess } from "./arbitration-veto.js";
import { synthesisQualityRetry } from "./synthesis-retry.js";
import { looksLikeSemanticAbstention } from "./abstention-detection.js";
import { applyGroundedTerminalGate } from "./grounded-terminal-gate.js";
import type {
  ArbitrationContext,
  TerminationIntent,
  Verdict,
} from "./arbitration-types.js";
import type { BudgetLimits } from "./budget-signal.js";

export { evaluateTermination } from "./termination-resolver.js";
export { normalizedLevenshtein } from "./text-similarity.js";
export {
  pendingToolCallEvaluator,
  finalAnswerToolEvaluator,
  entropyConvergenceEvaluator,
  reactiveControllerEarlyStopEvaluator,
  contentStabilityEvaluator,
  llmEndTurnEvaluator,
  finalAnswerRegexEvaluator,
  completionGapEvaluator,
  controllerSignalVetoEvaluator,
  defaultEvaluators,
} from "./termination-signals.js";
export { computeBudgetSignal } from "./budget-signal.js";
export type {
  ToolRequest,
  ReactiveDecision,
  EntropyTrajectory,
  EntropyScoreLike,
  TerminationContext,
  SignalVerdict,
  TerminationSignalEvaluator,
  TerminationDecision,
} from "./termination-types.js";
export type {
  TerminationIntent,
  Verdict,
  ArbitrationContext,
} from "./arbitration-types.js";
export type { BudgetLimits, BudgetSignal } from "./budget-signal.js";

// ─── Arbitrator — Sole Termination Authority (Sprint 3.3) ────────────────────
//
// The Arbitrator is the SINGLE place that decides whether the kernel
// terminates and whether termination is success or failure. Every code path
// that previously transitioned state.status="done" now flows through here.
//
// Pre-Sprint-3.3, 9 code paths set status="done" independently. CHANGE A
// (controllerSignalVeto) wired the oracle into one path, but corpus N=2
// proved that didn't move the needle — the other 8 paths bypassed the veto
// entirely. Sprint 3.3 is the structural fix: all 9 paths emit a typed
// TerminationIntent; the Arbitrator resolves intents into Verdicts; the
// loop runner applies Verdicts to state.
//
// Pattern: Sole Termination Authority — same shape as S2.5's Sole Author
// pattern for prompt assembly. One owner, typed contract, observable, no
// parallel paths.


// Late binding to avoid cycle ambiguity in tooling. Both files compile fine
// either way; this keeps the import block at the top tidy.
import { deriveConditions } from "../verify/derive-conditions.js";
import { describeUnmet } from "../verify/post-conditions.js";
import { verifyDelivery } from "../verify/delivery-authority.js";
import {
  GROUNDING_REDIRECT,
  hasSuccessfulSubstantiveToolCall,
} from "../../loop/runner-helpers/grounded-terminal.js";
import { evaluateTerminalGate } from "./terminal-gate.js";
import { authorityOf } from "./authority.js";
import {
  resolveHorizonProfile,
} from "../../loop/runner-helpers/horizon-profile.js";
import type { RawTerminatedBy } from "../../loop/terminate-reason.js";
import { makeStep } from "../sense/step-utils.js";

// ─── PostCondition spine — deterministic state-grounded success authority ─────
//
// Unconditional (default-on, no opt-out — the RA_POST_CONDITIONS flag was
// deleted Sprint-1 A4; prose-only success is the removed legacy path).
// When the run has non-empty derived post-conditions, a would-be
// exit-success Verdict is demoted to a "post-condition-steer" escalation when
// any condition is unmet: the kernel CANNOT report success while a required
// deliverable was never produced. The prose verdict becomes a quality signal,
// not the success authority (canon: tau-bench, DSPy assertions).
//
// Sentinel `nextStrategy = "post-condition-steer"` is distinct from
// "retry-with-feedback": applyTermination rides the steering text on
// pendingGuidance.errorRecovery WITHOUT setting escalateTo (no strategy switch)
// and WITHOUT touching synthesisRetryCount (bounded by the existing iteration /
// budget caps, not the 1-shot synthesis cap).
const POST_CONDITION_STEER = "post-condition-steer";

// Unconditional (default-on, no opt-out). Cleared the default-on bar by the
// cross-tier ablation + frontier-judge verdict (wiki/Research/Harness-Reports/
// postconditions-ablation-2026-05-31.md): the state-grounded spine steers incomplete
// deliverable runs to completion — cogito summary success 1/3→3/3, per-run judged
// quality 0.31→0.72, mid parity, no false-block, token-neutral. Prose-only success
// Sprint-1 A4 (2026-06-02): RA_POST_CONDITIONS flag DELETED. Post-condition
// state-grounded verification is unconditional — the prose-only legacy
// success path is no longer reachable. Aligns with canonical-harness-core
// part 4 (state-grounded verification as the success authority).

/**
 * Post-verdict override (single chokepoint). Runs AFTER the switch resolves a
 * Verdict so it covers ALL five exit-success producers (agent-final-answer,
 * fast-path-completed, loop-detected, controller-early-stop, oracle exit)
 * without editing each branch. Purely additive:
 *   - only fires on action === "exit-success"
 *   - only when the flag is ON and conditions are non-empty
 *   - exit-failure / escalate / continue verdicts pass through untouched
 */
function applyPostConditionGate(verdict: Verdict, ctx: ArbitrationContext): Verdict {
  if (verdict.action !== "exit-success") return verdict;

  // DRY — prefer the run's derived-once stored set (threaded via
  // arbitrationContextFromState from state.meta.postConditions) so the steer
  // gate and the terminal gate (terminate.ts) read the SAME conditions. Fall
  // back to deriving here only for direct callers (tests / pre-stored runs)
  // that didn't thread postConditions through the context.
  const conditions =
    ctx.postConditions ?? deriveConditions(ctx.task, ctx.requiredTools);
  if (conditions.length === 0) return verdict; // fall back to prose, as today

  // Single delivery authority (Move 2) — disk ground truth ON by default, so a
  // deliverable ON DISK that the ledger/steps reconstruction failed to link
  // (unlinked write, non-standard path-arg key, delegated write) is not falsely
  // demoted here. This is the reactive/exit-success chokepoint — the third
  // post-condition authority, unified with terminate.ts + terminal-gate.ts.
  const result = verifyDelivery(conditions, {
    steps: ctx.steps,
    output: verdict.output,
    ledger: ctx.ledger,
  });
  if (result.unmet.length === 0) return verdict; // state-grounded success

  // Unmet post-conditions: refuse success, steer and continue (bounded by the
  // existing iteration / budget caps via the standard loop re-entry).
  return {
    action: "escalate",
    nextStrategy: POST_CONDITION_STEER,
    reason: describeUnmet(result.unmet),
  };
}

// ─── arbitrate(): the single decision function ───────────────────────────────
/**
 * The Arbitrator's resolution function. Takes a TerminationIntent (what a
 * phase observed) and an ArbitrationContext (run-wide signals), and returns
 * exactly ONE Verdict. This is the function that closes G-5: every code path
 * that wants to terminate the kernel calls arbitrate() and applies the
 * returned Verdict.
 *
 * Resolution rules:
 * - max-iterations → always exit-failure (budget exhausted)
 * - kernel-error → always exit-failure (unrecoverable)
 * - controller-early-stop → exit-success with output (controller chose to stop)
 * - loop-detected → exit-success when output present + no veto, else exit-failure
 * - fast-path-completed → exit-success when no veto fires + synthesis grounded
 * - agent-final-answer → exit-success when no veto fires + synthesis grounded;
 *                        veto → exit-failure; ungrounded → escalate (retry once)
 * - oracle-decision → forward the oracle's verdict
 *
 * Sprint 3.4 Scaffold 3 — synthesis-grounding retry escalation:
 * agent-final-answer + ungrounded synthesis → escalate("retry-with-feedback").
 * Bounded by ctx.synthesisRetryCount (default cap: 1).
 */
export function arbitrate(intent: TerminationIntent, ctx: ArbitrationContext): Verdict {
  const verdict = arbitrateInner(intent, ctx);
  // F1 — grounded-terminal invariant gate. Runs BEFORE the post-condition gate:
  // for the zero-successful-calls class it owns the outcome (one bounded
  // redirect, then accept-for-abstention) — the post-condition steer would
  // otherwise re-steer that class unboundedly and keep the forced-abstention
  // threshold unreachable. Grounded runs fall through (returns null).
  const grounded = applyGroundedTerminalGate(verdict, ctx);
  if (grounded) return grounded;
  // Post-verdict PostCondition gate (single chokepoint, default-on, additive).
  // No-op unless the verdict is exit-success AND the run has non-empty derived
  // post-conditions with an unmet member.
  return applyPostConditionGate(verdict, ctx);
}

function arbitrateInner(intent: TerminationIntent, ctx: ArbitrationContext): Verdict {
  // ── Budget pre-intent guard (Issue #128, North Star v5.0 Pillar 6) ─────────
  // When the BudgetSignal reports `exceeded`, terminate immediately as a
  // failure regardless of intent.kind. Budget enforcement is a kernel-level
  // concern that DOMINATES every other termination signal — running out of
  // tokens/cost is always exit-failure, never exit-success, even if the
  // agent simultaneously emitted a final-answer. Side-channel termination
  // (compose/killswitches/budget-limit.ts) is preserved as a fallback for
  // non-standard kernel users.
  if (ctx.budget?.status === "exceeded") {
    // Best-effort output salvage: agent-final-answer / oracle-decision /
    // fast-path / loop-detected variants carry an `output` field. Others
    // (kernel-error, max-iterations w/o output) don't — omit cleanly.
    const salvaged: string | undefined =
      "output" in intent && typeof intent.output === "string" ? intent.output : undefined;
    return {
      action: "exit-failure",
      error: `budget_exceeded: ${ctx.budget.reason ?? "budget limit reached"}`,
      terminatedBy: "budget_exceeded",
      ...(salvaged !== undefined ? { output: salvaged } : {}),
    };
  }

  switch (intent.kind) {
    case "max-iterations":
      return {
        action: "exit-failure",
        error: `Maximum iterations (${ctx.maxIterations ?? "?"}) exceeded`,
        terminatedBy: "max_iterations",
        output: intent.output,
      };

    case "kernel-error":
      return {
        action: "exit-failure",
        error: intent.error,
        terminatedBy: "kernel_error",
      };

    case "controller-early-stop": {
      // Controller chose to stop. The DISPATCH itself is trustworthy, but
      // the OUTCOME interpretation depends on whether the run was healthy.
      // If tool-failure evidence + pathological controller log are present,
      // the early-stop is "framework giving up" not "task complete" → veto.
      const veto = shouldVetoSuccess(ctx);
      if (veto.veto) {
        return {
          action: "exit-failure",
          error: `controller_early_stop_with_failure_evidence: ${veto.reason}`,
          terminatedBy: "controller_signal_veto",
          output: intent.output,
        };
      }
      // W4.3 (plan 4.3) — a controller early-stop may NOT preempt contract
      // coverage. A flat-trajectory verdict (the RI dispatcher early-stop at
      // confidence 0 while still acting) used to ship exit-success regardless of
      // outstanding contract requirements. Route it through the SAME terminal
      // gate every other exit uses: an unsatisfied deterministic requirement (or
      // declared-but-ungrounded required tools) refuses success and surfaces an
      // honest failure the runner's §7.5 abstention path converts. A SATISFIED
      // contract (or no contract) keeps the early-stop as success — no
      // over-blocking.
      if (ctx.runContract !== undefined) {
        const gate = evaluateTerminalGate({
          terminatedBy: "end_turn",
          requiredTools: ctx.requiredTools,
          coveredTools: deriveRequirementEvidence(ctx.steps, ctx.requiredTools, ctx.ledger)
            .coveredTools,
          hasSubstantiveGrounding: hasSuccessfulSubstantiveToolCall(ctx.steps),
          redirectsSpent: { grounding: 0, coverage: 0, checker: 0 },
          // No redirect at an early-stop: the honest terminal is refusal, not
          // another loop turn.
          redirectBudget: 0,
          coverageExhaustionPolicy: "abstain",
          contract: ctx.runContract,
          evidence: { steps: ctx.steps, output: intent.output, ledger: ctx.ledger },
          buildGroundingGuidance: () => "",
          buildCoverageGuidance: (m) => m.join(", "),
        });
        if (gate.decision === "abstain" || gate.decision === "redirect") {
          return {
            action: "exit-failure",
            error:
              `controller_early_stop_ungrounded: ${gate.check}` +
              ("missing" in gate && gate.missing.length > 0 ? ` (${gate.missing.join(", ")})` : ""),
            terminatedBy: "controller_early_stop_ungrounded",
            output: intent.output,
          };
        }
      }
      return {
        action: "exit-success",
        output: intent.output,
        terminatedBy: `controller_early_stop:${intent.reason}`,
      };
    }

    case "loop-detected": {
      // Loop detection is a controller decision, not an agent claim. But if
      // the agent never produced output AND the controller is also showing
      // pathological signals, mark as failure.
      const veto = shouldVetoSuccess(ctx);
      if (veto.veto) {
        return {
          action: "exit-failure",
          error: `loop-detected with controller veto: ${veto.reason}`,
          terminatedBy: "loop_detected_with_veto",
          output: intent.output,
        };
      }
      // Loop detection without veto → graceful exit with whatever output exists.
      return {
        action: "exit-success",
        output: intent.output,
        terminatedBy: `loop_detected:${intent.reason}`,
      };
    }

    case "fast-path-completed": {
      // Trivial tasks shouldn't need controller activity. If they do, something
      // is very wrong — apply veto.
      const veto = shouldVetoSuccess(ctx);
      if (veto.veto) {
        return {
          action: "exit-failure",
          error: veto.reason,
          terminatedBy: "controller_signal_veto",
        };
      }
      // Use "end_turn" — react-kernel.ts maps it to the canonical
      // terminatedBy enum value matching pre-Sprint-3.3 behavior.
      return {
        action: "exit-success",
        output: intent.output,
        terminatedBy: "end_turn",
      };
    }

    case "agent-final-answer": {
      // Agent self-claimed success. Apply Verdict-Override: if controller
      // signals contradict, mark as failure.
      //
      // Lever 8 (2026-05-26) — when the agent exits via the final-answer
      // TOOL (`intent.via === "tool"`), skip the veto. The final-answer
      // tool is a deliberate, structured exit channel: invoking it is the
      // model's strongest possible "I considered the situation and this
      // is my answer" signal. Vetoing a deliberate tool-mediated exit
      // breaks graceful-failure tasks like the f1 bench scenario
      // ("…stop trying and state that you cannot fetch the live price")
      // where the model correctly acknowledges tool failure via
      // final-answer and the controller-signal veto then incorrectly
      // converts the success into max_iterations failure.
      //
      // Veto still applies on `via === "regex"` (FINAL ANSWER: prefix
      // match — weaker signal, may be incidental in a thought) and on
      // `via === undefined` (raw end_turn — the original veto target,
      // silent drops mid-loop).
      if (intent.via !== "tool") {
        const veto = shouldVetoSuccess(ctx);
        if (veto.veto) {
          return {
            action: "exit-failure",
            error: veto.reason,
            terminatedBy: "controller_signal_veto",
          };
        }
      }

      // Sprint 3.4 Scaffold 3 — synthesis-grounding gate. If the answer
      // contains framework compression markers OR systematically lacks
      // claims that appear in the evidence corpus, escalate for ONE
      // corrective iteration with explicit feedback.
      const retryCheck = synthesisQualityRetry(intent, ctx);
      if (retryCheck.retry) {
        return {
          action: "escalate",
          nextStrategy: "retry-with-feedback",
          reason: retryCheck.feedback,
        };
      }

      // Preserve the existing terminatedBy strings for downstream consumers
      // (react-kernel.ts, tests, telemetry): "final_answer_tool" / "final_answer"
      // / "end_turn" — the via discriminator picks the legacy name.
      //
      // Semantic abstention reclassification: when the model delivers an
      // abstention through the final-answer tool (e.g. "I cannot access the
      // database"), reclassify as "abstained" so goalAchieved correctly
      // reports false. Guarded: if the model already produced substantive
      // tool output, the "I cannot" is qualifying language, not a genuine
      // abstention — mirrors decideForcedAbstention's hasDeliverable guard.
      const hasDeliverable = hasSuccessfulSubstantiveToolCall(ctx.steps);
      const terminatedBy =
        intent.via === "tool"
          ? (!hasDeliverable && looksLikeSemanticAbstention(intent.output) ? "abstained" : "final_answer_tool")
          : intent.via === "regex"
            ? "final_answer"
            : "end_turn";
      return {
        action: "exit-success",
        output: intent.output,
        terminatedBy,
      };
    }

    case "oracle-decision": {
      // Oracle already ran the evaluator chain (including the veto evaluator).
      // Use decision.reason for terminatedBy — react-kernel.ts maps these
      // canonical reason strings ("llm_end_turn", "final_answer_regex",
      // etc.) to the public terminatedBy enum.
      if (intent.decision.action === "fail") {
        return {
          action: "exit-failure",
          error: intent.decision.reason,
          terminatedBy: "controller_signal_veto",
          output: intent.output,
        };
      }
      if (intent.decision.action === "exit") {
        // Map oracle's evaluator reasons to terminatedBy strings that
        // react-kernel.ts's existing mapping already understands. Any
        // reason starting with "content_stable" or "entropy_converged"
        // is a stability-based exit ⇒ "end_turn" downstream.
        const reason = intent.decision.reason ?? "oracle";
        // Documented narrow cast (Phase 3 vocabulary closure): the evaluator
        // exit-reason vocabulary is closed over RawTerminatedBy — producers are
        // entropyConvergenceEvaluator ("entropy_converged"),
        // contentStabilityEvaluator ("content_stable"),
        // reactiveControllerEarlyStopEvaluator ("controller_early_stop: …"),
        // llmEndTurnEvaluator ("llm_end_turn"), finalAnswerRegexEvaluator
        // ("final_answer_regex") — all members of the union or its templates.
        const terminatedBy = (
          reason === "content_stable" || reason.startsWith("entropy_converged")
            ? "llm_end_turn"
            : reason
        ) as RawTerminatedBy;
        return {
          action: "exit-success",
          output: intent.decision.output ?? intent.output,
          terminatedBy,
        };
      }
      // continue / redirect from the oracle
      return { action: "continue" };
    }

    default: {
      // exhaustive check
      const _exhaust: never = intent;
      void _exhaust;
      return { action: "continue" };
    }
  }
}

// ─── applyTermination(): helper to apply a Verdict to KernelState ────────────

/**
 * Imports KernelState lazily through the type-only import so this file
 * remains free of cyclic runtime dependencies. The helper mutates state via
 * transitionState (the canonical state-mutation path).
 */
import type {
  KernelState as _KernelState,
} from "../../state/kernel-state.js";
import { transitionState } from "../../state/kernel-state.js";
import { commitDeliverable } from "../../loop/runner-helpers/deliverable.js";
import { modelSynthesisDeliverable } from "@reactive-agents/core";
import { recordEvidenceClaims, recordTerminalVerdict } from "../../ledger/emit.js";

/**
 * Apply a Verdict to KernelState. The single helper every termination
 * site calls instead of setting state.status directly.
 *
 * Sprint 3.3 wires all 9 termination sites through this helper. After this
 * commit, a `grep "status.*\"done\""` in src/kernel/{capabilities,loop}/
 * outside arbitrator.ts should return zero matches (cf-24 pins this).
 */
export function applyTermination(
  state: _KernelState,
  verdict: Verdict,
  extraMeta?: Record<string, unknown>,
): _KernelState {
  switch (verdict.action) {
    case "continue":
      return state;
    case "exit-success": {
      // P1 mission 2B: the verdict's `output` is the model's final answer
      // (authored text). Set status + terminatedBy first (NO output key — an
      // output-only patch on a `done` state sticks per the transitionState
      // invariant), then funnel the output string through the single writer
      // commitDeliverable so the Arbitrator stops being a raw output writer.
      // C1 — persist the terminal verdict + the answer's evidence claims that
      // both gates used to compute and DISCARD (audit 01 / 01-F2). Threaded via
      // patch.ledger so transitionState carries them (no new step is added).
      // §3 / §1a — surface the terminating actor's authority class (threaded
      // via extraMeta.evaluator from the oracle) and mark evidence:none for a
      // LEXICAL exit on a CONTRACTLESS run: it exited on "the model thinks it's
      // done" with no goal evidence. On a contract run a lexical proposal cannot
      // reach here without first clearing the terminal gate (piece 1).
      const terminatingActor =
        typeof extraMeta?.["evaluator"] === "string"
          ? (extraMeta["evaluator"] as string)
          : undefined;
      const terminalAuthorityClass = terminatingActor
        ? authorityOf(terminatingActor)
        : undefined;
      // "Contract-bearing" for authority purposes = the compiled contract has a
      // non-empty deterministic floor (postConditions). The runner ALWAYS
      // compiles a RunContract (even for a free-form goal, whose contract holds
      // only the base self-critique requirement with no checkable condition), so
      // presence alone is not evidence — an enforceable floor is.
      const contract = state.meta.runContract;
      const contractEnforceable =
        contract !== undefined && contract.postConditions.length > 0;
      const terminalEvidence: "none" | undefined =
        terminalAuthorityClass === "lexical" && !contractEnforceable ? "none" : undefined;

      const successLedger = recordEvidenceClaims(
        recordTerminalVerdict(state.ledger, {
          verified: true,
          terminatedBy: verdict.terminatedBy,
          iteration: state.iteration,
          ...(terminalAuthorityClass ? { authorityClass: terminalAuthorityClass } : {}),
          ...(terminalEvidence ? { evidence: terminalEvidence } : {}),
        }),
        verdict.output,
        state.steps,
        state.scratchpad,
        state.iteration,
      );
      // Semantic abstention via final-answer: populate the abstention metadata
      // so AgentResult.abstention is present (contract: "iff terminatedBy ===
      // abstained"). Harness-forced and model-initiated paths set this upstream;
      // the reclassification path has no upstream site, so derive here.
      const abstentionMeta =
        verdict.terminatedBy === "abstained" && !extraMeta?.["abstention"]
          ? { abstention: { reason: verdict.output.slice(0, 200), missing: [] as string[] } }
          : {};
      const done = transitionState(state, {
        status: "done" as const,
        ledger: successLedger,
        meta: {
          ...state.meta,
          terminatedBy: verdict.terminatedBy,
          ...(terminalAuthorityClass ? { terminalAuthorityClass } : {}),
          ...(terminalEvidence ? { terminalEvidence } : {}),
          ...abstentionMeta,
          ...(extraMeta ?? {}),
        },
      });
      return commitDeliverable(
        done,
        modelSynthesisDeliverable({ type: "thought", content: verdict.output, iteration: done.iteration }),
      );
    }
    case "exit-failure": {
      // Failure escape (transitionState JSDoc §803): the Arbitrator is the
      // sanctioned site that forwards `verdict.output` alongside a failure.
      // Set status:"failed" + meta with NO output key first (so an absent
      // verdict.output is nulled by the invariant), then — only when a payload
      // exists — route it through the single writer. `transitionToFailed` is
      // false on the already-failed state, so commitDeliverable's output sticks.
      // C1 — persist the terminal (failure) verdict as a ledger fact.
      const failedLedger = recordTerminalVerdict(state.ledger, {
        verified: false,
        terminatedBy: verdict.terminatedBy,
        reason: verdict.error,
        iteration: state.iteration,
      });
      const failed = transitionState(state, {
        status: "failed" as const,
        error: verdict.error,
        ledger: failedLedger,
        meta: {
          ...state.meta,
          terminatedBy: verdict.terminatedBy,
          ...(extraMeta ?? {}),
        },
      });
      return verdict.output !== undefined
        ? commitDeliverable(
            failed,
            modelSynthesisDeliverable({ type: "thought", content: verdict.output, iteration: failed.iteration }),
          )
        : failed;
    }
    case "escalate": {
      // Escalation is signaled in meta. State.status stays "thinking".
      // Sprint 3.4 Scaffold 3 — when nextStrategy === "retry-with-feedback",
      // inject feedback as pendingGuidance so think.ts surfaces it next
      // iteration AND increment the retry counter so we don't loop forever.
      // For other escalations (legacy strategy switch), preserve the
      // existing behavior.
      // PostCondition spine — state-grounded steer. Ride the steering text on
      // pendingGuidance.errorRecovery so think.ts surfaces it next iteration.
      // Do NOT set escalateTo (no strategy switch) and do NOT touch
      // synthesisRetryCount (bounded by the standard iteration / budget caps,
      // not the synthesis 1-shot cap). Status stays "thinking" → loop re-enters.
      // F1 — grounded-terminal redirect: reject the ungrounded terminal ONCE.
      // Appends a harness_signal step (visible to think.ts prompt assembly,
      // the verifier's recent-harness-signals window, and rax:diagnose via the
      // runner's emitHarnessSignalInjected), rides the steering text on
      // pendingGuidance.errorRecovery, and bumps the one-shot counter so the
      // gate never fires twice. Status stays "thinking" → loop re-enters.
      if (verdict.nextStrategy === GROUNDING_REDIRECT) {
        return transitionState(state, {
          steps: [
            ...state.steps,
            makeStep("harness_signal", `⚠️ ${verdict.reason}`, {
              // Spec §5b — the grounding redirect is a receipt-visible
              // deterministic intervention (F1: ungrounded terminal rejected).
              intervention: {
                actor: "grounding-redirect",
                authorityClass: authorityOf("grounding-redirect"),
                evidence: verdict.reason.slice(0, 200),
                whatChanged: "grounding-redirect: ungrounded terminal rejected once",
                iter: state.iteration,
              },
            }),
          ],
          pendingGuidance: {
            ...(state.pendingGuidance ?? {}),
            errorRecovery: verdict.reason,
          },
          meta: {
            ...state.meta,
            groundingRedirectCount: (state.meta.groundingRedirectCount ?? 0) + 1,
            ...(extraMeta ?? {}),
          },
        });
      }
      if (verdict.nextStrategy === "post-condition-steer") {
        return transitionState(state, {
          pendingGuidance: {
            ...(state.pendingGuidance ?? { requiredToolsPending: [], loopDetected: false }),
            errorRecovery: verdict.reason,
          },
          meta: {
            ...state.meta,
            ...(extraMeta ?? {}),
          },
        });
      }
      if (verdict.nextStrategy === "retry-with-feedback") {
        const currentRetry = state.meta.synthesisRetryCount ?? 0;
        return transitionState(state, {
          pendingGuidance: {
            ...(state.pendingGuidance ?? { requiredToolsPending: [], loopDetected: false }),
            errorRecovery: verdict.reason, // surfaced in system prompt's Guidance section
          },
          meta: {
            ...state.meta,
            synthesisRetryCount: currentRetry + 1,
            // Don't set escalateTo for retry-with-feedback so the runner's
            // strategy-switch handler doesn't fire on this.
            ...(extraMeta ?? {}),
          },
        });
      }
      // Legacy escalate (strategy switch): keep existing semantics.
      return transitionState(state, {
        meta: {
          ...state.meta,
          escalateTo: verdict.nextStrategy,
          escalationReason: verdict.reason,
          ...(extraMeta ?? {}),
        },
      });
    }
    default: {
      // Exhaustiveness: Verdict.action is a closed 4-variant union, all
      // handled above. A new action value would otherwise fall through to
      // `undefined` and crash the kernel. Mirror the file's `arbitrate`
      // exhaustive-default pattern; the no-op tail is to return state unchanged.
      const _exhaust: never = verdict;
      void _exhaust;
      return state;
    }
  }
}

/**
 * Convenience: arbitrate + apply in one call. The single entry point most
 * termination sites use.
 */
export function arbitrateAndApply(
  state: _KernelState,
  intent: TerminationIntent,
  ctx: ArbitrationContext,
  extraMeta?: Record<string, unknown>,
): _KernelState {
  const verdict = arbitrate(intent, ctx);
  return applyTermination(state, verdict, extraMeta);
}

// ─── Capability-boundary emit wrapper (WS-3 Phase 5b) ───────────────────────
//
// `arbitrateAndApplyWithBudgetEmit` is the canonical entry point for callers
// (the kernel loop) that need both the BudgetSignalCollected trace event AND
// the arbitrate-and-apply state transition. It enforces invariant 10 of the
// canonical-refactor model: capability emit events fire from capability code,
// never from strategy / loop code.
//
// Pre-WS-3 Phase 5b, runner.ts called `yield* emitBudgetSignalCollected({...})`
// inline before `arbitrateAndApply(...)` at the dispatcher-early-stop site.
// That coupled the loop to the BudgetSignal trace shape. This helper colocates
// the emit with the arbitration call so future budget-signal evolution
// (new threshold bands, derived fields, etc.) updates the emit without
// touching runner.ts.
//
// Architecture mapping: §5.3 — Arbitrator integrates 6 signals;
// BudgetSignal is one of them; emit fires from Decide.
//
// Same semantics as calling `arbitrateAndApply(state, intent, ctx, extraMeta)`
// directly — the returned KernelState is unchanged. The emit fires only when
// `ctx.budget` is present (limits were declared) and is fire-and-forget at
// the EventBus boundary (Effect-swallows publish failures via the underlying
// helper's `emitErrorSwallowed` policy).
export function arbitrateAndApplyWithBudgetEmit(args: {
  readonly state: _KernelState;
  readonly intent: TerminationIntent;
  readonly ctx: ArbitrationContext;
  readonly taskId: string;
  readonly extraMeta?: Record<string, unknown>;
}): Effect.Effect<_KernelState, never> {
  const { state, intent, ctx, taskId, extraMeta } = args;
  return Effect.gen(function* () {
    // Issue #128 — surface BudgetSignal whenever the Arbitrator runs.
    if (ctx.budget) {
      yield* emitBudgetSignalCollected({
        taskId,
        iteration: ctx.iteration,
        tokensUsed: ctx.budget.tokensUsed,
        costUsd: ctx.budget.costUsd,
        ...(ctx.budget.tokenLimit !== undefined
          ? { tokenLimit: ctx.budget.tokenLimit }
          : {}),
        ...(ctx.budget.costLimit !== undefined
          ? { costLimit: ctx.budget.costLimit }
          : {}),
        status: ctx.budget.status,
        ...(ctx.budget.reason !== undefined ? { reason: ctx.budget.reason } : {}),
      });
    }
    return arbitrateAndApply(state, intent, ctx, extraMeta);
  });
}

/**
 * Helper: build an ArbitrationContext from a KernelState + KernelInput-like
 * structure. Used by call sites that have state in hand.
 */
export function arbitrationContextFromState(
  state: _KernelState,
  input: { readonly task: string; readonly requiredTools?: readonly string[] },
): ArbitrationContext {
  const entropyMeta = state.meta.entropy as
    | { latestScore?: { composite?: number } }
    | undefined;
  const verifSteps = state.steps.filter(
    (s) =>
      s.type === "observation" &&
      s.metadata?.verification !== undefined,
  );
  const lastVerif = verifSteps[verifSteps.length - 1]?.metadata
    ?.verification as { verified: boolean; summary: string } | undefined;

  // Issue #128 — compute BudgetSignal purely from state. Reads
  // state.meta.budgetLimits set at kernel-start by runner.ts. When no limits
  // are declared, computeBudgetSignal returns undefined and ctx.budget stays
  // off — backward-compatible no-op for the pre-intent guard.
  //
  // Issue #231 — when the run-scoped meter is present, spend is the MAX of the
  // live meter and the per-kernel `state.tokens`/`state.cost`. The meter is the
  // authoritative run total (fed by the observable LLM wrapper on every call
  // path); `Math.max` guards any unmetered path (e.g. completeStructured, which
  // exposes no usage) so a metered run can never report LESS spend than the
  // kernel already recorded. `state.tokens`/`state.cost` stay untouched for
  // honest-partial metadata.
  const budgetLimits = state.meta.budgetLimits as BudgetLimits | undefined;
  const meter = state.meta.runBudgetMeter;
  // Issue #231 follow-up — when the run meter is armed, the authoritative limit
  // is the run-scoped ORIGINAL limit. A multi-kernel strategy (plan-execute)
  // hands this sub-kernel a REDUCED limit via `withSpentBudget`; combining that
  // reduced limit with run-TOTAL spend halts early by up to the prior spend.
  // Fall back to `budgetLimits` when no run limit was seeded (unchanged path).
  const effectiveLimits = meter
    ? ((state.meta.runBudgetLimits as BudgetLimits | undefined) ?? budgetLimits)
    : budgetLimits;
  const budgetSignal = computeBudgetSignal({
    tokensUsed: meter ? Math.max(meter.tokens, state.tokens ?? 0) : (state.tokens ?? 0),
    costUsd: meter ? Math.max(meter.cost, state.cost ?? 0) : (state.cost ?? 0),
    limits: effectiveLimits,
  });

  // A2 — resolve the long-horizon guard scaling from the mirrored meta fields
  // (state.meta.horizonProfile + maxIterations). `undefined` off the profile →
  // the veto stays run-cumulative and the terminal gate stays one-shot.
  const horizon = resolveHorizonProfile({
    horizonProfile: state.meta.horizonProfile,
    maxIterations: (state.meta.maxIterations as number | undefined) ?? 0,
  });

  return {
    iteration: state.iteration,
    maxIterations: state.meta.maxIterations as number | undefined,
    task: input.task,
    steps: state.steps,
    // Wave C.2 — the run-scoped ledger, populated HERE (the one builder every
    // arbitration call site goes through) rather than at each caller, so a new
    // call site cannot silently drop the delegated-work evidence.
    ledger: state.ledger,
    runContract: state.meta.runContract,
    toolsUsed: state.toolsUsed,
    requiredTools: input.requiredTools ?? [],
    controllerDecisionLog: state.controllerDecisionLog,
    ...(horizon ? { vetoDecisionWindow: horizon.vetoDecisionWindow, redirectBudget: horizon.redirectBudget } : {}),
    // E2 — surface the assessment phase ONLY under the profile so the veto can
    // stand down in synthesize. Absent off the profile → byte-identical.
    ...(horizon && state.meta.assessment ? { assessmentPhase: state.meta.assessment.phase } : {}),
    entropyComposite: entropyMeta?.latestScore?.composite,
    latestVerification: lastVerif,
    // Sprint 3.4 Scaffold 3 — surface the synthesis retry counter so the
    // Arbitrator can decide whether to escalate again.
    synthesisRetryCount: state.meta.synthesisRetryCount,
    // Surface scratchpad so the grounding check sees full tool data, not
    // the compressed-preview content stored on observation steps.
    scratchpad: state.scratchpad,
    // F1 — grounded-terminal invariant: surface the one-shot redirect counter
    // so the gate knows whether this run's grounding redirect is spent.
    ...(state.meta.groundingRedirectCount !== undefined
      ? { groundingRedirectCount: state.meta.groundingRedirectCount }
      : {}),
    // Issue #128 — surface BudgetSignal when limits were declared.
    ...(budgetSignal ? { budget: budgetSignal } : {}),
    // PostCondition spine — surface the derived-once stored set so the steer
    // gate reads the SAME conditions as the terminal gate (DRY, no
    // double-derivation). Absent on flag-off runs (runner.ts never seeds it).
    ...(state.meta.postConditions
      ? { postConditions: state.meta.postConditions }
      : {}),
  };
}
