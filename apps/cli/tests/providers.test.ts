// Run: bun test apps/cli/tests/providers.test.ts --timeout 15000
//
// The CLI's provider list must be exactly what the framework config accepts.
// Hand-written copies drifted before: `rax serve` rejected groq and xai.
import { describe, expect, it } from "bun:test";
import { Schema } from "effect";
import { ProviderNameSchema } from "@reactive-agents/runtime";
import { VALID_PROVIDERS, isValidProvider } from "../src/providers.js";

describe("CLI providers match the framework", () => {
  it("every CLI provider decodes as a framework provider name", () => {
    for (const p of VALID_PROVIDERS) {
      expect(Schema.is(ProviderNameSchema)(p)).toBe(true);
    }
  });

  it("includes groq and xai, rejects custom", () => {
    expect(isValidProvider("groq")).toBe(true);
    expect(isValidProvider("xai")).toBe(true);
    expect(isValidProvider("custom")).toBe(false);
  });
});
