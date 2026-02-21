import { Effect } from "effect";
import type { CompletionRequest, CompletionResponse, LLMErrors } from "@reactive-agents/llm-provider";
import type { DimensionScore } from "../types/eval-result.js";
import { EvalError } from "../errors/errors.js";

type LLMCompleter = {
  readonly complete: (request: CompletionRequest) => Effect.Effect<CompletionResponse, LLMErrors>;
};

/**
 * Completeness scorer: measures whether the output fully answers the input.
 * Takes the llm instance directly (captured from Layer construction).
 */
export const scoreCompleteness = (
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
      ? `Reference answer: ${params.expectedOutput}`
      : "No reference answer — evaluate based on the input requirements alone.";

    const response = yield* llm
      .complete({
        messages: [
          {
            role: "user",
            content: `You are an evaluation judge. Score the completeness of this AI response on a scale of 0.0 to 1.0.

Input: ${params.input}
${reference}
Actual output: ${params.actualOutput}

Completeness measures whether all parts of the question were answered and nothing important was left out.
A score of 1.0 means fully complete. A score of 0.0 means nothing was answered.
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
              message: `Completeness scoring failed: ${String(err)}`,
              caseId: params.caseId,
              cause: err,
            }),
        ),
      );

    const score = Math.max(0, Math.min(1, parseFloat(response.content.trim()) || 0.5));
    return { dimension: "completeness", score } satisfies DimensionScore;
  });
