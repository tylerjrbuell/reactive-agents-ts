import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/** Fire when structural entropy signals knowledge gap and tools are available. */
export function evaluateToolInject(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "tool-inject" }) | null {
  const { entropyHistory, availableToolNames } = params;
  if (!availableToolNames || availableToolNames.length === 0) return null;
  if (entropyHistory.length < 2) return null;

  const latest = entropyHistory[entropyHistory.length - 1]!;
  // Moderate-to-high entropy + flat/diverging trajectory = knowledge gap.
  // 0.5 rather than 0.7: local models without logprobs plateau at ~0.58-0.61
  // when genuinely stuck and never reach the old ceiling.
  if (latest.composite < 0.5 || latest.trajectory.shape === "converging") return null;

  // Suggest web-search if available, otherwise first available tool
  const toolName = availableToolNames.includes("web-search")
    ? "web-search"
    : availableToolNames[0]!;

  return {
    decision: "tool-inject",
    toolName,
    reason: `High entropy (${latest.composite.toFixed(3)}) with ${latest.trajectory.shape} trajectory — knowledge gap detected`,
  };
}
