import { describe, it, expect } from "bun:test";
import { scoreAbstention } from "../src/judge";

describe("scoreAbstention", () => {
  it("trap task + abstained → 1.0 (correct refusal)", () => {
    expect(scoreAbstention({ abstainExpected: true, abstained: true, answerCorrect: false })).toBe(1);
  }, 15000);

  it("trap task + fabricated/wrong answer → 0", () => {
    expect(scoreAbstention({ abstainExpected: true, abstained: false, answerCorrect: false })).toBe(0);
  }, 15000);

  it("solvable task + premature abstain → 0", () => {
    expect(scoreAbstention({ abstainExpected: false, abstained: true, answerCorrect: false })).toBe(0);
  }, 15000);

  it("solvable task + correct answer → 1.0", () => {
    expect(scoreAbstention({ abstainExpected: false, abstained: false, answerCorrect: true })).toBe(1);
  }, 15000);
});
