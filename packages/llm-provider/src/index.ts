// ─── Provider Capabilities ───
/**
 * @deprecated v0.10.0 — superseded by `Capability` (Phase 1 S1.1, see below).
 *
 * **Scheduled removal: v0.11.0.** Per AUDIT-overhaul-2026.md §11 #39, this
 * surface remains exported in v0.10.0 to preserve binary compatibility for
 * external consumers; the v0.11 release will delete it. New code must use
 * `Capability` + `resolveCapability(provider, model)` from this same module.
 *
 * Migration: replace `import type { ProviderCapabilities }` with
 * `import type { Capability }`, and any `DEFAULT_CAPABILITIES` lookup with
 * `resolveCapability("anthropic" | "openai" | "ollama", modelId)` which
 * returns the validated per-(provider, model) descriptor.
 */
export type { ProviderCapabilities } from "./capabilities.js";
/** @deprecated v0.10.0 — see ProviderCapabilities above. Removed in v0.11.0. */
export { DEFAULT_CAPABILITIES } from "./capabilities.js";

/**
 * ─── Capability port (Phase 1 S1.1) ───
 * Per-(provider, model) capability descriptor; supersedes ProviderCapabilities.
 * Resolution (probe → static-table → fallback) ships in S1.3.
 *
 * @unstable Added post-v0.9.0 on `refactor/overhaul`. Surface may change in
 * v0.10.x without notice. Track stabilization in
 * `docs/spec/docs/AUDIT-overhaul-2026.md` §11 #15.
 */
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
/**
 * Capability resolver (Phase 1 S1.3) — three-tier lookup: cached probe →
 * static table → conservative fallback. Ollama provider consumes this to
 * drive options.num_ctx per (provider, model).
 *
 * @unstable See note above on Capability port.
 */
export { resolveCapability } from "./capability-resolver.js";
export type { CapabilityCache, ResolveCapabilityOptions } from "./capability-resolver.js";

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

/**
 * ─── Provider Behavior Adapters ───
 * Composable per-tier prompt/guidance hooks (7 hooks: taskFraming, toolGuidance,
 * continuationHint, errorRecovery, synthesisPrompt, qualityCheck, systemPromptPatch).
 *
 * @unstable Phase 1 surface. `selectAdapter` resolution + tier dispatch may change
 * in v0.10.x. See AUDIT-overhaul-2026.md §11 #15.
 */
export {
  type ProviderAdapter,
  type AdapterSelection,
  defaultAdapter,
  localModelAdapter,
  midModelAdapter,
  selectAdapter,
} from "./adapter.js";

/**
 * ─── Calibration ───
 * Three-tier calibration store + alias accumulation (N≥3 gate) + ExperienceSummary
 * materialization. Drives `buildCalibratedAdapter` selection.
 *
 * @unstable Sprint 3.x surface; not external-validated. May change in v0.10.x.
 * See AUDIT-overhaul-2026.md §11 #15 + M7 mechanism verdict.
 */
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

/**
 * ─── Calibration Runner ───
 * @unstable See Calibration section above.
 */
export { runCalibrationProbes, majority, median } from "./calibration-runner.js";
