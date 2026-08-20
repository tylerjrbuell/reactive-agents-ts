import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { defineToolset } from "../src/toolset.js";

describe("defineToolset", () => {
  it("applies toolset defaults to every tool", () => {
    const halopedia = defineToolset("halopedia", {
      category: "research",
      riskLevel: "low",
      timeoutMs: 15_000,
    });
    const t = halopedia.tool({
      name: "get-article",
      description: "Fetch a Halopedia article",
      input: Schema.Struct({ title: Schema.String }),
      handler: async ({ title }) => ({ title }),
    });
    expect(t.definition.category).toBe("research");
    expect(t.definition.riskLevel).toBe("low");
    expect(t.definition.timeoutMs).toBe(15_000);
  });

  it("lets a per-tool option override the toolset default", () => {
    const halopedia = defineToolset("halopedia", { riskLevel: "low", timeoutMs: 15_000 });
    const t = halopedia.tool({
      name: "delete-cache",
      description: "Clears the local article cache",
      input: Schema.Struct({}),
      handler: async () => ({ cleared: true }),
      riskLevel: "medium",
    });
    expect(t.definition.riskLevel).toBe("medium");
    expect(t.definition.timeoutMs).toBe(15_000);
  });
});
