// File: tests/context/context-profile.test.ts
import { describe, it, expect } from "bun:test";
import {
  CONTEXT_PROFILES,
  mergeProfile,
} from "../../src/context/context-profile.js";
import { resolveProfile } from "../../src/context/profile-resolver.js";

describe("CONTEXT_PROFILES", () => {
  it("has all four tiers", () => {
    expect(CONTEXT_PROFILES.local).toBeDefined();
    expect(CONTEXT_PROFILES.mid).toBeDefined();
    expect(CONTEXT_PROFILES.large).toBeDefined();
    expect(CONTEXT_PROFILES.frontier).toBeDefined();
  });

  it("local tier has strictest limits", () => {
    const local = CONTEXT_PROFILES.local;
    expect(local.compactAfterSteps).toBeLessThan(CONTEXT_PROFILES.mid.compactAfterSteps);
    expect(local.toolResultMaxChars).toBeLessThan(CONTEXT_PROFILES.mid.toolResultMaxChars);
    expect(local.rulesComplexity).toBe("simplified");
  });

  it("frontier tier has most generous limits", () => {
    const f = CONTEXT_PROFILES.frontier;
    expect(f.compactAfterSteps).toBeGreaterThan(CONTEXT_PROFILES.large.compactAfterSteps);
    expect(f.toolResultMaxChars).toBeGreaterThan(CONTEXT_PROFILES.large.toolResultMaxChars);
    expect(f.rulesComplexity).toBe("detailed");
  });
});

describe("mergeProfile", () => {
  it("overrides specific fields", () => {
    const base = CONTEXT_PROFILES.mid;
    const merged = mergeProfile(base, { compactAfterSteps: 10 });
    expect(merged.compactAfterSteps).toBe(10);
    expect(merged.tier).toBe("mid");
    expect(merged.fullDetailSteps).toBe(base.fullDetailSteps);
  });

  it("can override tier", () => {
    const merged = mergeProfile(CONTEXT_PROFILES.mid, { tier: "local" });
    expect(merged.tier).toBe("local");
  });
});

describe("resolveProfile", () => {
  it("resolves tier from explicit tier string", () => {
    expect(resolveProfile("local").tier).toBe("local");
    expect(resolveProfile("mid").tier).toBe("mid");
    expect(resolveProfile("large").tier).toBe("large");
    expect(resolveProfile("frontier").tier).toBe("frontier");
  });

  it("resolves tier from quality score", () => {
    expect(resolveProfile(0.3).tier).toBe("local");
    expect(resolveProfile(0.55).tier).toBe("local");
    expect(resolveProfile(0.6).tier).toBe("mid");
    expect(resolveProfile(0.75).tier).toBe("large");
    expect(resolveProfile(0.9).tier).toBe("frontier");
    expect(resolveProfile(1.0).tier).toBe("frontier");
  });

  it("resolves local tier from truly small model patterns", () => {
    expect(resolveProfile("tinyllama").tier).toBe("local");
    expect(resolveProfile("phi-2").tier).toBe("local");
    expect(resolveProfile("gemma-2b").tier).toBe("local");
    expect(resolveProfile("stablelm").tier).toBe("local");
  });

  it("resolves mid tier from capable local models (>=7B)", () => {
    expect(resolveProfile("ollama:qwen3:14b").tier).toBe("mid");
    expect(resolveProfile("llama-3.3-70b").tier).toBe("mid");
    expect(resolveProfile("mistral-7b").tier).toBe("mid");
    expect(resolveProfile("phi-3-mini").tier).toBe("mid");
    expect(resolveProfile("deepseek-coder").tier).toBe("mid");
    expect(resolveProfile("cogito:14b").tier).toBe("mid");
  });

  it("resolves local tier for very small capable-pattern models (<=3B)", () => {
    expect(resolveProfile("llama-3b").tier).toBe("local");
    expect(resolveProfile("qwen-2b").tier).toBe("local");
  });

  it("resolves mid tier from model name patterns", () => {
    expect(resolveProfile("claude-3-5-haiku-20241022").tier).toBe("mid");
    expect(resolveProfile("gpt-4o-mini").tier).toBe("mid");
    expect(resolveProfile("gemini-2.0-flash").tier).toBe("mid");
  });

  it("resolves large tier from model name patterns", () => {
    expect(resolveProfile("claude-sonnet-4-20250514").tier).toBe("large");
    expect(resolveProfile("gpt-4o").tier).toBe("large");
  });

  it("resolves frontier tier from model name patterns", () => {
    expect(resolveProfile("claude-opus-4-20250514").tier).toBe("frontier");
  });

  it("defaults to mid for unknown models", () => {
    expect(resolveProfile("some-unknown-model").tier).toBe("mid");
  });

  it("applies custom overrides on top of resolved profile", () => {
    const profile = resolveProfile("local", { toolResultMaxChars: 600 });
    expect(profile.tier).toBe("local");
    expect(profile.toolResultMaxChars).toBe(600);
    expect(profile.compactAfterSteps).toBe(5);
  });
});
