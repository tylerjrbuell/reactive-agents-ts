import type { ControllerDecision, ControllerEvalParams } from "../types.js";

/**
 * Evaluate whether the agent should switch reasoning strategy.
 * Fires when entropy trajectory has been "flat" for N consecutive iterations
 * AND the behavioral loop score is high (> 0.7), indicating the current
 * strategy is stuck in an unproductive loop.
 */
export function evaluateStrategySwitch(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "switch-strategy" }) | null {
  const { entropyHistory, config, strategy } = params;
  const flatCount = config.flatIterationsBeforeSwitch ?? 3;

  // Need enough history
  if (entropyHistory.length < flatCount) return null;

  // Check last flatCount entries all have shape "flat"
  const recent = entropyHistory.slice(-flatCount);
  const allFlat = recent.every((e) => e.trajectory.shape === "flat");
  if (!allFlat) return null;

  // Check behavioral loop score exceeds threshold
  if (params.behavioralLoopScore <= 0.7) return null;

  // Simple alternation: suggest the other strategy
  const to =
    strategy === "plan-execute-reflect" ? "reactive" : "plan-execute-reflect";

  return {
    decision: "switch-strategy",
    from: strategy,
    to,
    reason: `Entropy flat for ${flatCount} iterations with high loop score (${params.behavioralLoopScore.toFixed(2)}), switching from ${strategy} to ${to}`,
  };
}
