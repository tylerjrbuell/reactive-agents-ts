import { Effect, FiberRef, Schema } from "effect";
import type { StructuredAttemptReport } from "@reactive-agents/core";
import { LLMParseError, type ParseAttemptError, type LLMErrors } from "./errors.js";
import type { TokenUsage } from "./types.js";

/**
 * Usage of one `completeStructured()` call: the {@link TokenUsage} summed over
 * every native attempt, plus `attempts`, one {@link StructuredAttemptReport}
 * per attempt in order (tokens, stop reason, thinking size, parsed or not).
 */
export type StructuredCallUsage = TokenUsage & {
  readonly attempts?: readonly StructuredAttemptReport[];
};

/**
 * What one native attempt of a structured call returned. `stopReason` and
 * `thinkingChars` are optional: an adapter reports them only when its SDK
 * exposes them for the request it made.
 */
export type StructuredAttemptResult = {
  readonly content: string;
  readonly usage: TokenUsage;
  /** Provider stop reason for this attempt (normalized `StopReason` value). */
  readonly stopReason?: string;
  /** Characters of internal reasoning the attempt produced, when surfaced. */
  readonly thinkingChars?: number;
};

/**
 * Ambient sink for the usage of the most recent `completeStructured()` call on
 * this fiber. Set by {@link runStructuredParseWithRetry} (summed across every
 * parse-retry attempt that ran, with the per-attempt split on `attempts`);
 * read by the observable LLM wrapper in `@reactive-agents/reasoning` to feed
 * the run-scoped budget meter and the `llm-exchange` record. Fiber-local, so
 * concurrent structured calls do not clobber each other. Each call sets a
 * fresh object; nothing is mutated after it is set.
 *
 * Issue #232 Gap 1: before this ref existed, the mapped response's usage was
 * discarded by the retry loop, so native structured calls (plan generation,
 * extraction) were unmetered and the run budget under-counted.
 */
export const StructuredUsageRef = FiberRef.unsafeMake<StructuredCallUsage | null>(null);

/** Zero-valued usage — the accumulator's identity element. */
const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCost: 0,
};

/**
 * Sum two {@link TokenUsage} records. Optional cache fields are only emitted
 * when at least one side carries them, so a provider without prompt caching
 * does not acquire spurious zero-valued cache fields.
 */
const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  totalTokens: a.totalTokens + b.totalTokens,
  estimatedCost: a.estimatedCost + b.estimatedCost,
  ...(a.cacheCreationInputTokens !== undefined ||
  b.cacheCreationInputTokens !== undefined
    ? {
        cacheCreationInputTokens:
          (a.cacheCreationInputTokens ?? 0) + (b.cacheCreationInputTokens ?? 0),
      }
    : {}),
  ...(a.cacheReadInputTokens !== undefined || b.cacheReadInputTokens !== undefined
    ? {
        cacheReadInputTokens:
          (a.cacheReadInputTokens ?? 0) + (b.cacheReadInputTokens ?? 0),
      }
    : {}),
});

/**
 * Shared self-correcting retry loop for `completeStructured()`. Every provider
 * adapter (anthropic/gemini/litellm/openai/local) implemented the identical
 * skeleton independently: call the model, JSON.parse + Schema-decode the
 * content, and on failure feed the error back into the next attempt's
 * messages so the model can self-correct. This collapses that skeleton to one
 * place — each provider only supplies `runAttempt`, which builds that
 * provider's request (using `lastError` for the repair prompt) and returns
 * the raw text content plus the provider-reported {@link TokenUsage} for the
 * attempt to parse.
 *
 * The summed usage across all attempts, with one {@link StructuredAttemptReport}
 * per attempt on `attempts`, is written to {@link StructuredUsageRef} on the
 * success path, the parse-failure path, and (when at least one attempt already
 * completed) a provider failure on a later attempt, so a run-scoped budget
 * meter can account for every attempt that ran.
 */
export const runStructuredParseWithRetry = <A>(params: {
  readonly outputSchema: Schema.Schema<A>;
  readonly schemaStr: string;
  readonly maxRetries: number;
  readonly runAttempt: (ctx: {
    readonly attempt: number;
    readonly lastError: unknown;
  }) => Effect.Effect<StructuredAttemptResult, LLMErrors>;
}): Effect.Effect<A, LLMParseError | LLMErrors> =>
  Effect.gen(function* () {
    let lastError: unknown = null;
    let totalUsage: TokenUsage = EMPTY_USAGE;
    const parseAttempts: ParseAttemptError[] = [];
    const reports: StructuredAttemptReport[] = [];
    // A fresh object per set: readers may hold the previous value.
    const callUsage = (): StructuredCallUsage => ({ ...totalUsage, attempts: [...reports] });

    for (let attempt = 0; attempt <= params.maxRetries; attempt++) {
      const attemptResult = yield* params.runAttempt({ attempt, lastError }).pipe(
        // Earlier attempts ran and were billed even if this one failed.
        Effect.tapError(() =>
          reports.length > 0 ? FiberRef.set(StructuredUsageRef, callUsage()) : Effect.void,
        ),
      );
      totalUsage = addUsage(totalUsage, attemptResult.usage);
      const report = (parsed: boolean): StructuredAttemptReport => ({
        attempt,
        parsed,
        inputTokens: attemptResult.usage.inputTokens,
        outputTokens: attemptResult.usage.outputTokens,
        ...(attemptResult.stopReason !== undefined ? { stopReason: attemptResult.stopReason } : {}),
        ...(attemptResult.thinkingChars !== undefined ? { thinkingChars: attemptResult.thinkingChars } : {}),
      });

      try {
        const parsed = JSON.parse(attemptResult.content);
        const decoded = Schema.decodeUnknownEither(params.outputSchema)(parsed);

        if (decoded._tag === "Right") {
          reports.push(report(true));
          yield* FiberRef.set(StructuredUsageRef, callUsage());
          return decoded.right;
        }
        lastError = decoded.left;
        parseAttempts.push({ attempt, error: decoded.left });
      } catch (e) {
        lastError = e;
        parseAttempts.push({ attempt, error: e });
      }
      reports.push(report(false));
    }

    // Best-effort: account for tokens already spent even though the call
    // ultimately failed to produce schema-valid output.
    yield* FiberRef.set(StructuredUsageRef, callUsage());

    return yield* Effect.fail(
      new LLMParseError({
        message: `Failed to parse structured output after ${params.maxRetries + 1} attempts`,
        rawOutput: String(lastError),
        expectedSchema: params.schemaStr,
        attempts: parseAttempts,
      }),
    );
  });
