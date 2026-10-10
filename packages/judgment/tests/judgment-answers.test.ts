// Run: bun test packages/judgment/tests/judgment-answers.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import type { JudgmentAnswer, QuestionSpecs } from "@reactive-agents/judgment";
import { hasExactJudgmentAnswerKeys } from "./judgment-answers.js";

const questions = {
  safe: { type: "noul", instructions: "Is this action safe?" },
  tier: { type: "score", instructions: "Rate risk", criteria: ["low", "high"] },
} as const satisfies QuestionSpecs;

const safeAnswers = {
  safe: { kind: "noul", probability: 0.9 },
  tier: { kind: "score", value: 0, probabilities: {}, confidence: 0.9, calibrated: true },
} satisfies Record<string, JudgmentAnswer>;

describe("hasExactJudgmentAnswerKeys", () => {
  it("accepts one answer for every requested question", () => {
    expect(hasExactJudgmentAnswerKeys(questions, safeAnswers)).toBe(true);
  });

  it("rejects missing and unexpected answer keys", () => {
    expect(hasExactJudgmentAnswerKeys(questions, { safe: safeAnswers.safe })).toBe(false);
    expect(
      hasExactJudgmentAnswerKeys(questions, {
        ...safeAnswers,
        extra: { kind: "noul", probability: 0.1 },
      }),
    ).toBe(false);
  });
});
