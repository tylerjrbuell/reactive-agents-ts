import { defineTool, type DefineToolOptions, type DefinedTool } from "./define-tool.js";
import type { ToolDefinition } from "./types.js";

export interface ToolsetDefaults {
  readonly category?: ToolDefinition["category"];
  readonly riskLevel?: ToolDefinition["riskLevel"];
  readonly timeoutMs?: number;
  readonly requiresApproval?: boolean;
  readonly isCacheable?: boolean;
  readonly cacheTtlMs?: number;
}

export interface Toolset {
  readonly name: string;
  readonly tool: <A, O = unknown>(options: DefineToolOptions<A, O>) => DefinedTool;
}

/**
 * Groups related `defineTool` calls under shared defaults (category, risk
 * level, timeout, approval, cache policy) so a domain toolset (e.g. every
 * Halopedia lookup tool) doesn't repeat the same 4-5 metadata fields per
 * tool. Any field the caller sets explicitly on an individual tool wins
 * over the toolset default — this only fills in what's left unset.
 */
export function defineToolset(name: string, defaults: ToolsetDefaults = {}): Toolset {
  return {
    name,
    tool: <A, O = unknown>(options: DefineToolOptions<A, O>): DefinedTool =>
      defineTool<A, O>({
        ...defaults,
        ...options,
      }),
  };
}
