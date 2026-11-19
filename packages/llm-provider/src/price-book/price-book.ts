// packages/llm-provider/src/price-book/price-book.ts
//
// PriceBook lookup: the single source of model prices for every adapter, the
// runtime and UIs (Cortex shows $/1M per model through `priceFor`).
//
// Resolution order for (provider, model):
//   1. pricing registry                                    - always wins
//      user rows (`withModelPricing`) -> source "user"; remote rows a
//      PricingProvider stamped with `origin` (`withDynamicPricing`) -> "remote"
//   2. ollama (local inference)                            - always $0
//   3. rates a LiteLLM proxy stated in /model/info          - the operator's prices
//   4. official override (overrides.ts)
//   5. the bundled LiteLLM snapshot (snapshot.generated.ts)
//   otherwise: Option.none() - the price is UNKNOWN. There is no keyword
//   heuristic and no default price: a guessed number is worse than none.
//
// Model ids are matched exactly after alias normalization only: a provider
// prefix is stripped (`openai/gpt-4o`, `gemini/...`, `google/...`, `x-ai/...`)
// and Anthropic's dotted OpenRouter versions are dashed (`claude-sonnet-4.6` ->
// `claude-sonnet-4-6`). Date suffixes are NOT stripped: a dated snapshot can be
// priced differently from its alias (gpt-4o-2024-05-13 vs gpt-4o), so it never inherits the alias row.

import { Context, Layer, Option } from "effect";
import { PRICE_OVERRIDES } from "./overrides.js";
import type { PriceEntry, PriceRates, PricingRegistry, PricingRow } from "./schema.js";
import { PRICE_SNAPSHOT } from "./snapshot.generated.js";

/** Provider prefixes stripped before matching a price row. */
const PREFIX_ALIASES: Readonly<Record<string, readonly string[]>> = {
  anthropic: ["anthropic/"],
  openai: ["openai/"],
  gemini: ["models/", "gemini/", "google/"],
  groq: ["groq/"],
  xai: ["xai/", "x-ai/"],
  mistral: ["mistral/", "mistralai/"],
};

/** LiteLLM route prefix -> price-book provider (`ollama` = local, $0). */
const LITELLM_ROUTES: Readonly<Record<string, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  gemini: "gemini",
  google: "gemini",
  groq: "groq",
  xai: "xai",
  "x-ai": "xai",
  mistral: "mistral",
  mistralai: "mistral",
  ollama: "ollama",
  ollama_chat: "ollama",
};

/** Providers tried, in order, for an un-prefixed LiteLLM model name. */
const BARE_LITELLM_ORDER = ["openai", "anthropic", "gemini", "xai", "mistral", "groq"] as const;

/** Local inference: no per-token bill. */
const LOCAL_ENTRY: PriceEntry = { input: 0, output: 0, source: "local" };

/**
 * The ids a model may be listed under for `provider`, most specific first.
 *
 * @param provider - price-book provider id (`anthropic`, `gemini`, ...)
 * @param model - model id as sent to the provider
 */
export const modelIdCandidates = (provider: string, model: string): readonly string[] => {
  const out = [model];
  let bare = model;
  for (const prefix of PREFIX_ALIASES[provider] ?? []) {
    if (bare.startsWith(prefix)) {
      bare = bare.slice(prefix.length);
      out.push(bare);
    }
  }
  if (provider === "anthropic") {
    const dashed = bare.replace(/(\d)\.(\d)/g, "$1-$2");
    if (dashed !== bare) out.push(dashed);
  }
  return [...new Set(out)];
};

// ─── Proxy-reported rates (LiteLLM /model/info) ───

const reported = new Map<string, PriceRates>();

/**
 * Record the rates a LiteLLM proxy stated for one of its model names (called by
 * the LiteLLM discoverer after parsing /model/info).
 */
export const registerReportedPrice = (provider: string, model: string, rates: PriceRates): void => {
  reported.set(`${provider}:${model}`, rates);
};

/** Test seam: clears proxy-reported rates. */
export const _resetReportedPricesForTesting = (): void => reported.clear();

// ─── Lookup ───

/** A registry row's entry: `"remote"` when a PricingProvider stamped `origin`, else `"user"`. */
const registryEntry = ({ origin, ...rates }: PricingRow): PriceEntry =>
  origin === undefined ? { ...rates, source: "user" } : { ...rates, source: "remote", origin };

const bookLookup = (provider: string, model: string): Option.Option<PriceEntry> => {
  if (provider === "ollama") return Option.some(LOCAL_ENTRY);
  for (const id of modelIdCandidates(provider, model)) {
    const override = PRICE_OVERRIDES[`${provider}:${id}`];
    if (override !== undefined) return Option.some({ ...override.rates, source: "official", asOf: override.asOf });
    const row = PRICE_SNAPSHOT.rows[`${provider}:${id}`];
    if (row !== undefined) return Option.some({ ...row, source: "litellm", asOf: PRICE_SNAPSHOT.asOf });
  }
  return Option.none();
};

const liteLLMLookup = (model: string): Option.Option<PriceEntry> => {
  const slash = model.indexOf("/");
  if (slash > 0) {
    const routed = LITELLM_ROUTES[model.slice(0, slash)];
    return routed === undefined ? Option.none() : bookLookup(routed, model.slice(slash + 1));
  }
  for (const provider of BARE_LITELLM_ORDER) {
    const hit = bookLookup(provider, model);
    if (Option.isSome(hit)) return hit;
  }
  return Option.none();
};

/**
 * The price of `model` on `provider`, or `Option.none()` when RA does not know
 * it. `none` means "unknown", never "free".
 *
 * @param provider - RA provider id (`anthropic`, `openai`, `gemini`, `groq`,
 *   `xai`, `litellm`, `ollama`, ...)
 * @param model - model id as sent to the provider
 * @param registry - pricing keyed by model id; wins over every other source.
 *   Rows with `origin` (remote, `withDynamicPricing`) report source `"remote"`;
 *   rows without it report `"user"`.
 */
export const priceFor = (
  provider: string,
  model: string,
  registry?: PricingRegistry,
): Option.Option<PriceEntry> => {
  if (registry !== undefined) {
    for (const id of modelIdCandidates(provider, model)) {
      const row = registry[id];
      if (row !== undefined) return Option.some(registryEntry(row));
    }
  }
  const proxy = reported.get(`${provider}:${model}`);
  if (proxy !== undefined) return Option.some({ ...proxy, source: "proxy" });
  return provider === "litellm" ? liteLLMLookup(model) : bookLookup(provider, model);
};

/**
 * Every model id the bundled PriceBook (snapshot + official overrides) prices
 * for `provider`, sorted, deduplicated. Ids are returned exactly as keyed: no
 * alias folding (the book has no alias table, so none is invented here).
 * Used by model discovery as the "known models" fallback when a live list fails.
 *
 * @param provider - price-book provider id (`xai`, `anthropic`, ...)
 */
export const pricedModelIds = (provider: string): readonly string[] => {
  const prefix = `${provider}:`;
  const ids = new Set<string>();
  for (const key of [...Object.keys(PRICE_SNAPSHOT.rows), ...Object.keys(PRICE_OVERRIDES)]) {
    if (key.startsWith(prefix) && key.length > prefix.length) ids.add(key.slice(prefix.length));
  }
  return [...ids].sort();
};

/** Date and URL of the bundled price snapshot. */
export const priceSnapshotInfo = (): { readonly asOf: string; readonly sourceUrl: string } => ({
  asOf: PRICE_SNAPSHOT.asOf,
  sourceUrl: PRICE_SNAPSHOT.sourceUrl,
});

// ─── Service ───

/**
 * PriceBook service: model price lookup for runtimes and UIs that resolve
 * services from a Layer. Adapters call {@link priceFor} directly.
 */
export class PriceBook extends Context.Tag("PriceBook")<
  PriceBook,
  {
    /** Price of `model` on `provider`; `none` = unknown. User pricing wins. */
    readonly priceFor: (provider: string, model: string) => Option.Option<PriceEntry>;
  }
>() {}

/**
 * PriceBook Layer over the bundled snapshot.
 *
 * @param registry - user pricing keyed by model id (wins over the snapshot)
 */
export const PriceBookLive = (registry?: PricingRegistry): Layer.Layer<PriceBook> =>
  Layer.succeed(PriceBook, { priceFor: (provider, model) => priceFor(provider, model, registry) });
