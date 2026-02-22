import { Layer } from "effect";
import { LLMConfig, LLMConfigFromEnv, llmConfigFromEnv } from "./llm-config.js";
import { AnthropicProviderLive } from "./providers/anthropic.js";
import { OpenAIProviderLive } from "./providers/openai.js";
import { LocalProviderLive } from "./providers/local.js";
import { GeminiProviderLive } from "./providers/gemini.js";
import { PromptManagerLive } from "./prompt-manager.js";
import { TestLLMServiceLayer } from "./testing.js";

/**
 * Create the LLM provider layer for a specific provider.
 * Uses env vars for configuration by default.
 */
export const createLLMProviderLayer = (
  provider: "anthropic" | "openai" | "ollama" | "gemini" | "test" = "anthropic",
  testResponses?: Record<string, string>,
  model?: string,
) => {
  if (provider === "test") {
    return Layer.mergeAll(
      TestLLMServiceLayer(testResponses ?? {}),
      PromptManagerLive,
    );
  }

  const configLayer = model
    ? Layer.succeed(LLMConfig, LLMConfig.of({ ...llmConfigFromEnv, defaultModel: model }))
    : LLMConfigFromEnv;

  const providerLayer =
    provider === "anthropic"
      ? AnthropicProviderLive
      : provider === "openai"
        ? OpenAIProviderLive
        : provider === "gemini"
          ? GeminiProviderLive
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
  provider: "anthropic" | "openai" | "ollama" | "gemini" = "anthropic",
) => {
  const configLayer = Layer.succeed(LLMConfig, config);

  const providerLayer =
    provider === "anthropic"
      ? AnthropicProviderLive
      : provider === "openai"
        ? OpenAIProviderLive
        : provider === "gemini"
          ? GeminiProviderLive
          : LocalProviderLive;

  return Layer.mergeAll(
    providerLayer.pipe(Layer.provide(configLayer)),
    PromptManagerLive,
  );
};
