import { Effect } from "effect";
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  RateLimitError,
  TypeSafeClient,
  type TypeSafeClientConfig,
} from "@typesafe-ai/sdk";
import {
  JudgmentBadResponse,
  JudgmentConnectionError,
  JudgmentRateLimited,
  JudgmentTimeout,
  JudgmentUnauthorized,
  type JudgmentBackend,
  type JudgmentConfig,
  type JudgmentError,
} from "../types.js";
import { fromSdkResult, toSdkEntry, toSdkQuestions } from "../translate.js";

const toJudgmentError = (cause: unknown): JudgmentError => {
  if (cause instanceof AuthenticationError) {
    return new JudgmentUnauthorized({ message: cause.message });
  }
  if (cause instanceof RateLimitError) {
    return new JudgmentRateLimited({ message: cause.message, retryAfterMs: cause.retryAfterMs });
  }
  if (cause instanceof APITimeoutError) {
    return new JudgmentTimeout({ message: cause.message, timeoutMs: cause.timeoutMs });
  }
  if (cause instanceof APIConnectionError) {
    return new JudgmentConnectionError({ message: cause.message });
  }
  if (cause instanceof APIError) {
    return new JudgmentBadResponse({ message: `HTTP ${cause.status}: ${cause.message}` });
  }
  return new JudgmentBadResponse({ message: cause instanceof Error ? cause.message : String(cause) });
};

/**
 * `JudgmentBackend` over `@typesafe-ai/sdk`'s Jev model. Construct once per
 * `JudgmentConfig` (the SDK client is reused across calls). Tests inject a
 * fake `fetch` via `config` (the SDK's own supported test seam — see
 * `TypeSafeClientConfig.fetch`), never a bespoke transport wrapper.
 */
export const makeJevBackend = (
  config: JudgmentConfig & {
    readonly fetch?: TypeSafeClientConfig["fetch"];
    /** SDK-level retry override (Task 0 Step 2: `JudgmentService` never double-retries — configure it here, not in the service). */
    readonly retry?: TypeSafeClientConfig["retry"];
  } = {},
): JudgmentBackend => {
  const client = new TypeSafeClient({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    defaultModel: config.model,
    timeout: config.timeoutMs,
    retry: config.retry,
    fetch: config.fetch,
  });

  return {
    name: "jev",
    evaluate: ({ state, questions, model }) => {
      const questionIds = Object.keys(questions);
      return Effect.tryPromise({
        try: () =>
          client.systemOne({
            state: toSdkEntry(state),
            questions: toSdkQuestions(questions),
            model,
          }),
        catch: toJudgmentError,
      }).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => fromSdkResult(result, questionIds),
            catch: (cause) =>
              new JudgmentBadResponse({
                message: cause instanceof Error ? cause.message : String(cause),
              }),
          }),
        ),
      );
    },
  };
};
