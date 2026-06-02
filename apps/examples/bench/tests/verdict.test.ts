import { describe, it, expect } from "bun:test";
import { benchVerdict } from "../verdict.js";
import type { CohortDelta } from "@reactive-agents/trace";

const baseDelta = (verdict: CohortDelta["verdict"]): CohortDelta => ({
  a: {} as CohortDelta["a"],
  b: {} as CohortDelta["b"],
  verdict,
  reasons: [],
  deltas: { claimedSuccessRate: 0, dishonestSuspectedRate: 0, deliverableProducedRate: 0, tokensP50: 0, avgGuardsFired: 0, overlapStormRate: 0 },
});

describe("benchVerdict", () => {
  it("PASSES only when cohort holds AND faithfulness flat-or-up AND pass^k flat-or-up", () => {
    const v = benchVerdict({ cohort: baseDelta("B improves"), faithfulnessDelta: 0.1, passKDelta: 0 });
    expect(v.pass).toBe(true);
  });
  it("FAILS when faithfulness drops even if cohort says improve", () => {
    const v = benchVerdict({ cohort: baseDelta("B improves"), faithfulnessDelta: -0.1, passKDelta: 0 });
    expect(v.pass).toBe(false);
    expect(v.reasons.join(" ")).toContain("faithfulness");
  });
  it("FAILS when cohort regresses (honesty/success/tokens) regardless of faithfulness", () => {
    const v = benchVerdict({ cohort: baseDelta("B regresses"), faithfulnessDelta: 0.2, passKDelta: 0.2 });
    expect(v.pass).toBe(false);
  });
  it("is INCONCLUSIVE when the cohort is blind", () => {
    const v = benchVerdict({ cohort: baseDelta("inconclusive (blind)"), faithfulnessDelta: 0, passKDelta: 0 });
    expect(v.pass).toBe(false);
    expect(v.inconclusive).toBe(true);
  });
});
