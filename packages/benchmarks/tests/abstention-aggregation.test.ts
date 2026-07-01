import { describe, it, expect } from "bun:test";
import { aggregateAbstention } from "../src/runner";

describe("aggregateAbstention", () => {
  it("computes accuracy and fabrication-under-trap over trap runs", () => {
    const runs = [
      { abstainExpected: true, abstained: true },   // correct refusal
      { abstainExpected: true, abstained: false },  // fabricated under trap
      { abstainExpected: false, abstained: false }, // solvable, ignored by trap metrics
    ];
    const a = aggregateAbstention(runs);
    expect(a.abstentionAccuracy).toBeCloseTo(0.5, 5);       // 1 of 2 traps correct
    expect(a.fabricationUnderTrapRate).toBeCloseTo(0.5, 5); // 1 of 2 traps fabricated
  }, 15000);

  it("returns 0/0 when there are no trap runs", () => {
    const a = aggregateAbstention([{ abstainExpected: false, abstained: false }]);
    expect(a.abstentionAccuracy).toBe(0);
    expect(a.fabricationUnderTrapRate).toBe(0);
  }, 15000);
});
