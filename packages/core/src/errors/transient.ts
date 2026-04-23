import { Data } from "effect";

/**
 * Transient failure — the fault is environmental (network blip, flaky
 * endpoint, transient DNS). Retryable with exponential backoff.
 *
 * Retry rule default: 2-3 attempts, linear or exponential backoff.
 *
 * @see isRetryable — returns true
 */
export class TransientError extends Data.TaggedError("TransientError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * LLM request exceeded the client-side timeout. The LLM MAY still have
 * been working when the timeout fired, so retry is only safe for
 * idempotent tools (see `ToolDefinition.idempotent`). Retry policy
 * short-circuits on non-idempotent tools.
 */
export class LLMTimeoutError extends Data.TaggedError("LLMTimeoutError")<{
  readonly elapsedMs: number;
  readonly message: string;
}> {}
