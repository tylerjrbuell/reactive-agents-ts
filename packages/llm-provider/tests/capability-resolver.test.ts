// Run: bun test packages/llm-provider/tests/capability-resolver.test.ts --timeout 15000
//
// Phase 1 Sprint 1 S1.3 — Capability resolver.
// Three-tier lookup: probed cache → static table → fallback.

import { describe, it, expect, mock } from "bun:test";
import {
  resolveCapability,
  type CapabilityCache,
} from "../src/capability-resolver.js";
import {
  STATIC_CAPABILITIES,
  fallbackCapability,
  type Capability,
} from "../src/capability.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeCache(initial: Map<string, Capability> = new Map()): CapabilityCache {
  const m = new Map(initial);
  return {
    loadCapability: mock((provider: string, model: string) =>
      m.get(`${provider}/${model}`) ?? null,
    ) as CapabilityCache["loadCapability"],
    saveCapability: mock((cap: Capability) => {
      m.set(`${cap.provider}/${cap.model}`, cap);
    }) as CapabilityCache["saveCapability"],
  };
}

const probedCap: Capability = {
  provider: "ollama",
  model: "cogito:14b",
  tier: "local",
  maxContextTokens: 32_768,
  recommendedNumCtx: 16_384, // distinct from static table's 8192
  maxOutputTokens: 4096,
  tokenizerFamily: "llama",
  supportsPromptCaching: false,
  supportsVision: false,
  supportsThinkingMode: false,
  supportsStreamingToolCalls: true,
  toolCallDialect: "native-fc",
  source: "probe",
};

// ─── Tier 1: cached probe wins ────────────────────────────────────────────────

describe("resolveCapability — Tier 1 (cached probe)", () => {
  it("returns the cached probe value when present, even when static table has an entry", () => {
    const cache = makeCache(new Map([["ollama/cogito:14b", probedCap]]));
    const result = resolveCapability("ollama", "cogito:14b", { cache });
    expect(result).toEqual(probedCap);
    expect(result.source).toBe("probe");
    expect(result.recommendedNumCtx).toBe(16_384); // probe's value, not static's 8192
  });

  it("calls cache.loadCapability with the right (provider, model) key", () => {
    const cache = makeCache();
    resolveCapability("anthropic", "claude-haiku-4-5-20251001", { cache });
    expect(cache.loadCapability).toHaveBeenCalledWith(
      "anthropic",
      "claude-haiku-4-5-20251001",
    );
  });
});

// ─── Tier 2: static table when no cache entry ─────────────────────────────────

describe("resolveCapability — Tier 2 (static table)", () => {
  it("returns the static table entry when no cache entry exists", () => {
    const cache = makeCache();
    const result = resolveCapability("ollama", "cogito:14b", { cache });
    expect(result).toEqual(STATIC_CAPABILITIES["ollama/cogito:14b"]!);
    expect(result.source).toBe("static-table");
  });

  it("returns the static table entry when no cache is provided at all", () => {
    const result = resolveCapability("anthropic", "claude-opus-4-7");
    expect(result).toEqual(STATIC_CAPABILITIES["anthropic/claude-opus-4-7"]!);
    expect(result.source).toBe("static-table");
  });
});

// ─── Tier 3: fallback when nothing matches ────────────────────────────────────

describe("resolveCapability — Tier 3 (fallback)", () => {
  it("returns conservative fallback for an unknown (provider, model) pair", () => {
    const result = resolveCapability("custom-provider", "private-model:v1");
    expect(result.source).toBe("fallback");
    expect(result.provider).toBe("custom-provider");
    expect(result.model).toBe("private-model:v1");
    expect(result.recommendedNumCtx).toBe(2048); // matches Ollama's silent default
    expect(result.tier).toBe("local");
  });

  it("emits onProbeFailed callback on fallback path with the right details", () => {
    const onProbeFailed = mock((_args: { provider: string; model: string }) => {});
    const result = resolveCapability("unknown", "missing:v1", { onProbeFailed });
    expect(result.source).toBe("fallback");
    expect(onProbeFailed).toHaveBeenCalledTimes(1);
    expect(onProbeFailed).toHaveBeenCalledWith({
      provider: "unknown",
      model: "missing:v1",
    });
  });

  it("does NOT invoke onProbeFailed on the cached or static path", () => {
    const onProbeFailed = mock((_args: { provider: string; model: string }) => {});
    resolveCapability("ollama", "cogito:14b", { onProbeFailed }); // static-table hit
    expect(onProbeFailed).not.toHaveBeenCalled();
  });
});

// ─── Cache write-through (resolver does NOT cache static/fallback) ────────────

describe("resolveCapability — cache write-through discipline", () => {
  it("does NOT save static-table entries to the cache (cache holds probes only)", () => {
    const cache = makeCache();
    resolveCapability("ollama", "cogito:14b", { cache });
    expect(cache.saveCapability).not.toHaveBeenCalled();
  });

  it("does NOT save fallback entries to the cache", () => {
    const cache = makeCache();
    resolveCapability("unknown", "x", { cache });
    expect(cache.saveCapability).not.toHaveBeenCalled();
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("resolveCapability — edge cases", () => {
  it("invalid cache entry (wrong provider/model fields) is ignored gracefully", () => {
    // Hypothetical: cache returns a Capability whose provider/model don't
    // match the requested key (corrupted store, version drift, etc.).
    // The resolver trusts the lookup-by-key contract; the value's own
    // provider/model fields are returned as-is. This test pins that
    // behavior so we don't accidentally add expensive validation.
    const wrongCap: Capability = { ...probedCap, provider: "wrong", model: "also-wrong" };
    const cache = makeCache(new Map([["ollama/cogito:14b", wrongCap]]));
    const result = resolveCapability("ollama", "cogito:14b", { cache });
    // Returned by reference; resolver doesn't second-guess what the cache returned
    expect(result).toEqual(wrongCap);
  });

  it("the fallback path returns a fresh object per call (no shared mutation)", () => {
    const a = resolveCapability("u", "m");
    const b = resolveCapability("u", "m");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
