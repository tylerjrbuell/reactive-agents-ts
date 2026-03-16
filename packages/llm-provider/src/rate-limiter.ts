// File: src/rate-limiter.ts
/**
 * Rate Limiter — throttles LLM requests BEFORE they hit the API to prevent
 * 429 errors. Uses a sliding window algorithm for both request-per-minute
 * and token-per-minute limits, plus a concurrency semaphore.
 */
import { Effect } from "effect";
import type { LLMMessage } from "./types.js";
import { estimateTokenCount } from "./token-counter.js";

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * Configuration for the rate limiter.
 *
 * @example
 * ```typescript
 * const config: RateLimiterConfig = {
 *   requestsPerMinute: 60,
 *   tokensPerMinute: 100_000,
 *   maxConcurrent: 10,
 * };
 * ```
 */
export interface RateLimiterConfig {
  /** Maximum requests per minute (sliding window). Default: 60 */
  readonly requestsPerMinute?: number;
  /** Maximum estimated input tokens per minute (sliding window). Default: 100,000 */
  readonly tokensPerMinute?: number;
  /** Maximum concurrent in-flight requests. Default: 10 */
  readonly maxConcurrent?: number;
}

const DEFAULT_CONFIG: Required<RateLimiterConfig> = {
  requestsPerMinute: 60,
  tokensPerMinute: 100_000,
  maxConcurrent: 10,
};

// ─── Rate Limiter ────────────────────────────────────────────────────────────

export interface RateLimiter {
  /**
   * Acquire a rate limiter slot. Returns an Effect that resolves when a slot
   * is available. If the limit is hit, the Effect will delay until the oldest
   * entry in the sliding window expires.
   *
   * @param messages - Optional messages to estimate token count for token-based limiting.
   *                   When omitted, only request-count and concurrency limits apply.
   */
  readonly acquire: (
    messages?: readonly LLMMessage[],
  ) => Effect.Effect<void, never>;

  /**
   * Signal that a request has completed (decrements concurrent count).
   * Must be called after every `acquire()` once the request finishes.
   */
  readonly release: () => void;

  /**
   * Current number of in-flight requests.
   */
  readonly concurrentCount: () => number;

  /**
   * Number of requests recorded in the current sliding window.
   */
  readonly windowRequestCount: () => number;

  /**
   * Number of estimated tokens recorded in the current sliding window.
   */
  readonly windowTokenCount: () => number;
}

/**
 * Create a rate limiter with configurable thresholds.
 *
 * Uses a sliding window algorithm: timestamps of recent requests are stored
 * in an array. On `acquire()`, expired entries (older than 60s) are pruned.
 * If the remaining count >= limit, the caller waits until the oldest entry
 * would expire from the window.
 *
 * @example
 * ```typescript
 * const limiter = makeRateLimiter({ requestsPerMinute: 30 });
 * // In an Effect pipeline:
 * yield* limiter.acquire(messages);
 * try {
 *   yield* llm.complete(request);
 * } finally {
 *   limiter.release();
 * }
 * ```
 */
export const makeRateLimiter = (
  config: RateLimiterConfig = {},
): RateLimiter => {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  const WINDOW_MS = 60_000; // 1 minute sliding window

  // Sliding window entries: each entry records { timestamp, estimatedTokens }
  const window: Array<{ ts: number; tokens: number }> = [];
  let concurrent = 0;

  /** Remove entries older than the sliding window. */
  const prune = (now: number) => {
    const cutoff = now - WINDOW_MS;
    while (window.length > 0 && window[0]!.ts <= cutoff) {
      window.shift();
    }
  };

  /** Sum of tokens in current window. */
  const currentTokens = (): number => {
    return window.reduce((sum, entry) => sum + entry.tokens, 0);
  };

  return {
    acquire: (messages?: readonly LLMMessage[]) =>
      Effect.gen(function* () {
        // Estimate token count for this request (if messages provided)
        const estimatedTokens = messages
          ? yield* estimateTokenCount(messages)
          : 0;

        // Retry loop — poll until all limits are satisfied.
        // In practice this loop runs 0-1 times for well-configured limits.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const now = Date.now();
          prune(now);

          // Check concurrency limit
          if (concurrent >= resolved.maxConcurrent) {
            yield* Effect.sleep("100 millis");
            continue;
          }

          // Check requests-per-minute limit
          if (window.length >= resolved.requestsPerMinute) {
            const oldestTs = window[0]!.ts;
            const waitMs = oldestTs + WINDOW_MS - now;
            if (waitMs > 0) {
              yield* Effect.sleep(`${waitMs} millis`);
              continue;
            }
          }

          // Check tokens-per-minute limit
          if (
            estimatedTokens > 0 &&
            currentTokens() + estimatedTokens > resolved.tokensPerMinute &&
            window.length > 0
          ) {
            const oldestTs = window[0]!.ts;
            const waitMs = oldestTs + WINDOW_MS - now;
            if (waitMs > 0) {
              yield* Effect.sleep(`${waitMs} millis`);
              continue;
            }
          }

          // All limits satisfied — record and proceed
          window.push({ ts: now, tokens: estimatedTokens });
          concurrent++;
          return;
        }
      }),

    release: () => {
      if (concurrent > 0) concurrent--;
    },

    concurrentCount: () => concurrent,

    windowRequestCount: () => {
      prune(Date.now());
      return window.length;
    },

    windowTokenCount: () => {
      prune(Date.now());
      return currentTokens();
    },
  };
};
