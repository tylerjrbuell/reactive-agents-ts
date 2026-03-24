import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/** Fire when semantic entropy diverges over last 3 iterations → lower temperature. */
export function evaluateTempAdjust(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "temp-adjust" }) | null {
  const { entropyHistory, currentTemperature } = params;
  if (currentTemperature === undefined) return null;
  if (entropyHistory.length < 3) return null;

  const recent = entropyHistory.slice(-3);
  const diverging = recent.every((e) => e.trajectory.shape === "diverging" || e.trajectory.derivative > 0.05);

  if (!diverging) return null;

  const delta = -0.1;
  return {
    decision: "temp-adjust",
    delta,
    reason: `Semantic entropy diverging over last 3 iterations (derivative: ${recent[recent.length - 1]!.trajectory.derivative.toFixed(3)})`,
  };
}
