/**
 * Tool-failure streak — the trailing run of error `tool_result`s on one tool,
 * read by the reactive observer and handed to the controller's
 * tool-failure-streak evaluator (`consecutiveToolFailures`, `failingToolName`).
 *
 * A tool-gate refusal (`refused: true`, decide/tool-call-refusals.ts) is
 * skipped: the call never ran, so it is neither a failure nor a success. H3 at
 * 6a6a7f4d5 (trace 01M6Q3F6Z90Q97DB1C4JMAG9S2): five refused file-writes read
 * as five failures, tool-failure-redirect fired and dispatcher_early_stop ended
 * a correct run.
 *
 * The streak counts BATCHES (assistant turns), not results: parallel failures
 * in one batch are one failed attempt. lh-a0 baseline 2026-11-06 (trace
 * 01M6REXPKJXWABQ9WB081BTBCR): two file-reads of not-yet-written outputs
 * failed in one batch of 11 and read as a 2-streak, which fired the redirect.
 */
import type { KernelMessage } from "../../state/kernel-message.js";

/** The trailing same-tool failure streak; `toolName` is undefined when `count` is 0. */
export interface ToolFailureStreak {
  /** Consecutive batches (assistant turns) whose trailing results failed on `toolName`. */
  readonly count: number;
  readonly toolName: string | undefined;
}

/**
 * Scan `tool_result` messages from the end: skip refusals, stop at the first
 * success or at a change of tool. An assistant message closes a batch; each
 * batch with a failure on the tool adds one.
 */
export function toolFailureStreak(messages: readonly KernelMessage[]): ToolFailureStreak {
  let count = 0;
  let toolName: string | undefined;
  let batchCounted = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "assistant") {
      batchCounted = false;
      continue;
    }
    if (m.role !== "tool_result" || m.refused) continue;
    if (!m.isError) break;
    if (toolName === undefined) toolName = m.toolName;
    if (m.toolName !== toolName) break;
    if (!batchCounted) {
      count++;
      batchCounted = true;
    }
  }
  return { count, toolName };
}
