/**
 * shared/termination-oracle.ts — Scored signal pipeline for ReAct kernel exit logic.
 *
 * Replaces scattered if/else exit conditions with a composable evaluator chain.
 * Each TerminationSignalEvaluator inspects TerminationContext and returns a
 * SignalVerdict (or null to abstain). The resolver aggregates verdicts with
 * short-circuit semantics for high-confidence signals.
 */

import type { ReasoningStep } from "../../types/index.js";
import type { ToolSchema } from "./tool-utils.js";

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
}

export interface SignalVerdict {
  readonly action: "exit" | "redirect" | "continue";
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
  readonly action: "exit" | "redirect" | "continue";
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  readonly evaluator: string;
  readonly output?: string;
  readonly allVerdicts: ReadonlyArray<{ evaluator: string; verdict: SignalVerdict }>;
}

// ── Expanded FINAL ANSWER regex ─────────────────────────────────────────
// Defined locally here; will be moved/unified with tool-utils.ts in Task 5.

/** Expanded regex matching FINAL ANSWER with optional markdown bold and various colon forms. */
export const FINAL_ANSWER_RE = /(?:\*{0,2})final\s*answer(?:\*{0,2})\s*[:：]?\s*/i;

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

    // Short-circuit: high-confidence exit
    if (verdict.action === "exit" && verdict.confidence === "high") {
      return { shouldExit: true, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }
    // Short-circuit: high-confidence continue (e.g., tool call pending)
    if (verdict.action === "continue" && verdict.confidence === "high") {
      return { shouldExit: false, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }
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
