import { describe, expect, test } from "bun:test";
import { MARKDOWN_AUTO_RENDER_LIMIT, REVEAL_STEP, formatSize, nextReveal, visibleSlice } from "./text-budget.js";

describe("text budget", () => {
  test("slices bounded, reports hidden, never splits a surrogate pair", () => {
    expect(visibleSlice("abc", 10)).toEqual({ shown: "abc", hidden: 0 });
    expect(visibleSlice("abcdef", 4)).toEqual({ shown: "abcd", hidden: 2 });
    const s = "a😀b"; // 😀 is a surrogate pair at index 1-2
    expect(visibleSlice(s, 2).shown).toBe("a");
  });
  test("size labels and reveal step", () => {
    expect(formatSize(500)).toBe("500 chars");
    expect(formatSize(2_500)).toBe("2.5 KB");
    expect(formatSize(250_000)).toBe("250 KB");
    expect(formatSize(3_200_000)).toBe("3.2 MB");
    expect(nextReveal(4_000)).toBe(4_000 + REVEAL_STEP);
    expect(MARKDOWN_AUTO_RENDER_LIMIT).toBeGreaterThan(10_000);
  });
});
