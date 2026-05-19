import { describe, it, expect } from "bun:test";
import { buildStaticContext } from "../src/context/context-engine.js";

describe("buildStaticContext — env context always injected", () => {
  const baseInput = {
    task: "What is 2+2?",
    profile: { tier: "frontier" as const },
  };

  it("includes Date: line regardless of RA_LAZY_TOOLS", () => {
    delete process.env.RA_LAZY_TOOLS;
    const ctx = buildStaticContext(baseInput);
    expect(ctx).toContain("Date:");
  });

  it("includes Time: line regardless of RA_LAZY_TOOLS", () => {
    delete process.env.RA_LAZY_TOOLS;
    const ctx = buildStaticContext(baseInput);
    expect(ctx).toContain("Time:");
  });

  it("includes Timezone: line", () => {
    delete process.env.RA_LAZY_TOOLS;
    const ctx = buildStaticContext(baseInput);
    expect(ctx).toContain("Timezone:");
  });

  it("merges custom environment context keys", () => {
    delete process.env.RA_LAZY_TOOLS;
    const ctx = buildStaticContext({
      ...baseInput,
      environmentContext: { Agent: "cortex-desk", RunId: "abc123" },
    });
    expect(ctx).toContain("Agent: cortex-desk");
    expect(ctx).toContain("RunId: abc123");
  });
});
