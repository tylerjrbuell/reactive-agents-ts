// Internal test support — unstable, not part of the public API.
//
// Typed `LLMConfig` builder for provider tests. Tests used to hand-build a
// partial config literal and widen it with a double cast; this fills every
// required field with a neutral default so the compiler checks the rest.

import type { LLMConfig } from "../../src/llm-config.js";

/** The resolved `LLMConfig` service value. */
export type LLMConfigValue = (typeof LLMConfig)["Service"];

/** Build a complete `LLMConfig` value; override only what the test depends on. */
export function makeLLMConfig(overrides: Partial<LLMConfigValue> = {}): LLMConfigValue {
  return {
    defaultProvider: "ollama",
    defaultModel: "test-model",
    embeddingConfig: { model: "nomic-embed-text", dimensions: 1, provider: "ollama" },
    supportsPromptCaching: false,
    maxRetries: 0,
    timeoutMs: 30_000,
    defaultMaxTokens: 128,
    defaultTemperature: 0.1,
    observabilityVerbosity: "metadata",
    pricingRegistry: {},
    ...overrides,
  };
}
