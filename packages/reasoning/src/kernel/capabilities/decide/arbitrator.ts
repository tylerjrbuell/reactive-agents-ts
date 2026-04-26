/**
 * shared/termination-oracle.ts — Scored signal pipeline for ReAct kernel exit logic.
 *
 * Replaces scattered if/else exit conditions with a composable evaluator chain.
 * Each TerminationSignalEvaluator inspects TerminationContext and returns a
 * SignalVerdict (or null to abstain). The resolver aggregates verdicts with
 * short-circuit semantics for high-confidence signals.
 */

import type { ReasoningStep } from "../../../types/index.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { FINAL_ANSWER_RE, extractFinalAnswer } from "../act/tool-parsing.js";

// ── Local structural types ──────────────────────────────────────────────
// These mirror shapes from @reactive-agents/reactive-intelligence without
// creating a cross-package dependency. The reasoning package deliberately
// avoids depending on reactive-intelligence (see service-utils.ts).

export interface ToolRequest {
  readonly tool: string;
  readonly input: string;
}

/** Subset of ControllerDecision from reactive-intelligence. */
export interface ReactiveDecision {
  readonly decision: "early-stop" | "compress" | "switch-strategy";
  readonly reason: string;
}

/** Subset of EntropyTrajectory from reactive-intelligence. */
export interface EntropyTrajectory {
  readonly history?: readonly number[];
  readonly shape: "converging" | "flat" | "diverging" | "v-recovery" | "oscillating";
  readonly derivative: number;
  readonly momentum: number;
}

/** Subset of EntropyScore from reactive-intelligence (composite + trajectory). */
export interface EntropyScoreLike {
  readonly composite: number;
  readonly trajectory?: EntropyTrajectory;
}

export interface TerminationContext {
  readonly thought: string;
  readonly thinking?: string;
  readonly stopReason: string;
  readonly toolRequest: ToolRequest | null;
  readonly iteration: number;
  readonly tier?: "local" | "mid" | "large" | "frontier";
  readonly steps: readonly ReasoningStep[];
  readonly priorThought?: string;
  readonly entropy?: EntropyScoreLike;
  readonly trajectory?: EntropyTrajectory;
  readonly controllerDecisions?: readonly ReactiveDecision[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly requiredTools: readonly string[];
  readonly allToolSchemas: readonly ToolSchema[];
  readonly redirectCount: number;
  readonly priorFinalAnswerAttempts: number;
  readonly taskDescription: string;
  /**
   * Run-wide accumulated controller decision strings (from
   * state.controllerDecisionLog). Each entry is "decisionType: reason".
   * Used by controllerSignalVetoEvaluator to detect pathological controller
   * activity that should override an apparent successful exit.
   */
  readonly controllerDecisionLog?: readonly string[];
}

export interface SignalVerdict {
  /**
   * "fail" (S2.5 Slice C+ / CHANGE A — Verdict-Override pattern):
   * Exit the kernel AND mark the run as failed (status="failed", success=false),
   * regardless of the agent's own success claim. Used when the controller's
   * accumulated activity (repeated tactical interventions without escalation,
   * high entropy, tool-failure streaks) contradicts the agent's exit signal.
   */
  readonly action: "exit" | "redirect" | "continue" | "fail";
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  readonly output?: string;
}

export interface TerminationSignalEvaluator {
  readonly name: string;
  readonly evaluate: (ctx: TerminationContext) => SignalVerdict | null;
}

export interface TerminationDecision {
  readonly shouldExit: boolean;
  readonly action: SignalVerdict["action"];
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  readonly evaluator: string;
  readonly output?: string;
  readonly allVerdicts: ReadonlyArray<{ evaluator: string; verdict: SignalVerdict }>;
}

// ── Resolver ────────────────────────────────────────────────────────────

function confidenceRank(c: "high" | "medium" | "low"): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

export function evaluateTermination(
  ctx: TerminationContext,
  evaluators: readonly TerminationSignalEvaluator[],
): TerminationDecision {
  const verdicts: Array<{ evaluator: string; verdict: SignalVerdict }> = [];

  for (const ev of evaluators) {
    const verdict = ev.evaluate(ctx);
    if (!verdict) continue;

    verdicts.push({ evaluator: ev.name, verdict });

    // Short-circuit: high-confidence FAIL veto (CHANGE A — Verdict-Override).
    // Wins over any subsequent exit/continue verdict because controller-level
    // failure detection trumps the agent's own success claim. shouldExit=true
    // so the kernel terminates this iteration; the action="fail" tells
    // think.ts to set status="failed" not status="done".
    if (verdict.action === "fail" && verdict.confidence === "high") {
      return { shouldExit: true, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }
    // Short-circuit: high-confidence exit
    if (verdict.action === "exit" && verdict.confidence === "high") {
      return { shouldExit: true, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }
    // Short-circuit: high-confidence continue (e.g., tool call pending)
    if (verdict.action === "continue" && verdict.confidence === "high") {
      return { shouldExit: false, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }
  }

  // Failure verdicts trump exits at the same confidence band — the
  // Verdict-Override pattern says: when the controller signals failure, the
  // kernel terminates as failed even if another evaluator wanted a success exit.
  const fails = verdicts
    .filter((v) => v.verdict.action === "fail")
    .sort((a, b) => confidenceRank(b.verdict.confidence) - confidenceRank(a.verdict.confidence));
  const bestFail = fails[0];
  if (bestFail) {
    return {
      shouldExit: true,
      ...bestFail.verdict,
      evaluator: bestFail.evaluator,
      allVerdicts: verdicts,
    };
  }

  const exits = verdicts
    .filter((v) => v.verdict.action === "exit")
    .sort((a, b) => confidenceRank(b.verdict.confidence) - confidenceRank(a.verdict.confidence));
  const redirects = verdicts
    .filter((v) => v.verdict.action === "redirect")
    .sort((a, b) => confidenceRank(b.verdict.confidence) - confidenceRank(a.verdict.confidence));

  const bestExit = exits[0];
  const bestRedirect = redirects[0];

  if (bestExit && bestRedirect) {
    if (confidenceRank(bestExit.verdict.confidence) >= confidenceRank(bestRedirect.verdict.confidence)) {
      return { shouldExit: true, ...bestExit.verdict, evaluator: bestExit.evaluator, allVerdicts: verdicts };
    }
    return { shouldExit: false, ...bestRedirect.verdict, evaluator: bestRedirect.evaluator, allVerdicts: verdicts };
  }
  if (bestExit) {
    return { shouldExit: true, ...bestExit.verdict, evaluator: bestExit.evaluator, allVerdicts: verdicts };
  }
  if (bestRedirect) {
    return { shouldExit: false, ...bestRedirect.verdict, evaluator: bestRedirect.evaluator, allVerdicts: verdicts };
  }

  return {
    shouldExit: false,
    action: "continue",
    confidence: "low",
    reason: "no_exit_signal",
    evaluator: "none",
    allVerdicts: verdicts,
  };
}

// ── Levenshtein Utility ──────────────────────────────────────────────────────

/** Normalized Levenshtein similarity (0-1, 1 = identical). No external dependencies. */
export function normalizedLevenshtein(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) { matrix[i]![j] = j; continue; }
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return 1 - matrix[a.length]![b.length]! / maxLen;
}

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
    return { action: "exit", confidence: "high", reason: `controller_early_stop: ${earlyStop.reason}`, output: ctx.thought.trim() };
  },
};

export const contentStabilityEvaluator: TerminationSignalEvaluator = {
  name: "ContentStability",
  evaluate: (ctx) => {
    if (!ctx.priorThought || ctx.toolRequest) return null;
    const current = ctx.thought.trim();
    const prior = ctx.priorThought.trim();
    if (current.length === 0 || prior.length === 0) return null;

    if (current === prior) {
      return { action: "exit", confidence: "high", reason: "content_stable", output: current };
    }
    // Fuzzy match only for substantive content (>= 100 chars) to avoid
    // false positives on short incrementing outputs like "Step 1..." / "Step 2..."
    const stabilityThreshold = CONTENT_STABILITY_THRESHOLDS[ctx.tier ?? "mid"] ?? 0.85;
    if (current.length >= 100 && normalizedLevenshtein(current, prior) > stabilityThreshold) {
      return { action: "exit", confidence: "medium", reason: "content_stable", output: current };
    }
    return null;
  },
};

export const llmEndTurnEvaluator: TerminationSignalEvaluator = {
  name: "LLMEndTurn",
  evaluate: (ctx) => {
    if (ctx.stopReason !== "end_turn") return null;
    if (ctx.thought.trim().length === 0) return null;
    const remainingRequired = ctx.requiredTools.filter((t) => !ctx.toolsUsed.has(t));
    if (remainingRequired.length > 0) return null;
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
    return { action: "exit", confidence: "medium", reason: "final_answer_regex", output: extracted.trim() };
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
    const log = ctx.controllerDecisionLog ?? [];
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
  finalAnswerToolEvaluator,
  entropyConvergenceEvaluator,
  reactiveControllerEarlyStopEvaluator,
  contentStabilityEvaluator,
  finalAnswerRegexEvaluator,
  llmEndTurnEvaluator,
  completionGapEvaluator,
];
