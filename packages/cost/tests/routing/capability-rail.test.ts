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

  // F2: tierModels override — honour per-tier model but still window-gate it.
  it("uses the tierModels override for the selected tier", () => {
    // Override haiku to a custom model string; small prompt stays at haiku tier.
    const m = selectCapableModel("anthropic", "haiku", 1000, { haiku: "my-custom-haiku-model" });
    expect(m).toBe("my-custom-haiku-model");
  });

  it("falls back to a higher tier when the override model's window is too small", () => {
    // Use ollama where windows differ; override the haiku tier with the default
    // haiku model but then request a huge prompt to force escalation to sonnet.
    // Because resolveCapability is called on the override model, and that model
    // has the same capability as the default haiku, it must escalate.
    const small = selectCapableModel("ollama", "haiku", 10, { haiku: "llama3.2:1b" });
    const huge = selectCapableModel("ollama", "haiku", 10_000_000, { haiku: "llama3.2:1b" });
    expect(huge).not.toBe(small); // window check forces escalation past the override
  });

  it("without tierModels, behaviour is unchanged (regression guard)", () => {
    // Calling with explicit undefined tierModels must behave identically to no arg.
    expect(selectCapableModel("anthropic", "haiku", 1000, undefined)).toBe(
      selectCapableModel("anthropic", "haiku", 1000),
    );
  });
});
