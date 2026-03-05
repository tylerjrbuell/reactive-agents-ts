import { Layer } from "effect";
import { LLMConfig, LLMConfigFromEnv, llmConfigFromEnv } from "./llm-config.js";
import { AnthropicProviderLive } from "./providers/anthropic.js";
import { OpenAIProviderLive } from "./providers/openai.js";
import { LocalProviderLive } from "./providers/local.js";
import { GeminiProviderLive } from "./providers/gemini.js";
import { LiteLLMProviderLive } from "./providers/litellm.js";
import { PromptManagerLive } from "./prompt-manager.js";
import { TestLLMServiceLayer } from "./testing.js";

/**
 * Create the LLM provider layer for a specific provider.
 * Uses env vars for configuration by default.
 */
export const createLLMProviderLayer = (
  provider: "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test" = "anthropic",
  testResponses?: Record<string, string>,
  model?: string,
  modelParams?: { thinking?: boolean; temperature?: number; maxTokens?: number },
) => {
  if (provider === "test") {
    return Layer.mergeAll(
      TestLLMServiceLayer(testResponses ?? {}),
      PromptManagerLive,
    );
  }

  const configOverrides: Record<string, unknown> = {};
  if (model) configOverrides.defaultModel = model;
  if (modelParams?.thinking !== undefined) configOverrides.thinking = modelParams.thinking;
  if (modelParams?.temperature !== undefined) configOverrides.defaultTemperature = modelParams.temperature;
  if (modelParams?.maxTokens !== undefined) configOverrides.defaultMaxTokens = modelParams.maxTokens;

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

  return Layer.mergeAll(
    providerLayer.pipe(Layer.provide(configLayer)),
    PromptManagerLive,
  );
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

  return Layer.mergeAll(
    providerLayer.pipe(Layer.provide(configLayer)),
    PromptManagerLive,
  );
};
