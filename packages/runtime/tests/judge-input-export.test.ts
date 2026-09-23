import { describe, test, expect } from "bun:test";
import type { JudgeInput } from "../src/index.js";
import type { QuestionSpecs } from "@reactive-agents/judgment";

describe("JudgeInput type export", () => {
  test("JudgeInput can be imported from public index", () => {
    // Type-only test: this should compile successfully once JudgeInput
    // is re-exported from index.ts
    
    // Example wrapper function that uses JudgeInput<Q> to type its input
    const createJudgmentRequest = <Q extends QuestionSpecs>(
      input: JudgeInput<Q>
    ): JudgeInput<Q> => {
      return input;
    };

    // Verify it works with a sample input
    const questions = {
      example: { type: "noul" as const, instructions: "Is this a test?" },
    };
    
    const result = createJudgmentRequest({
      state: { message: "test context" },
      questions,
    });

    expect(result.questions).toEqual(questions);
  });
});
