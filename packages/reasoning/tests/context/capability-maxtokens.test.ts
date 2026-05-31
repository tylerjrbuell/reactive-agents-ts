import { describe, it, expect } from "bun:test";
import { applyCapabilityMaxTokens, CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { resolveCapability } from "@reactive-agents/llm-provider";

describe("applyCapabilityMaxTokens — S1.4 capability wiring", () => {
  it("sets local-tier maxTokens to cogito:14b recommendedNumCtx when caller did not set it", () => {
    // Assert the WIRING (maxTokens tracks the resolved capability's
    // recommendedNumCtx), not a magic literal — the num_ctx value is a tuning
    // knob (8192 → 32768 → operator-set) and a hardcoded expectation goes stale
    // on every retune. The contract under test is "profile.maxTokens follows
    // the model's recommendedNumCtx".
    const expected = resolveCapability("ollama", "cogito:14b").recommendedNumCtx;
    const out = applyCapabilityMaxTokens(CONTEXT_PROFILES.local, "ollama", "cogito:14b", undefined);
    expect(out.maxTokens).toBe(expected);
  });

  it("caller-supplied contextProfile.maxTokens always wins over capability", () => {
    const base = { ...CONTEXT_PROFILES.local, maxTokens: 16000 };
    const out = applyCapabilityMaxTokens(base, "ollama", "cogito:14b", 16000);
    expect(out.maxTokens).toBe(16000);
  });

  it("unknown ollama model falls back to capability fallback (2048)", () => {
    const out = applyCapabilityMaxTokens(CONTEXT_PROFILES.local, "ollama", "private-model:custom", undefined);
    expect(out.maxTokens).toBe(2048);
  });

  it("cloud model gets its large capability window (anthropic claude-sonnet-4-6 → 200000)", () => {
    const out = applyCapabilityMaxTokens(CONTEXT_PROFILES.frontier, "anthropic", "claude-sonnet-4-6", undefined);
    expect(out.maxTokens).toBe(200_000);
  });

  it("returns profile unchanged when provider or model is missing", () => {
    const out = applyCapabilityMaxTokens(CONTEXT_PROFILES.mid, undefined, undefined, undefined);
    expect(out.maxTokens).toBe(CONTEXT_PROFILES.mid.maxTokens);
  });
});
