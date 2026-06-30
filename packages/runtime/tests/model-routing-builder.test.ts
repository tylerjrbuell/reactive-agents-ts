// Run: bun test packages/runtime/tests/model-routing-builder.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe(".withModelRouting()", () => {
  it("is off by default (config.modelRouting undefined)", async () => {
    const agent = await ReactiveAgents.create().withName("r").withTestScenario([{ text: "ok" }]).build();
    expect((agent as any)._config?.modelRouting).toBeUndefined();
  });

  it("sets config.modelRouting when enabled", async () => {
    const agent = await ReactiveAgents.create()
      .withName("r").withTestScenario([{ text: "ok" }])
      .withModelRouting({ minTier: "sonnet" })
      .build();
    expect((agent as any)._config?.modelRouting?.minTier).toBe("sonnet");
  });
});
