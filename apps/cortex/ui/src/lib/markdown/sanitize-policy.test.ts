import { describe, expect, test } from "bun:test";
import { isCodeLanguageClass, PURIFY_ATTR } from "./render-markdown-with-math.js";

describe("markdown sanitizer attribute policy", () => {
  test("class is not an allowed attribute (model output cannot pick app styles)", () => {
    expect((PURIFY_ATTR as readonly string[]).includes("class")).toBe(false);
    expect((PURIFY_ATTR as readonly string[]).includes("style")).toBe(false);
  });

  test("only the fence language marker on <code> survives", () => {
    expect(isCodeLanguageClass("CODE", "language-ts")).toBe(true);
    expect(isCodeLanguageClass("code", "language-c++")).toBe(true);
    expect(isCodeLanguageClass("CODE", "language-ts fixed inset-0")).toBe(false);
    expect(isCodeLanguageClass("DIV", "language-ts")).toBe(false);
    expect(isCodeLanguageClass("CODE", "fixed inset-0 z-50")).toBe(false);
    expect(isCodeLanguageClass("CODE", "cortex-live-glow")).toBe(false);
  });
});
