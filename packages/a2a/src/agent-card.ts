/**
 * AgentCard generator — pure functions to produce A2A-compliant Agent Cards.
 */
import type { AgentCard, AgentSkill, AgentCapabilities } from "./types.js";

export interface AgentCardGeneratorConfig {
  name: string;
  description?: string;
  version?: string;
  url: string;
  organization?: string;
  organizationUrl?: string;
  capabilities?: Partial<AgentCapabilities>;
  skills?: AgentSkill[];
}

export const generateAgentCard = (config: AgentCardGeneratorConfig): AgentCard => {
  return {
    name: config.name,
    description: config.description,
    version: config.version ?? "0.1.0",
    protocolVersion: "0.3.0",
    url: config.url,
    provider: {
      organization: config.organization ?? "Reactive Agents",
      url: config.organizationUrl,
    },
    capabilities: {
      streaming: config.capabilities?.streaming ?? true,
      pushNotifications: config.capabilities?.pushNotifications ?? false,
      ...config.capabilities,
    },
    skills: config.skills ?? [],
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
  };
};

/** Generate skills array from ToolDefinition-like objects. */
export const toolsToSkills = (
  tools: ReadonlyArray<{ name: string; description: string; parameters?: ReadonlyArray<{ name: string }> }>,
): AgentSkill[] =>
  tools.map((t) => ({
    id: t.name,
    name: t.name,
    description: t.description,
    tags: [],
  }));
