import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/**
 * Fire when the same tool has failed in 2+ consecutive batches.
 *
 * This signal is complementary to entropy — a model stuck retrying a broken
 * tool may have flat or even low entropy (confident but wrong approach).
 *
 * A pending batch (`pendingToolNames`, emitted by think and not yet run) that
 * no longer calls the failing tool is a changed approach, not a stuck loop:
 * no decision. lh-a0 baseline 2026-11-06 (trace 01M6REXPKJXWABQ9WB081BTBCR):
 * the redirect early-stopped a batch of 4 file-writes after two file-read
 * failures, dropping the writes the task needed.
 */
export function evaluateToolFailureStreak(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "tool-failure-redirect" }) | null {
  const { consecutiveToolFailures, failingToolName, iteration, pendingToolNames } = params;
  // Threshold 2: one failure might be transient (rate limit, timeout); two in
  // a row on the same tool signals a genuine stuck loop worth redirecting.
  if (!consecutiveToolFailures || consecutiveToolFailures < 2) return null;
  if (!failingToolName) return null;
  // Give the model at least 2 iterations before redirecting
  if (iteration < 2) return null;
  if (pendingToolNames !== undefined && !pendingToolNames.includes(failingToolName)) return null;

  return {
    decision: "tool-failure-redirect",
    failingTool: failingToolName,
    streakCount: consecutiveToolFailures,
    reason: `"${failingToolName}" has failed ${consecutiveToolFailures} consecutive times — try a different approach or tool`,
  };
}
