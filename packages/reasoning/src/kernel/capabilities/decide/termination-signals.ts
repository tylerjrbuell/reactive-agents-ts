/**
 * decide/termination-signals.ts — the built-in TerminationSignalEvaluator zoo.
 *
 * The lexical/controller signal evaluators (PendingToolCall, ContentStability,
 * LLMEndTurn, FinalAnswerRegex, ControllerSignalVeto, …), the tier-aware
 * threshold tables they consult, the contract-coverage proposal helper, and
 * the default evaluator chain. Moved verbatim from `arbitrator.ts` (GH #220 /
 * quality program Task 7); every evaluator symbol is still re-exported from
 * `arbitrator.ts`, so the single-termination-owner invariant is untouched —
 * these evaluators PROPOSE, the Arbitrator DECIDES.
 */

import { FINAL_ANSWER_RE, extractFinalAnswer } from "../../utils/tool-parsing.js";
import { resolveUnconsumedEvidence } from "../verify/unconsumed-evidence.js";
import { deriveRequirementEvidence } from "../verify/requirement-state.js";
import { windowDecisions } from "../../loop/runner-helpers/horizon-profile.js";
import { evaluateTerminalGate } from "./terminal-gate.js";
import { normalizedLevenshtein } from "./text-similarity.js";
import type {
  TerminationContext,
  TerminationSignalEvaluator,
} from "./termination-types.js";

// ── Tier-aware threshold tables ────────────────────────────────────────────

/** Entropy derivative thresholds per tier (more negative = stricter). */
const ENTROPY_CONVERGENCE_THRESHOLDS: Record<string, number> = {
  local: -0.03,
  mid: -0.05,
  large: -0.07,
  frontier: -0.15,
};

/** Content similarity thresholds per tier (higher = stricter). */
const CONTENT_STABILITY_THRESHOLDS: Record<string, number> = {
  local: 0.80,
  mid: 0.85,
  large: 0.90,
  frontier: 0.95,
};

// ── Built-in Signal Evaluators ──────────────────────────────────────────────

export const pendingToolCallEvaluator: TerminationSignalEvaluator = {
  name: "PendingToolCall",
  evaluate: (ctx) => {
    if (ctx.toolRequest) return { action: "continue", confidence: "high", reason: "tool_call_pending" };
    return null;
  },
};

export const finalAnswerToolEvaluator: TerminationSignalEvaluator = {
  name: "FinalAnswerTool",
  evaluate: (_ctx) => {
    // Placeholder — final-answer tool accept/reject logic stays in handleActing.
    // When handleActing accepts, it transitions to "done" directly.
    return null;
  },
};

export const entropyConvergenceEvaluator: TerminationSignalEvaluator = {
  name: "EntropyConvergence",
  evaluate: (ctx) => {
    if (!ctx.entropy || !ctx.trajectory) return null;
    if (ctx.stopReason !== "end_turn") return null;

    const threshold = ENTROPY_CONVERGENCE_THRESHOLDS[ctx.tier ?? "mid"] ?? -0.05;
    const converging = ctx.trajectory.shape === "converging" && ctx.trajectory.derivative < threshold;
    if (converging && ctx.thought.trim().length > 0) {
      return { action: "exit", confidence: "high", reason: "entropy_converged", output: ctx.thought.trim() };
    }
    return null;
  },
};

export const reactiveControllerEarlyStopEvaluator: TerminationSignalEvaluator = {
  name: "ReactiveControllerEarlyStop",
  evaluate: (ctx) => {
    if (!ctx.controllerDecisions) return null;
    const earlyStop = ctx.controllerDecisions.find((d) => d.decision === "early-stop");
    if (!earlyStop) return null;
    // 2026-08-16 root fix: this was an UNCONDITIONAL high-confidence exit —
    // no terminal-gate call at all, so it short-circuits `evaluateTermination`
    // before contentStability/finalAnswerRegex/llmEndTurn's evidence checks
    // ever run. Measured as the DOMINANT termination path in live gemma4:e4b
    // traces this session ("Approaching maxIterations... flat trajectory"
    // fires almost every run) — every other evaluator's evidence-grounding
    // fix was reachable in principle but preempted in practice by this one.
    // One-shot, own budget (2026-08-15: dedicated evidenceRedirectCount, not
    // the shared ctx.redirectCount — a prior grounding/coverage redirect must
    // not starve this check of its turn).
    if ((ctx.evidenceRedirectCount ?? 0) === 0 && ctx.scratchpad) {
      const unconsumedEvidence = resolveUnconsumedEvidence(ctx.steps, ctx.scratchpad);
      if (unconsumedEvidence !== null) {
        return {
          action: "redirect",
          confidence: "high",
          reason:
            `Before finalizing: earlier tool results were shown to you only as short previews. ` +
            `Here is the COMPLETE content, expanded automatically — ground your answer in it (do not ` +
            `invent details not present here), then give your final answer again:\n\n${unconsumedEvidence}`,
        };
      }
    }
    return { action: "exit", confidence: "high", reason: `controller_early_stop: ${earlyStop.reason}`, output: ctx.thought.trim() };
  },
};

/**
 * Piece-1 (spec §1a) — the lexical-proposal gate. A lexical terminator
 * (content-stability, final-answer regex) is NOT a completion authority: on a
 * CONTRACT-BEARING run its candidate answer must pass the terminal gate
 * (contract coverage vs the ORIGINAL, frozen criteria) before it may exit.
 *
 * Returns redirect GUIDANCE when the gate rejects the candidate — the run then
 * continues with the outstanding list via think.ts's existing redirect
 * machinery. Returns `null` when the candidate is clear to exit: either the
 * contract's requirements are satisfied, OR the run is contractless. A
 * contractless lexical exit is permitted but the terminal marks it
 * `evidence: none` (see applyTermination), so byte-identical to the pre-piece-1
 * path for contractless runs (null → the evaluator exits exactly as before).
 *
 * Mirrors llmEndTurnEvaluator's contract path (same gate call, same coverage
 * wording) so all three exit proposals judge the frozen contract identically.
 *
 * 2026-08-16 root fix: this function used to early-return `null` for every
 * contractless run, so `contentStabilityEvaluator`/`finalAnswerRegexEvaluator`
 * exited UNCONDITIONALLY on the common case (no RunContract) — never
 * consulting the terminal gate at all. That let those two evaluators win
 * `evaluateTermination`'s exit-vs-redirect tie-break (exit wins at equal
 * confidence) over `llmEndTurnEvaluator`'s evidence-grounding redirect fired
 * the SAME tick, so an ungrounded candidate shipped anyway. The gate now
 * always runs; contract fields are simply omitted when absent (grounding/
 * coverage stay vacuously true/empty, byte-identical for those two checks),
 * so evidence-grounding — which needs no contract — applies universally.
 */
function contractCoverageProposal(
  ctx: TerminationContext,
  candidate: string,
): string | null {
  const unconsumedEvidence = ctx.scratchpad
    ? resolveUnconsumedEvidence(ctx.steps, ctx.scratchpad)
    : null;
  if (ctx.runContract === undefined && unconsumedEvidence === null) return null;
  // Coverage must stay vacuous for a contractless run — this function's
  // long-standing contract, preserved verbatim: only the NEW evidence check
  // participates when there is no contract. Passing real requiredTools here
  // for a contractless run would resurrect a coverage check that was never
  // active on this path before 2026-08-16.
  const effectiveRequiredTools = ctx.runContract !== undefined ? ctx.requiredTools : [];
  const gate = evaluateTerminalGate({
    terminatedBy: "end_turn",
    requiredTools: effectiveRequiredTools,
    // Step 3 item 3c (09 §6.5): one ledger-backed derivation — covered means
    // COMPLETED SUCCESSFULLY, not merely attempted (`ctx.toolsUsed`, the bug).
    coveredTools: deriveRequirementEvidence(ctx.steps, effectiveRequiredTools, ctx.ledger)
      .coveredTools,
    // Grounding (F1) is owned by applyGroundedTerminalGate on the arbitrate
    // path; the lexical proposal is gated on contract COVERAGE only.
    hasSubstantiveGrounding: true,
    redirectsSpent: { grounding: 0, coverage: ctx.redirectCount, checker: 0 },
    ...(ctx.redirectBudget !== undefined ? { redirectBudget: ctx.redirectBudget } : {}),
    coverageExhaustionPolicy: "accept",
    hasUnconsumedEvidence: unconsumedEvidence !== null,
    // 2026-08-15: dedicated budget, not ctx.redirectCount — see TerminationContext.evidenceRedirectCount.
    evidenceRedirectsSpent: ctx.evidenceRedirectCount ?? 0,
    buildEvidenceGuidance: () =>
      `Before finalizing: earlier tool results were shown to you only as short previews. ` +
      `Here is the COMPLETE content, expanded automatically — ground your answer in it (do not ` +
      `invent details not present here), then give your final answer again:\n\n${unconsumedEvidence ?? ""}`,
    ...(ctx.runContract !== undefined
      ? { contract: ctx.runContract, evidence: { steps: ctx.steps, output: candidate, ledger: ctx.ledger } }
      : {}),
    buildGroundingGuidance: () => "",
    buildCoverageGuidance: (missing) =>
      `outstanding requirements not yet satisfied: ${missing.join("; ")} — address them, or state explicitly why they are unnecessary and give your final answer`,
  });
  return gate.decision === "redirect" ? gate.guidance : null;
}

export const contentStabilityEvaluator: TerminationSignalEvaluator = {
  name: "ContentStability",
  evaluate: (ctx) => {
    if (!ctx.priorThought || ctx.toolRequest) return null;
    const current = ctx.thought.trim();
    const prior = ctx.priorThought.trim();
    if (current.length === 0 || prior.length === 0) return null;

    const exact = current === prior;
    // Fuzzy match only for substantive content (>= 100 chars) to avoid
    // false positives on short incrementing outputs like "Step 1..." / "Step 2..."
    const stabilityThreshold = CONTENT_STABILITY_THRESHOLDS[ctx.tier ?? "mid"] ?? 0.85;
    const fuzzy =
      current.length >= 100 && normalizedLevenshtein(current, prior) > stabilityThreshold;
    if (!exact && !fuzzy) return null;

    // Piece 1 (spec §1a): content-stability is a LEXICAL proposal, not a
    // terminator. On a contract-bearing run the candidate must clear the
    // terminal gate — else it becomes a redirect and the run continues with the
    // outstanding list. Contractless runs exit exactly as before (helper → null).
    const redirect = contractCoverageProposal(ctx, current);
    if (redirect !== null) {
      return { action: "redirect", confidence: "medium", reason: redirect };
    }
    return {
      action: "exit",
      confidence: exact ? "high" : "medium",
      reason: "content_stable",
      output: current,
    };
  },
};

export const llmEndTurnEvaluator: TerminationSignalEvaluator = {
  name: "LLMEndTurn",
  evaluate: (ctx) => {
    if (ctx.stopReason !== "end_turn") return null;
    if (ctx.thought.trim().length === 0) return null;
    // B1 (2026-07-07): a silent null here was an invisible wall — bench trace
    // 01KWXQK2D001 (qwen3:14b, rw-2) produced the correct grounded answer at
    // iteration 1 and looped to the 420s timeout because the exit was
    // declined with no feedback each turn. Bounded fix, mirroring the F1
    // redirect-then-accept symmetry: name the gap ONCE, then accept the next
    // substantive end_turn. Phase 3: the decision lives in the terminal
    // gate's coverage check (kernel semantics: covered = attempted, policy =
    // accept on exhaustion; the F1 arm downstream still guards the
    // zero-substantive-grounding case, so grounding is held true here).
    // 2026-08-16 root fix: resolve unconsumed stored evidence deterministically
    // (no recall() dependency) so an end_turn candidate synthesized from a
    // compressed preview gets redirected ONCE with the real fetched content,
    // instead of shipping ungrounded. Absent scratchpad (caller didn't thread
    // it) → inert, byte-identical.
    const unconsumedEvidence = ctx.scratchpad
      ? resolveUnconsumedEvidence(ctx.steps, ctx.scratchpad)
      : null;
    const gate = evaluateTerminalGate({
      terminatedBy: "end_turn",
      requiredTools: ctx.requiredTools,
      // Step 3 item 3c (09 §6.5): one ledger-backed derivation — covered
      // means COMPLETED SUCCESSFULLY, not merely attempted (`ctx.toolsUsed`).
      coveredTools: deriveRequirementEvidence(ctx.steps, ctx.requiredTools, ctx.ledger)
        .coveredTools,
      hasSubstantiveGrounding: true,
      redirectsSpent: { grounding: 0, coverage: ctx.redirectCount, checker: 0 },
      redirectBudget: ctx.redirectBudget,
      coverageExhaustionPolicy: "accept",
      hasUnconsumedEvidence: unconsumedEvidence !== null,
      // 2026-08-15: dedicated one-shot budget (evidenceRedirectCount), NOT the
      // generic ctx.redirectCount grounding/coverage share. The prior version
      // reused that shared counter, so a run whose ONLY earlier redirect was an
      // unrelated grounding/coverage gap permanently starved this check —
      // measured live (gemini-2.5-flash, trace 01M03XF7QQRXKPE71VT5T2C88J): an
      // end_turn candidate with 4 unconsumed scratchpad keys exited ungrounded.
      evidenceRedirectsSpent: ctx.evidenceRedirectCount ?? 0,
      buildEvidenceGuidance: () =>
        `Before finalizing: earlier tool results were shown to you only as short previews. ` +
        `Here is the COMPLETE content, expanded automatically — ground your answer in it (do not ` +
        `invent details not present here), then give your final answer again:\n\n${unconsumedEvidence ?? ""}`,
      // B2 check 2.5: when a RunContract is present, coverage consumes
      // requirement satisfaction (verify against the ledger + this candidate
      // answer) instead of the tool-name diff. Absent → tool-name path.
      ...(ctx.runContract !== undefined
        ? {
            contract: ctx.runContract,
            evidence: {
              steps: ctx.steps,
              output: ctx.thought.trim(),
              ledger: ctx.ledger,
            },
          }
        : {}),
      buildGroundingGuidance: () => "",
      // No-contract wording is unchanged (rw-9 byte-identity); the contract path
      // names outstanding REQUIREMENTS (may be artifacts, not just tools).
      buildCoverageGuidance: (missing) =>
        ctx.runContract !== undefined
          ? `outstanding requirements not yet satisfied: ${missing.join("; ")} — address them, or state explicitly why they are unnecessary and give your final answer`
          : `required tools not used yet: ${missing.join(", ")} — use them, or state explicitly why they are unnecessary and give your final answer`,
    });
    if (gate.decision === "redirect") {
      return { action: "redirect", confidence: "medium", reason: gate.guidance };
    }
    return { action: "exit", confidence: "medium", reason: "llm_end_turn", output: ctx.thought.trim() };
  },
};

export const finalAnswerRegexEvaluator: TerminationSignalEvaluator = {
  name: "FinalAnswerRegex",
  evaluate: (ctx) => {
    const thought = ctx.thought;
    const thinking = ctx.thinking ?? "";
    if (!FINAL_ANSWER_RE.test(thought) && !FINAL_ANSWER_RE.test(thinking)) return null;

    const extracted = extractFinalAnswer(thought) || extractFinalAnswer(thinking);
    if (!extracted || extracted.trim().length === 0) return null;
    const candidate = extracted.trim();
    // Piece 1 (spec §1a): the final-answer regex is a LEXICAL proposal, not a
    // terminator — gate the candidate against the contract before exit.
    const redirect = contractCoverageProposal(ctx, candidate);
    if (redirect !== null) {
      return { action: "redirect", confidence: "medium", reason: redirect };
    }
    return { action: "exit", confidence: "medium", reason: "final_answer_regex", output: candidate };
  },
};

export const completionGapEvaluator: TerminationSignalEvaluator = {
  name: "CompletionGap",
  evaluate: (ctx) => {
    // Completion gap logic is injected at integration time since it depends
    // on detectCompletionGaps from react-kernel.ts. This evaluator is
    // a factory target — the kernel passes a configured instance.
    // Default: no opinion.
    if (ctx.redirectCount >= 1) return null;
    return null;
  },
};

// ── controllerSignalVetoEvaluator (CHANGE A — Verdict-Override) ──────────────
//
// Why: corpus traces (2026-04-25) showed 3 of 4 labeled-failure scenarios
// terminated with success=true at iter 3-9 — well within budget. The agents
// stopped while STILL FAILING and the framework declared success because the
// only termination signal it consulted was the agent's own end_turn. Yet the
// controller had been firing tactical interventions repeatedly without ever
// escalating to switch-strategy. The veto reads that controller history and
// converts the would-be success into a correct failure.
//
// Trigger conditions (all must hold to veto):
//   1. Agent is signaling exit (stopReason === "end_turn" OR has a textual
//      thought ready to be the final answer)
//   2. controllerDecisionLog shows pathological tactical activity:
//        - ≥2 stall-detect decisions, OR
//        - ≥3 tool-inject decisions, OR
//        - high entropy (composite > 0.55) AND ≥1 stall-detect
//   3. switch-strategy NEVER fired in this run (no escalation occurred)
//
// Conservative on purpose — false vetoes (rejecting a correct success) are
// worse than missed vetoes. If success-typescript-paradigm-style runs (1
// stall-detect + recovery) start tripping the veto, raise thresholds.
//
// Pattern: Verdict-Override. The agent's self-report is one signal; the
// controller's aggregate history is another; the meta-controller produces the
// final verdict by reconciling them.
export const controllerSignalVetoEvaluator: TerminationSignalEvaluator = {
  name: "ControllerSignalVeto",
  evaluate: (ctx) => {
    // E2 (audit 02-#2 veto-at-finish-line): under the long-horizon profile,
    // never convert a SYNTHESIZE-phase run's success into a failure — the run
    // reached the endgame; stale tactical churn must not amputate it. Absent
    // (profile off) → falls through to today's behavior.
    if (ctx.assessmentPhase === "synthesize") return null;
    // A2 — under the long-horizon profile the veto counts only the last N
    // decision-log entries (windowed); off → run-cumulative (window undefined).
    const log = windowDecisions(ctx.controllerDecisionLog ?? [], ctx.vetoDecisionWindow);
    if (log.length === 0) return null;

    // Extract decision types — entries are formatted "decisionType: reason".
    const decisionTypes = log.map((e) => e.split(":", 1)[0]?.trim() ?? "");

    // Escalation already happened — trust the controller's own escalation path.
    const hasEscalation = decisionTypes.some((d) => d === "switch-strategy");
    if (hasEscalation) return null;

    const stallCount = decisionTypes.filter((d) => d === "stall-detect").length;
    const injectCount = decisionTypes.filter((d) => d === "tool-inject").length;
    const entropy = ctx.entropy?.composite ?? 0;

    const repeatedStall = stallCount >= 2;
    const repeatedInject = injectCount >= 3;
    const stallWithHighEntropy = stallCount >= 1 && entropy > 0.55;

    if (!repeatedStall && !repeatedInject && !stallWithHighEntropy) return null;

    // Only veto if the agent is actually trying to exit. If the kernel is
    // mid-loop and we'd just continue anyway, the veto adds no value.
    const lookingToExit =
      ctx.stopReason === "end_turn" || ctx.thought.trim().length > 0;
    if (!lookingToExit) return null;

    const reasons: string[] = [];
    if (repeatedStall) reasons.push(`${stallCount} stall-detect`);
    if (repeatedInject) reasons.push(`${injectCount} tool-inject`);
    if (stallWithHighEntropy)
      reasons.push(`stall+entropy=${entropy.toFixed(2)}`);

    return {
      action: "fail",
      confidence: "high",
      reason: `controller_signal_veto: ${reasons.join(", ")} without switch-strategy escalation`,
      // No output — the run is being marked as failed; the kernel surfaces
      // the veto reason as state.error instead.
    };
  },
};

/** Default evaluator chain — ordered for short-circuit performance.
 *  controllerSignalVeto runs FIRST so its high-confidence "fail" verdict can
 *  short-circuit before any successful-exit evaluator gets a chance to fire.
 *  finalAnswerRegex runs before llmEndTurn because it extracts a clean answer
 *  (stripping the "FINAL ANSWER:" prefix), while end_turn returns raw thought. */
export const defaultEvaluators: readonly TerminationSignalEvaluator[] = [
  pendingToolCallEvaluator,
  controllerSignalVetoEvaluator,
  entropyConvergenceEvaluator,
  reactiveControllerEarlyStopEvaluator,
  contentStabilityEvaluator,
  finalAnswerRegexEvaluator,
  llmEndTurnEvaluator,
  // finalAnswerToolEvaluator + completionGapEvaluator removed from the chain
  // (Phase 1b, 2026-07-07): both unconditionally return null — a chain slot
  // paid on every evaluateTermination call for no opinion. The exported
  // symbols remain (deprecated) until the Phase 3 oracle merge deletes the
  // legacy chain wholesale.
];
