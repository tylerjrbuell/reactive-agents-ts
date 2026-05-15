// File: src/strategies/code-action/code-action-observe.ts
//
// Formats sandbox execution results as an observation message suitable
// for appending to the LLM conversation thread.

export interface ToolCallRecord {
  name: string;
  args: unknown;
  result: unknown;
}

/**
 * Formats the tool call log and final result as a human-readable
 * observation string appended to state.messages.
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
          : JSON.stringify(call.result);
      lines.push(`  - ${call.name}(${argsStr}) → ${resultStr}`);
    }
  } else {
    lines.push("\nNo tool calls made.");
  }

  lines.push(
    `\nFinal result: ${
      typeof finalResult === "string"
        ? finalResult
        : JSON.stringify(finalResult)
    }`,
  );

  return lines.join("\n");
}
