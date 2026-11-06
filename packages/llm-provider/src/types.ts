import { Schema } from "effect";
import type { ContentBlock, ToolMessageBlock } from "./content-blocks.js";

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
  /** Groq LPU inference (OpenAI-compatible). Requires GROQ_API_KEY. */
  "groq",
  /** xAI Grok models (OpenAI-compatible). Requires XAI_API_KEY. */
  "xai",
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
 * - "groq": Groq LPU inference (OpenAI-compatible)
 * - "xai": xAI Grok models (OpenAI-compatible)
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
 *   model: "claude-opus-4-8",
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
 * // { provider: "anthropic", model: "claude-opus-4-8", costPer1MInput: 15.0, ... }
 * ```
 */
export const ModelPresets = {
  /**
   * Claude Haiku 4.5 — fast, cost-effective Anthropic model.
   * Best for low-latency, simple reasoning tasks; not recommended for complex analysis.
   */
  "claude-haiku": {
    provider: "anthropic" as const,
    model: "claude-haiku-4-5",
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
   * Claude Sonnet 4.6 — balanced Anthropic model.
   * Recommended for general-purpose reasoning, tool use, and production agents.
   */
  "claude-sonnet": {
    provider: "anthropic" as const,
    model: "claude-sonnet-4-6",
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
    maxContext: 1_000_000,
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
   * Claude Opus 4.8 — most capable Anthropic model.
   * Best for complex analysis, research, and high-accuracy multi-hop reasoning.
   * Largest context window (1M tokens).
   */
  "claude-opus": {
    provider: "anthropic" as const,
    model: "claude-opus-4-8",
    costPer1MInput: 5.0,
    costPer1MOutput: 25.0,
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
   * GPT-5.5 — OpenAI flagship model.
   * Frontier reasoning for coding and professional work; 1M context, vision.
   */
  "gpt-5.5": {
    provider: "openai" as const,
    model: "gpt-5.5",
    costPer1MInput: 5.0,
    costPer1MOutput: 30.0,
    maxContext: 1_000_000,
    /** Quality tier (1.0 = frontier-class reasoning) */
    quality: 1.0,
  },
  /**
   * GPT-5.4 — strong, lower-cost OpenAI model.
   * Excellent reasoning at a production-friendly price; 1M context, vision.
   */
  "gpt-5.4": {
    provider: "openai" as const,
    model: "gpt-5.4",
    costPer1MInput: 2.5,
    costPer1MOutput: 15.0,
    maxContext: 1_000_000,
    /** Quality tier (0.9 = very strong reasoning) */
    quality: 0.9,
  },
  /**
   * GPT-4o — earlier OpenAI model (still active).
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
   * Gemini 2.5 Flash-Lite — fastest, lowest-cost Google model.
   * Excellent speed and cost efficiency; large 1M context window.
   * (Gemini 2.0 Flash was shut down 2026-06-01.)
   */
  "gemini-2.5-flash-lite": {
    provider: "gemini" as const,
    model: "gemini-2.5-flash-lite",
    costPer1MInput: 0.1,
    costPer1MOutput: 0.4,
    maxContext: 1_000_000,
    /** Quality tier (0.7 = good for simple tasks) */
    quality: 0.7,
  },
  /**
   * Gemini 2.5 Pro — advanced Google model.
   * Superior reasoning to Flash; large context window and competitive pricing.
   */
  "gemini-2.5-pro": {
    provider: "gemini" as const,
    model: "gemini-2.5-pro",
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

// ─── Cache Control + Content Blocks ───
// Moved to ./content-blocks.ts (Plan 9 Phase 4 stage C): text/image blocks now
// derive from core ContentPart. Re-exported so existing importers are unaffected.
export {
  CacheControlSchema,
  ImageSourceSchema,
  isImageSource,
  TextContentBlockSchema,
  ImageContentBlockSchema,
  ToolUseContentBlockSchema,
  ToolResultContentBlockSchema,
  makeCacheable,
} from "./content-blocks.js";
export type {
  CacheControl,
  ImageSource,
  ContentBlock,
  ToolMessageBlock,
  CacheableContentBlock,
} from "./content-blocks.js";

// ─── Message Types ───

/**
 * Union of LLM message roles.
 * Each message has a role (system, user, assistant, tool) and content.
 *
 * - **system**: Instructions/context set by the agent developer. Content is always a string.
 * - **user**: User query or context provided by caller. Content is string or content blocks.
 * - **assistant**: Model response or thoughts. Content is string or content blocks (including tool_use).
 * - **tool**: Tool execution result returned to model. Content is a string, or text/image blocks.
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
      /** Name of the tool that produced this result */
      readonly toolName?: string;
      /** Plain text result/output, or text/image blocks (Phase 4 typed parts) */
      readonly content: string | readonly ToolMessageBlock[];
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
  /**
   * Tokens that wrote NEW entries to the provider's prompt cache on this turn.
   * Charged at a premium (e.g. Anthropic: 1.25x base input). Subsequent calls
   * within the cache TTL window read these for the discounted cache_read price.
   * Optional — providers without prompt caching omit this field.
   */
  cacheCreationInputTokens: Schema.optional(Schema.Number),
  /**
   * Tokens served from the provider's prompt cache (cache hit). Charged at a
   * deep discount (e.g. Anthropic: 0.1x base input — 90% off). Indicates the
   * caching infrastructure (Lever 1, GH #143-followup) is firing on multi-turn
   * conversations. Optional — providers without prompt caching omit this field.
   */
  cacheReadInputTokens: Schema.optional(Schema.Number),
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

// ─── Tool Definition / Tool Call / Tool Choice ───
// Moved to ./tool-protocol.ts (2026-11-06, tool_choice work). Re-exported so
// existing importers are unaffected.
import { ToolCallSchema } from "./tool-protocol.js";
import type { ToolChoice, ToolDefinition } from "./tool-protocol.js";
export { ToolDefinitionSchema, ToolCallSchema, isToolCallRequired } from "./tool-protocol.js";
export type { ToolDefinition, ToolCall, ToolChoice } from "./tool-protocol.js";

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
 * MOVED to `@reactive-agents/core` (2026-07-28) and re-exported here so existing
 * importers are unaffected. It had to move down: `core`'s EventBus and the
 * `trace` package both need it to carry `purpose` onto `LLMExchangeEmitted` and
 * the `llm-exchange` trace event, and neither may depend on `llm-provider`.
 * `core` has zero workspace deps, so it is the only home all three can share.
 * Re-exported rather than re-declared — a second copy is the drift class the
 * debt register tracks.
 */
import type { LlmCallPurpose } from "@reactive-agents/core";
export type { LlmCallPurpose };

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
 *   model: { provider: "anthropic", model: "claude-opus-4-8" },
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
  /**
   * What this call is for (see {@link LlmCallPurpose}). Set by the kernel LLM
   * gateway on every mediated call. Absent on direct, un-mediated calls.
   */
  readonly purpose?: LlmCallPurpose;
  /** Model config (provider + model name + optional sampling params), or bare model-name string for routing overrides */
  readonly model?: ModelConfig | string;
  /** Maximum response tokens (optional, uses config default if omitted) */
  readonly maxTokens?: number;
  /** Sampling temperature 0.0-1.0 (optional, uses config default if omitted) */
  readonly temperature?: number;
  /** Stop sequences to halt generation (optional) */
  readonly stopSequences?: readonly string[];
  /** Tools available for the model to call (optional) */
  readonly tools?: readonly ToolDefinition[];
  /**
   * `"required"` = the response must carry at least one call to a tool in
   * `tools`; ignored when `tools` is empty. Omitted or `"auto"` = the model
   * decides, and the request is byte-identical to one without this field.
   * Per-provider mapping (Anthropic `any`, OpenAI/LiteLLM `required`, Gemini
   * `ANY`, Ollama constrained decoding): see {@link ToolChoice}.
   */
  readonly toolChoice?: ToolChoice;
  /** System prompt (optional, prepended to user messages) */
  readonly systemPrompt?: string;
  /** Request log probabilities for each output token (optional) */
  readonly logprobs?: boolean;
  /** Number of most likely tokens to return log probabilities for (optional, 1-20) */
  readonly topLogprobs?: number;
  /**
   * Context window size for local providers (Ollama `options.num_ctx`).
   * When omitted, falls back to `LLMConfig.defaultNumCtx`, then to the provider's
   * own default. For Ollama this matters — its own default is 2048 tokens, which
   * silently truncates long conversations and tool results. Setting this to 8192
   * or higher is recommended for any non-trivial task.
   *
   * No-op for cloud providers (Anthropic, OpenAI, Gemini, etc.) which derive
   * context size from the model ID.
   */
  readonly numCtx?: number;
  /**
   * Per-request hard timeout in milliseconds for the underlying provider call.
   *
   * Honored by the local (Ollama) provider, where a cold model load or GPU
   * contention can push a single generation past the default ceiling. On
   * timeout the in-flight HTTP request is aborted so the server stops
   * generating. Falls back to `LLMConfig.ollamaTimeoutMs`, then to a
   * cold-load-tolerant default (see `providers/local.ts`).
   *
   * Cloud providers (Anthropic/OpenAI/Gemini/LiteLLM and OpenAI-compat
   * siblings) honor it on `complete()` as the top of their own chain:
   * `request.timeoutMs` → `LLMConfig.cloudTimeoutMs` → 120s default
   * (see `params/cloud-timeout.ts`).
   */
  readonly timeoutMs?: number;
  /**
   * Per-call thinking override; wins over `LLMConfig.thinking` when set, and
   * omitting it leaves the request identical to a config-only call. `false` =
   * no thinking this call: Ollama sends `think: false` on capable models
   * (non-capable models: param omitted, nothing to switch off), Anthropic sends no `thinking` block, Gemini sends `thinkingBudget: 0`
   * (advisory on 2.5-pro), OpenAI/LiteLLM add no reasoning reserve or
   * `reasoning_effort` (models that always reason keep the server default).
   * `true` = enable when the model is capable, exactly like config `true`.
   * Typical use: a thinking-off retry after a runaway thinking call.
   * The test provider ignores it. Mapping: `thinking/resolve.ts`.
   */
  readonly thinking?: boolean;
  /**
   * OBSERVABILITY-ONLY run correlation. Carries the kernel's taskId/iteration
   * so the observable-LLM wrapper can key LLMExchange trace events to the real
   * run instead of a global `llm-direct` placeholder.
   *
   * Providers MUST NOT read this field or send it to any API — it is a pure
   * no-op for every adapter (anthropic/openai/gemini/ollama/litellm/test),
   * which construct their API payloads from explicit fields and ignore it.
   * It is snapshotted at request-build time (not read at stream finalization),
   * so it is immune to FiberRef-inheritance streaming regressions.
   */
  readonly traceContext?: {
    readonly taskId?: string;
    readonly iteration?: number;
  };
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
 *   model: "claude-opus-4-8",
 *   toolCalls: undefined
 * };
 * ```
 */
/**
 * Effective parameters the PROVIDER actually resolved and applied for a call —
 * the provider-transparency mechanism. Downstream consumers (Cortex's
 * context-window gauge, the trace/diagnose layers) read these as ground truth
 * instead of re-deriving assumptions (e.g. recomputing num_ctx precedence, which
 * would drift from the provider). Each provider populates what it can; every
 * field is optional. Extend this struct rather than adding ad-hoc response fields.
 */
export const ResolvedParamsSchema = Schema.Struct({
  /**
   * The exact context window (in tokens) the provider used for this call. For
   * Ollama this is the resolved `options.num_ctx` (request override → explicit
   * config override → capability recommendation); for fixed-window providers it
   * is the model's context window. This — not the model's assumed max — is the
   * correct denominator for context-occupancy reporting.
   */
  contextWindow: Schema.optional(Schema.Number),
  /** The effective max-output-tokens cap the provider applied this call. */
  maxOutputTokens: Schema.optional(Schema.Number),
});

/** @see ResolvedParamsSchema */
export type ResolvedParams = Schema.Schema.Type<typeof ResolvedParamsSchema>;

export const CompletionResponseSchema = Schema.Struct({
  /** Generated response content (text only, no content blocks) */
  content: Schema.String,
  /** Why the model stopped generating */
  stopReason: StopReasonSchema,
  /** Token usage statistics */
  usage: TokenUsageSchema,
  /** Actual model identifier used (may differ from request) */
  model: Schema.String,
  /**
   * Effective parameters the provider actually resolved for this call
   * (transparency). Optional — providers populate what they can.
   */
  resolvedParams: Schema.optional(ResolvedParamsSchema),
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
 * Events arrive in sequence: thinking_delta(s) then text_delta(s) for thinking
 * models (thinking_delta is only emitted when the provider's thinking-capability
 * seam is on for the model), then tool_use_start/delta(s) if applicable, then
 * content_complete (optionally carrying the accumulated `thinking`), then usage.
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
      /**
       * Internal-reasoning chunk from a thinking model (e.g. qwen3's
       * `message.thinking` stream under Ollama, Anthropic extended-thinking
       * blocks). Wave 1 (Local-Tier Reliability): this is the streaming
       * counterpart of the `thinking` field `complete()` already returns on
       * `CompletionResponse` — the kernel's `providerThinking` /
       * `rescueFromThinking` paths consume it. Emitted ONLY when the
       * provider's thinking-capability seam is on for the model; non-thinking
       * models produce zero of these. Additive variant — consumers that do
       * not handle it simply ignore it (rollback-tolerant by construction).
       */
      readonly type: "thinking_delta";
      /** Reasoning chunk content */
      readonly thinking: string;
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
      /**
       * Full accumulated internal reasoning for this response, when the
       * provider's thinking-capability seam was on and the model actually
       * emitted thinking (Wave 1 streaming symmetry with
       * `CompletionResponse.thinking`). Absent otherwise — additive optional
       * field, rollback-tolerant: consumers that ignore it behave exactly as
       * before.
       */
      readonly thinking?: string;
      /**
       * Stop reason for the completed response when the provider reports one
       * at stream end (e.g. Ollama done_reason "length" → "max_tokens").
       * Consumers use this to distinguish truncation from natural end_turn —
       * critical for thinking models that exhaust the budget inside <think>.
       */
      readonly stopReason?: StopReason;
    }
  | {
      /** Token usage reported */
      readonly type: "usage";
      /** Final token usage for the request */
      readonly usage: TokenUsage;
      /**
       * Effective parameters the provider resolved for this call (transparency).
       * Streamed alongside usage so streaming callers get the same ground-truth
       * the non-streaming `complete()` path exposes via `CompletionResponse.resolvedParams`.
       */
      readonly resolvedParams?: ResolvedParams;
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
 *   model: "claude-opus-4-8",
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
