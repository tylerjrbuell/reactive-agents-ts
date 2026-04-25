// ─── Provider Capabilities ───
// @deprecated — see Capability below (Phase 1 S1.1).
export type { ProviderCapabilities } from "./capabilities.js";
export { DEFAULT_CAPABILITIES } from "./capabilities.js";

// ─── Capability port (Phase 1 S1.1) ───
// Per-(provider, model) capability descriptor; supersedes ProviderCapabilities.
// Resolution (probe → static-table → fallback) ships in S1.3.
export {
  CapabilitySchema,
  ModelTierSchema,
  TokenizerFamilySchema,
  ToolCallDialectSchema,
  CapabilitySourceSchema,
  STATIC_CAPABILITIES,
  fallbackCapability,
} from "./capability.js";
export type {
  Capability,
  ModelTier,
  TokenizerFamily,
  ToolCallDialect,
  CapabilitySource,
} from "./capability.js";

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
export { TestLLMService, TestLLMServiceLayer, type TestTurn, type ToolCallSpec } from "./testing.js";

// ─── Utilities ───
export { estimateTokenCount, calculateCost } from "./token-counter.js";
export type { CacheUsage } from "./token-counter.js";
export { retryPolicy } from "./retry.js";
export type { PricingProvider, ModelPricing } from "./pricing.js";
export { openRouterPricingProvider, urlPricingProvider } from "./pricing.js";

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

// ─── Model catalog (UI / Cortex) ───
export {
  listFrameworkModelsForProvider,
  type FrameworkModelOption,
} from "./model-catalog.js";

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

// ─── Rate Limiter ───
export { makeRateLimiter } from "./rate-limiter.js";
export type { RateLimiterConfig, RateLimiter } from "./rate-limiter.js";
export { makeRateLimitedProvider } from "./rate-limited-provider.js";

// ─── Fallback Chain ───
export { FallbackChain } from "./fallback-chain.js";
export type { FallbackConfig, FallbackCallback } from "./fallback-chain.js";

// ─── Validation ───
export { validateAndRepairMessages } from "./validation.js";

// ─── Provider Behavior Adapters ───
export {
  type ProviderAdapter,
  type AdapterSelection,
  defaultAdapter,
  localModelAdapter,
  midModelAdapter,
  selectAdapter,
  recommendStrategyForTier,
} from "./adapter.js";

// ─── Calibration ───
export {
  ModelCalibrationSchema,
  loadCalibration,
  normalizeModelId,
  clearCalibrationCache,
  buildCalibratedAdapter,
  ALIAS_FREQUENCY_THRESHOLD,
  shouldWriteAlias,
  accumulateAliasObservation,
  confirmedAliases,
  materializeExperienceSummary,
  formatToolGuidanceFromSummary,
} from "./calibration.js";
export type {
  ModelCalibration,
  ProfileOverrides,
  AliasObservationState,
  ExperienceSummary,
} from "./calibration.js";

// ─── Calibration Runner ───
export { runCalibrationProbes, majority, median } from "./calibration-runner.js";
