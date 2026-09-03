import { Effect, Schema } from "effect";
import { LLMParseError, type ParseAttemptError, type LLMErrors } from "./errors.js";

/**
 * Shared self-correcting retry loop for `completeStructured()`. Every provider
 * adapter (anthropic/gemini/litellm/openai/local) implemented the identical
 * skeleton independently: call the model, JSON.parse + Schema-decode the
 * content, and on failure feed the error back into the next attempt's
 * messages so the model can self-correct. This collapses that skeleton to one
 * place — each provider only supplies `runAttempt`, which builds that
 * provider's request (using `lastError` for the repair prompt) and returns
 * the raw text content to parse.
 */
export const runStructuredParseWithRetry = <A>(params: {
  readonly outputSchema: Schema.Schema<A>;
  readonly schemaStr: string;
  readonly maxRetries: number;
  readonly runAttempt: (ctx: {
    readonly attempt: number;
    readonly lastError: unknown;
  }) => Effect.Effect<string, LLMErrors>;
}): Effect.Effect<A, LLMParseError | LLMErrors> =>
  Effect.gen(function* () {
    let lastError: unknown = null;
    const parseAttempts: ParseAttemptError[] = [];

    for (let attempt = 0; attempt <= params.maxRetries; attempt++) {
      const content = yield* params.runAttempt({ attempt, lastError });

      try {
        const parsed = JSON.parse(content);
        const decoded = Schema.decodeUnknownEither(params.outputSchema)(parsed);

        if (decoded._tag === "Right") {
          return decoded.right;
        }
        lastError = decoded.left;
        parseAttempts.push({ attempt, error: decoded.left });
      } catch (e) {
        lastError = e;
        parseAttempts.push({ attempt, error: e });
      }
    }

    return yield* Effect.fail(
      new LLMParseError({
        message: `Failed to parse structured output after ${params.maxRetries + 1} attempts`,
        rawOutput: String(lastError),
        expectedSchema: params.schemaStr,
        attempts: parseAttempts,
      }),
    );
  });
