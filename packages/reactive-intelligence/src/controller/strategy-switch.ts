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
  const { entropyHistory, config, strategy, iteration } = params;
  const flatCount = config.flatIterationsBeforeSwitch ?? 3;

  // Need enough history and must be past early exploration phase.
  // Switching strategy in the first 3 iterations is premature — the model
  // hasn't had runway to demonstrate the current strategy is actually stuck.
  if (entropyHistory.length < flatCount) return null;
  if (iteration < 3) return null;

  // Check last flatCount entries all have shape "flat"
  const recent = entropyHistory.slice(-flatCount);
  const allFlat = recent.every((e) => e.trajectory.shape === "flat");
  if (!allFlat) return null;

  // Require elevated entropy — flat at 0.15 means the model finished and is
  // just stalling, not that it's stuck in a bad loop. Only switch strategy
  // when the model is stuck at a meaningfully high entropy level.
  const flatEntropy = recent[recent.length - 1]!.composite;
  if (flatEntropy < 0.35) return null;

  // Check behavioral loop score exceeds threshold.
  // 0.45 rather than 0.7: local models accumulate behavioral entropy more slowly
  // (fewer repeated tool calls before giving up), so a lower bar catches real loops.
  if (params.behavioralLoopScore <= 0.45) return null;

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
