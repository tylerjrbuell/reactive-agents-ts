import { Effect, Context, type Stream } from "effect";
import type {
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  StructuredCompletionRequest,
  LLMMessage,
  ModelConfig,
} from "./types.js";
import type { LLMErrors } from "./errors.js";

/**
 * Core LLM service — all LLM interactions go through this.
 * Layers 3, 4, 5, and 10 depend on this.
 */
export class LLMService extends Context.Tag("LLMService")<
  LLMService,
  {
    /**
     * Complete a prompt (non-streaming).
     * Returns full response after generation completes.
     */
    readonly complete: (
      request: CompletionRequest,
    ) => Effect.Effect<CompletionResponse, LLMErrors>;

    /**
     * Stream a completion. Returns an Effect that yields a Stream of events.
     * Use for real-time UI updates (collaborative mode).
     */
    readonly stream: (
      request: CompletionRequest,
    ) => Effect.Effect<Stream.Stream<StreamEvent, LLMErrors>, LLMErrors>;

    /**
     * Complete with structured output.
     * Parses LLM response into a typed object using Effect Schema.
     * Retries with parse error feedback if parsing fails.
     */
    readonly completeStructured: <A>(
      request: StructuredCompletionRequest<A>,
    ) => Effect.Effect<A, LLMErrors>;

    /**
     * Generate embeddings for text.
     *
     * This is the SOLE embedding source for the entire framework.
     * Anthropic has no embeddings API — routes to OpenAI or Ollama
     * per LLMConfig.embeddingConfig.
     */
    readonly embed: (
      texts: readonly string[],
      model?: string,
    ) => Effect.Effect<readonly number[][], LLMErrors>;

    /**
     * Count tokens for a set of messages.
     * Used for context window management.
     */
    readonly countTokens: (
      messages: readonly LLMMessage[],
    ) => Effect.Effect<number, LLMErrors>;

    /**
     * Get current model configuration.
     */
    readonly getModelConfig: () => Effect.Effect<ModelConfig, never>;
  }
>() {}
