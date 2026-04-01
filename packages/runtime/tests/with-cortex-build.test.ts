import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("withCortex + build", () => {
  it("builds with test provider and withCortex URL", async () => {
    const agent = await ReactiveAgents.create()
      .withName("cortex-build-smoke")
      .withProvider("test")
      .withCortex("http://127.0.0.1:4321")
      .build();
    expect(agent.agentId).toContain("cortex-build-smoke");
  });

  it("run() succeeds with test provider when withCortex is enabled", async () => {
    const agent = await ReactiveAgents.create()
      .withName("cortex-run-smoke")
      .withProvider("test")
      .withCortex("http://127.0.0.1:4321")
      .build();

    const result = await agent.run("hello");
    expect(result.success).toBe(true);
  });
});
