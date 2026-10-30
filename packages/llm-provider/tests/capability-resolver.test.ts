// Run: bun test packages/llm-provider/tests/capability-resolver.test.ts --timeout 15000
//
// Phase 1 Sprint 1 S1.3 — Capability resolver.
// Three-tier lookup: probed cache → static table → fallback.

import { describe, it, expect, mock, afterEach, beforeEach } from "bun:test";
import {
  registerReportedModelMetadata,
  _resetReportedMetadataForTesting,
} from "../src/capability-reported.js";
import {
  resolveCapability,
  registerProbedCapability,
  _resetProbedRegistryForTesting,
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

// ─── Tier 1: process-wide probed registry (write-through) ─────────────────────

describe("resolveCapability — Tier 1 (probed registry write-through)", () => {
  afterEach(() => _resetProbedRegistryForTesting());

  it("a registered probe wins over the static table for cache-less callers", () => {
    // gemma4:e4b is NOT in the static table — before this, cache-less callers got
    // the 2048 fallback. After the probe registers the real numCtx, they get it.
    const probed: Capability = { ...probedCap, model: "gemma4:e4b", recommendedNumCtx: 32_768, maxContextTokens: 131_072 };
    registerProbedCapability(probed);
    const result = resolveCapability("ollama", "gemma4:e4b");
    expect(result.source).toBe("probe");
    expect(result.recommendedNumCtx).toBe(32_768); // real probed value, not 2048 fallback
  });

  it("overrides a static-table entry too", () => {
    registerProbedCapability(probedCap); // cogito:14b, recommendedNumCtx 16_384
    const result = resolveCapability("ollama", "cogito:14b"); // static table = 8192
    expect(result.recommendedNumCtx).toBe(16_384);
    expect(result.source).toBe("probe");
  });

  it("an explicit cache still takes precedence over the registry", () => {
    registerProbedCapability(probedCap);
    const overrideCap: Capability = { ...probedCap, recommendedNumCtx: 99_999 };
    const cache = makeCache(new Map([["ollama/cogito:14b", overrideCap]]));
    const result = resolveCapability("ollama", "cogito:14b", { cache });
    expect(result.recommendedNumCtx).toBe(99_999);
  });

  it("after reset, falls back to the static/fallback tiers again", () => {
    registerProbedCapability(probedCap);
    _resetProbedRegistryForTesting();
    const result = resolveCapability("ollama", "cogito:14b");
    expect(result.source).toBe("static-table");
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

// ─── Tier 2.5: provider-reported metadata ───────────────────────────────────
//
// Model discovery writes through what a provider REPORTED for a model (context
// window, output limit, ...). That row sits BELOW probe/cache/static/user and
// ABOVE the loud fallback. No id-pattern guessing: no report, no inferred row.

describe("resolveCapability - Tier 2.5 (provider-reported metadata)", () => {
  beforeEach(() => {
    _resetProbedRegistryForTesting();
    _resetReportedMetadataForTesting();
  });
  afterEach(() => {
    _resetProbedRegistryForTesting();
    _resetReportedMetadataForTesting();
  });

  it("a static-table row still wins over reported metadata", () => {
    registerReportedModelMetadata("openai", "gpt-5.4", { maxContextTokens: 1234 });
    const result = resolveCapability("openai", "gpt-5.4");
    expect(result.source).toBe("static-table");
    expect(result.maxContextTokens).not.toBe(1234);
  });

  it("a probed row beats reported metadata", () => {
    registerReportedModelMetadata("gemini", "gemini-9-x", { maxContextTokens: 1_000_000 });
    registerProbedCapability({ ...probedCap, provider: "gemini", model: "gemini-9-x", recommendedNumCtx: 24_000 });
    const result = resolveCapability("gemini", "gemini-9-x");
    expect(result.source).toBe("probe");
    expect(result.recommendedNumCtx).toBe(24_000);
  });

  it("a reported window yields an inferred row carrying ONLY reported numbers", () => {
    registerReportedModelMetadata("gemini", "gemini-9-x", {
      maxContextTokens: 1_048_576,
      maxOutputTokens: 65_536,
      supportsThinkingMode: true,
    });
    const result = resolveCapability("gemini", "gemini-9-x");
    expect(result.source).toBe("inferred");
    expect(result.maxContextTokens).toBe(1_048_576);
    expect(result.recommendedNumCtx).toBe(1_048_576);
    expect(result.maxOutputTokens).toBe(65_536);
    expect(result.supportsThinkingMode).toBe(true);
    expect(result.supportsVision).toBe(false); // not reported -> not claimed
    expect(result.toolCallDialect).toBe("native-fc");
    expect(result.tier).toBe("mid"); // never guessed from the id
  });

  it("metadata without a context window does NOT escape the loud fallback", () => {
    registerReportedModelMetadata("anthropic", "claude-9-x", { maxOutputTokens: 64_000 });
    expect(resolveCapability("anthropic", "claude-9-x").source).toBe("fallback");
  });

  it("an id with no reported metadata falls back, whatever its name looks like", () => {
    expect(resolveCapability("openai", "gpt-5.6-sol").source).toBe("fallback");
    expect(resolveCapability("anthropic", "claude-opus-9").source).toBe("fallback");
  });

  it("providers outside the hosted native-FC set never get an inferred row", () => {
    registerReportedModelMetadata("ollama", "brand-new-local:7b", { maxContextTokens: 128_000 });
    expect(resolveCapability("ollama", "brand-new-local:7b").source).toBe("fallback");
  });

  it("does NOT invoke onProbeFailed when reported metadata resolves the model", () => {
    registerReportedModelMetadata("groq", "new-model", { maxContextTokens: 131_072 });
    const onProbeFailed = mock((_args: { provider: string; model: string }) => {});
    resolveCapability("groq", "new-model", { onProbeFailed });
    expect(onProbeFailed).not.toHaveBeenCalled();
  });
});

// ─── Chat Completions tool rules (named-model tables, applied across tiers) ───

describe("resolveCapability - chat tool rules", () => {
  it.each([
    ["openai", "gpt-6-sol", { noReasoning: true, responses: false }],
    ["openai", "gpt-6-luna", { noReasoning: true, responses: false }],
    ["openai", "gpt-6-sol-2026-08-01", { noReasoning: true, responses: false }],
    ["openai", "gpt-6-astra", { noReasoning: false, responses: true }],
    ["openai", "gpt-6.1-sol", { noReasoning: false, responses: true }],
    ["openai", "gpt-6.1-terra", { noReasoning: false, responses: true }],
    ["litellm", "openai/gpt-6-luna", { noReasoning: true, responses: false }],
    ["litellm", "openai/gpt-6.1-sol", { noReasoning: false, responses: true }],
    // near misses must NOT be flagged
    ["openai", "gpt-4o-mini", { noReasoning: false, responses: false }],
    ["openai", "gpt-5.6-sol", { noReasoning: false, responses: false }],
    ["openai", "ft:gpt-4o:acme::123", { noReasoning: false, responses: false }],
    ["openai", "gpt-6-solar", { noReasoning: false, responses: false }],
    ["anthropic", "gpt-6-sol", { noReasoning: false, responses: false }],
    ["litellm", "azure/gpt-6-sol", { noReasoning: false, responses: false }],
  ] as const)("%s %s", (provider, model, want) => {
    const cap = resolveCapability(provider, model);
    expect(cap.chatToolsRequireNoReasoning === true).toBe(want.noReasoning);
    expect(cap.chatToolsRequireResponses === true).toBe(want.responses);
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
