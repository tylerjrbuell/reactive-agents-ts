import type { ToolDefinition } from "./types.js";

/**
 * Run a tool's deterministic pre-approval check (`ToolDefinition.preflight`).
 *
 * Returns the refusal text the tool would return at execution for these args,
 * or `undefined` to proceed (no preflight declared, call allowed, or the
 * preflight itself failed). Never throws: a broken preflight must not block a
 * call that execution would have accepted, so it degrades to "proceed" and
 * execution stays the authority.
 *
 * The approval gate calls this before requesting approval; a defined result is
 * returned to the model as the tool's refusal with no approval prompt.
 */
export function preflightToolCall(
  tool: Pick<ToolDefinition, "preflight"> | undefined,
  args: Record<string, unknown>,
): string | undefined {
  if (tool?.preflight === undefined) return undefined;
  try {
    const refusal = tool.preflight(args);
    return typeof refusal === "string" && refusal !== "" ? refusal : undefined;
  } catch {
    return undefined;
  }
}
