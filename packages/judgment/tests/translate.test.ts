import { describe, expect, test } from "bun:test";
import { fromSdkResult, toSdkEntry, toSdkQuestions } from "../src/translate.js";
import type { ChoiceSpec, NoulSpec, ScoreSpec } from "../src/types.js";

describe("translate: RA specs -> SDK questions", () => {
  test("maps noul/choice/score specs to SDK question shapes with type discriminants", () => {
    const noul: NoulSpec = { type: "noul", instructions: "Is this billing?" };
    const choice: ChoiceSpec = {
      type: "choice",
      instructions: "Pick a category",
      criteria: { billing: null, technical: null },
    };
    const score: ScoreSpec = {
      type: "score",
      instructions: "Rate relevance",
      criteria: ["off-topic", "partial", "full"],
    };

    const sdk = toSdkQuestions({ n: noul, c: choice, s: score });

    expect(sdk.n).toEqual({ type: "noul", instructions: "Is this billing?", criteria: undefined });
    expect(sdk.c).toEqual({
      type: "choice",
      instructions: "Pick a category",
      criteria: { billing: null, technical: null },
    });
    expect(sdk.s).toEqual({
      type: "score",
      instructions: "Rate relevance",
      criteria: ["off-topic", "partial", "full"],
    });
  });

  test("toSdkEntry defaults an undefined instructions field to null (the SDK's undescribed marker)", () => {
    expect(toSdkEntry(undefined)).toBeNull();
    expect(toSdkEntry("text")).toBe("text");
    expect(toSdkEntry({ a: 1 })).toEqual({ a: 1 });
  });
});

describe("translate: SDK result -> JudgmentAnswers", () => {
  test("maps noul/choice/score SDK responses to typed, calibrated answers", () => {
    const result = {
      model: "jev-latest",
      usage: { input_tokens: 10, output_tokens: 0 },
      answers: {
        n: { type: "noul" as const, noul: 0.87 },
        c: {
          type: "choice" as const,
          choice: "billing",
          confidence: 0.9,
          probabilities: { billing: 0.9, technical: 0.1 },
        },
        s: {
          type: "score" as const,
          score: 1.8,
          confidence: 0.75,
          legend: { 0: "off-topic", 1: "partial", 2: "full" },
          probabilities: { "0": 0.05, "1": 0.1, "2": 0.85 },
        },
      },
    };

    const answers = fromSdkResult(result, ["n", "c", "s"]);

    expect(answers.n).toEqual({ kind: "noul", probability: 0.87 });
    expect(answers.c).toEqual({
      kind: "choice",
      value: "billing",
      probabilities: { billing: 0.9, technical: 0.1 },
      confidence: 0.9,
      calibrated: true,
    });
    expect(answers.s).toEqual({
      kind: "score",
      value: 1.8,
      probabilities: { "0": 0.05, "1": 0.1, "2": 0.85 },
      confidence: 0.75,
      calibrated: true,
    });
  });

  test("throws (never partial-trusts) when a requested question id is missing from the response", () => {
    const result = {
      model: "jev-latest",
      usage: { input_tokens: 1, output_tokens: 0 },
      answers: { n: { type: "noul" as const, noul: 0.5 } },
    };

    expect(() => fromSdkResult(result, ["n", "missing"])).toThrow(/missing answer/i);
  });
});
