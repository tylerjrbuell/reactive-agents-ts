import { Effect } from "effect";
import type { CompletionRequest, CompletionResponse, LLMErrors } from "@reactive-agents/llm-provider";
import type { DimensionScore } from "../types/eval-result.js";
import { EvalError } from "../errors/errors.js";

type LLMCompleter = {
  readonly complete: (request: CompletionRequest) => Effect.Effect<CompletionResponse, LLMErrors>;
};

/**
 * Relevance scorer: measures whether the output addresses the input.
 * Takes the llm instance directly (captured from Layer construction).
 */
export const scoreRelevance = (
  llm: LLMCompleter,
  params: {
    input: string;
    actualOutput: string;
    caseId: string;
  },
): Effect.Effect<DimensionScore, EvalError> =>
  Effect.gen(function* () {
    const response = yield* llm
      .complete({
        messages: [
          {
            role: "user",
            content: `You are an evaluation judge. Score the relevance of this AI response on a scale of 0.0 to 1.0.

Input: ${params.input}
Actual output: ${params.actualOutput}

Relevance measures whether the response directly addresses the question or task.
A score of 1.0 means fully on-topic. A score of 0.0 means completely off-topic.
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
              message: `Relevance scoring failed: ${String(err)}`,
              caseId: params.caseId,
              cause: err,
            }),
        ),
      );

    const score = Math.max(0, Math.min(1, parseFloat(response.content.trim()) || 0.5));
    return { dimension: "relevance", score } satisfies DimensionScore;
  });
