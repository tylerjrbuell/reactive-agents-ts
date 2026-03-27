// File: src/rate-limited-provider.ts
/**
 * Rate-Limited Provider — wraps an existing LLMService with rate limiting.
 *
 * Intercepts `complete()`, `stream()`, and `completeStructured()` calls,
 * acquiring a rate limiter slot before each request and releasing it afterward.
 * Passthrough for `embed()`, `countTokens()`, `getModelConfig()`, and
 * `getStructuredOutputCapabilities()`.
 */
import { Effect, Layer } from "effect";
import type { Context } from "effect";
import { LLMService } from "./llm-service.js";
import type { RateLimiterConfig } from "./rate-limiter.js";
import { makeRateLimiter } from "./rate-limiter.js";

/**
 * Create a Layer that wraps the existing LLMService with rate limiting.
 *
 * The returned layer depends on an upstream LLMService (i.e., it must be
 * `.pipe(Layer.provide(baseLlmLayer))` to resolve the dependency).
 *
 * @example
 * ```typescript
 * const rateLimitedLlm = makeRateLimitedProvider({ requestsPerMinute: 30 })
 *   .pipe(Layer.provide(AnthropicProviderLive));
 * ```
 */
export const makeRateLimitedProvider = (
  config: RateLimiterConfig = {},
): Layer.Layer<LLMService, never, LLMService> =>
  Layer.effect(
    LLMService,
    Effect.gen(function* () {
      const svc = yield* LLMService;
      const limiter = makeRateLimiter(config);

      return {
        complete: (req) =>
          Effect.gen(function* () {
            yield* limiter.acquire(req.messages);
            try {
              return yield* svc.complete(req);
            } finally {
              limiter.release();
            }
          }),

        stream: (req) =>
          Effect.gen(function* () {
            yield* limiter.acquire(req.messages);
            try {
              return yield* svc.stream(req);
            } finally {
              limiter.release();
            }
          }),

        completeStructured: (req) =>
          Effect.gen(function* () {
            yield* limiter.acquire(req.messages);
            try {
              return yield* svc.completeStructured(req);
            } finally {
              limiter.release();
            }
          }),

        // Passthrough — embedding, token counting, config, and capabilities are not rate-limited
        embed: svc.embed,
        countTokens: svc.countTokens,
        getModelConfig: svc.getModelConfig,
        getStructuredOutputCapabilities: svc.getStructuredOutputCapabilities,
        capabilities: svc.capabilities,
      } as Context.Tag.Service<LLMService>;
    }),
  );
