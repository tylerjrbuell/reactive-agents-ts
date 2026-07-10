// packages/llm-provider/src/capability.ts
//
// Phase 1 Sprint 1 S1.1 — Capability port struct.
// Spec: docs/spec/docs/15-design-north-star.md §3.
//
// Replaces (deprecates) the legacy 4-field `ProviderCapabilities` interface
// in `packages/llm-provider/src/capabilities.ts`. The legacy type stays around
// for one minor release for backwards compat; remove in Phase 2.
//
// `Capability` is per-(provider, model). Resolution order is provided by the
// resolver in capability-resolver.ts (S1.3): probe → static-table → fallback,
// with a `source` field on the final value so telemetry can attribute which
// path won.

import { Schema } from "effect";

// ─── Literal unions ──────────────────────────────────────────────────────────

/**
 * Operational tier — drives runtime behavior (context profiles, compression
 * budgets, temperature tuning). The four-bucket version. Distinct from
 * `TelemetryModelTier` in `@reactive-agents/observability` which is a coarser
 * five-bucket privacy classification (see G-2 / commit cedf8cc8). Phase 1 will
 * collapse the two so both derive from `Capability.tier`.
 */
export const ModelTierSchema = Schema.Literal("local", "mid", "large", "frontier");
export type ModelTier = typeof ModelTierSchema.Type;

/**
 * Tokenizer family — used to pick the right token-count estimator and to
 * understand how `maxContextTokens` was measured.
 */
export const TokenizerFamilySchema = Schema.Literal(
  "tiktoken-cl100k", // OpenAI / GPT family
  "claude",
  "gemini",
  "llama",
  "unknown",
);
export type TokenizerFamily = typeof TokenizerFamilySchema.Type;

/**
 * Tool-calling dialect — drives the `ToolCallingDriver` selection.
 *   - native-fc: provider supports native function/tool calls
 *   - text-parse: must parse tool calls out of free-form model text
 *   - none: no tool-calling support; meta-tools only
 */
export const ToolCallDialectSchema = Schema.Literal("native-fc", "text-parse", "none");
export type ToolCallDialect = typeof ToolCallDialectSchema.Type;

/**
 * Provenance of the resolved capability.
 *   - probe: live probe (e.g. Ollama /api/show, Anthropic capability discovery)
 *   - static-table: built-in fallback table in this file
 *   - fallback: conservative defaults (`maxContextTokens=4096`, ...) when
 *     both probe and static-table miss
 */
export const CapabilitySourceSchema = Schema.Literal("probe", "static-table", "fallback");
export type CapabilitySource = typeof CapabilitySourceSchema.Type;

// ─── Capability struct ───────────────────────────────────────────────────────

/**
 * Per-(provider, model) capability descriptor.
 *
 * The 12 user-facing fields enumerated in North Star §3, plus a 13th
 * `source` field carrying provenance for telemetry. `source` is mandatory
 * (the resolver always knows where the value came from) and isn't counted
 * against the documented "12 fields" count — it's plumbing, not capability.
 */
export const CapabilitySchema = Schema.Struct({
  /** Provider identifier — matches the values accepted by `withProvider()`. */
  provider: Schema.String,

  /** Exact model identifier as it appears in API requests. */
  model: Schema.String,

  /** Operational tier; drives context profile and compression budget. */
  tier: ModelTierSchema,

  /** Hard ceiling on input+output context for this model, in tokens. */
  maxContextTokens: Schema.Number.pipe(Schema.positive()),

  /**
   * Working context window the framework should request when applicable.
   * MUST be ≤ maxContextTokens. For Ollama this lands as `options.num_ctx`;
   * for cloud providers it's informational (their context is fixed).
   */
  recommendedNumCtx: Schema.Number.pipe(Schema.positive()),

  /** Maximum output (completion) tokens the model will produce in one call. */
  maxOutputTokens: Schema.Number.pipe(Schema.positive()),

  /** Tokenizer family — picks the right estimator + sanity-checks usage. */
  tokenizerFamily: TokenizerFamilySchema,

  /** True when the provider supports prompt caching with cost discount. */
  supportsPromptCaching: Schema.Boolean,

  /** True when the model accepts image inputs in addition to text. */
  supportsVision: Schema.Boolean,

  /** True when the model exposes a "thinking" / reasoning mode (e.g. Claude). */
  supportsThinkingMode: Schema.Boolean,

  /**
   * True when the model's API rejects `max_tokens` (400) and requires
   * `max_completion_tokens` on every call, thinking or not (OpenAI gpt-5.x
   * and o-series). Absent/false → legacy `max_tokens` is accepted.
   */
  requiresMaxCompletionTokens: Schema.optional(Schema.Boolean),

  /** True when the streaming API surfaces tool_use blocks incrementally. */
  supportsStreamingToolCalls: Schema.Boolean,

  /** Tool-calling dialect — drives ToolCallingDriver selection. */
  toolCallDialect: ToolCallDialectSchema,

  /** Where this capability came from (probe / static-table / fallback). */
  source: CapabilitySourceSchema,
});

export type Capability = typeof CapabilitySchema.Type;

// ─── Static table — built-in fallback for known models ───────────────────────

/**
 * Per-(provider, model) capability table consulted by the resolver when no
 * live probe is available or when probing fails. Keys are `<provider>/<model>`
 * for unambiguous lookup.
 *
 * Adding a model: pick reasonable defaults from the model's docs. If unsure,
 * lean conservative — the resolver's fallback path (4096 context, 2048 ctx)
 * is the worst case anyway.
 *
 * Sources: provider docs as of 2026-04 — Anthropic API docs, OpenAI model
 * spec, Google Gemini docs, Ollama model library.
 */
export const STATIC_CAPABILITIES: Readonly<Record<string, Capability>> = Object.freeze({
  // ── Deterministic test provider ──────────────────────────────────────────
  // `TestLLMService` is a real provider in the ProviderName union, but it had no
  // capability entry, so `resolveCapability` fell through to `source: "fallback"`.
  // The bench's preflight treats a fallback source as a CONTRACT VIOLATION and
  // marks every cell `inconclusive` with zero runs — which meant no benchmark
  // e2e test could use the deterministic provider at all (found 2026-07-09 while
  // pinning the abstention rail). The remedy is the one the resolver's own error
  // message prescribes: give it a static entry.
  //
  // Values describe the stub, not a model: it returns scripted turns, so the
  // context window is nominal and nothing is inferred from it.
  "test/test": {
    provider: "test",
    model: "test",
    tier: "local",
    maxContextTokens: 32_768,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },

  // ── Anthropic ────────────────────────────────────────────────────────────
  // Context windows and output caps per Anthropic model docs (2026-06):
  // Opus/Sonnet 4.x = 1M context; Opus output 128K, Sonnet/Haiku output 64K;
  // Haiku 4.5 = 200K context.
  "anthropic/claude-opus-4-8": {
    provider: "anthropic",
    model: "claude-opus-4-8",
    tier: "frontier",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 128_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "anthropic/claude-opus-4-7": {
    provider: "anthropic",
    model: "claude-opus-4-7",
    tier: "frontier",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 128_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "anthropic/claude-sonnet-4-6": {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    tier: "large",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "anthropic/claude-sonnet-4-5-20250929": {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    tier: "large",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // Suffix-less alias: callers using the marketing name `claude-sonnet-4-5`
  // (without the 20250929 date suffix) previously fell to the 2048 conservative
  // fallback — which the bench honesty guard marks inconclusive and refuses to
  // score. Mirrors the `claude-haiku-4-5` alias below; same capability as the
  // dated entry.
  "anthropic/claude-sonnet-4-5": {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    tier: "large",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "anthropic/claude-haiku-4-5-20251001": {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    tier: "mid",
    maxContextTokens: 200_000,
    recommendedNumCtx: 200_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // Suffix-less alias: callers using `claude-haiku-4-5` (the marketing name
  // without the 20251001 date suffix) previously fell through to the 2048
  // conservative fallback, which under-sized the recencyBudgetChars gate in
  // assembly and triggered preview+ref on a 28K-char tool result — haiku
  // then read the structural-preview heading skeleton, perceived it as a
  // truncation marker ("file-read is truncating at 29487 chars"), and
  // narrated honest failure instead of summarizing. Phase-A 2026-06-02
  // bench cells used `claude-haiku-4-5` (suffix-less); this entry collapses
  // the resolution to the same capability as the dated alias.
  "anthropic/claude-haiku-4-5": {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    tier: "mid",
    maxContextTokens: 200_000,
    recommendedNumCtx: 200_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },

  // ── OpenAI ───────────────────────────────────────────────────────────────
  // GPT-5 family per OpenAI model docs (2026-06): 1M context, 128K output,
  // vision. gpt-4o/gpt-4o-mini retained — still active (legacy).
  "openai/gpt-5.5": {
    provider: "openai",
    model: "gpt-5.5",
    tier: "frontier",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 128_000,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    requiresMaxCompletionTokens: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "openai/gpt-5.4": {
    provider: "openai",
    model: "gpt-5.4",
    tier: "large",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 128_000,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    requiresMaxCompletionTokens: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "openai/gpt-5.4-mini": {
    provider: "openai",
    model: "gpt-5.4-mini",
    tier: "mid",
    maxContextTokens: 400_000,
    recommendedNumCtx: 400_000,
    maxOutputTokens: 128_000,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    requiresMaxCompletionTokens: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "openai/gpt-4o": {
    provider: "openai",
    model: "gpt-4o",
    tier: "large",
    maxContextTokens: 128_000,
    recommendedNumCtx: 128_000,
    maxOutputTokens: 16_384,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "openai/gpt-4o-mini": {
    provider: "openai",
    model: "gpt-4o-mini",
    tier: "mid",
    maxContextTokens: 128_000,
    recommendedNumCtx: 128_000,
    maxOutputTokens: 16_384,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // o5-reasoning: OpenAI reasoning model with native reasoning_effort + max_completion_tokens API.
  // Uses max_completion_tokens (not max_tokens) and reasoning_effort when thinking is enabled.
  "openai/o5-reasoning": {
    provider: "openai",
    model: "o5-reasoning",
    tier: "frontier",
    maxContextTokens: 400_000,
    recommendedNumCtx: 400_000,
    maxOutputTokens: 128_000,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: false,
    supportsThinkingMode: true,
    requiresMaxCompletionTokens: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },

  // ── Gemini ───────────────────────────────────────────────────────────────
  // Gemini 2.0 Flash/Pro were shut down 2026-06-01. Current stable models per
  // ai.google.dev/gemini-api/docs/models (2026-06): 2.5 Pro/Flash/Flash-Lite
  // and 3.5 Flash. 1M context, 64K output, vision, thinking.
  "gemini/gemini-2.5-pro": {
    provider: "gemini",
    model: "gemini-2.5-pro",
    tier: "frontier",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 65_536,
    tokenizerFamily: "gemini",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "gemini/gemini-3.5-flash": {
    provider: "gemini",
    model: "gemini-3.5-flash",
    tier: "large",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 65_536,
    tokenizerFamily: "gemini",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "gemini/gemini-2.5-flash": {
    provider: "gemini",
    model: "gemini-2.5-flash",
    tier: "mid",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 65_536,
    tokenizerFamily: "gemini",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "gemini/gemini-2.5-flash-lite": {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    tier: "mid",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 65_536,
    tokenizerFamily: "gemini",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },

  // ── Ollama (local) ───────────────────────────────────────────────────────
  // Ollama defaults to num_ctx=2048 if not set — that's the G-1 truncation
  // bug. recommendedNumCtx is set to 32K (== maxContextTokens here, == the
  // probe's VRAM-conservative cap from local-probe.ts) so real MCP/persona
  // workloads aren't silently truncated at 8K. Both 14B models report a far
  // larger real window via /api/show (cogito qwen2.context_length=131072,
  // qwen3.context_length=40960) but 32K is the VRAM-safe ceiling for a 16GB
  // GPU. Users can override via CompletionRequest.numCtx.
  "ollama/cogito:14b": {
    provider: "ollama",
    model: "cogito:14b",
    tier: "local",
    maxContextTokens: 32_768,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "ollama/qwen3:14b": {
    provider: "ollama",
    model: "qwen3:14b",
    tier: "local",
    maxContextTokens: 32_768,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: true, // qwen3 thinks by default under Ollama (verified 2026-07-07: think:true yields thinking tokens, content empty at low num_predict, done_reason=length)
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // Smaller local-tier siblings used by the public `local-models` bench
  // session (qwen3:4b, cogito:8b). Without these the resolver falls back to a
  // 2048-token window and the bench correctly refuses to report (capability
  // source = "fallback"). Real windows are larger (qwen3 40960, cogito/qwen2
  // 131072); 32K is the VRAM-safe ceiling shared with the 14B entries.
  "ollama/qwen3:4b": {
    provider: "ollama",
    model: "qwen3:4b",
    tier: "local",
    maxContextTokens: 32_768,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: true, // qwen3 thinks by default under Ollama (verified 2026-07-07: think:true yields thinking tokens, content empty at low num_predict, done_reason=length)
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "ollama/cogito:8b": {
    provider: "ollama",
    model: "cogito:8b",
    tier: "local",
    maxContextTokens: 32_768,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // qwen3.5 family — Phase-A canonical-harness-core local-tier baseline.
  // Resolver previously fell back to recommendedNumCtx=2048 because the
  // `:latest` tag carries no `Nb` size hint and the static table lacked
  // an entry. That under-sizing produced a window-truncated capability
  // (window=2048, tier=mid) on bench cells, distorting Phase-A measurements.
  "ollama/qwen3.5:latest": {
    provider: "ollama",
    model: "qwen3.5:latest",
    tier: "local",
    maxContextTokens: 32_768,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // ── Groq (OpenAI-compatible LPU inference) ─────────────────────────────────
  // Windows/output per Groq model docs (2026-07). All native-fc. Unlisted Groq
  // models resolve via the provider-aware fallback below (native-fc, 128k),
  // NOT the conservative local fallback — Groq always speaks OpenAI tools.
  "groq/llama-3.3-70b-versatile": {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    tier: "large",
    maxContextTokens: 131_072,
    recommendedNumCtx: 131_072,
    maxOutputTokens: 32_768,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "groq/llama-3.1-8b-instant": {
    provider: "groq",
    model: "llama-3.1-8b-instant",
    tier: "mid",
    maxContextTokens: 131_072,
    recommendedNumCtx: 131_072,
    maxOutputTokens: 8_192,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "groq/openai/gpt-oss-120b": {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    tier: "large",
    maxContextTokens: 131_072,
    recommendedNumCtx: 131_072,
    maxOutputTokens: 32_768,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "groq/openai/gpt-oss-20b": {
    provider: "groq",
    model: "openai/gpt-oss-20b",
    tier: "mid",
    maxContextTokens: 131_072,
    recommendedNumCtx: 131_072,
    maxOutputTokens: 32_768,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "groq/meta-llama/llama-4-scout-17b-16e-instruct": {
    provider: "groq",
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    tier: "mid",
    maxContextTokens: 131_072,
    recommendedNumCtx: 131_072,
    maxOutputTokens: 8_192,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "groq/qwen/qwen3-32b": {
    provider: "groq",
    model: "qwen/qwen3-32b",
    tier: "large",
    maxContextTokens: 131_072,
    recommendedNumCtx: 131_072,
    maxOutputTokens: 16_384,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    // Groq drives qwen3 reasoning via `reasoning_format`, not the
    // `reasoning_effort` param this adapter emits — leave thinking off to
    // avoid a 400 on the opt-in thinking path.
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },

  // ── xAI Grok (OpenAI-compatible) ───────────────────────────────────────────
  // Windows per xAI model docs (2026-07). Unlisted grok-* models resolve via
  // the provider-aware fallback below.
  "xai/grok-4": {
    provider: "xai",
    model: "grok-4",
    tier: "frontier",
    maxContextTokens: 256_000,
    recommendedNumCtx: 256_000,
    maxOutputTokens: 32_768,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: true,
    // grok-4 always reasons and rejects a configurable `reasoning_effort`;
    // exposing thinking would emit a param it 400s on. grok-3-mini keeps it.
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "xai/grok-3": {
    provider: "xai",
    model: "grok-3",
    tier: "large",
    maxContextTokens: 131_072,
    recommendedNumCtx: 131_072,
    maxOutputTokens: 16_384,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "xai/grok-3-mini": {
    provider: "xai",
    model: "grok-3-mini",
    tier: "mid",
    maxContextTokens: 131_072,
    recommendedNumCtx: 131_072,
    maxOutputTokens: 16_384,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: false,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },

  // ── Static table is intentionally small ─────────────────────────────────
  //
  // Only "tested baseline" models the framework has explicitly validated
  // belong here. The long tail of community Ollama models is handled by
  // probe-on-first-use (S2.4) — see providers/local-probe.ts. Probing
  // /api/show extracts the actual context_length, capabilities[], family,
  // and parameter size for any model the user has pulled, removing the
  // need to manually enumerate the world.
});

// ─── Conservative fallback ───────────────────────────────────────────────────

/**
 * Returned by the resolver when both probing and the static table miss.
 * Picks safe lower-bound values that won't crash on any modern provider.
 *
 * `recommendedNumCtx: 2048` matches Ollama's silent default — explicitly
 * setting it preserves prior behavior while making the conservatism visible
 * in telemetry via `source: "fallback"`.
 */
/**
 * Hosted OpenAI-compatible providers (Groq, xAI) whose model lists drift fast.
 * An unlisted model here MUST still get `native-fc` — these providers always
 * accept the OpenAI tools schema, so the conservative `toolCallDialect:"none"`
 * local fallback would silently strip tool-calling. A generous 128k window is a
 * safe lower bound across their current lineups.
 */
const OPENAI_COMPAT_FALLBACK_PROVIDERS = new Set(["groq", "xai"]);

export function fallbackCapability(provider: string, model: string): Capability {
  if (OPENAI_COMPAT_FALLBACK_PROVIDERS.has(provider)) {
    return {
      provider,
      model,
      tier: "large",
      maxContextTokens: 131_072,
      recommendedNumCtx: 131_072,
      maxOutputTokens: 8_192,
      tokenizerFamily: provider === "xai" ? "tiktoken-cl100k" : "llama",
      supportsPromptCaching: false,
      supportsVision: false,
      supportsThinkingMode: false,
      supportsStreamingToolCalls: true,
      toolCallDialect: "native-fc",
      source: "fallback",
    };
  }

  return {
    provider,
    model,
    tier: "local",
    maxContextTokens: 4096,
    recommendedNumCtx: 2048,
    maxOutputTokens: 2048,
    tokenizerFamily: "unknown",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: false,
    toolCallDialect: "none",
    source: "fallback",
  };
}
