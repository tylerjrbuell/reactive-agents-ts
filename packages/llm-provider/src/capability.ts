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
  // ── Anthropic ────────────────────────────────────────────────────────────
  "anthropic/claude-opus-4-7": {
    provider: "anthropic",
    model: "claude-opus-4-7",
    tier: "frontier",
    maxContextTokens: 200_000,
    recommendedNumCtx: 200_000,
    maxOutputTokens: 8192,
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
    maxContextTokens: 200_000,
    recommendedNumCtx: 200_000,
    maxOutputTokens: 8192,
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
    maxOutputTokens: 8192,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },

  // ── OpenAI ───────────────────────────────────────────────────────────────
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

  // ── Gemini ───────────────────────────────────────────────────────────────
  "gemini/gemini-2.0-flash": {
    provider: "gemini",
    model: "gemini-2.0-flash",
    tier: "mid",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 8192,
    tokenizerFamily: "gemini",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "gemini/gemini-2.0-pro": {
    provider: "gemini",
    model: "gemini-2.0-pro",
    tier: "large",
    maxContextTokens: 2_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 8192,
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
  // bug. Recommended values here lean toward common task sizes (8K) for the
  // most-tested local models. Users can override via CompletionRequest.numCtx.
  "ollama/cogito:14b": {
    provider: "ollama",
    model: "cogito:14b",
    tier: "local",
    maxContextTokens: 32_768,
    recommendedNumCtx: 8192,
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
    recommendedNumCtx: 8192,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
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
export function fallbackCapability(provider: string, model: string): Capability {
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
