// Run: bun test packages/runtime/tests/spawn-agents.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("spawn-agents — registration", () => {
  it("withDynamicSubAgents() registers spawn-agents tool (agent builds)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("parallel-dispatch-test")
      .withProvider("test")
      .withDynamicSubAgents({ maxIterations: 3 })
      .withTestScenario([{ text: "Done." }])
      .build();

    expect(agent).toBeDefined();
    expect(agent.agentId).toContain("parallel-dispatch-test");
    await agent.dispose();
  }, 15000);

  it("withDynamicSubAgents() without spawn-agents still registers (no regression)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("single-spawn-regression")
      .withProvider("test")
      .withDynamicSubAgents()
      .withTestScenario([{ text: "Done." }])
      .build();

    expect(agent).toBeDefined();
    await agent.dispose();
  }, 15000);

  it("spawn-agents tool has correct name via createSpawnAgentsTool()", async () => {
    const { createSpawnAgentsTool } = await import("@reactive-agents/tools");
    expect(createSpawnAgentsTool().name).toBe("spawn-agents");
  }, 15000);
});

describe("spawn-agents — failFast flag defaults", () => {
  it("spawn-agents tool has failFast parameter defaulting to false", async () => {
    const { createSpawnAgentsTool } = await import("@reactive-agents/tools");
    const tool = createSpawnAgentsTool();
    const param = tool.parameters.find((p) => p.name === "failFast");
    expect(param?.default).toBe(false);
  }, 15000);

  it("spawn-agents tool tasks parameter is required array", async () => {
    const { createSpawnAgentsTool } = await import("@reactive-agents/tools");
    const tool = createSpawnAgentsTool();
    const param = tool.parameters.find((p) => p.name === "tasks");
    expect(param?.required).toBe(true);
    expect(param?.type).toBe("array");
  }, 15000);
});
