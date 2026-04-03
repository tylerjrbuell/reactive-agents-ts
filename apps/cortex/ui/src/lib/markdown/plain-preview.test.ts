import { describe, expect, test } from "bun:test";
import { plainPreviewFromMarkdown, preferExpandedDeliverable } from "./plain-preview.js";

describe("plainPreviewFromMarkdown", () => {
  test("strips display math placeholder", () => {
    expect(plainPreviewFromMarkdown("Hi $$x^2$$ there", 80)).toBe("Hi … there");
  });

  test("truncates long text", () => {
    const s = "a".repeat(100);
    expect(plainPreviewFromMarkdown(s, 20).length).toBeLessThanOrEqual(21);
    expect(plainPreviewFromMarkdown(s, 20).endsWith("…")).toBe(true);
  });
});

describe("preferExpandedDeliverable", () => {
  test("short body prefers expanded", () => {
    expect(preferExpandedDeliverable("Hello world.")).toBe(true);
  });

  test("long single line prefers compact", () => {
    expect(preferExpandedDeliverable("x".repeat(400))).toBe(false);
  });

  test("many short lines beyond threshold prefers compact", () => {
    const lines = Array.from({ length: 12 }, () => "short").join("\n");
    expect(preferExpandedDeliverable(lines)).toBe(false);
  });
});
