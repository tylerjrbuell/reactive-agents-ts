import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/**
 * Fire when the same tool has failed in 2+ consecutive batches.
 *
 * This signal is complementary to entropy — a model stuck retrying a broken
 * tool may have flat or even low entropy (confident but wrong approach).
 *
 * The first fire is a nudge; a later fire is an early stop (the handler counts
 * prior applied redirects). Re-fire therefore needs evidence that the model
 * ignored the nudge, read from the pending batch (`pendingToolCalls`, emitted
 * by think and not yet run):
 *
 * - A non-empty batch that no longer calls the failing tool is a changed
 *   approach: no decision. lh-a0 baseline 2026-11-06 (trace
 *   01M6REXPKJXWABQ9WB081BTBCR): the redirect early-stopped a batch of 4
 *   file-writes after two file-read failures.
 * - After a nudge, only an IDENTICAL failing call (same tool, same canonical
 *   arguments) in the pending batch re-fires. The nudge asks for different
 *   arguments; 5 of 6 inspectable post-nudge calls in the RI census
 *   (2026-11-06, e.g. 01M6QTFXJ2E5H7FPG80P3QVAKR) had changed them and were
 *   early-stopped. An empty batch (a turn with no tool calls, or the post-act
 *   evaluation) repeats nothing (verdict 2026-11-06, run
 *   01M6RKA3KHF937NA4QV45HWMZR iterations 5-6).
 */
export function evaluateToolFailureStreak(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "tool-failure-redirect" }) | null {
  const { consecutiveToolFailures, failingToolName, iteration, pendingToolCalls, failingArgsKeys, priorDecisionsThisRun } =
    params;
  // Threshold 2: one failure might be transient (rate limit, timeout); two in
  // a row on the same tool signals a genuine stuck loop worth redirecting.
  if (!consecutiveToolFailures || consecutiveToolFailures < 2) return null;
  if (!failingToolName) return null;
  // Give the model at least 2 iterations before redirecting
  if (iteration < 2) return null;

  const pendingOnTool = (pendingToolCalls ?? []).filter((c) => c.name === failingToolName);
  // A pending batch that avoids the failing tool is a changed approach.
  if (pendingToolCalls !== undefined && pendingToolCalls.length > 0 && pendingOnTool.length === 0) return null;

  const nudged = (priorDecisionsThisRun ?? []).includes("tool-failure-redirect");
  if (nudged) {
    const failed = new Set(failingArgsKeys ?? []);
    if (!pendingOnTool.some((c) => failed.has(c.argsKey))) return null;
  }

  return {
    decision: "tool-failure-redirect",
    failingTool: failingToolName,
    streakCount: consecutiveToolFailures,
    reason: `"${failingToolName}" has failed ${consecutiveToolFailures} consecutive times — try a different approach or tool`,
  };
}
