// File: tests/canonical-resolver.test.ts
import { describe, it, expect } from "bun:test";
import { resolveCanonical } from "../src/canonical-resolver.js";
import { effectiveWindowFromClaimedTokens, TIER_TOOL_RESULT_PRESERVE } from "@reactive-agents/core";

describe("resolveCanonical — single source-tagged Capability resolver", () => {
  it("returns static-table source for qwen3.5:latest with 32K window", () => {
    const cap = resolveCanonical("ollama", "qwen3.5:latest");
    expect(cap.source).toBe("static-table");
    expect(cap.recommendedNumCtx).toBe(32_768);
    expect(cap.effectiveWindowChars).toBe(effectiveWindowFromClaimedTokens(32_768));
    expect(cap.tier).toBe("local");
    expect(cap.toolResultPreserveBudget).toBe(TIER_TOOL_RESULT_PRESERVE.local);
    expect(cap.dialect).toBe("native-fc");
  });

  it("returns static-table source for claude-haiku-4-5 with 200K window (alias coverage)", () => {
    // The 2026-06-02 Sprint-1 fix added the suffix-less alias. The canonical
    // resolver inherits that fix — no separate handling required.
    const cap = resolveCanonical("anthropic", "claude-haiku-4-5");
    expect(cap.source).toBe("static-table");
    expect(cap.recommendedNumCtx).toBe(200_000);
    expect(cap.tier).toBe("mid");
    expect(cap.toolResultPreserveBudget).toBe(TIER_TOOL_RESULT_PRESERVE.mid);
  });

  it("returns fallback source loudly for unknown model + onFallback fires", () => {
    let warnedAt = "";
    const cap = resolveCanonical("ollama", "unknown-xyz", {
      onFallback: (p, m) => { warnedAt = `${p}/${m}`; },
    });
    expect(cap.source).toBe("fallback");
    expect(cap.recommendedNumCtx).toBe(2048);
    expect(warnedAt).toBe("ollama/unknown-xyz");
  });

  it("translates the four boolean support fields into the canonical sub-struct", () => {
    const cap = resolveCanonical("anthropic", "claude-sonnet-4-6");
    expect(cap.supports.thinking).toBe(true); // sonnet exposes thinking mode
    expect(cap.supports.streamingToolCalls).toBe(true);
    expect(cap.supports.promptCaching).toBe(true);
    expect(cap.supports.vision).toBe(true);
  });

  it("effectiveWindowChars derives from claimed window via the ~65% × 4 chars/token rule", () => {
    const cap = resolveCanonical("anthropic", "claude-haiku-4-5");
    // 200K claimed → ~520K chars effective (65% × 4 chars/token).
    expect(cap.effectiveWindowChars).toBe(Math.floor(200_000 * 0.65 * 4));
  });

  // W3b item 5 (plan 3.3): the GH #239 nominal marker (llm-provider
  // CapabilitySchema.nominal, 265ec7001) must survive the canonical round
  // trip. Dropped, a nominal stub row re-enters tier arbitration as registry
  // truth — the exact second-arbiter class design law #1 forbids.
  it("nominal survives toCanonical (static-table stub row → canonical shape)", () => {
    const cap = resolveCanonical("test", "test");
    expect(cap.tier).toBe("local");
    expect(cap.nominal).toBe(true);
  });

  it("nominal survives the CapabilityCache round trip (adaptCache load path)", () => {
    const stub = resolveCanonical("test", "test");
    // Seed a model with NO static-table row so only the cache tier can serve
    // it — otherwise a static-table hit would make the assertion vacuous.
    const cached = { ...stub, provider: "ollama", model: "nominal-roundtrip-x", source: "cache" as const };
    const rows = new Map<string, typeof stub>();
    rows.set("ollama/nominal-roundtrip-x", cached);
    const cache = {
      get: (provider: string, model: string) => rows.get(`${provider}/${model}`),
      put: (cap: typeof stub) => {
        rows.set(`${cap.provider}/${cap.model}`, cap);
      },
    };
    // Resolver tier-1 reads through adaptCache's loadCapability (canonical →
    // provider shape). The marker must ride; a "cache" source maps to "probe"
    // (existing adapter semantics).
    const cap = resolveCanonical("ollama", "nominal-roundtrip-x", { cache });
    expect(cap.source).toBe("probe");
    expect(cap.nominal).toBe(true);
  });

  it("real-model rows carry no nominal marker (undefined, not false-defaulted)", () => {
    const cap = resolveCanonical("ollama", "qwen3.5:latest");
    expect(cap.nominal).toBeUndefined();
  });
});
