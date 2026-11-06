import { describe, expect, it } from "bun:test";
import { decideExitCode } from "../src/commands/eval-gate.js";

function verdict(decision: "default-on" | "opt-in" | "reject", tiersCovered: number) {
  return {
    decision,
    perTier: [],
    aggregate: { liftPp: 0, tokenOverheadPct: 0, billedTokenOverheadPct: 0, tiersCovered },
    partial: false,
    rationale: "",
    baselineVariantId: "b",
    candidateVariantId: "c",
  };
}

describe("decideExitCode", () => {
  it("exits 1 on reject", () => {
    expect(decideExitCode(verdict("reject", 2))).toBe(1);
  });
  it("exits 0 on default-on", () => {
    expect(decideExitCode(verdict("default-on", 2))).toBe(0);
  });
  it("exits 0 on opt-in", () => {
    expect(decideExitCode(verdict("opt-in", 2))).toBe(0);
  });
  it("exits 2 when no tiers were comparable (bad variant ids / empty report)", () => {
    expect(decideExitCode(verdict("opt-in", 0))).toBe(2);
  });
  it("exits 2 (not 1) when the mechanism never fired: an A/A reject measures nothing", () => {
    expect(decideExitCode(verdict("reject", 2), 0)).toBe(2);
    expect(decideExitCode(verdict("reject", 2), 3)).toBe(1);
  });
});
