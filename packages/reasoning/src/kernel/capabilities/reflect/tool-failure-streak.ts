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
 */
import type { KernelMessage } from "../../state/kernel-message.js";

/** The trailing same-tool failure streak; `toolName` is undefined when `count` is 0. */
export interface ToolFailureStreak {
  readonly count: number;
  readonly toolName: string | undefined;
}

/**
 * Scan `tool_result` messages from the end: skip refusals, stop at the first
 * success or at a change of tool.
 */
export function toolFailureStreak(messages: readonly KernelMessage[]): ToolFailureStreak {
  let count = 0;
  let toolName: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "tool_result" || m.refused) continue;
    if (!m.isError) break;
    if (toolName === undefined) toolName = m.toolName;
    if (m.toolName !== toolName) break;
    count++;
  }
  return { count, toolName };
}
