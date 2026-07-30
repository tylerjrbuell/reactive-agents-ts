// File: src/strategies/code-action/code-action-observe.ts
//
// Formats sandbox execution results as an observation message suitable
// for appending to the LLM conversation thread.
import { subAgentResultForDisplay } from "@reactive-agents/tools";

export interface ToolCallRecord {
  name: string;
  args: unknown;
  result: unknown;
}

/**
 * Formats the tool call log and final result as a human-readable
 * observation string appended to state.messages.
 *
 * `subAgentResultForDisplay` strips a `spawn-agent`/`spawn-agents` result's
 * `childRunLedger` carrier before it's stringified — without it a delegated
 * sub-agent's raw ledger entries leaked verbatim into this model-visible
 * text (root cause #7, 2026-07-29 systems audit; code-action was the one
 * delegation path Wave C.2 never wired through the merge/strip pattern the
 * other 3 paths use — see `subAgentChildLedgerEntries` in code-action.ts for
 * the merge half of the fix).
 */
export function formatObservationMessage(
  toolCalls: ToolCallRecord[],
  finalResult: unknown,
): string {
  const lines: string[] = ["[Code Execution Observation]"];

  if (toolCalls.length > 0) {
    lines.push(`\nTool calls made (${toolCalls.length}):`);
    for (const call of toolCalls) {
      const argsStr = JSON.stringify(call.args, null, 2);
      const resultStr =
        typeof call.result === "string"
          ? call.result
          : JSON.stringify(subAgentResultForDisplay(call.result));
      lines.push(`  - ${call.name}(${argsStr}) → ${resultStr}`);
    }
  } else {
    lines.push("\nNo tool calls made.");
  }

  lines.push(
    `\nFinal result: ${
      typeof finalResult === "string"
        ? finalResult
        : JSON.stringify(subAgentResultForDisplay(finalResult))
    }`,
  );

  return lines.join("\n");
}
