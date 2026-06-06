// apps/advocate/tests/agent-base.test.ts
// Run: bun test apps/advocate/tests/agent-base.test.ts --timeout 20000
import { describe, it, expect } from "bun:test";
import { createMetaAgentBase } from "../src/agent-base.js";

describe("createMetaAgentBase", () => {
  it("builds a valid agent with the full advanced baseline (test provider)", async () => {
    const agent = await createMetaAgentBase({
      name: "test-meta-agent",
      provider: "test",
      model: "test-model",
    })
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .build();

    expect(agent.agentId).toContain("test-meta-agent");
    await agent.dispose?.();
  });

  it("accepts same-provider fallback models without throwing", async () => {
    const agent = await createMetaAgentBase({
      name: "fb-agent",
      provider: "test",
      model: "test-model",
      fallbackModels: ["alt-1", "alt-2"],
      maxTokensPerRun: 50_000,
    })
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .build();

    expect(agent).toBeDefined();
    await agent.dispose?.();
  });
});
