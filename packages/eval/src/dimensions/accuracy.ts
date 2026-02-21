import { Effect } from "effect";
import type { CompletionRequest, CompletionResponse, LLMErrors } from "@reactive-agents/llm-provider";
import type { DimensionScore } from "../types/eval-result.js";
import { EvalError } from "../errors/errors.js";

type LLMCompleter = {
  readonly complete: (request: CompletionRequest) => Effect.Effect<CompletionResponse, LLMErrors>;
};

/**
 * Accuracy scorer: compares actual output to expected output using LLM-as-judge.
 * Takes an LLM completer directly (captured from Layer construction).
 */
export const scoreAccuracy = (
  llm: LLMCompleter,
  params: {
    input: string;
    actualOutput: string;
    expectedOutput?: string;
    caseId: string;
  },
): Effect.Effect<DimensionScore, EvalError> =>
  Effect.gen(function* () {
    const reference = params.expectedOutput
      ? `Expected output: ${params.expectedOutput}`
      : "No expected output provided — evaluate factual correctness only.";

    const response = yield* llm
      .complete({
        messages: [
          {
            role: "user",
            content: `You are an evaluation judge. Score the accuracy of this AI response on a scale of 0.0 to 1.0.

Input: ${params.input}
${reference}
Actual output: ${params.actualOutput}

Accuracy measures whether the response is factually correct and matches the expected answer.
Respond with ONLY a decimal number between 0.0 and 1.0. No explanation.`,
          },
        ],
        maxTokens: 10,
        temperature: 0.0,
      })
      .pipe(
        Effect.mapError(
          (err) =>
            new EvalError({
              message: `Accuracy scoring failed: ${String(err)}`,
              caseId: params.caseId,
              cause: err,
            }),
        ),
      );

    const score = Math.max(0, Math.min(1, parseFloat(response.content.trim()) || 0.5));
    return { dimension: "accuracy", score } satisfies DimensionScore;
  });
