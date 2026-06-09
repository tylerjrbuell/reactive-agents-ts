import type { BuildCortexAgentParams, MCPServerConfig } from "./build-cortex-agent.js";

type ToolParamKeys = "mcpConfigs" | "agentTools" | "dynamicSubAgents" | "additionalToolNames";
type ToolParams = Partial<Pick<BuildCortexAgentParams, ToolParamKeys>>;
/** Mutable counterpart so fields can be assigned conditionally (Pick keeps `readonly`). */
type MutableToolParams = { -readonly [K in ToolParamKeys]?: NonNullable<BuildCortexAgentParams[K]> };

/**
 * Tool-related `buildCortexAgent` params derived from a chat session's agent
 * config — mirrors the Lab run path (`runner-service.ts` start()). When
 * `enableTools` is false the agent runs tool-less, so every tool field is omitted.
 * `mcpConfigs` is resolved by the caller (id -> config) and passed in.
 */
export function chatToolParams(
  agentConfig: Record<string, unknown>,
  enableTools: boolean,
  mcpConfigs: readonly MCPServerConfig[],
): ToolParams {
  if (!enableTools) return {};

  const dsa = agentConfig.dynamicSubAgents;
  const dsaEnabled =
    !!dsa &&
    typeof dsa === "object" &&
    !Array.isArray(dsa) &&
    (dsa as { enabled?: unknown }).enabled === true;
  const addl =
    typeof agentConfig.additionalToolNames === "string" ? agentConfig.additionalToolNames.trim() : "";

  const out: MutableToolParams = {};
  if (mcpConfigs.length > 0) out.mcpConfigs = [...mcpConfigs];
  if (Array.isArray(agentConfig.agentTools) && agentConfig.agentTools.length > 0) {
    out.agentTools = agentConfig.agentTools as NonNullable<BuildCortexAgentParams["agentTools"]>;
  }
  if (dsaEnabled) out.dynamicSubAgents = dsa as NonNullable<BuildCortexAgentParams["dynamicSubAgents"]>;
  if (addl.length > 0) out.additionalToolNames = addl;
  return out;
}
