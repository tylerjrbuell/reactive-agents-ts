import { Context, Layer } from "effect";
import type { LLMProvider, EmbeddingConfig } from "./types.js";

/**
 * LLM configuration — provided via environment or config file.
 */
export class LLMConfig extends Context.Tag("LLMConfig")<
  LLMConfig,
  {
    readonly defaultProvider: LLMProvider;
    readonly defaultModel: string;
    readonly anthropicApiKey?: string;
    readonly openaiApiKey?: string;
    readonly ollamaEndpoint?: string;
    /**
     * Embedding configuration. Anthropic has no embeddings API;
     * embeddings route to OpenAI (default) or Ollama.
     * This is the SOLE embedding config for the entire framework.
     */
    readonly embeddingConfig: EmbeddingConfig;
    /**
     * Enable Anthropic prompt caching.
     * When true, memory context injections are wrapped in
     * `cache_control: { type: "ephemeral" }` blocks.
     */
    readonly supportsPromptCaching: boolean;
    readonly maxRetries: number;
    readonly timeoutMs: number;
    readonly defaultMaxTokens: number;
    readonly defaultTemperature: number;
  }
>() {}

/**
 * Build LLMConfig from environment variables.
 */
export const LLMConfigFromEnv = Layer.succeed(
  LLMConfig,
  LLMConfig.of({
    defaultProvider: "anthropic",
    defaultModel:
      process.env.LLM_DEFAULT_MODEL ?? "claude-sonnet-4-20250514",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    ollamaEndpoint:
      process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434",
    embeddingConfig: {
      model: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
      dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 1536),
      provider:
        (process.env.EMBEDDING_PROVIDER as "openai" | "ollama") ?? "openai",
      batchSize: 100,
    },
    supportsPromptCaching: (
      process.env.LLM_DEFAULT_MODEL ?? "claude-sonnet-4-20250514"
    ).startsWith("claude"),
    maxRetries: Number(process.env.LLM_MAX_RETRIES ?? 3),
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 30_000),
    defaultMaxTokens: 4096,
    defaultTemperature: Number(process.env.LLM_DEFAULT_TEMPERATURE ?? 0.7),
  }),
);
