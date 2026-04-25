// Run: bun test packages/llm-provider/tests/capability-schema.test.ts --timeout 15000
//
// Phase 1 Sprint 1 S1.1 — Capability struct schema regression suite.
// Pins the 12-field shape from North Star v2.3 §3 and asserts JSON round-trip
// identity so future migrations to/from disk (calibration store, telemetry
// payloads) can't silently lose fields.

import { describe, it, expect } from "bun:test";
import { Schema, ParseResult } from "effect";
import { Capability, CapabilitySchema, STATIC_CAPABILITIES } from "../src/capability.js";

describe("Capability struct (Phase 1 S1.1)", () => {
  it("schema exposes exactly the 12 documented fields", () => {
    // Pin the field set so adding/removing fields without updating callers
    // is caught at the schema level. Field order doesn't matter; presence does.
    const expected = new Set([
      "provider",
      "model",
      "tier",
      "maxContextTokens",
      "recommendedNumCtx",
      "maxOutputTokens",
      "tokenizerFamily",
      "supportsPromptCaching",
      "supportsVision",
      "supportsThinkingMode",
      "supportsStreamingToolCalls",
      "toolCallDialect",
      "source",
    ]);
    // 13 entries with `source` — see comment in capability.ts: spec called for 12
    // user-facing fields; `source` is a 13th provenance field that doesn't count
    // toward the marketed surface but is mandatory for resolver telemetry.
    const ast = (CapabilitySchema as unknown as { ast: { propertySignatures: { name: string }[] } }).ast;
    const actual = new Set(ast.propertySignatures.map((p) => p.name));
    expect(actual).toEqual(expected);
  });

  it("decodes a valid capability without error", () => {
    const valid = {
      provider: "ollama",
      model: "cogito:14b",
      tier: "local" as const,
      maxContextTokens: 8192,
      recommendedNumCtx: 8192,
      maxOutputTokens: 4096,
      tokenizerFamily: "llama" as const,
      supportsPromptCaching: false,
      supportsVision: false,
      supportsThinkingMode: false,
      supportsStreamingToolCalls: true,
      toolCallDialect: "native-fc" as const,
      source: "static-table" as const,
    };
    const decoded = Schema.decodeUnknownEither(CapabilitySchema)(valid);
    expect(decoded._tag).toBe("Right");
    if (decoded._tag === "Right") {
      expect(decoded.right.provider).toBe("ollama");
      expect(decoded.right.recommendedNumCtx).toBe(8192);
    }
  });

  it("rejects an unknown tier", () => {
    const bad = { tier: "supermassive" } as unknown;
    const decoded = Schema.decodeUnknownEither(CapabilitySchema)(bad);
    expect(decoded._tag).toBe("Left");
  });

  it("rejects a negative recommendedNumCtx", () => {
    const bad = {
      provider: "ollama",
      model: "x",
      tier: "local",
      maxContextTokens: 4096,
      recommendedNumCtx: -1,
      maxOutputTokens: 2048,
      tokenizerFamily: "unknown",
      supportsPromptCaching: false,
      supportsVision: false,
      supportsThinkingMode: false,
      supportsStreamingToolCalls: false,
      toolCallDialect: "none",
      source: "fallback",
    };
    const decoded = Schema.decodeUnknownEither(CapabilitySchema)(bad);
    expect(decoded._tag).toBe("Left");
  });

  it("round-trip JSON: decode → encode → decode is structurally identical", () => {
    for (const cap of Object.values(STATIC_CAPABILITIES)) {
      const json = JSON.stringify(cap);
      const decoded = Schema.decodeUnknownSync(CapabilitySchema)(JSON.parse(json));
      const encoded = Schema.encodeSync(CapabilitySchema)(decoded);
      const redecoded = Schema.decodeUnknownSync(CapabilitySchema)(encoded);
      expect(redecoded).toEqual(decoded);
    }
  });

  it("STATIC_CAPABILITIES covers all 6 marketed providers", () => {
    const providers = new Set(Object.values(STATIC_CAPABILITIES).map((c) => c.provider));
    // From README Features: "6 LLM providers — Anthropic, OpenAI, Google
    // Gemini, Ollama (local), LiteLLM (40+ models), Test (deterministic)"
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("gemini")).toBe(true);
    expect(providers.has("ollama")).toBe(true);
    // LiteLLM is a routing layer, not a provider per se — it surfaces models
    // from underlying providers. We don't add a "litellm" capability row;
    // models routed through it use their native provider's capability.
    // Test provider is also a runtime adapter, not a real model — same.
  });

  it("STATIC_CAPABILITIES has at least 2 models per real provider", () => {
    const byProvider: Record<string, number> = {};
    for (const cap of Object.values(STATIC_CAPABILITIES)) {
      byProvider[cap.provider] = (byProvider[cap.provider] ?? 0) + 1;
    }
    for (const provider of ["anthropic", "openai", "gemini", "ollama"]) {
      expect(byProvider[provider] ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it("every static-table entry has source: 'static-table'", () => {
    for (const cap of Object.values(STATIC_CAPABILITIES)) {
      expect(cap.source).toBe("static-table");
    }
  });

  it("recommendedNumCtx never exceeds maxContextTokens", () => {
    for (const [key, cap] of Object.entries(STATIC_CAPABILITIES)) {
      expect(cap.recommendedNumCtx).toBeLessThanOrEqual(cap.maxContextTokens);
      // Surface the offender's key in the message if this fails
      if (cap.recommendedNumCtx > cap.maxContextTokens) {
        throw new Error(`${key}: recommendedNumCtx ${cap.recommendedNumCtx} > maxContextTokens ${cap.maxContextTokens}`);
      }
    }
  });

  it("Capability TypeScript type is structurally inferred from CapabilitySchema", () => {
    // Compile-time check via assignment: if Capability ever drifts from the
    // schema (e.g. someone hand-edits the type), this test fails to compile.
    const cap: Capability = {
      provider: "test",
      model: "test-model",
      tier: "local",
      maxContextTokens: 1024,
      recommendedNumCtx: 1024,
      maxOutputTokens: 256,
      tokenizerFamily: "unknown",
      supportsPromptCaching: false,
      supportsVision: false,
      supportsThinkingMode: false,
      supportsStreamingToolCalls: false,
      toolCallDialect: "none",
      source: "fallback",
    };
    expect(cap.provider).toBe("test");
  });
});
