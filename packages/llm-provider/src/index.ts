// ─── Provider Capabilities ───
/**
 * Per-provider API-surface flags (tool calling, streaming, structured output,
 * logprobs). Orthogonal to {@link Capability}, which is the per-(provider,
 * model) spec.
 *
 * An earlier "Capability supersedes ProviderCapabilities" design intent
 * (annotated with `@deprecated v0.10.0 — Removed in v0.11.0`) was reverted
 * after wiki HS-18 audit (2026-05-20): the two types encode orthogonal
 * concerns — per-provider API flags vs per-model spec — and `Capability`
 * has no analogs for `supportsStreaming` / `supportsLogprobs` /
 * `supportsStructuredOutput`. Both types are now treated as permanent.
 *
 * See `packages/llm-provider/src/capabilities.ts` JSDoc for the full
 * taxonomy (ProviderCapabilities vs StructuredOutputCapabilities vs
 * Capability).
 */
export type { ProviderCapabilities } from "./capabilities.js";
export { DEFAULT_CAPABILITIES } from "./capabilities.js";

/**
 * ─── Capability port (Phase 1 S1.1) ───
 * Per-(provider, model) capability descriptor. Orthogonal to
 * {@link ProviderCapabilities}; covers context window, tokenizer, tier,
 * and tool-call dialect. Resolution (probe → static-table → fallback)
 * ships in S1.3.
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
export { resolveCapability, _resetProbedRegistryForTesting } from "./capability-resolver.js";
export type { CapabilityCache, ResolveCapabilityOptions } from "./capability-resolver.js";

// Canonical capability resolver (Sprint-1 B3β). The single function consumers
// should call when they need model-capability info; returns the canonical
// `Capability` shape from `@reactive-agents/core/contracts/capability`.
export { resolveCanonical, warnCapabilityFallback } from "./canonical-resolver.js";

// Eager capability prime — runs the provider's live discovery probe (Ollama
// /api/show) and writes through to the process-wide probed registry BEFORE the
// synchronous resolvers at build-validation + every reasoning iteration, so any
// pulled model resolves at its real window/dialect instead of the 2048 fallback.
export { primeCapability } from "./capability-prime.js";
export type { PrimeCapabilityOptions } from "./capability-prime.js";

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
export type { LLMErrors, ParseAttemptError } from "./errors.js";

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
export { TestLLMService, TestLLMServiceLayer, type TestTurn, type ToolCallSpec, type ProviderQuirk } from "./testing.js";

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

// ─── Thinking / Reasoning Budget ───
export {
  resolveThinkingEnabled,
  reserveThinkingBudget,
  THINKING_MIN,
  THINKING_MAX,
} from "./thinking/index.js";
export type { ThinkingOptions } from "./thinking/index.js";

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
