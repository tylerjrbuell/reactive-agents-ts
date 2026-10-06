import { describe, it, expect } from "bun:test";
import { makeRng } from "./rng.js";

describe("rng", () => {
  it("same seed yields same sequence", () => {
    const a = makeRng(7);
    const b = makeRng(7);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });
  it("different seeds diverge", () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next());
  });
  it("int inclusive range", () => {
    const r = makeRng(3);
    for (let i = 0; i < 200; i++) {
      const n = r.int(2, 5);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});
