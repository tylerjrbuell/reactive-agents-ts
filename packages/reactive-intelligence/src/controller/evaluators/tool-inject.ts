import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/** Fire when structural entropy signals knowledge gap and tools are available. */
export function evaluateToolInject(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "tool-inject" }) | null {
  const { entropyHistory, availableToolNames } = params;
  if (!availableToolNames || availableToolNames.length === 0) return null;
  if (entropyHistory.length < 2) return null;

  const latest = entropyHistory[entropyHistory.length - 1]!;
  // High composite entropy + flat/diverging trajectory = knowledge gap
  if (latest.composite < 0.7 || latest.trajectory.shape === "converging") return null;

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
