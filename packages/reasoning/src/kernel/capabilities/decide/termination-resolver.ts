/**
 * decide/termination-resolver.ts — the scored-signal aggregation resolver.
 *
 * `evaluateTermination` runs the TerminationSignalEvaluator chain with
 * short-circuit semantics (CHANGE A — Verdict-Override) and aggregates the
 * remaining verdicts into one TerminationDecision. Moved verbatim from
 * `arbitrator.ts` (GH #220 / quality program Task 7); the symbol is still
 * re-exported from `arbitrator.ts`.
 */

import type {
  SignalVerdict,
  TerminationContext,
  TerminationDecision,
  TerminationSignalEvaluator,
} from "./termination-types.js";

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
