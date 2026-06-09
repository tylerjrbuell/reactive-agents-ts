import { describe, it, expect } from "bun:test";
import { chatToolParams } from "./chat-tool-params.js";
import type { MCPServerConfig } from "./build-cortex-agent.js";
import type { CortexAgentToolEntry } from "./cortex-agent-config.js";

const mcp: MCPServerConfig[] = [{ name: "context7" } as MCPServerConfig];
// Partial fixture (same pattern as the `as MCPServerConfig` cast above): the
// mapper forwards agentTools verbatim, so the literal shape is irrelevant here.
const agentTool = { id: "x" } as unknown as CortexAgentToolEntry;

describe("chatToolParams", () => {
  it("omits all tool fields when tools are off", () => {
    const out = chatToolParams(
      { agentTools: [agentTool], dynamicSubAgents: { enabled: true }, additionalToolNames: "y" },
      false,
      mcp,
    );
    expect(out).toEqual({});
  });

  it("forwards mcpConfigs, agentTools, dynamicSubAgents, additionalToolNames when on", () => {
    const out = chatToolParams(
      {
        agentTools: [agentTool],
        dynamicSubAgents: { enabled: true, maxIterations: 3 },
        additionalToolNames: "  my-tool  ",
      },
      true,
      mcp,
    );
    expect(out.mcpConfigs).toEqual(mcp);
    expect(out.agentTools).toEqual([agentTool]);
    expect(out.dynamicSubAgents).toEqual({ enabled: true, maxIterations: 3 });
    expect(out.additionalToolNames).toBe("my-tool");
  });

  it("omits empty/blank optional fields when on", () => {
    const out = chatToolParams({ additionalToolNames: "   " }, true, []);
    expect("additionalToolNames" in out).toBe(false);
    expect("agentTools" in out).toBe(false);
    expect("dynamicSubAgents" in out).toBe(false);
    expect("mcpConfigs" in out).toBe(false);
  });
});
