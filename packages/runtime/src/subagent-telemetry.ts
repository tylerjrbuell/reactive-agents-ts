export const SUBAGENT_TOOL_NAMES: ReadonlySet<string> = new Set(["spawn-agent", "spawn-agents"]);

export function isSubagentCall(
  toolName: string,
  customAgentToolNames: readonly string[],
): boolean {
  return SUBAGENT_TOOL_NAMES.has(toolName) || customAgentToolNames.includes(toolName);
}
