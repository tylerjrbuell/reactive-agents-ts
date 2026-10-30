// Run: bun test packages/llm-provider/tests/capability-reported.test.ts --timeout 15000
//
// Pure unit pins for the provider-reported metadata tier. Resolver-level and
// discovery-level behavior is pinned in capability-resolver.test.ts and
// model-discovery.test.ts.

import { describe, it, expect, beforeEach } from "bun:test";
import {
  capabilityFromReported,
  registerReportedModelMetadata,
  reportedModelMetadataFor,
  _resetReportedMetadataForTesting,
} from "../src/capability-reported.js";

beforeEach(() => _resetReportedMetadataForTesting());

describe("capabilityFromReported", () => {
  it.each(["anthropic", "openai", "gemini", "groq", "xai"])("%s: window reported -> inferred row", (p) => {
    const cap = capabilityFromReported(p, "m", { maxContextTokens: 100_000 });
    expect(cap?.source).toBe("inferred");
    expect(cap?.maxContextTokens).toBe(100_000);
    expect(cap?.recommendedNumCtx).toBe(100_000);
    expect(cap?.toolCallDialect).toBe("native-fc");
  });

  it.each(["ollama", "litellm", "test", "custom"])("%s: never inferred", (p) => {
    expect(capabilityFromReported(p, "m", { maxContextTokens: 100_000 })).toBeNull();
  });

  it("no reported window -> null (loud fallback stays)", () => {
    expect(capabilityFromReported("gemini", "m", { maxOutputTokens: 8_000, supportsThinkingMode: true })).toBeNull();
  });

  it("unreported flags are not claimed", () => {
    const cap = capabilityFromReported("anthropic", "m", { maxContextTokens: 1 })!;
    expect(cap.supportsVision).toBe(false);
    expect(cap.supportsThinkingMode).toBe(false);
  });
});

describe("registry", () => {
  it("round-trips and ignores empty metadata", () => {
    registerReportedModelMetadata("gemini", "a", {});
    expect(reportedModelMetadataFor("gemini", "a")).toBeUndefined();
    registerReportedModelMetadata("gemini", "a", { maxContextTokens: 5 });
    expect(reportedModelMetadataFor("gemini", "a")).toEqual({ maxContextTokens: 5 });
  });
});
