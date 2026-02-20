import { Schema } from "effect";

// ─── LLM Provider Type ───

export const LLMProviderType = Schema.Literal(
  "anthropic",
  "openai",
  "ollama",
  "custom",
);
export type LLMProvider = Schema.Schema.Type<typeof LLMProviderType>;

// ─── Embedding Configuration ───

export const EmbeddingConfigSchema = Schema.Struct({
  model: Schema.String,
  dimensions: Schema.Number,
  provider: Schema.Literal("openai", "ollama"),
  batchSize: Schema.optional(Schema.Number),
});

export type EmbeddingConfig = Schema.Schema.Type<typeof EmbeddingConfigSchema>;

export const DefaultEmbeddingConfig: EmbeddingConfig = {
  model: "text-embedding-3-small",
  dimensions: 1536,
  provider: "openai",
  batchSize: 100,
};

// ─── Model Configuration ───

export const ModelConfigSchema = Schema.Struct({
  provider: LLMProviderType,
  model: Schema.String,
  maxTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  stopSequences: Schema.optional(Schema.Array(Schema.String)),
});

export type ModelConfig = Schema.Schema.Type<typeof ModelConfigSchema>;

// ─── Model Presets ───

export const ModelPresets = {
  "claude-haiku": {
    provider: "anthropic" as const,
    model: "claude-3-5-haiku-20241022",
    costPer1MInput: 1.0,
    costPer1MOutput: 5.0,
    maxContext: 200_000,
    quality: 0.6,
  },
  "claude-sonnet": {
    provider: "anthropic" as const,
    model: "claude-sonnet-4-20250514",
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
    maxContext: 200_000,
    quality: 0.85,
  },
  "claude-sonnet-4-5": {
    provider: "anthropic" as const,
    model: "claude-sonnet-4-5-20250929",
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
    maxContext: 200_000,
    quality: 0.9,
  },
  "claude-opus": {
    provider: "anthropic" as const,
    model: "claude-opus-4-20250514",
    costPer1MInput: 15.0,
    costPer1MOutput: 75.0,
    maxContext: 1_000_000,
    quality: 1.0,
  },
  "gpt-4o-mini": {
    provider: "openai" as const,
    model: "gpt-4o-mini",
    costPer1MInput: 0.15,
    costPer1MOutput: 0.6,
    maxContext: 128_000,
    quality: 0.55,
  },
  "gpt-4o": {
    provider: "openai" as const,
    model: "gpt-4o",
    costPer1MInput: 2.5,
    costPer1MOutput: 10.0,
    maxContext: 128_000,
    quality: 0.8,
  },
} as const;

export type ModelPresetName = keyof typeof ModelPresets;

// ─── Cache Control (Anthropic Prompt Caching) ───

export const CacheControlSchema = Schema.Struct({
  type: Schema.Literal("ephemeral"),
});

export type CacheControl = Schema.Schema.Type<typeof CacheControlSchema>;

// ─── Content Blocks ───

export const ImageSourceSchema = Schema.Struct({
  type: Schema.Literal("base64", "url"),
  media_type: Schema.Literal(
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ),
  data: Schema.String,
});

export type ImageSource = Schema.Schema.Type<typeof ImageSourceSchema>;

export const TextContentBlockSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache_control: Schema.optional(CacheControlSchema),
});

export const ImageContentBlockSchema = Schema.Struct({
  type: Schema.Literal("image"),
  source: ImageSourceSchema,
});

export const ToolUseContentBlockSchema = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
});

export const ToolResultContentBlockSchema = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.String,
  content: Schema.String,
});

export type ContentBlock =
  | {
      readonly type: "text";
      readonly text: string;
      readonly cache_control?: CacheControl;
    }
  | { readonly type: "image"; readonly source: ImageSource }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }
  | {
      readonly type: "tool_result";
      readonly tool_use_id: string;
      readonly content: string;
    };

// ─── Cacheable Content Block ───

export type CacheableContentBlock = {
  readonly type: "text";
  readonly text: string;
  readonly cache_control: CacheControl;
};

/**
 * Helper — wrap text in a cacheable content block.
 * Non-Anthropic providers silently ignore `cache_control`.
 */
export const makeCacheable = (text: string): CacheableContentBlock => ({
  type: "text",
  text,
  cache_control: { type: "ephemeral" },
});

// ─── Message Types ───

export type LLMMessage =
  | { readonly role: "system"; readonly content: string }
  | {
      readonly role: "user";
      readonly content: string | readonly ContentBlock[];
    }
  | {
      readonly role: "assistant";
      readonly content: string | readonly ContentBlock[];
    };

// ─── Token Usage ───

export const TokenUsageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalTokens: Schema.Number,
  estimatedCost: Schema.Number,
});

export type TokenUsage = Schema.Schema.Type<typeof TokenUsageSchema>;

// ─── Stop Reason ───

export const StopReasonSchema = Schema.Literal(
  "end_turn",
  "max_tokens",
  "stop_sequence",
  "tool_use",
);

export type StopReason = Schema.Schema.Type<typeof StopReasonSchema>;

// ─── Tool Definition ───

export const ToolDefinitionSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  inputSchema: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type ToolDefinition = Schema.Schema.Type<typeof ToolDefinitionSchema>;

// ─── Tool Call ───

export const ToolCallSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
});

export type ToolCall = Schema.Schema.Type<typeof ToolCallSchema>;

// ─── Completion Request ───

export type CompletionRequest = {
  readonly messages: readonly LLMMessage[];
  readonly model?: ModelConfig;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly stopSequences?: readonly string[];
  readonly tools?: readonly ToolDefinition[];
  readonly systemPrompt?: string;
};

// ─── Completion Response ───

export const CompletionResponseSchema = Schema.Struct({
  content: Schema.String,
  stopReason: StopReasonSchema,
  usage: TokenUsageSchema,
  model: Schema.String,
  toolCalls: Schema.optional(Schema.Array(ToolCallSchema)),
});

export type CompletionResponse = Schema.Schema.Type<
  typeof CompletionResponseSchema
>;

// ─── Stream Events ───

export type StreamEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | {
      readonly type: "tool_use_start";
      readonly id: string;
      readonly name: string;
    }
  | { readonly type: "tool_use_delta"; readonly input: string }
  | { readonly type: "content_complete"; readonly content: string }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | { readonly type: "error"; readonly error: string };

// ─── Structured Output Config ───

export type StructuredCompletionRequest<A> = CompletionRequest & {
  readonly outputSchema: Schema.Schema<A>;
  readonly retryOnParseFail?: boolean;
  readonly maxParseRetries?: number;
};

// ─── Truncation Strategy ───

export type TruncationStrategy =
  | "drop-oldest"
  | "summarize-middle"
  | "sliding-window"
  | "importance-based";
