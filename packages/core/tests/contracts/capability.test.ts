// File: tests/contracts/capability.test.ts
import { describe, it, expect } from "bun:test";
import {
  fallbackCapability,
  effectiveWindowFromClaimedTokens,
  TIER_TOOL_RESULT_PRESERVE,
} from "../../src/contracts/capability.js";
import type {
  Capability,
  CapabilityResolver,
  CapabilitySource,
} from "../../src/contracts/capability.js";

describe("Capability — single source of model truth", () => {
  it("fallbackCapability is loud: source='fallback' + 2048 num_ctx + mid tier", () => {
    const cap = fallbackCapability("ollama", "unknown-model");
    expect(cap.source).toBe("fallback");
    expect(cap.recommendedNumCtx).toBe(2048);
    expect(cap.tier).toBe("mid");
    expect(cap.provider).toBe("ollama");
    expect(cap.model).toBe("unknown-model");
  });

  it("TIER_TOOL_RESULT_PRESERVE mirrors the legacy CONTEXT_PROFILES empirical table", () => {
    expect(TIER_TOOL_RESULT_PRESERVE.local).toBe(4000);
    expect(TIER_TOOL_RESULT_PRESERVE.mid).toBe(1200);
    expect(TIER_TOOL_RESULT_PRESERVE.large).toBe(800);
    expect(TIER_TOOL_RESULT_PRESERVE.frontier).toBe(600);
  });

  it("effectiveWindowFromClaimedTokens applies the ~65% × 4 chars/token derivation", () => {
    // Chroma Context Rot / NVIDIA RULER: ~65% of claimed window is the
    // honest effective range. 4 chars/token (English ASCII-ish proxy).
    expect(effectiveWindowFromClaimedTokens(32_768)).toBe(Math.floor(32768 * 0.65 * 4));
    expect(effectiveWindowFromClaimedTokens(200_000)).toBe(Math.floor(200000 * 0.65 * 4));
    expect(effectiveWindowFromClaimedTokens(8192)).toBe(Math.floor(8192 * 0.65 * 4));
  });

  it("CapabilitySource is a discriminated union with provenance ordering", () => {
    const sources: readonly CapabilitySource[] = ["probe", "cache", "static-table", "fallback"];
    expect(sources.length).toBe(4);
    expect(sources.includes("fallback")).toBe(true);
  });

  it("CapabilityResolver contract is satisfiable by a minimal mock", () => {
    const mock: CapabilityResolver = {
      resolve(provider, model) {
        if (provider === "ollama" && model === "qwen3.5:latest") {
          const c: Capability = {
            provider,
            model,
            effectiveWindowChars: effectiveWindowFromClaimedTokens(32_768),
            recommendedNumCtx: 32_768,
            tier: "local",
            dialect: "native-fc",
            toolResultPreserveBudget: TIER_TOOL_RESULT_PRESERVE.local,
            maxOutputTokens: 4096,
            supports: { thinking: false, streamingToolCalls: true, promptCaching: false, vision: false },
            source: "static-table",
          };
          return c;
        }
        return fallbackCapability(provider, model);
      },
    };
    const known = mock.resolve("ollama", "qwen3.5:latest");
    expect(known.source).toBe("static-table");
    expect(known.tier).toBe("local");

    const unknown = mock.resolve("ollama", "alphabet-soup");
    expect(unknown.source).toBe("fallback");
  });

  it("onFallback hook fires when resolver takes fallback path", () => {
    let warned = "";
    const mock: CapabilityResolver = {
      resolve(provider, model, opts) {
        // No cache, no probe, no static — fallback path
        opts?.onFallback?.(provider, model);
        return fallbackCapability(provider, model);
      },
    };
    mock.resolve("ollama", "unknown", { onFallback: (p, m) => { warned = `${p}/${m}`; } });
    expect(warned).toBe("ollama/unknown");
  });
});
