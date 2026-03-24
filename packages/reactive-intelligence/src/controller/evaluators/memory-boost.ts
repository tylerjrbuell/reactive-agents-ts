import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/** Switch from recent/keyword retrieval to semantic RAG when knowledge gap detected. */
export function evaluateMemoryBoost(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "memory-boost" }) | null {
  const { entropyHistory, activeRetrievalMode } = params;
  if (!activeRetrievalMode || activeRetrievalMode === "semantic") return null;
  if (entropyHistory.length < 3) return null;

  const latest = entropyHistory[entropyHistory.length - 1]!;
  if (latest.composite < 0.6) return null;

  // Flat trajectory + high entropy = not progressing, needs better context
  const recent = entropyHistory.slice(-2);
  const notConverging = recent.every((e) => e.trajectory.shape !== "converging");
  if (!notConverging) return null;

  return {
    decision: "memory-boost",
    from: activeRetrievalMode,
    to: "semantic",
    reason: `Knowledge gap pattern: entropy ${latest.composite.toFixed(3)}, trajectory ${latest.trajectory.shape}`,
  };
}
