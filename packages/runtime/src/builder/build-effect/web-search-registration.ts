/**
 * Per-agent `web-search` registration.
 *
 * `.withTools({ webSearch: { apiKeys, providers } })` replaces the default
 * `web-search` handler with `makeWebSearchHandler(config)`, so the agent's own
 * keys are used instead of process env vars (which would leak to shell and
 * code-execute children and race across concurrent runs). Nothing is
 * registered when `webSearch` is unset, when `web-search` is not a permitted
 * built-in, or when the agent defines its own `web-search` tool.
 */
import { makeWebSearchHandler, webSearchTool } from "@reactive-agents/tools";
import { computeExposedToolNames } from "../contract-tool-set.js";
import type { ToolsOptions } from "../types.js";
import type { ToolInitRegistration } from "./tool-init-layer.js";

/** The registration for the configured `web-search`, or `undefined` when none applies. */
export const webSearchRegistration = (
  toolsOptions: ToolsOptions | undefined,
  requiredTools?: readonly string[],
): ToolInitRegistration | undefined => {
  const config = toolsOptions?.webSearch;
  if (config === undefined) return undefined;
  if ((toolsOptions?.tools ?? []).some((t) => t.definition.name === webSearchTool.name)) return undefined;
  if (!computeExposedToolNames(toolsOptions, requiredTools).includes(webSearchTool.name)) return undefined;
  return { def: webSearchTool, handler: makeWebSearchHandler(config) };
};
