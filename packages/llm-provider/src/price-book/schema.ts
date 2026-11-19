// packages/llm-provider/src/price-book/schema.ts
//
// The PriceBook data model. Every rate is DOLLARS PER 1M TOKENS, stored as the
// provider bills it (never as a multiplier of the input rate), so per-model
// cache and long-context rates are data, not code. `perRequest` rates are
// dollars per request (e.g. one web search).

import { Schema } from "effect";
import type { PriceSource as CorePriceSource } from "@reactive-agents/core";

/**
 * Where a call's USD cost came from. Mirrors `PriceSource` in
 * `@reactive-agents/core` (`LLMRequestCompleted.priceSource`) member for member.
 * - `"provider-reported"`: the provider or proxy returned the cost itself
 *   (LiteLLM's `x-litellm-response-cost` header).
 * - `"price-book"`: computed from the bundled snapshot or a proxy's stated rates.
 * - `"user"`: computed from user pricing (`withModelPricing` / a pricing registry).
 * - `"unknown"`: no price is known for the model; the cost is absent, not 0.
 */
export const PriceSourceSchema: Schema.Schema<PriceSource> = Schema.Literal(
  "provider-reported",
  "price-book",
  "user",
  "unknown",
);
/** Provenance of a call's USD cost: core's `PriceSource`, re-exported. */
export type PriceSource = CorePriceSource;

/**
 * Long-context tier. Applies when the request's prompt size is at least
 * `minPromptTokens`; any rate it omits falls back to the base rate.
 */
export const PriceTierSchema = Schema.Struct({
  /** Inclusive lower bound on the prompt size (LiteLLM "above 200k" = 200,001). */
  minPromptTokens: Schema.Number,
  input: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Number),
  cacheRead: Schema.optional(Schema.Number),
  cacheWrite5m: Schema.optional(Schema.Number),
  cacheWrite1h: Schema.optional(Schema.Number),
});
/** A long-context price tier. */
export type PriceTier = Schema.Schema.Type<typeof PriceTierSchema>;

/** The rates of one model, without provenance (the snapshot row shape). */
export const PriceRatesSchema = Schema.Struct({
  /** Uncached input, $/1M tokens. */
  input: Schema.Number,
  /** Output, including hidden reasoning/thinking, $/1M tokens. */
  output: Schema.Number,
  /** Cache hit (read), $/1M tokens. Absent: cache reads bill at `input`. */
  cacheRead: Schema.optional(Schema.Number),
  /** Cache write at the standard TTL (Anthropic 5 minutes), $/1M tokens. Absent: `input`. */
  cacheWrite5m: Schema.optional(Schema.Number),
  /** Cache write at the 1-hour TTL (Anthropic), $/1M tokens. Absent: `cacheWrite5m`. */
  cacheWrite1h: Schema.optional(Schema.Number),
  /** Audio input, $/1M tokens. Absent: `input`. */
  inputAudio: Schema.optional(Schema.Number),
  /** Audio output, $/1M tokens. Absent: `output`. */
  outputAudio: Schema.optional(Schema.Number),
  /** Long-context tiers, ascending by `minPromptTokens`. */
  tiers: Schema.optional(Schema.Array(PriceTierSchema)),
  /** Per-request charges in dollars per request. */
  perRequest: Schema.optional(Schema.Struct({ webSearch: Schema.optional(Schema.Number) })),
});
/** The rates of one model. */
export type PriceRates = Schema.Schema.Type<typeof PriceRatesSchema>;

/**
 * Where a price entry came from:
 * - `"litellm"`: the bundled LiteLLM snapshot.
 * - `"official"`: an override read from the provider's official price page.
 * - `"proxy"`: rates a LiteLLM proxy stated in `/model/info`.
 * - `"local"`: local inference (Ollama), always $0.
 * - `"user"`: user-supplied pricing.
 */
export const PriceEntrySourceSchema = Schema.Literal("litellm", "official", "proxy", "local", "user");
/** Origin of a {@link PriceEntry}. */
export type PriceEntrySource = Schema.Schema.Type<typeof PriceEntrySourceSchema>;

/** One model's price with provenance: what `priceFor` returns. */
export const PriceEntrySchema = Schema.extend(
  PriceRatesSchema,
  Schema.Struct({
    source: PriceEntrySourceSchema,
    /** Date the rates were read (`YYYY-MM-DD`); absent for user pricing. */
    asOf: Schema.optional(Schema.String),
  }),
);
/** One model's price with provenance. */
export type PriceEntry = Schema.Schema.Type<typeof PriceEntrySchema>;

/**
 * User pricing for one model (`withModelPricing`, `PricingProvider` rows),
 * $/1M tokens. Only `input` and `output` are required; an omitted cache rate
 * bills those tokens at `input` (see {@link PriceRatesSchema}).
 */
export const ModelPricingSchema = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.optional(Schema.Number),
  cacheWrite5m: Schema.optional(Schema.Number),
  cacheWrite1h: Schema.optional(Schema.Number),
});
/** User pricing for one model, $/1M tokens. */
export type ModelPricing = Schema.Schema.Type<typeof ModelPricingSchema>;

/** User pricing keyed by model id. */
export type PricingRegistry = Readonly<Record<string, ModelPricing>>;

/** The generated snapshot: rows keyed `"<provider>:<bare model id>"`. */
export const PriceSnapshotSchema = Schema.Struct({
  sourceUrl: Schema.String,
  asOf: Schema.String,
  rows: Schema.Record({ key: Schema.String, value: PriceRatesSchema }),
});
/** The generated price snapshot. */
export type PriceSnapshot = Schema.Schema.Type<typeof PriceSnapshotSchema>;
