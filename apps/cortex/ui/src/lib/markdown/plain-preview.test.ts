import { describe, expect, test } from "bun:test";
import { plainPreviewFromMarkdown, preferExpandedDeliverable } from "./plain-preview.js";

describe("plainPreviewFromMarkdown", () => {
  test("strips display math placeholder", () => {
    expect(plainPreviewFromMarkdown("Hi $$x^2$$ there", 80)).toBe("Hi … there");
  });

  test("drops rules, list and quote markers and table rules; keeps inline code text (2026-11-11 QA)", () => {
    const md = [
      "Here's a deep dive on hybrid retrieval.",
      "",
      "---",
      "",
      "## Part 1",
      "> Why `hybrid` is the default",
      "- BM25 alone on 3,200 docs",
      "1. Dense",
      "| A | B |",
      "|---|:-:|",
      "| x | y |",
    ].join("\n");
    expect(plainPreviewFromMarkdown(md, 400)).toBe(
      "Here's a deep dive on hybrid retrieval. Part 1 Why hybrid is the default BM25 alone on 3,200 docs Dense A B x y",
    );
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
