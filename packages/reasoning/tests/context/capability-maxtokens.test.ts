import { describe, it, expect } from "bun:test";
import { applyCapabilityMaxTokens, CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { resolveProfileWithWindow, resolveProfile } from "../../src/context/profile-resolver.js";
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

describe("resolveProfileWithWindow — builder auto-resolution binds the MODEL window", () => {
  // Regression guard for the builder/createRuntime window asymmetry: the builder
  // baked the tier PLACEHOLDER maxTokens (mid=32768), which masqueraded as a
  // caller cap and made the runner skip model resolution → mid agents ran at
  // 32768 instead of the model's real window. This helper must bind maxTokens to
  // the model's recommendedNumCtx so builder == createRuntime.
  it("a mid-tier cloud model resolves to its real window, NOT the 32768 tier placeholder", () => {
    const out = resolveProfileWithWindow("claude-haiku-4-5-20251001", "anthropic");
    const expected = resolveCapability("anthropic", "claude-haiku-4-5-20251001").recommendedNumCtx;
    expect(out.maxTokens).toBe(expected); // 200_000
    expect(out.maxTokens).not.toBe(CONTEXT_PROFILES.mid.maxTokens); // not the 32768 placeholder
  });

  it("an ollama model resolves to its recommendedNumCtx (tier detection unchanged)", () => {
    const out = resolveProfileWithWindow("cogito:14b", "ollama");
    expect(out.maxTokens).toBe(resolveCapability("ollama", "cogito:14b").recommendedNumCtx);
    // tier is still whatever resolveProfile picks — the window bind doesn't alter it.
    expect(out.tier).toBe(resolveProfile("cogito:14b", undefined, "ollama").tier);
  });

  it("preserves the intentional ollama-safe fallback for unknown models (2048)", () => {
    const out = resolveProfileWithWindow("private-model:custom", "ollama");
    expect(out.maxTokens).toBe(2048);
  });
});
