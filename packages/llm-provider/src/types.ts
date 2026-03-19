import { Schema } from "effect";

// ─── LLM Provider Type ───

/**
 * Schema for LLM provider selection.
 * Supported providers: anthropic, openai, ollama, gemini, litellm, custom.
 *
 * @example
 * ```typescript
 * const provider: LLMProvider = "anthropic";
 * ```
 */
export const LLMProviderType = Schema.Literal(
  /** Claude models via Anthropic API. Requires ANTHROPIC_API_KEY. */
  "anthropic",
  /** GPT models via OpenAI API. Requires OPENAI_API_KEY. */
  "openai",
  /** Local models via Ollama. Requires a running Ollama server. */
  "ollama",
  /** Google Gemini models. Requires GOOGLE_API_KEY. */
  "gemini",
  /** LiteLLM proxy — unified gateway to 40+ model providers. */
  "litellm",
  /** User-defined provider adapter — implement the LLMService interface. */
  "custom",
);

/**
 * Union of supported LLM provider names.
 * - "anthropic": Claude models via Anthropic API
 * - "openai": GPT models via OpenAI API
 * - "ollama": Local models via Ollama
 * - "gemini": Google Gemini models
 * - "litellm": LiteLLM proxy (40+ model providers)
 * - "custom": User-defined provider adapter
 */
export type LLMProvider = Schema.Schema.Type<typeof LLMProviderType>;

// ─── Embedding Configuration ───

/**
 * Schema for embedding model configuration.
 * Embeddings are used for semantic caching, memory similarity search, and verification.
 * Anthropic provides no embeddings API; embeddings always route to OpenAI or Ollama.
 *
 * @example
 * ```typescript
 * const config: EmbeddingConfig = {
 *   model: "text-embedding-3-small",
 *   dimensions: 1536,
 *   provider: "openai",
 *   batchSize: 100
 * };
 * ```
 */
export const EmbeddingConfigSchema = Schema.Struct({
  /** Embedding model name (e.g., "text-embedding-3-small") */
  model: Schema.String,
  /** Output embedding vector dimensionality */
  dimensions: Schema.Number,
  /** Provider hosting the embedding model */
  provider: Schema.Literal("openai", "ollama"),
  /** Maximum vectors to embed in a single API call (default: 100) */
  batchSize: Schema.optional(Schema.Number),
});

/**
 * Embedding configuration type.
 * Specifies the embedding model and provider for semantic operations.
 */
export type EmbeddingConfig = Schema.Schema.Type<typeof EmbeddingConfigSchema>;

/**
 * Default embedding configuration.
 * Uses OpenAI's text-embedding-3-small with 1536 dimensions.
 *
 * @default { model: "text-embedding-3-small", dimensions: 1536, provider: "openai", batchSize: 100 }
 */
export const DefaultEmbeddingConfig: EmbeddingConfig = {
  model: "text-embedding-3-small",
  dimensions: 1536,
  provider: "openai",
  batchSize: 100,
};

// ─── Model Configuration ───

/**
 * Schema for LLM model configuration options.
 * Includes provider, model name, and optional sampling/output parameters.
 *
 * @example
 * ```typescript
 * const config: ModelConfig = {
 *   provider: "anthropic",
 *   model: "claude-opus-4-20250514",
 *   maxTokens: 4096,
 *   temperature: 0.7
 * };
 * ```
 */
export const ModelConfigSchema = Schema.Struct({
  /** LLM provider identifier */
  provider: LLMProviderType,
  /** Model name/identifier for the provider */
  model: Schema.String,
  /** Maximum tokens in response (optional) */
  maxTokens: Schema.optional(Schema.Number),
  /** Sampling temperature 0.0-1.0 (optional) */
  temperature: Schema.optional(Schema.Number),
  /** Top-p (nucleus) sampling probability (optional) */
  topP: Schema.optional(Schema.Number),
  /** Stop sequences to halt generation (optional) */
  stopSequences: Schema.optional(Schema.Array(Schema.String)),
});

/**
 * LLM model configuration type.
 * Specifies which LLM to use and how to configure its behavior.
 */
export type ModelConfig = Schema.Schema.Type<typeof ModelConfigSchema>;

// ─── Model Presets ───

/**
 * Pre-configured model profiles for popular LLMs.
 * Each preset includes cost estimates, context window, and quality tiers.
 * Quality tier: 0.0 (low) to 1.0 (highest).
 * Cost: per 1 million input/output tokens in USD.
 *
 * @example
 * ```typescript
 * const preset = ModelPresets["claude-opus"];
 * // { provider: "anthropic", model: "claude-opus-4-20250514", costPer1MInput: 15.0, ... }
 * ```
 */
export const ModelPresets = {
  /**
   * Claude 3.5 Haiku — fast, cost-effective Anthropic model.
   * Best for low-latency, simple reasoning tasks; not recommended for complex analysis.
   */
  "claude-haiku": {
    provider: "anthropic" as const,
    model: "claude-3-5-haiku-20241022",
    /** Cost per 1 million input tokens in USD */
    costPer1MInput: 1.0,
    /** Cost per 1 million output tokens in USD */
    costPer1MOutput: 5.0,
    /** Maximum context window in tokens */
    maxContext: 200_000,
    /** Quality tier (0.6 = reliable for simple tasks) */
    quality: 0.6,
  },
  /**
   * Claude Sonnet 4 — balanced Anthropic model.
   * Recommended for general-purpose reasoning, tool use, and production agents.
   */
  "claude-sonnet": {
    provider: "anthropic" as const,
    model: "claude-sonnet-4-20250514",
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
    maxContext: 200_000,
    /** Quality tier (0.85 = excellent reasoning) */
    quality: 0.85,
  },
  /**
   * Claude Sonnet 4.5 — latest Anthropic model.
   * Superior reasoning over Sonnet 4; recommended for complex multi-step reasoning.
   */
  "claude-sonnet-4-5": {
    provider: "anthropic" as const,
    model: "claude-sonnet-4-5-20250929",
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
    maxContext: 200_000,
    /** Quality tier (0.9 = very strong reasoning) */
    quality: 0.9,
  },
  /**
   * Claude Opus 4 — most capable Anthropic model.
   * Best for complex analysis, research, and high-accuracy multi-hop reasoning.
   * Largest context window (1M tokens); highest cost.
   */
  "claude-opus": {
    provider: "anthropic" as const,
    model: "claude-opus-4-20250514",
    costPer1MInput: 15.0,
    costPer1MOutput: 75.0,
    maxContext: 1_000_000,
    /** Quality tier (1.0 = frontier-class reasoning) */
    quality: 1.0,
  },
  /**
   * GPT-4o Mini — fast, low-cost OpenAI model.
   * Good for simple tasks and high-throughput scenarios.
   */
  "gpt-4o-mini": {
    provider: "openai" as const,
    model: "gpt-4o-mini",
    costPer1MInput: 0.15,
    costPer1MOutput: 0.6,
    maxContext: 128_000,
    /** Quality tier (0.55 = capable but less reliable for complex reasoning) */
    quality: 0.55,
  },
  /**
   * GPT-4o — latest OpenAI flagship model.
   * Strong reasoning, multimodal support; recommended for tool use and complex analysis.
   */
  "gpt-4o": {
    provider: "openai" as const,
    model: "gpt-4o",
    costPer1MInput: 2.5,
    costPer1MOutput: 10.0,
    maxContext: 128_000,
    /** Quality tier (0.8 = very good reasoning) */
    quality: 0.8,
  },
  /**
   * Gemini 2.0 Flash — fast Google model.
   * Excellent speed and cost efficiency; large 1M context window.
   */
  "gemini-2.0-flash": {
    provider: "gemini" as const,
    model: "gemini-2.0-flash",
    costPer1MInput: 0.1,
    costPer1MOutput: 0.4,
    maxContext: 1_000_000,
    /** Quality tier (0.75 = good reasoning) */
    quality: 0.75,
  },
  /**
   * Gemini 2.5 Pro Preview — advanced Google model.
   * Superior reasoning to Flash; large context window and competitive pricing.
   */
  "gemini-2.5-pro": {
    provider: "gemini" as const,
    model: "gemini-2.5-pro-preview-03-25",
    costPer1MInput: 1.25,
    costPer1MOutput: 10.0,
    maxContext: 1_000_000,
    /** Quality tier (0.95 = excellent reasoning) */
    quality: 0.95,
  },
} as const;

/**
 * Union of all model preset names.
 * Use to select a pre-configured model with cost/quality/context metadata.
 *
 * @example
 * ```typescript
 * const presetName: ModelPresetName = "claude-opus";
 * const preset = ModelPresets[presetName];
 * ```
 */
export type ModelPresetName = keyof typeof ModelPresets;

// ─── Cache Control (Anthropic Prompt Caching) ───

/**
 * Schema for Anthropic prompt caching control.
 * Currently only supports "ephemeral" type (cache for this request only).
 * Non-Anthropic providers silently ignore cache_control directives.
 *
 * @example
 * ```typescript
 * const cacheControl: CacheControl = { type: "ephemeral" };
 * ```
 */
export const CacheControlSchema = Schema.Struct({
  /** Cache type: "ephemeral" for request-scoped caching */
  type: Schema.Literal("ephemeral"),
});

/**
 * Anthropic prompt caching configuration.
 * Wraps text content blocks to enable prompt caching optimization.
 * Reduces costs for repeated context; only supported on Anthropic provider.
 */
export type CacheControl = Schema.Schema.Type<typeof CacheControlSchema>;

// ─── Content Blocks ───

/**
 * Schema for image source reference.
 * Supports base64-encoded or URL-referenced images in PNG, JPEG, GIF, or WebP format.
 *
 * @example
 * ```typescript
 * const source: ImageSource = {
 *   type: "base64",
 *   media_type: "image/png",
 *   data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
 * };
 * ```
 */
export const ImageSourceSchema = Schema.Struct({
  /** Image source type: "base64" for encoded data or "url" for HTTP(S) URL */
  type: Schema.Literal("base64", "url"),
  /** MIME type of image: PNG, JPEG, GIF, or WebP */
  media_type: Schema.Literal(
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ),
  /** Either base64-encoded data or HTTPS URL */
  data: Schema.String,
});

/**
 * Image source reference type.
 * Either a base64-encoded image or an HTTPS URL to an image resource.
 */
export type ImageSource = Schema.Schema.Type<typeof ImageSourceSchema>;

/**
 * Schema for text content blocks.
 * Supports optional Anthropic prompt caching via cache_control.
 *
 * @example
 * ```typescript
 * const textBlock: TextContentBlock = {
 *   type: "text",
 *   text: "This is a text message"
 * };
 * ```
 */
export const TextContentBlockSchema = Schema.Struct({
  /** Content type identifier */
  type: Schema.Literal("text"),
  /** Text content */
  text: Schema.String,
  /** Optional Anthropic cache control directive */
  cache_control: Schema.optional(CacheControlSchema),
});

/**
 * Schema for image content blocks.
 *
 * @example
 * ```typescript
 * const imageBlock: ImageContentBlock = {
 *   type: "image",
 *   source: { type: "url", media_type: "image/png", data: "https://..." }
 * };
 * ```
 */
export const ImageContentBlockSchema = Schema.Struct({
  /** Content type identifier */
  type: Schema.Literal("image"),
  /** Image source reference */
  source: ImageSourceSchema,
});

/**
 * Schema for tool use content blocks (model invoking a tool).
 *
 * @example
 * ```typescript
 * const toolBlock: ToolUseContentBlock = {
 *   type: "tool_use",
 *   id: "toolu_123",
 *   name: "file-read",
 *   input: { path: "./output.txt" }
 * };
 * ```
 */
export const ToolUseContentBlockSchema = Schema.Struct({
  /** Content type identifier */
  type: Schema.Literal("tool_use"),
  /** Unique tool call identifier */
  id: Schema.String,
  /** Tool name being invoked */
  name: Schema.String,
  /** Tool parameters (JSON-compatible object) */
  input: Schema.Unknown,
});

/**
 * Schema for tool result content blocks (system returning tool output).
 *
 * @example
 * ```typescript
 * const resultBlock: ToolResultContentBlock = {
 *   type: "tool_result",
 *   tool_use_id: "toolu_123",
 *   content: "File contents..."
 * };
 * ```
 */
export const ToolResultContentBlockSchema = Schema.Struct({
  /** Content type identifier */
  type: Schema.Literal("tool_result"),
  /** ID of tool call this result corresponds to */
  tool_use_id: Schema.String,
  /** Tool result/output content */
  content: Schema.String,
});

/**
 * Union of all content block types used in LLM messages.
 * Content blocks allow mixing text, images, tool invocations, and tool results.
 *
 * @example
 * ```typescript
 * const blocks: readonly ContentBlock[] = [
 *   { type: "text", text: "Analyze this image:" },
 *   { type: "image", source: { type: "url", media_type: "image/png", data: "https://..." } }
 * ];
 * ```
 */
export type ContentBlock =
  | {
      /** Text content (optionally cached with Anthropic) */
      readonly type: "text";
      readonly text: string;
      readonly cache_control?: CacheControl;
    }
  | {
      /** Image content */
      readonly type: "image";
      readonly source: ImageSource;
    }
  | {
      /** Model invoking a tool */
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }
  | {
      /** System returning tool output */
      readonly type: "tool_result";
      readonly tool_use_id: string;
      readonly content: string;
    };

// ─── Cacheable Content Block ───

/**
 * Text content block with cache control enabled.
 * Used when text context should be cached for cost reduction (Anthropic only).
 * Non-Anthropic providers silently ignore the cache_control directive.
 *
 * @example
 * ```typescript
 * const cached: CacheableContentBlock = {
 *   type: "text",
 *   text: "Expensive context (system prompt, instructions, etc)",
 *   cache_control: { type: "ephemeral" }
 * };
 * ```
 */
export type CacheableContentBlock = {
  /** Always "text" */
  readonly type: "text";
  /** Cached text content */
  readonly text: string;
  /** Cache control directive (always ephemeral) */
  readonly cache_control: CacheControl;
};

/**
 * Wrap plain text in a cacheable content block.
 * Enables Anthropic prompt caching for the given text (no-op for other providers).
 * Useful for repeated context like system prompts, instructions, or reference documents.
 *
 * @param text — The text to cache
 * @returns A content block with ephemeral cache control enabled
 *
 * @example
 * ```typescript
 * const cached = makeCacheable("You are a helpful assistant...");
 * // Returns: { type: "text", text: "...", cache_control: { type: "ephemeral" } }
 * ```
 */
export const makeCacheable = (text: string): CacheableContentBlock => ({
  type: "text",
  text,
  cache_control: { type: "ephemeral" },
});

// ─── Message Types ───

/**
 * Union of LLM message roles.
 * Each message has a role (system, user, assistant, tool) and content.
 *
 * - **system**: Instructions/context set by the agent developer. Content is always a string.
 * - **user**: User query or context provided by caller. Content is string or content blocks.
 * - **assistant**: Model response or thoughts. Content is string or content blocks (including tool_use).
 * - **tool**: Tool execution result returned to model. Content is always string.
 *
 * @example
 * ```typescript
 * const messages: readonly LLMMessage[] = [
 *   { role: "system", content: "You are a helpful assistant." },
 *   { role: "user", content: "What is 2+2?" },
 *   { role: "assistant", content: "2+2 equals 4." }
 * ];
 *
 * const withTools: readonly LLMMessage[] = [
 *   { role: "user", content: "Read the file." },
 *   {
 *     role: "assistant",
 *     content: [
 *       { type: "text", text: "I'll read that file for you." },
 *       { type: "tool_use", id: "toolu_1", name: "file-read", input: { path: "./data.txt" } }
 *     ]
 *   },
 *   { role: "tool", toolCallId: "toolu_1", content: "File contents here..." }
 * ];
 * ```
 */
export type LLMMessage =
  | {
      /** System prompt/instructions — context set by developer */
      readonly role: "system";
      /** Plain text string only (no content blocks) */
      readonly content: string;
    }
  | {
      /** User input/query */
      readonly role: "user";
      /** Plain text or multimodal content blocks */
      readonly content: string | readonly ContentBlock[];
    }
  | {
      /** Model response or reasoning */
      readonly role: "assistant";
      /** Plain text or multimodal content blocks (including tool_use) */
      readonly content: string | readonly ContentBlock[];
    }
  | {
      /** Tool execution result */
      readonly role: "tool";
      /** Tool call ID this result corresponds to */
      readonly toolCallId: string;
      /** Plain text result/output */
      readonly content: string;
    };

// ─── Token Usage ───

/**
 * Schema for token usage statistics from an LLM response.
 * Used for cost tracking, budget enforcement, and observability.
 *
 * @example
 * ```typescript
 * const usage: TokenUsage = {
 *   inputTokens: 1200,
 *   outputTokens: 450,
 *   totalTokens: 1650,
 *   estimatedCost: 0.0045
 * };
 * ```
 */
/**
 * Schema for token usage statistics from an LLM response.
 * Used for cost tracking, budget enforcement, and observability.
 */
export const TokenUsageSchema = Schema.Struct({
  /** Tokens consumed by the input (messages + system prompt) */
  inputTokens: Schema.Number,
  /** Tokens generated in the response */
  outputTokens: Schema.Number,
  /** Sum of input and output tokens */
  totalTokens: Schema.Number,
  /** Estimated cost in USD based on provider pricing */
  estimatedCost: Schema.Number,
});

/**
 * Token usage from an LLM response.
 * Tracks input/output tokens separately for cost calculation.
 */
export type TokenUsage = Schema.Schema.Type<typeof TokenUsageSchema>;

// ─── Stop Reason ───

/**
 * Schema for LLM response termination reason.
 * Indicates why the model stopped generating tokens.
 *
 * @example
 * ```typescript
 * const reason: StopReason = "end_turn"; // Model concluded naturally
 * const reason2: StopReason = "max_tokens"; // Hit output limit
 * ```
 */
export const StopReasonSchema = Schema.Literal(
  /** Model concluded naturally — full response present. */
  "end_turn",
  /** Hit `maxTokens` limit — response may be truncated. */
  "max_tokens",
  /** Hit a configured stop sequence — generation halted by design. */
  "stop_sequence",
  /** Model is invoking a tool — `toolCalls` array is populated. */
  "tool_use",
);

/**
 * Reason the LLM stopped generating.
 *
 * - **end_turn**: Model concluded naturally — response is complete.
 * - **max_tokens**: Hit configured output token limit — response may be truncated.
 * - **stop_sequence**: Hit a configured stop sequence — generation halted by design.
 * - **tool_use**: Model is invoking a tool — `toolCalls` array is populated.
 */
export type StopReason = Schema.Schema.Type<typeof StopReasonSchema>;

// ─── Tool Definition ───

/**
 * Schema for tool definitions.
 * Describes tools available to the LLM, including name, description, and input schema.
 * Tools are passed to the LLM for function calling / tool use.
 *
 * @example
 * ```typescript
 * const tool: ToolDefinition = {
 *   name: "file-read",
 *   description: "Read a file from disk",
 *   inputSchema: {
 *     path: { type: "string", description: "File path", required: true }
 *   }
 * };
 * ```
 */
export const ToolDefinitionSchema = Schema.Struct({
  /** Tool identifier (used by model to invoke the tool) */
  name: Schema.String,
  /** Human-readable tool description for the model */
  description: Schema.String,
  /** Input schema describing expected parameters (JSON Schema format) */
  inputSchema: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

/**
 * Tool definition.
 * Used to register available functions that the LLM can call.
 * Input schema is a JSON Schema object defining parameters.
 */
export type ToolDefinition = Schema.Schema.Type<typeof ToolDefinitionSchema>;

// ─── Tool Call ───

/**
 * Schema for tool invocation.
 * Emitted by the model when it decides to call a tool.
 *
 * @example
 * ```typescript
 * const call: ToolCall = {
 *   id: "toolu_123",
 *   name: "file-read",
 *   input: { path: "./output.txt" }
 * };
 * ```
 */
export const ToolCallSchema = Schema.Struct({
  /** Unique tool call identifier (generated by model) */
  id: Schema.String,
  /** Tool name to invoke */
  name: Schema.String,
  /** Tool input parameters (arbitrary JSON-compatible object) */
  input: Schema.Unknown,
});

/**
 * Tool invocation from the LLM.
 * When the model decides to call a tool, this describes which tool and with what inputs.
 */
export type ToolCall = Schema.Schema.Type<typeof ToolCallSchema>;

// ─── Token Log Probabilities ───

/**
 * Log probability information for a single token.
 * Returned by providers that support logprobs (OpenAI, Ollama).
 *
 * @example
 * ```typescript
 * const logprob: TokenLogprob = {
 *   token: "Paris",
 *   logprob: -0.0234,
 *   topLogprobs: [
 *     { token: "Paris", logprob: -0.0234 },
 *     { token: "London", logprob: -3.89 },
 *   ]
 * };
 * ```
 */
export type TokenLogprob = {
  readonly token: string;
  readonly logprob: number;
  readonly topLogprobs?: readonly { token: string; logprob: number }[];
};

// ─── Completion Request ───

/**
 * Request to the LLM for a completion.
 * Includes messages, model configuration, tool definitions, and sampling parameters.
 * Passed to LLMService.complete() for synchronous LLM calls.
 *
 * @see CompletionResponse — the response type returned by LLMService.complete()
 * @see ToolDefinition — shape of entries in the `tools` array
 * @see ModelConfig — shape of the `model` field
 *
 * @example
 * ```typescript
 * const request: CompletionRequest = {
 *   messages: [
 *     { role: "system", content: "You are a helpful assistant." },
 *     { role: "user", content: "What is the capital of France?" }
 *   ],
 *   model: { provider: "anthropic", model: "claude-opus-4-20250514" },
 *   maxTokens: 1024,
 *   temperature: 0.7,
 *   tools: [
 *     { name: "web-search", description: "Search the web", inputSchema: { query: { type: "string" } } }
 *   ]
 * };
 * ```
 */
export type CompletionRequest = {
  /** Conversation history (at least 1 message required) */
  readonly messages: readonly LLMMessage[];
  /** Model config (provider + model name + optional sampling params) */
  readonly model?: ModelConfig;
  /** Maximum response tokens (optional, uses config default if omitted) */
  readonly maxTokens?: number;
  /** Sampling temperature 0.0-1.0 (optional, uses config default if omitted) */
  readonly temperature?: number;
  /** Stop sequences to halt generation (optional) */
  readonly stopSequences?: readonly string[];
  /** Tools available for the model to call (optional) */
  readonly tools?: readonly ToolDefinition[];
  /** System prompt (optional, prepended to user messages) */
  readonly systemPrompt?: string;
  /** Request log probabilities for each output token (optional) */
  readonly logprobs?: boolean;
  /** Number of most likely tokens to return log probabilities for (optional, 1-20) */
  readonly topLogprobs?: number;
};

// ─── Completion Response ───

/**
 * Schema for LLM response.
 * Contains the generated content, stop reason, token usage, and any tool calls.
 *
 * @example
 * ```typescript
 * const response: CompletionResponse = {
 *   content: "The capital of France is Paris.",
 *   stopReason: "end_turn",
 *   usage: { inputTokens: 120, outputTokens: 15, totalTokens: 135, estimatedCost: 0.00041 },
 *   model: "claude-opus-4-20250514",
 *   toolCalls: undefined
 * };
 * ```
 */
export const CompletionResponseSchema = Schema.Struct({
  /** Generated response content (text only, no content blocks) */
  content: Schema.String,
  /** Why the model stopped generating */
  stopReason: StopReasonSchema,
  /** Token usage statistics */
  usage: TokenUsageSchema,
  /** Actual model identifier used (may differ from request) */
  model: Schema.String,
  /** Tool calls emitted by the model (if any) */
  toolCalls: Schema.optional(Schema.Array(ToolCallSchema)),
  /** Internal reasoning from thinking models (e.g. <think> blocks from qwen3, DeepSeek-R1) */
  thinking: Schema.optional(Schema.String),
  /** Token-level log probabilities (when requested via logprobs in CompletionRequest) */
  logprobs: Schema.optional(
    Schema.Array(
      Schema.Struct({
        token: Schema.String,
        logprob: Schema.Number,
        topLogprobs: Schema.optional(
          Schema.Array(
            Schema.Struct({
              token: Schema.String,
              logprob: Schema.Number,
            }),
          ),
        ),
      }),
    ),
  ),
});

/**
 * LLM response to a completion request.
 * Contains generated text, stop reason, usage metrics, and optional tool calls.
 *
 * @see CompletionRequest — the request type passed to LLMService.complete()
 * @see StopReason — possible values for the `stopReason` field
 * @see TokenUsage — shape of the `usage` field
 * @see ToolCall — shape of entries in the optional `toolCalls` array
 */
export type CompletionResponse = Schema.Schema.Type<
  typeof CompletionResponseSchema
>;

// ─── Stream Events ───

/**
 * Events streamed during an LLM response.
 * Used when streaming responses rather than waiting for full completion.
 * Events arrive in sequence: text_delta(s), then tool_use_start/delta(s) if applicable, then content_complete, then usage.
 *
 * @example
 * ```typescript
 * const events: StreamEvent[] = [
 *   { type: "text_delta", text: "The " },
 *   { type: "text_delta", text: "capital " },
 *   { type: "text_delta", text: "is Paris." },
 *   { type: "content_complete", content: "The capital is Paris." },
 *   { type: "usage", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60, estimatedCost: 0.00018 } }
 * ];
 * ```
 */
export type StreamEvent =
  | {
      /** Text chunk arriving */
      readonly type: "text_delta";
      /** Text chunk content */
      readonly text: string;
    }
  | {
      /** Tool invocation starting */
      readonly type: "tool_use_start";
      /** Unique tool call ID */
      readonly id: string;
      /** Tool name being invoked */
      readonly name: string;
    }
  | {
      /** Tool input parameter chunk arriving */
      readonly type: "tool_use_delta";
      /** JSON parameter chunk (accumulated to form full input) */
      readonly input: string;
    }
  | {
      /** Content generation completed */
      readonly type: "content_complete";
      /** Full accumulated response content */
      readonly content: string;
    }
  | {
      /** Token usage reported */
      readonly type: "usage";
      /** Final token usage for the request */
      readonly usage: TokenUsage;
    }
  | {
      /** Token-level log probabilities (accumulated over the full response) */
      readonly type: "logprobs";
      /** Per-token logprob data */
      readonly logprobs: readonly TokenLogprob[];
    }
  | {
      /** Error occurred during streaming */
      readonly type: "error";
      /** Error message */
      readonly error: string;
    };

// ─── Structured Output Config ───

/**
 * Completion request with structured output validation.
 * Extends CompletionRequest to require the model output conform to a schema.
 * Used when the agent needs guaranteed JSON schema output from the LLM.
 *
 * @see CompletionRequest — base request type this extends
 *
 * @typeParam A — The type that the LLM output must conform to
 *
 * @example
 * ```typescript
 * interface Decision {
 *   readonly choice: "yes" | "no";
 *   readonly confidence: number;
 * }
 *
 * const request: StructuredCompletionRequest<Decision> = {
 *   messages: [{ role: "user", content: "Should I approve this?" }],
 *   outputSchema: Schema.Struct({
 *     choice: Schema.Literal("yes", "no"),
 *     confidence: Schema.Number
 *   }),
 *   maxParseRetries: 2
 * };
 * ```
 */
export type StructuredCompletionRequest<A> = CompletionRequest & {
  /** Schema that the LLM response must conform to */
  readonly outputSchema: Schema.Schema<A>;
  /** If true, retry with corrected prompt if parse fails (default: false) */
  readonly retryOnParseFail?: boolean;
  /** Maximum parse retry attempts before giving up (default: 1) */
  readonly maxParseRetries?: number;
};

// ─── Truncation Strategy ───

/**
 * Strategy for truncating context when it exceeds token budget.
 * Used by ContextWindowManager when compacting message history for token limits.
 *
 * @example
 * ```typescript
 * const strategy: TruncationStrategy = "summarize-middle";
 * ```
 */
export type TruncationStrategy =
  /** Remove oldest messages first (FIFO). Fastest; may lose early context. */
  | "drop-oldest"
  /** Summarize middle messages, preserving system prompt and most recent turns. */
  | "summarize-middle"
  /** Keep only the most recent N messages; drops all prior history. */
  | "sliding-window"
  /** Use heuristics to score and drop least-important messages first. */
  | "importance-based";

// ─── LLM Request Event ───

/**
 * Observability event emitted after every LLM request completes.
 * Captures request/response metadata for metrics, tracing, and cost tracking.
 * Published to EventBus and collected by MetricsCollector.
 *
 * Full request/response payloads included only when LLMConfig.observabilityVerbosity = "full".
 *
 * @see ObservabilityVerbosity — controls whether `fullRequest`/`fullResponse` are populated
 * @see TokenUsage — nested token usage shape in `response.usage`
 *
 * @example
 * ```typescript
 * const event: LLMRequestEvent = {
 *   requestId: "req-123",
 *   provider: "anthropic",
 *   model: "claude-opus-4-20250514",
 *   timestamp: new Date(),
 *   durationMs: 1250,
 *   systemPromptLength: 340,
 *   messageCount: 3,
 *   toolCount: 2,
 *   response: {
 *     contentLength: 156,
 *     stopReason: "end_turn",
 *     toolCallCount: 0,
 *     usage: {
 *       inputTokens: 420,
 *       outputTokens: 45,
 *       totalTokens: 465,
 *       estimatedCost: 0.00195
 *     }
 *   }
 * };
 * ```
 */
export type LLMRequestEvent = {
  /** Unique request identifier for correlating request/response pairs */
  readonly requestId: string;
  /** LLM provider (e.g., "anthropic", "openai") */
  readonly provider: string;
  /** Model name used for the request */
  readonly model: string;
  /** When the request completed */
  readonly timestamp: Date;
  /** Request round-trip time in milliseconds */
  readonly durationMs: number;
  /** Length of system prompt in characters */
  readonly systemPromptLength: number;
  /** Number of messages in the request */
  readonly messageCount: number;
  /** Number of tool definitions passed to the model */
  readonly toolCount: number;
  /** Response details */
  readonly response: {
    /** Length of response content in characters */
    readonly contentLength: number;
    /** Why the model stopped (end_turn, max_tokens, etc.) */
    readonly stopReason: string;
    /** Number of tool calls in response */
    readonly toolCallCount: number;
    /** Token usage metrics */
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly estimatedCost: number;
    };
  };
  /** Complete request payload (only if LLMConfig.observabilityVerbosity = "full") */
  readonly fullRequest?: CompletionRequest;
  /** Complete response payload (only if LLMConfig.observabilityVerbosity = "full") */
  readonly fullResponse?: CompletionResponse;
};

// ─── Observability Verbosity ───

/**
 * Observability verbosity level for LLM request events.
 * Controls what is captured in each `LLMRequestEvent` published to the EventBus.
 *
 * @default "full"
 *
 * @example
 * ```typescript
 * const config = LLMConfig.of({
 *   // ... other fields
 *   observabilityVerbosity: process.env.NODE_ENV === "production" ? "metadata" : "full"
 * });
 * ```
 */
export type ObservabilityVerbosity =
  /** Capture timing, token counts, and cost only — lightweight, production-safe. */
  | "metadata"
  /** Capture complete request/response payloads — higher overhead, useful for debugging. */
  | "full";

// ── Structured Output Capabilities ──

/**
 * Provider-reported capabilities for structured JSON output.
 * Used by the structured output pipeline to select the optimal extraction strategy.
 */
export type StructuredOutputCapabilities = {
  /** Provider supports forcing JSON-only output (OpenAI, Gemini, Ollama) */
  readonly nativeJsonMode: boolean;
  /** Provider can enforce a JSON Schema on the output (OpenAI structured outputs) */
  readonly jsonSchemaEnforcement: boolean;
  /** Provider supports assistant message prefill to start response with "{" (Anthropic) */
  readonly prefillSupport: boolean;
  /** Provider supports GBNF grammar constraints for exact schema matching (Ollama/llama.cpp) */
  readonly grammarConstraints: boolean;
};
