import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { JudgmentAnswers, JudgmentService } from "@reactive-agents/judgment";
import { scoreDimensionsViaJudgment, JEV_JUDGED_DIMENSIONS } from "../src/services/judgment-dimensions.js";

const PARAMS = { input: "What is 2+2?", actualOutput: "4", expectedOutput: "4" };

describe("scoreDimensionsViaJudgment", () => {
  it("answers all jev-capable dimensions in ONE ask() call", async () => {
    let callCount = 0;
    let lastQuestionIds: string[] = [];
    const judgment: JudgmentService["Type"] = {
      ask: (input) => {
        callCount += 1;
        lastQuestionIds = Object.keys(input.questions);
        const answers: Record<string, unknown> = {};
        for (const id of lastQuestionIds) {
          answers[id] = { kind: "score", value: 1, probabilities: {}, confidence: 0.8, calibrated: true };
        }
        return Effect.succeed(answers as unknown as JudgmentAnswers<typeof input.questions>);
      },
    };

    const result = await Effect.runPromise(
      scoreDimensionsViaJudgment(judgment, ["accuracy", "relevance", "completeness", "safety"], PARAMS),
    );

    expect(callCount).toBe(1);
    expect(lastQuestionIds.sort()).toEqual(["accuracy", "completeness", "relevance", "safety"]);
    expect(result.size).toBe(4);
    expect(result.get("relevance")?.score).toBeCloseTo(0.5); // value=1 of 0..2 rubric -> 0.5
    expect(result.get("relevance")?.confidence).toBeCloseTo(0.8);
  });

  it("skips non-jev-capable dimensions (e.g. cost-efficiency) — never asked, never in the result map", async () => {
    let lastQuestionIds: string[] = [];
    const judgment: JudgmentService["Type"] = {
      ask: (input) => {
        lastQuestionIds = Object.keys(input.questions);
        const answers: Record<string, unknown> = {};
        for (const id of lastQuestionIds) {
          answers[id] = { kind: "score", value: 0, probabilities: {}, confidence: 1, calibrated: true };
        }
        return Effect.succeed(answers as unknown as JudgmentAnswers<typeof input.questions>);
      },
    };

    const result = await Effect.runPromise(
      scoreDimensionsViaJudgment(judgment, ["accuracy", "cost-efficiency", "custom-dim"], PARAMS),
    );

    expect(lastQuestionIds).toEqual(["accuracy"]);
    expect(result.has("cost-efficiency")).toBe(false);
    expect(result.has("custom-dim")).toBe(false);
  });

  it("returns an empty map (never a fabricated score) when the batch fails", async () => {
    const judgment: JudgmentService["Type"] = {
      ask: () => Effect.fail({ _tag: "JudgmentTimeout", message: "slow", timeoutMs: 1 } as never),
    };

    const result = await Effect.runPromise(
      scoreDimensionsViaJudgment(judgment, ["accuracy", "relevance"], PARAMS),
    );

    expect(result.size).toBe(0);
  });

  it("drops a dimension whose answer isn't score-shaped, without dropping the others", async () => {
    const judgment: JudgmentService["Type"] = {
      ask: () =>
        Effect.succeed({
          accuracy: { kind: "score", value: 2, probabilities: {}, confidence: 0.9, calibrated: true },
          relevance: { kind: "noul", probability: 0.5 }, // wrong shape — never partial-trusted
        } as unknown as JudgmentAnswers),
    };

    const result = await Effect.runPromise(
      scoreDimensionsViaJudgment(judgment, ["accuracy", "relevance"], PARAMS),
    );

    expect(result.has("accuracy")).toBe(true);
    expect(result.has("relevance")).toBe(false);
  });

  it("no jev-capable dimensions requested short-circuits without calling ask()", async () => {
    let called = false;
    const judgment: JudgmentService["Type"] = {
      ask: () => {
        called = true;
        return Effect.succeed({} as JudgmentAnswers);
      },
    };

    const result = await Effect.runPromise(
      scoreDimensionsViaJudgment(judgment, ["cost-efficiency"], PARAMS),
    );

    expect(called).toBe(false);
    expect(result.size).toBe(0);
  });

  it("JEV_JUDGED_DIMENSIONS is exactly the four LLM-judged dimensions", () => {
    expect([...JEV_JUDGED_DIMENSIONS].sort()).toEqual(["accuracy", "completeness", "relevance", "safety"]);
  });
});
