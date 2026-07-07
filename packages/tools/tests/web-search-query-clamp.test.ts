import { describe, expect, test } from "bun:test";
import { clampQueryLength } from "../src/skills/web-search.js";

// rw-1 rerun (2026-07-07, trace 01KWYBZQ1VZWQEPXCHK94DS8QM): a plan step
// templated a prior search result into `query`, producing a ~540-char query.
// Tavily hard-rejects >400 chars (HTTP 400) and the whole provider chain then
// failed on unsearchable input. The handler now clamps instead of failing.
describe("web-search query clamp", () => {
  test("short queries pass through untouched", () => {
    expect(clampQueryLength("Bitcoin price today USD")).toBe(
      "Bitcoin price today USD",
    );
  });

  test("exactly 400 chars passes through untouched", () => {
    const q = "x".repeat(400);
    expect(clampQueryLength(q)).toBe(q);
  });

  test("oversize query clamps to ≤400 at a word boundary", () => {
    const q = ("vector database ".repeat(40)).trim(); // ~640 chars
    const out = clampQueryLength(q);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.endsWith("vector") || out.endsWith("database")).toBe(true);
  });

  test("oversize query with no spaces hard-cuts at 400", () => {
    const out = clampQueryLength("y".repeat(1000));
    expect(out.length).toBe(400);
  });
});
