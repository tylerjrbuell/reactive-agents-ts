// packages/llm-provider/src/price-book/price-usage.ts
//
// Price a provider's FULL usage object. Each adapter normalizes its wire usage
// into a BillableUsage (disjoint token pools, so nothing is billed twice), and
// one pure function, `priceUsage`, applies a PriceEntry to it.
//
// Usage semantics per provider (what each pool is a subset of):
//   - Anthropic: `input_tokens` EXCLUDES cache reads and writes, which are
//     separate pools; writes split 5m/1h in `cache_creation`; web searches in
//     `server_tool_use.web_search_requests`. Long-context tiers count the full
//     prompt (input + cache read + cache write).
//   - OpenAI-compatible (openai, groq, xai, litellm): `prompt_tokens` INCLUDES
//     `cached_tokens` and audio tokens; `completion_tokens` includes reasoning
//     and audio output. Unverified: whether xAI counts reasoning inside
//     `completion_tokens` (audit F10).
//   - Gemini: `promptTokenCount` includes `cachedContentTokenCount`; thoughts
//     sit OUTSIDE `candidatesTokenCount` and bill as output;
//     `toolUsePromptTokenCount` is extra billed input.

import { Option, Schema } from "effect";
import { priceFor } from "./price-book.js";
import type { PriceEntry, PriceSource, PricingRegistry } from "./schema.js";

/** Disjoint billable token pools of one call (all counts, never undefined). */
export const BillableUsageSchema = Schema.Struct({
  /** Text input not served from or written to a cache. */
  inputUncached: Schema.Number,
  /** Input served from the prompt cache. */
  cacheRead: Schema.Number,
  /** Input written to the cache at the standard TTL (Anthropic 5 minutes). */
  cacheWrite5m: Schema.Number,
  /** Input written to the cache at the 1-hour TTL (Anthropic). */
  cacheWrite1h: Schema.Number,
  /** Audio input (not in `inputUncached`). */
  inputAudio: Schema.Number,
  /** Text output, including hidden reasoning/thinking. */
  output: Schema.Number,
  /** Audio output (not in `output`). */
  outputAudio: Schema.Number,
  /** Prompt size that selects a long-context tier. */
  promptTokensForTier: Schema.Number,
  /** Server-side web searches billed per request. */
  webSearchRequests: Schema.Number,
});
/** Disjoint billable token pools of one call. */
export type BillableUsage = Schema.Schema.Type<typeof BillableUsageSchema>;

const EMPTY: BillableUsage = {
  inputUncached: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  inputAudio: 0,
  output: 0,
  outputAudio: 0,
  promptTokensForTier: 0,
  webSearchRequests: 0,
};

/** Result of pricing one call: `usd` is absent when the price is unknown. */
export interface PricedUsage {
  readonly usd?: number;
  readonly priceSource: PriceSource;
}

/**
 * Price one call. Pure: same usage and entry, same dollars.
 *
 * The long-context tier with the highest `minPromptTokens` not above
 * `promptTokensForTier` replaces the base rates it states.
 *
 * @param usage - normalized billable pools
 * @param entry - the model's price, or undefined when unknown
 * @returns `{ usd, priceSource }`; no `usd` and `"unknown"` without an entry
 */
export const priceUsage = (usage: BillableUsage, entry: PriceEntry | undefined): PricedUsage => {
  if (entry === undefined) return { priceSource: "unknown" };
  const tier = (entry.tiers ?? []).filter((t) => t.minPromptTokens <= usage.promptTokensForTier).at(-1);
  const input = tier?.input ?? entry.input;
  const output = tier?.output ?? entry.output;
  const cacheRead = tier?.cacheRead ?? entry.cacheRead ?? input;
  const cacheWrite5m = tier?.cacheWrite5m ?? entry.cacheWrite5m ?? input;
  const cacheWrite1h = tier?.cacheWrite1h ?? entry.cacheWrite1h ?? cacheWrite5m;
  const perMillion =
    usage.inputUncached * input +
    usage.cacheRead * cacheRead +
    usage.cacheWrite5m * cacheWrite5m +
    usage.cacheWrite1h * cacheWrite1h +
    usage.inputAudio * (entry.inputAudio ?? input) +
    usage.output * output +
    usage.outputAudio * (entry.outputAudio ?? output);
  const perRequest = usage.webSearchRequests * (entry.perRequest?.webSearch ?? 0);
  return {
    usd: perMillion / 1_000_000 + perRequest,
    priceSource: entry.source === "user" ? "user" : "price-book",
  };
};

// ─── Per-adapter normalizers ───

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Anthropic Messages API `usage` (fields RA bills). */
export interface AnthropicWireUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_creation?: {
    readonly ephemeral_5m_input_tokens?: number | null;
    readonly ephemeral_1h_input_tokens?: number | null;
  } | null;
  readonly server_tool_use?: { readonly web_search_requests?: number | null } | null;
}

/** Normalize Anthropic usage. Without the 5m/1h split, every write is 5m. */
export const anthropicBillableUsage = (u: AnthropicWireUsage): BillableUsage => {
  const write1h = n(u.cache_creation?.ephemeral_1h_input_tokens);
  const writeTotal =
    u.cache_creation_input_tokens != null
      ? n(u.cache_creation_input_tokens)
      : n(u.cache_creation?.ephemeral_5m_input_tokens) + write1h;
  const cacheRead = n(u.cache_read_input_tokens);
  return {
    ...EMPTY,
    inputUncached: n(u.input_tokens),
    cacheRead,
    cacheWrite5m: Math.max(0, writeTotal - write1h),
    cacheWrite1h: write1h,
    output: n(u.output_tokens),
    promptTokensForTier: n(u.input_tokens) + cacheRead + writeTotal,
    webSearchRequests: n(u.server_tool_use?.web_search_requests),
  };
};

/** OpenAI-compatible `usage` (OpenAI, Groq, xAI, LiteLLM). */
export interface OpenAICompatWireUsage {
  readonly prompt_tokens?: number | null;
  readonly completion_tokens?: number | null;
  readonly prompt_tokens_details?: {
    readonly cached_tokens?: number | null;
    readonly audio_tokens?: number | null;
  } | null;
  readonly completion_tokens_details?: {
    /** A subset of `completion_tokens`, billed as output (no separate pool). */
    readonly reasoning_tokens?: number | null;
    readonly audio_tokens?: number | null;
  } | null;
  /** LiteLLM (Anthropic routes): cache writes, a subset of `prompt_tokens` (LiteLLM docs). */
  readonly cache_creation_input_tokens?: number | null;
}

/** Normalize OpenAI-compatible usage. Reasoning stays inside output. */
export const openAICompatBillableUsage = (u: OpenAICompatWireUsage): BillableUsage => {
  const prompt = n(u.prompt_tokens);
  const cacheRead = n(u.prompt_tokens_details?.cached_tokens);
  const cacheWrite = n(u.cache_creation_input_tokens);
  const inputAudio = n(u.prompt_tokens_details?.audio_tokens);
  const outputAudio = n(u.completion_tokens_details?.audio_tokens);
  return {
    ...EMPTY,
    inputUncached: Math.max(0, prompt - cacheRead - cacheWrite - inputAudio),
    cacheRead,
    cacheWrite5m: cacheWrite,
    inputAudio,
    output: Math.max(0, n(u.completion_tokens) - outputAudio),
    outputAudio,
    promptTokensForTier: prompt,
  };
};

/** Gemini `usageMetadata` (fields RA bills). */
export interface GeminiWireUsage {
  readonly promptTokenCount?: number | null;
  readonly candidatesTokenCount?: number | null;
  readonly thoughtsTokenCount?: number | null;
  readonly cachedContentTokenCount?: number | null;
  readonly toolUsePromptTokenCount?: number | null;
  readonly promptTokensDetails?: ReadonlyArray<{
    readonly modality?: string | null;
    readonly tokenCount?: number | null;
  }> | null;
}

/** Normalize Gemini usage: thoughts bill as output, tool-use prompt as input. */
export const geminiBillableUsage = (u: GeminiWireUsage): BillableUsage => {
  const prompt = n(u.promptTokenCount);
  const cacheRead = n(u.cachedContentTokenCount);
  const inputAudio = (u.promptTokensDetails ?? [])
    .filter((d) => d.modality === "AUDIO")
    .reduce((sum, d) => sum + n(d.tokenCount), 0);
  return {
    ...EMPTY,
    inputUncached: Math.max(0, prompt - cacheRead - inputAudio) + n(u.toolUsePromptTokenCount),
    cacheRead,
    inputAudio,
    output: n(u.candidatesTokenCount) + n(u.thoughtsTokenCount),
    promptTokensForTier: prompt,
  };
};

// ─── Usage fields ───

/** The cost fields of a `TokenUsage`: `estimatedCost` absent = price unknown. */
export interface CostFields {
  readonly estimatedCost?: number;
  readonly priceSource: PriceSource;
}

/**
 * Cost fields for one call, priced through the PriceBook.
 *
 * @param provider - RA provider id
 * @param model - model id as sent to the provider
 * @param usage - normalized billable pools
 * @param registry - user pricing (wins over everything, incl. `reportedUsd`)
 * @param reportedUsd - the provider's own bill for this call (LiteLLM
 *   `x-litellm-response-cost`); used unless user pricing covers the model
 */
export const costFields = (
  provider: string,
  model: string,
  usage: BillableUsage,
  registry?: PricingRegistry,
  reportedUsd?: number,
): CostFields => {
  const entry = Option.getOrUndefined(priceFor(provider, model, registry));
  if (reportedUsd !== undefined && entry?.source !== "user") {
    return { estimatedCost: reportedUsd, priceSource: "provider-reported" };
  }
  const priced = priceUsage(usage, entry);
  return priced.usd === undefined
    ? { priceSource: priced.priceSource }
    : { estimatedCost: priced.usd, priceSource: priced.priceSource };
};

/** Cost fields of local inference (Ollama): a known $0. */
export const LOCAL_COST_FIELDS: CostFields = { estimatedCost: 0, priceSource: "price-book" };
