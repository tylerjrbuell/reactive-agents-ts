/**
 * Shared constants for the composable kernel.
 *
 * Single source of truth for meta-tool names and other kernel-wide constants.
 * Every kernel phase, guard, and utility MUST import from here instead of
 * defining their own copy.
 */

/**
 * Meta-tool names — tools handled inline by the harness rather than
 * dispatched to ToolService. Not counted as "real work" for
 * completion detection, deliverable assembly, or loop detection.
 */
export const META_TOOLS = new Set([
  "final-answer",
  "task-complete",
  "context-status",
  "brief",
  "pulse",
  "find",
  "recall",
  "checkpoint",
]) as ReadonlySet<string>;

/**
 * Introspection-only meta-tools subject to consecutive-call dedup detection.
 * Subset of META_TOOLS — excludes final-answer and task-complete which are
 * termination tools, not introspection tools.
 */
export const INTROSPECTION_META_TOOLS = new Set([
  "brief",
  "pulse",
  "find",
  "recall",
  "checkpoint",
]) as ReadonlySet<string>;

/** Returns true when the tool is a delegation adapter (spawn-agent, agent-*). */
export function isDelegationTool(toolName: string): boolean {
  return toolName === "spawn-agent" || toolName.startsWith("agent-");
}
