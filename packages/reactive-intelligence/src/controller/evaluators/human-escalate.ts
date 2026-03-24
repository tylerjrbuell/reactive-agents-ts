import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/** Fire when all other decisions have been exhausted and entropy is still high. */
export function evaluateHumanEscalate(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "human-escalate" }) | null {
  const { entropyHistory, priorDecisionsThisRun } = params;
  if (!priorDecisionsThisRun || priorDecisionsThisRun.length < 3) return null;
  if (entropyHistory.length < 4) return null;

  const latest = entropyHistory[entropyHistory.length - 1]!;
  if (latest.composite < 0.7) return null; // still manageable

  // Need evidence that multiple decision types have been tried
  const uniqueDecisions = new Set(priorDecisionsThisRun);
  if (uniqueDecisions.size < 3) return null; // haven't tried enough yet

  return {
    decision: "human-escalate",
    reason: `Entropy still high (${latest.composite.toFixed(3)}) after ${uniqueDecisions.size} decision types tried`,
    decisionsExhausted: [...uniqueDecisions],
  };
}
