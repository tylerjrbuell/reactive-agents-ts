// Run: bun test packages/llm-provider/tests/capability-gemini-family.test.ts --timeout 15000
//
// N5 (2026-11-19 v0.19 QA): every gemini-flash-latest trace showed
// `capability-resolved source=fallback recommendedNumCtx=2048
// supportsThinkingMode=false`, because the id misses the static table.
// Unlisted Gemini text-model ids now borrow the nearest static row of their
// variant (capability-gemini-family.ts).

import { describe, it, expect } from "bun:test";
import { resolveCapability } from "../src/capability-resolver.js";
import { STATIC_CAPABILITIES } from "../src/capability.js";
import { geminiFamilyCapability, parseGeminiId } from "../src/capability-gemini-family.js";

/** The static row the family rule should borrow from (asserted present). */
const row = (model: string) => {
  expect(STATIC_CAPABILITIES[`gemini/${model}`]).toBeDefined();
  return resolveCapability("gemini", model);
};

describe("Gemini family capability rule", () => {
  it("gemini-flash-latest resolves to the newest flash row, not the 2048 fallback", () => {
    const cap = resolveCapability("gemini", "gemini-flash-latest");
    expect(cap.source).toBe("inferred");
    expect(cap.model).toBe("gemini-flash-latest");
    expect(cap.recommendedNumCtx).not.toBe(2048);
    expect(cap.recommendedNumCtx).toBe(row("gemini-3.5-flash").recommendedNumCtx);
    expect(cap.maxOutputTokens).toBe(row("gemini-3.5-flash").maxOutputTokens);
    expect(cap.supportsThinkingMode).toBe(true);
    expect(cap.toolCallDialect).toBe("native-fc");
  });

  it("dated previews and new versions map to the nearest listed version of their variant", () => {
    expect(resolveCapability("gemini", "gemini-2.5-flash-preview-09-2025").recommendedNumCtx).toBe(
      row("gemini-2.5-flash").recommendedNumCtx,
    );
    expect(resolveCapability("gemini", "gemini-3-pro-preview").supportsThinkingMode).toBe(true);
    expect(resolveCapability("gemini", "gemini-3-pro-preview").tier).toBe(row("gemini-2.5-pro").tier);
    expect(resolveCapability("gemini", "gemini-4-flash").tier).toBe(row("gemini-3.5-flash").tier);
    expect(resolveCapability("gemini", "gemini-flash-lite-latest").supportsThinkingMode).toBe(
      row("gemini-2.5-flash-lite").supportsThinkingMode,
    );
    expect(resolveCapability("gemini", "models/gemini-pro-latest").recommendedNumCtx).toBe(
      row("gemini-2.5-pro").recommendedNumCtx,
    );
  });

  it("variant wins over substring: flash-lite ids never take the flash row", () => {
    expect(parseGeminiId("gemini-2.5-flash-lite-preview-06-17")).toEqual({ variant: "flash-lite", version: 2.5 });
    expect(parseGeminiId("gemini-flash-latest")).toEqual({ variant: "flash", version: undefined });
  });

  it("explicit table rows still win", () => {
    expect(resolveCapability("gemini", "gemini-2.5-flash").source).toBe("static-table");
    expect(resolveCapability("gemini", "gemini-2.0-flash").source).toBe("static-table");
  });

  it("non-text and variant-less ids stay on the fallback", () => {
    for (const id of ["gemini-embedding-001", "gemini-2.5-flash-preview-tts", "gemini-2.5-flash-image-preview", "gemini-exp-1206", "gemini-9-boron"]) {
      expect(geminiFamilyCapability(id)).toBeUndefined();
      expect(resolveCapability("gemini", id).source).toBe("fallback");
    }
  });

  it("the rule is gemini-only", () => {
    expect(resolveCapability("openai", "gemini-flash-latest").source).toBe("fallback");
  });
});
