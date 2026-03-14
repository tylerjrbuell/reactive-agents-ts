// ─── Types ───
export type {
  LLMProvider,
  EmbeddingConfig,
  ModelConfig,
  ModelPresetName,
  CacheControl,
  ImageSource,
  ContentBlock,
  CacheableContentBlock,
  LLMMessage,
  TokenUsage,
  StopReason,
  ToolDefinition,
  ToolCall,
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  StructuredCompletionRequest,
  TruncationStrategy,
  StructuredOutputCapabilities,
  TokenLogprob,
} from "./types.js";

// ─── Schemas ───
export {
  LLMProviderType,
  EmbeddingConfigSchema,
  DefaultEmbeddingConfig,
  ModelConfigSchema,
  ModelPresets,
  CacheControlSchema,
  ImageSourceSchema,
  TextContentBlockSchema,
  ImageContentBlockSchema,
  ToolUseContentBlockSchema,
  ToolResultContentBlockSchema,
  TokenUsageSchema,
  StopReasonSchema,
  ToolDefinitionSchema,
  ToolCallSchema,
  CompletionResponseSchema,
  makeCacheable,
} from "./types.js";

// ─── Errors ───
export {
  LLMError,
  LLMRateLimitError,
  LLMTimeoutError,
  LLMParseError,
  LLMContextOverflowError,
} from "./errors.js";
export type { LLMErrors } from "./errors.js";

// ─── Service Tags ───
export { LLMService } from "./llm-service.js";
export { LLMConfig, LLMConfigFromEnv, llmConfigFromEnv } from "./llm-config.js";
export { PromptManager, PromptManagerLive } from "./prompt-manager.js";

// ─── Providers ───
export { AnthropicProviderLive } from "./providers/anthropic.js";
export { OpenAIProviderLive } from "./providers/openai.js";
export { LocalProviderLive } from "./providers/local.js";
export { GeminiProviderLive } from "./providers/gemini.js";
export { LiteLLMProviderLive } from "./providers/litellm.js";

// ─── Testing ───
export { TestLLMService, TestLLMServiceLayer } from "./testing.js";

// ─── Utilities ───
export { estimateTokenCount, calculateCost } from "./token-counter.js";
export { retryPolicy } from "./retry.js";

// ─── Structured Output Schemas ───
export {
  ReActActionSchema,
  PlanSchema,
  ReflectionSchema,
  StrategySelectionSchema,
  ThoughtEvaluationSchema,
  ComplexityAnalysisSchema,
} from "./structured-output.js";
export type {
  ReActAction,
  Plan,
  Reflection,
  StrategySelection,
  ThoughtEvaluation,
  ComplexityAnalysis,
} from "./structured-output.js";

// ─── Provider Defaults ───
export { PROVIDER_DEFAULT_MODELS, getProviderDefaultModel } from "./provider-defaults.js";

// ─── Runtime ───
export {
  createLLMProviderLayer,
  createLLMProviderLayerWithConfig,
} from "./runtime.js";

// ─── Embedding Cache ───
export { makeEmbeddingCache } from "./embedding-cache.js";
export type { EmbeddingCache } from "./embedding-cache.js";

// ─── Circuit Breaker ───
export { makeCircuitBreaker } from "./circuit-breaker.js";
export type { CircuitBreaker } from "./circuit-breaker.js";
export { defaultCircuitBreakerConfig } from "./retry.js";
export type { CircuitBreakerConfig } from "./retry.js";
