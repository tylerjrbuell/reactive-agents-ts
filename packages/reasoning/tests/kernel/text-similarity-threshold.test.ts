// `similarityExceeds` is the banded, early-exit form of
// `normalizedLevenshtein(a, b) > threshold`. The kernel runs it every
// iteration on whole thoughts (flail-signature, content stability). The full
// O(|a|*|b|) matrix cost ~150ms per iteration on 3,700-char thoughts and timed
// out scripted kernel tests in CI. These pins hold the verdict EQUAL to the
// full computation and the cost bounded.
import { describe, it, expect } from "bun:test";
import {
  normalizedLevenshtein,
  similarityExceeds,
} from "../../src/kernel/capabilities/decide/text-similarity.js";

// Deterministic PRNG so failures reproduce.
const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const mutate = (s: string, edits: number, r: () => number): string => {
  let out = s;
  for (let e = 0; e < edits; e++) {
    const pos = Math.floor(r() * (out.length + 1));
    const op = Math.floor(r() * 3);
    const ch = String.fromCharCode(97 + Math.floor(r() * 4));
    if (op === 0) out = out.slice(0, pos) + ch + out.slice(pos);
    else if (op === 1) out = out.slice(0, pos) + out.slice(pos + 1);
    else out = out.slice(0, pos) + ch + out.slice(pos + 1);
  }
  return out;
};

describe("normalizedLevenshtein (rolling rows)", () => {
  it("known distances", () => {
    expect(normalizedLevenshtein("kitten", "sitting")).toBeCloseTo(1 - 3 / 7, 10);
    expect(normalizedLevenshtein("", "")).toBe(1);
    expect(normalizedLevenshtein("abc", "")).toBe(0);
    expect(normalizedLevenshtein("", "abc")).toBe(0);
    expect(normalizedLevenshtein("flaw", "lawn")).toBeCloseTo(0.5, 10);
    expect(normalizedLevenshtein("same", "same")).toBe(1);
  });
});

describe("similarityExceeds matches the full computation", () => {
  it("randomized equivalence across thresholds and edit counts", () => {
    const r = rng(42);
    for (let t = 0; t < 600; t++) {
      const len = Math.floor(r() * 60);
      const base = Array.from({ length: len }, () => String.fromCharCode(97 + Math.floor(r() * 4))).join("");
      const other = r() < 0.2
        ? Array.from({ length: Math.floor(r() * 60) }, () => String.fromCharCode(97 + Math.floor(r() * 4))).join("")
        : mutate(base, Math.floor(r() * 15), r);
      for (const threshold of [0, 0.3, 0.5, 0.7, 0.85, 0.9, 0.95, 0.99]) {
        expect(similarityExceeds(base, other, threshold)).toBe(normalizedLevenshtein(base, other) > threshold);
        expect(similarityExceeds(other, base, threshold)).toBe(normalizedLevenshtein(other, base) > threshold);
      }
    }
  });

  it("edge cases", () => {
    expect(similarityExceeds("", "", 0.85)).toBe(true);
    expect(similarityExceeds("abc", "abc", 0.85)).toBe(true);
    expect(similarityExceeds("abc", "", 0.85)).toBe(false);
    expect(similarityExceeds("a".repeat(100), "a".repeat(100) + "b", 0.85)).toBe(true);
    expect(similarityExceeds("a".repeat(100), "b".repeat(100), 0.85)).toBe(false);
  });

  it("distinct ~3,700-char thoughts resolve fast (kernel per-iteration budget)", () => {
    const words = ["plan", "fetch", "verify", "result", "the", "tool", "data", "next", "step", "answer"];
    const thought = (seed: number) => {
      const r = rng(seed);
      return Array.from({ length: 600 }, () => words[Math.floor(r() * words.length)]).join(" ");
    };
    const a = thought(1);
    const b = thought(2);
    expect(normalizedLevenshtein(a, b)).toBeLessThan(0.85);
    const near = mutate(a, 40, rng(7));
    expect(similarityExceeds(a, near, 0.85)).toBe(true);
    // Distinct pairs are the common case and must exit early. The full matrix
    // cost ~60ms per such pair locally (20 calls ~1.2s, several seconds in CI);
    // the early exit is a few ms total. The bound is loose for slow runners.
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) expect(similarityExceeds(a, b, 0.85)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(600);
  });
});
