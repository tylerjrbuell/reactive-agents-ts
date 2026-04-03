import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../builder.js";

describe(".withAgentId() builder", () => {
  it("uses the supplied stable agentId instead of name-timestamp", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withAgentId("my-stable-id")
      .build();
    expect(agent.agentId).toBe("my-stable-id");
  });

  it("falls back to name-timestamp when withAgentId is not called", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withName("myagent")
      .build();
    expect(agent.agentId).toMatch(/^myagent-\d+$/);
  });

  it("two builds with same withAgentId produce the same agentId", async () => {
    const a = await ReactiveAgents.create().withProvider("test").withAgentId("shared-id").build();
    const b = await ReactiveAgents.create().withProvider("test").withAgentId("shared-id").build();
    expect(a.agentId).toBe("shared-id");
    expect(b.agentId).toBe("shared-id");
  });

  it("chains with other builder methods", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withAgentId("chain-test")
      .withReasoning()
      .withMemory();
    expect(builder).toBeDefined();
  });
});
