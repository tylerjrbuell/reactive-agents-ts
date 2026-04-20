import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/**
 * Fire when the same tool has failed consecutively N+ times.
 *
 * This signal is complementary to entropy — a model stuck retrying a broken
 * tool may have flat or even low entropy (confident but wrong approach).
 * The streak threshold defaults to 3 to avoid triggering on transient errors.
 */
export function evaluateToolFailureStreak(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "tool-failure-redirect" }) | null {
  const { consecutiveToolFailures, failingToolName, iteration } = params;
  if (!consecutiveToolFailures || consecutiveToolFailures < 3) return null;
  if (!failingToolName) return null;
  // Give the model at least 2 iterations before redirecting
  if (iteration < 2) return null;

  return {
    decision: "tool-failure-redirect",
    failingTool: failingToolName,
    streakCount: consecutiveToolFailures,
    reason: `"${failingToolName}" has failed ${consecutiveToolFailures} consecutive times — try a different approach or tool`,
  };
}
