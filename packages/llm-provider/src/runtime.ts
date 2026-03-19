import { Effect, Layer } from "effect";
import { LLMConfig, LLMConfigFromEnv, llmConfigFromEnv } from "./llm-config.js";
import { LLMService } from "./llm-service.js";
import { AnthropicProviderLive } from "./providers/anthropic.js";
import { OpenAIProviderLive } from "./providers/openai.js";
import { LocalProviderLive } from "./providers/local.js";
import { GeminiProviderLive } from "./providers/gemini.js";
import { LiteLLMProviderLive } from "./providers/litellm.js";
import { PromptManagerLive } from "./prompt-manager.js";
import { TestLLMServiceLayer } from "./testing.js";
import type { TestTurn } from "./testing.js";
import { makeEmbeddingCache } from "./embedding-cache.js";
import { makeCircuitBreaker } from "./circuit-breaker.js";
import type { CircuitBreakerConfig } from "./retry.js";

/**
 * Layer that wraps the underlying LLMService.embed() with a content-hash
 * deduplication cache. Identical texts get cached embeddings without an API call.
 */
const EmbeddingCacheLayer = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const cache = makeEmbeddingCache(llm.embed);
    return LLMService.of({ ...llm, embed: cache.embed });
  }),
);

/**
 * Layer that wraps LLMService.complete() and stream() with a circuit breaker.
 * After N consecutive failures, fast-fails without hitting the provider.
 */
const makeCircuitBreakerLayer = (config?: Partial<CircuitBreakerConfig>) =>
  Layer.effect(
    LLMService,
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const breaker = makeCircuitBreaker(config);
      return LLMService.of({
        ...llm,
        complete: (req) => breaker.protect(llm.complete(req)),
        stream: (req) => breaker.protect(llm.stream(req)),
      });
    }),
  );
/**
 * Create the LLM provider layer for a specific provider.
 * Uses env vars for configuration by default.
 */
export const createLLMProviderLayer = (
  provider: "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test" = "anthropic",
  testScenario?: TestTurn[],
  model?: string,
  modelParams?: { thinking?: boolean; temperature?: number; maxTokens?: number },
  circuitBreaker?: Partial<CircuitBreakerConfig>,
  pricingRegistry?: Record<string, { readonly input: number; readonly output: number }>,
) => {
  if (provider === "test") {
    return Layer.mergeAll(
      TestLLMServiceLayer(testScenario ?? [{ text: "" }]),
      PromptManagerLive,
    );
  }

  const configOverrides: Record<string, unknown> = {};
  if (model) configOverrides.defaultModel = model;
  if (modelParams?.thinking !== undefined) configOverrides.thinking = modelParams.thinking;
  if (modelParams?.temperature !== undefined) configOverrides.defaultTemperature = modelParams.temperature;
  if (modelParams?.maxTokens !== undefined) configOverrides.defaultMaxTokens = modelParams.maxTokens;
  if (pricingRegistry) configOverrides.pricingRegistry = pricingRegistry;

  const configLayer = Object.keys(configOverrides).length > 0
    ? Layer.succeed(LLMConfig, LLMConfig.of({ ...llmConfigFromEnv, ...configOverrides }))
    : LLMConfigFromEnv;

  const providerLayer =
    provider === "anthropic"
      ? AnthropicProviderLive
      : provider === "openai"
        ? OpenAIProviderLive
        : provider === "gemini"
          ? GeminiProviderLive
          : provider === "litellm"
            ? LiteLLMProviderLive
            : LocalProviderLive;

  const baseProviderLayer = providerLayer.pipe(Layer.provide(configLayer));

  // Stack: provider → circuit breaker (optional) → embedding cache
  let llmLayer = EmbeddingCacheLayer.pipe(Layer.provide(baseProviderLayer));
  if (circuitBreaker) {
    llmLayer = EmbeddingCacheLayer.pipe(
      Layer.provide(makeCircuitBreakerLayer(circuitBreaker).pipe(Layer.provide(baseProviderLayer))),
    );
  }

  return Layer.mergeAll(llmLayer, PromptManagerLive);
};

/**
 * LLM layer with custom config (for programmatic use).
 */
export const createLLMProviderLayerWithConfig = (
  config: typeof LLMConfig.Service,
  provider: "anthropic" | "openai" | "ollama" | "gemini" | "litellm" = "anthropic",
) => {
  const configLayer = Layer.succeed(LLMConfig, config);

  const providerLayer =
    provider === "anthropic"
      ? AnthropicProviderLive
      : provider === "openai"
        ? OpenAIProviderLive
        : provider === "gemini"
          ? GeminiProviderLive
          : provider === "litellm"
            ? LiteLLMProviderLive
            : LocalProviderLive;

  const baseProviderLayer = providerLayer.pipe(Layer.provide(configLayer));

  return Layer.mergeAll(
    EmbeddingCacheLayer.pipe(Layer.provide(baseProviderLayer)),
    PromptManagerLive,
  );
};
