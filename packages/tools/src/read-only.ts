import type { ToolDefinition } from "./types.js";

/**
 * True only when a tool is positively declared read-only: it sets
 * `mutatesExternalState: false` AND does not require approval.
 *
 * Fails closed: a definition that omits `mutatesExternalState` (user tools,
 * MCP tools, `defineTool` default) is NOT read-only.
 */
export const isReadOnlyTool = (
  def: Pick<ToolDefinition, "mutatesExternalState" | "requiresApproval">,
): boolean => def.mutatesExternalState === false && !def.requiresApproval;

/**
 * Filter tool definitions down to the read-only ones (see {@link isReadOnlyTool}).
 * Use to build a restricted tool surface, e.g. for non-owner channel senders.
 */
export const readOnlyTools = <T extends Pick<ToolDefinition, "mutatesExternalState" | "requiresApproval">>(
  defs: ReadonlyArray<T>,
): ReadonlyArray<T> => defs.filter(isReadOnlyTool);
