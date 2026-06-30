// Run: bun test packages/cost/tests/routing/capability-rail.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { selectCapableModel } from "../../src/routing/capability-rail.js";

describe("selectCapableModel", () => {
  it("keeps the cheap tier when its window covers the prompt", () => {
    // anthropic haiku has a large window; a tiny prompt stays on haiku.
    expect(selectCapableModel("anthropic", "haiku", 1000)).toBe("claude-haiku-4-5-20251001");
  });

  it("never returns below the start tier", () => {
    const m = selectCapableModel("anthropic", "sonnet", 1000);
    expect(m).toBe("claude-sonnet-4-6");
  });

  it("escalates when the prompt exceeds the cheap model's window (ollama)", () => {
    // ollama tiers have differing windows; a huge prompt must escalate past the smallest.
    const small = selectCapableModel("ollama", "haiku", 10);
    const huge = selectCapableModel("ollama", "haiku", 10_000_000);
    expect(huge).not.toBe(small); // escalated to a larger-window tier
  });
});
