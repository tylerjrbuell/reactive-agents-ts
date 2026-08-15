import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/** Fire when structural entropy signals knowledge gap and tools are available. */
export function evaluateToolInject(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "tool-inject" }) | null {
  const { entropyHistory, availableToolNames, hasUnconsumedStoredEvidence } = params;
  if (!availableToolNames || availableToolNames.length === 0) return null;
  // Need at least 3 iterations to distinguish a sustained knowledge gap from
  // normal early-run exploration (which also produces moderate entropy).
  if (entropyHistory.length < 3) return null;

  const latest = entropyHistory[entropyHistory.length - 1]!;
  const prev = entropyHistory[entropyHistory.length - 2]!;
  // Moderate-to-high entropy + flat/diverging trajectory = knowledge gap.
  // 0.5 rather than 0.7: local models without logprobs plateau at ~0.58-0.61.
  // Also require that entropy has been elevated for >=2 consecutive iterations
  // (not just a transient spike) to avoid false positives on success scenarios.
  if (latest.composite < 0.5 || prev.composite < 0.5) return null;
  if (latest.trajectory.shape === "converging") return null;

  // 2026-08-15 root fix (scratch.ts research-task finding): a "knowledge gap"
  // is not always a MISSING-evidence gap — the model may already have fetched
  // the answer and compressed it to the scratchpad without ever calling
  // recall() to read it back. Suggesting another web-search in that case
  // burns a redundant fetch while the real evidence sits unread. Prefer
  // recall over web-search whenever unconsumed stored evidence exists.
  const toolName =
    hasUnconsumedStoredEvidence && availableToolNames.includes("recall")
      ? "recall"
      : availableToolNames.includes("web-search")
        ? "web-search"
        : availableToolNames[0]!;

  const reason =
    toolName === "recall"
      ? `High entropy (${latest.composite.toFixed(3)}) with ${latest.trajectory.shape} trajectory — you already fetched evidence that was compressed to the scratchpad; call recall(key, full: true) to read the COMPLETE stored content (plain recall(key) only returns a short preview) before searching again`
      : `High entropy (${latest.composite.toFixed(3)}) with ${latest.trajectory.shape} trajectory — knowledge gap detected`;

  return {
    decision: "tool-inject",
    toolName,
    reason,
  };
}
