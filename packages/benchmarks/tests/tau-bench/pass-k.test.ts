// Run: bun test packages/benchmarks/tests/tau-bench/pass-k.test.ts
//
// pass^k is the probability that ALL k independent trials of a task succeed --
// it is a RELIABILITY metric, not an accuracy metric. A harness at 80% accuracy
// has pass^8 of 0.8^8 = 0.168, which is why 09 frames reliability as the binding
// axis. Getting this exponent wrong would flatter the harness by a wide margin.
import { describe, it, expect } from "bun:test";
import { passAtK } from "../../src/tau-bench/pass-k.js";

describe("pass^k", () => {
  it("is 1 when every trial of every task succeeded", () => {
    expect(passAtK([[true, true, true]], 3)).toBe(1);
  });

  it("is 0 when any trial of the only task failed", () => {
    expect(passAtK([[true, false, true]], 3)).toBe(0);
  });

  it("averages across tasks", () => {
    // One task fully reliable, one not: 0.5.
    expect(passAtK([[true, true], [true, false]], 2)).toBe(0.5);
  });

  it("refuses a k larger than the trials recorded", () => {
    // Silently scoring pass^8 off 3 trials would overstate reliability, which is
    // exactly the kind of quiet cap this project requires be logged, not hidden.
    expect(() => passAtK([[true, true, true]], 8)).toThrow();
  });
});
