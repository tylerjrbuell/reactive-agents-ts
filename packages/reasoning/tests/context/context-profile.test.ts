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

  it("large tier is tuned for efficiency (tighter than raw capability)", () => {
    const l = CONTEXT_PROFILES.large;
    expect(l.temperature).toBe(0.5);
    expect(l.maxIterations).toBe(10);
    expect(l.compactAfterSteps).toBe(6);
  });

  it("frontier tier is tuned for efficiency (tighter than default)", () => {
    const f = CONTEXT_PROFILES.frontier;
    expect(f.temperature).toBe(0.6);
    expect(f.maxIterations).toBe(12);
  });

  it("temperature increases monotonically from local to frontier", () => {
    const temps = [
      CONTEXT_PROFILES.local.temperature!,
      CONTEXT_PROFILES.mid.temperature!,
      CONTEXT_PROFILES.large.temperature!,
      CONTEXT_PROFILES.frontier.temperature!,
    ];
    for (let i = 1; i < temps.length; i++) {
      expect(temps[i]).toBeGreaterThanOrEqual(temps[i - 1]);
    }
  });

  it("maxIterations increases monotonically from local to frontier", () => {
    const iters = [
      CONTEXT_PROFILES.local.maxIterations!,
      CONTEXT_PROFILES.mid.maxIterations!,
      CONTEXT_PROFILES.large.maxIterations!,
      CONTEXT_PROFILES.frontier.maxIterations!,
    ];
    for (let i = 1; i < iters.length; i++) {
      expect(iters[i]).toBeGreaterThanOrEqual(iters[i - 1]);
    }
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

describe("resolveProfile — provider-scoped tier resolution", () => {
  it("gemini: routes gemini-2.5-flash to large (not mid via global 'flash' pattern)", () => {
    expect(resolveProfile("gemini-2.5-flash", undefined, "gemini").tier).toBe("large");
    expect(resolveProfile("gemini-2.5-flash-preview", undefined, "gemini").tier).toBe("large");
    expect(resolveProfile("gemini-2.5-flash-lite", undefined, "gemini").tier).toBe("large");
  });

  it("gemini: routes gemini-2.5-pro to frontier", () => {
    expect(resolveProfile("gemini-2.5-pro", undefined, "gemini").tier).toBe("frontier");
    expect(resolveProfile("gemini-2.5-pro-preview", undefined, "gemini").tier).toBe("frontier");
  });

  it("gemini: routes gemini-2.0-flash to mid", () => {
    expect(resolveProfile("gemini-2.0-flash", undefined, "gemini").tier).toBe("mid");
    expect(resolveProfile("gemini-2.0-flash-lite", undefined, "gemini").tier).toBe("mid");
  });

  it("gemini: routes gemini-1.5-pro to large and 1.5-flash to mid", () => {
    expect(resolveProfile("gemini-1.5-pro", undefined, "gemini").tier).toBe("large");
    expect(resolveProfile("gemini-1.5-flash", undefined, "gemini").tier).toBe("mid");
  });

  it("anthropic: correctly routes sonnet and haiku with provider", () => {
    expect(resolveProfile("claude-sonnet-4-20250514", undefined, "anthropic").tier).toBe("large");
    expect(resolveProfile("claude-3-5-haiku-20241022", undefined, "anthropic").tier).toBe("mid");
    expect(resolveProfile("claude-opus-4-20250514", undefined, "anthropic").tier).toBe("frontier");
  });

  it("openai: routes gpt-4o-mini to mid (not large via 'gpt-4o' substring)", () => {
    expect(resolveProfile("gpt-4o-mini", undefined, "openai").tier).toBe("mid");
    expect(resolveProfile("gpt-4o", undefined, "openai").tier).toBe("large");
    expect(resolveProfile("gpt-4o-audio-preview", undefined, "openai").tier).toBe("large");
  });

  it("openai: routes o1 and o3 to frontier", () => {
    expect(resolveProfile("o1", undefined, "openai").tier).toBe("frontier");
    expect(resolveProfile("o3-mini", undefined, "openai").tier).toBe("frontier");
    expect(resolveProfile("o4-mini", undefined, "openai").tier).toBe("frontier");
  });

  it("ollama: always routes to mid regardless of substrings like 'flash' or 'mini'", () => {
    expect(resolveProfile("cogito:14b", undefined, "ollama").tier).toBe("mid");
    expect(resolveProfile("gemma4:e4b", undefined, "ollama").tier).toBe("mid");
    expect(resolveProfile("llama-flash-mini", undefined, "ollama").tier).toBe("mid");
  });

  it("ollama: routes small models (<=3B) to local", () => {
    expect(resolveProfile("tinyllama:1b", undefined, "ollama").tier).toBe("local");
    expect(resolveProfile("qwen:2b", undefined, "ollama").tier).toBe("local");
    expect(resolveProfile("qwen:3b", undefined, "ollama").tier).toBe("local");
  });

  it("unknown provider falls through to global patterns unchanged", () => {
    expect(resolveProfile("gemini-2.0-flash", undefined, "litellm").tier).toBe("mid");
    expect(resolveProfile("claude-opus-4-20250514", undefined, "litellm").tier).toBe("frontier");
  });

  it("no-provider path still works (backward compatibility)", () => {
    expect(resolveProfile("gpt-4o-mini").tier).toBe("mid");
    expect(resolveProfile("claude-sonnet-4-20250514").tier).toBe("large");
    expect(resolveProfile("gemini-2.0-flash").tier).toBe("mid");
  });
});
