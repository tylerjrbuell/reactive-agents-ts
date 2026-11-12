// Run: bun run repo test apps/cortex/server/tests/channel-tool-surface.test.ts
//
// A non-owner sender's agent is built smaller than the owner's: read-only built-ins only, no MCP, no
// meta-tools, no memory layer. The BUILT config is checked, so a build that still carries a surface the
// route did not allow fails closed. Uses the real gateway agent shape with memory enabled.
import { describe, expect, it } from "bun:test";
import { cortexAgentBuilder } from "../services/build-cortex-agent.js";
import { narrowCortexParams, surfaceViolations } from "../services/channel-tool-surface.js";
import { normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";

const params = (extra: Record<string, unknown> = {}) => {
  const config = normalizeCortexAgentConfig({
    provider: "test",
    model: "test-model",
    tools: ["file-read", "file-write", "web-search"],
    memory: { working: true, episodic: true },
    ...extra,
  });
  const { gateway: _gateway, ...rest } = gatewayConfigToBuildParams({ agentId: "gw-1", name: "Bot", config, mcpConfigs: [] });
  return rest;
};

describe("sender surface", () => {
  it("ReadOnly builds without the memory layer and keeps only read-only built-ins", async () => {
    const exposure = { _tag: "ReadOnly" } as const;
    const config = (await cortexAgentBuilder(narrowCortexParams(params(), exposure))).toConfig();
    expect(surfaceViolations(config, exposure)).toEqual([]);
    expect(config.memory).toBeUndefined();
    expect(config.tools?.allowedTools).toContain("file-read");
    expect(config.tools?.allowedTools).toContain("web-search");
    expect(config.tools?.allowedTools).not.toContain("file-write");
  });

  it("the owner build keeps memory and the write tool", async () => {
    const exposure = { _tag: "AgentDefault" } as const;
    const config = (await cortexAgentBuilder(narrowCortexParams(params(), exposure))).toConfig();
    expect(config.memory).toBeDefined();
    expect(config.tools?.allowedTools).toContain("file-write");
  });

  it("a rawConfig override cannot re-open a removed surface", async () => {
    const exposure = { _tag: "ReadOnly" } as const;
    const p = params({ rawConfig: { memory: { tier: "enhanced" }, tools: { allowedTools: ["file-write"] } } });
    const config = (await cortexAgentBuilder(narrowCortexParams(p, exposure))).toConfig();
    expect(surfaceViolations(config, exposure)).toEqual([]);
    expect(config.tools?.allowedTools).not.toContain("file-write");
  });

  it("the guard names a surface the build still carries", async () => {
    const owner = (await cortexAgentBuilder(params())).toConfig();
    const found = surfaceViolations(owner, { _tag: "ReadOnly" });
    expect(found).toContain("tool file-write");
    expect(found).toContain("memory");
  });

  it("Allowlist keeps only the named tools the agent already had", () => {
    const narrowed = narrowCortexParams(params(), { _tag: "Allowlist", tools: ["file-write", "code-execute"] });
    expect(narrowed.tools).toEqual(["file-write"]);
  });
});
