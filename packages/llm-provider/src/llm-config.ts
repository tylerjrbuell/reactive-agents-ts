import { Context, Layer } from "effect";
import type { LLMProvider, EmbeddingConfig, ObservabilityVerbosity } from "./types.js";

/**
 * LLM service configuration.
 * Provides API keys, default model settings, timeouts, and observability verbosity.
 * Typically constructed from environment variables via llmConfigFromEnv.
 *
 * @example
 * ```typescript
 * const config = LLMConfig.of({
 *   defaultProvider: "anthropic",
 *   defaultModel: "claude-opus-4-20250514",
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY,
 *   maxRetries: 3,
 *   timeoutMs: 30000
 * });
 * ```
 */
export class LLMConfig extends Context.Tag("LLMConfig")<
  LLMConfig,
  {
    /**
     * Default LLM provider.
     * Used as fallback when a request does not specify a provider.
     *
     * @default "anthropic"
     */
    readonly defaultProvider: LLMProvider;

    /**
     * Default LLM model identifier.
     * Used as fallback when a request does not specify a model.
     *
     * @default From LLM_DEFAULT_MODEL env var, falls back to "claude-sonnet-4-20250514"
     */
    readonly defaultModel: string;

    /**
     * Anthropic API key.
     * Retrieved from ANTHROPIC_API_KEY environment variable.
     * Required if provider is "anthropic".
     *
     * @default From ANTHROPIC_API_KEY env var (undefined if not set)
     */
    readonly anthropicApiKey?: string;

    /**
     * OpenAI API key.
     * Retrieved from OPENAI_API_KEY environment variable.
     * Required if provider is "openai".
     *
     * @default From OPENAI_API_KEY env var (undefined if not set)
     */
    readonly openaiApiKey?: string;

    /**
     * Google API key.
     * Retrieved from GOOGLE_API_KEY environment variable.
     * Required if provider is "gemini".
     *
     * @default From GOOGLE_API_KEY env var (undefined if not set)
     */
    readonly googleApiKey?: string;

    /**
     * Ollama server endpoint.
     * Retrieved from OLLAMA_ENDPOINT environment variable.
     * Used for local model serving.
     *
     * @default "http://localhost:11434"
     */
    readonly ollamaEndpoint?: string;

    /**
     * Embedding configuration — model, provider, dimensions.
     * Anthropic has no embeddings API; embeddings always route to OpenAI or Ollama.
     * This is the sole embedding config for the entire framework.
     * Used by semantic cache, memory similarity search, and verification layers.
     *
     * @default { model: "text-embedding-3-small", dimensions: 1536, provider: "openai", batchSize: 100 }
     */
    readonly embeddingConfig: EmbeddingConfig;

    /**
     * Enable Anthropic prompt caching.
     * When true, memory context injections and system prompts are wrapped in
     * `cache_control: { type: "ephemeral" }` blocks to reduce costs.
     * Non-Anthropic providers silently ignore cache control directives.
     * Automatically set to true if defaultModel starts with "claude".
     *
     * @default true if defaultModel starts with "claude", false otherwise
     */
    readonly supportsPromptCaching: boolean;

    /**
     * Maximum number of retries for transient LLM request failures.
     * Applied with exponential backoff (2^n seconds between attempts).
     *
     * @default 3
     */
    readonly maxRetries: number;

    /**
     * Request timeout in milliseconds.
     * LLM requests exceeding this duration are aborted.
     *
     * @default 30000 (30 seconds)
     */
    readonly timeoutMs: number;

    /**
     * Enable/disable thinking mode for thinking-capable models.
     * - `true` — Always enable thinking (e.g., qwen3.5, DeepSeek-R1)
     * - `false` — Always disable thinking (e.g., cogito:14b that crashes with think:true)
     * - `undefined` — Auto-detect based on model capabilities (Ollama only)
     *
     * @default undefined (auto-detect)
     */
    readonly thinking?: boolean;

    /**
     * Default maximum output tokens for LLM responses.
     * Used if a CompletionRequest does not specify maxTokens.
     * Set lower for faster responses; higher for longer outputs.
     *
     * @default 4096
     */
    readonly defaultMaxTokens: number;

    /**
     * Default sampling temperature (0.0-1.0).
     * Used if a CompletionRequest does not specify temperature.
     * 0.0 = deterministic; 1.0 = maximum randomness.
     *
     * @default 0.7 (good balance of creativity and coherence)
     */
    readonly defaultTemperature: number;

    /**
     * LLM request/response observability verbosity.
     * Determines what data is captured in LLMRequestEvent for observability.
     *
     * - **"full"**: Capture complete request/response payloads (useful for debugging, higher overhead)
     * - **"metadata"**: Capture only timing, token counts, and cost (lightweight, production-safe)
     *
     * @default "full" (capture everything)
     *
     * @example
     * ```typescript
     * // Development: full details
     * observabilityVerbosity: process.env.NODE_ENV === "production" ? "metadata" : "full"
     * ```
     */
    readonly observabilityVerbosity: ObservabilityVerbosity;
  }
>() {}

/**
 * Raw LLMConfig object constructed from environment variables.
 * Reads all config from process.env with sensible defaults.
 * Exported so callers can spread overrides (e.g. change model) on top.
 *
 * Environment variables:
 * - LLM_DEFAULT_MODEL: Model identifier (default: claude-sonnet-4-20250514)
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - OPENAI_API_KEY: OpenAI API key
 * - GOOGLE_API_KEY: Google API key
 * - OLLAMA_ENDPOINT: Ollama server URL (default: http://localhost:11434)
 * - EMBEDDING_MODEL: Embedding model name (default: text-embedding-3-small)
 * - EMBEDDING_DIMENSIONS: Embedding vector dimensions (default: 1536)
 * - EMBEDDING_PROVIDER: Embedding provider (default: openai)
 * - LLM_MAX_RETRIES: Retry attempts (default: 3)
 * - LLM_TIMEOUT_MS: Request timeout in ms (default: 30000)
 * - LLM_DEFAULT_TEMPERATURE: Sampling temperature (default: 0.7)
 * - LLM_OBSERVABILITY_VERBOSITY: "full" or "metadata" (default: full)
 *
 * @example
 * ```typescript
 * // Use defaults from environment
 * const config = llmConfigFromEnv;
 *
 * // Override specific fields
 * const customConfig = LLMConfig.of({
 *   ...llmConfigFromEnv,
 *   defaultModel: "gpt-4o",
 *   defaultProvider: "openai"
 * });
 * ```
 */
export const llmConfigFromEnv = LLMConfig.of({
  defaultProvider: "anthropic",
  defaultModel:
    process.env.LLM_DEFAULT_MODEL ?? "claude-sonnet-4-20250514",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  googleApiKey: process.env.GOOGLE_API_KEY,
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
  observabilityVerbosity: (process.env.LLM_OBSERVABILITY_VERBOSITY as ObservabilityVerbosity | undefined) ?? "full",
});

/**
 * Effect-TS Layer that provides LLMConfig from environment variables.
 * Use this layer to automatically populate LLMConfig from process.env.
 * Can be overridden with a custom layer for testing or custom configuration.
 *
 * @example
 * ```typescript
 * const effect = Effect.gen(function* () {
 *   const config = yield* LLMConfig;
 *   console.log(config.defaultModel);
 * }).pipe(Effect.provide(LLMConfigFromEnv));
 *
 * Effect.runPromise(effect);
 * ```
 *
 * @see llmConfigFromEnv
 */
export const LLMConfigFromEnv = Layer.succeed(LLMConfig, llmConfigFromEnv);
