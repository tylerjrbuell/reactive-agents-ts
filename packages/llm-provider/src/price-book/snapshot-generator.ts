// packages/llm-provider/src/price-book/snapshot-generator.ts
//
// Pure generator for the bundled price snapshot. Input: LiteLLM's
// model_prices_and_context_window.json (already parsed). Output: a small,
// reviewable snapshot holding only the providers and fields RA bills, in
// dollars per 1M tokens, keyed "<RA provider>:<bare model id>".
//
// No I/O here: a script (scripts/update-prices.ts, tooling-warden) downloads
// the JSON, calls `buildPriceSnapshot`, and writes `renderPriceSnapshotModule`'s
// output to snapshot.generated.ts.

import type { PriceRates, PriceSnapshot, PriceTier } from "./schema.js";

/** Canonical download URL of LiteLLM's price table. */
export const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** LiteLLM `litellm_provider` value -> RA price-book provider id. */
const PROVIDERS: Readonly<Record<string, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  gemini: "gemini",
  groq: "groq",
  xai: "xai",
  mistral: "mistral",
};

/** Row modes RA can bill (chat-style text generation and embeddings). */
const MODES = new Set(["chat", "responses", "completion", "embedding"]);

type Rec = Readonly<Record<string, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

/** $/token -> $/1M tokens, rounded to 12 significant digits (drops float noise). */
const perMillion = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Number((n * 1_000_000).toPrecision(12));
};

const TIERED: ReadonlyArray<readonly [string, keyof Omit<PriceTier, "minPromptTokens">]> = [
  ["input_cost_per_token", "input"],
  ["output_cost_per_token", "output"],
  ["cache_read_input_token_cost", "cacheRead"],
  ["cache_creation_input_token_cost", "cacheWrite5m"],
  ["cache_creation_input_token_cost_above_1hr", "cacheWrite1h"],
];

/** Long-context tiers from `<field>_above_<N>k_tokens` keys. */
const tiersOf = (row: Rec): PriceTier[] => {
  const byThreshold = new Map<number, Record<string, number>>();
  for (const [field, target] of TIERED) {
    const re = new RegExp(`^${field}_above_(\\d+)k_tokens$`);
    for (const [key, value] of Object.entries(row)) {
      const m = re.exec(key);
      const rate = perMillion(value);
      if (m === null || rate === undefined) continue;
      // "above 200k" = more than 200,000 prompt tokens.
      const min = Number(m[1]) * 1000 + 1;
      const tier = byThreshold.get(min) ?? {};
      tier[target] = rate;
      byThreshold.set(min, tier);
    }
  }
  return [...byThreshold.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minPromptTokens, rates]) => ({ minPromptTokens, ...rates }));
};

/** One LiteLLM row -> RA rates, or undefined when it has no token prices. */
const ratesOf = (row: Rec): PriceRates | undefined => {
  const input = perMillion(row.input_cost_per_token);
  const output = perMillion(row.output_cost_per_token);
  if (input === undefined || output === undefined) return undefined;
  const optional: Record<string, number> = {};
  const put = (name: string, v: number | undefined) => {
    if (v !== undefined) optional[name] = v;
  };
  put("cacheRead", perMillion(row.cache_read_input_token_cost));
  put("cacheWrite5m", perMillion(row.cache_creation_input_token_cost));
  put("cacheWrite1h", perMillion(row.cache_creation_input_token_cost_above_1hr));
  put("inputAudio", perMillion(row.input_cost_per_audio_token));
  put("outputAudio", perMillion(row.output_cost_per_audio_token));
  const tiers = tiersOf(row);
  const search = isRec(row.search_context_cost_per_query)
    ? num(row.search_context_cost_per_query.search_context_size_medium)
    : undefined;
  return {
    input,
    output,
    ...optional,
    ...(tiers.length > 0 ? { tiers } : {}),
    ...(search !== undefined ? { perRequest: { webSearch: search } } : {}),
  };
};

/**
 * Filter and normalize LiteLLM's price table into RA's snapshot.
 *
 * Keeps rows whose provider RA bills and whose mode is text or embedding;
 * drops fine-tune templates (`ft:`), rows without token prices, and rows whose
 * `deprecation_date` is before `asOf` (retired at the provider). The provider
 * prefix (`gemini/`, `groq/`, `xai/`, `mistral/`) is stripped; when a bare and
 * a prefixed row collide, the prefixed (provider-native) row wins.
 *
 * @param litellm - parsed model_prices_and_context_window.json
 * @param asOf - date the table was downloaded, `YYYY-MM-DD`
 * @param sourceUrl - where it was downloaded from
 */
export const buildPriceSnapshot = (
  litellm: unknown,
  asOf: string,
  sourceUrl: string = LITELLM_PRICES_URL,
): PriceSnapshot => {
  const rows: Record<string, PriceRates> = {};
  const fromPrefixed = new Set<string>();
  if (!isRec(litellm)) return { sourceUrl, asOf, rows };
  for (const [key, row] of Object.entries(litellm)) {
    if (!isRec(row) || typeof row.litellm_provider !== "string") continue;
    const provider = PROVIDERS[row.litellm_provider];
    if (provider === undefined || !MODES.has(String(row.mode)) || key.startsWith("ft:")) continue;
    if (typeof row.deprecation_date === "string" && row.deprecation_date < asOf) continue;
    const prefixed = key.startsWith(`${provider}/`);
    const bare = prefixed ? key.slice(provider.length + 1) : key;
    // openai rows never carry a prefix; a slash there is a non-model entry.
    if (provider === "openai" && bare.includes("/")) continue;
    const id = `${provider}:${bare}`;
    if (!prefixed && fromPrefixed.has(id)) continue;
    const rates = ratesOf(row);
    if (rates === undefined) continue;
    rows[id] = rates;
    if (prefixed) fromPrefixed.add(id);
  }
  const sorted: Record<string, PriceRates> = {};
  for (const id of Object.keys(rows).sort()) sorted[id] = rows[id]!;
  return { sourceUrl, asOf, rows: sorted };
};

/**
 * Render a snapshot as the TypeScript module committed at
 * `src/price-book/snapshot.generated.ts` (one row per line, reviewable diffs).
 */
export const renderPriceSnapshotModule = (snapshot: PriceSnapshot): string => {
  const lines = Object.entries(snapshot.rows).map(
    ([id, rates]) => `    ${JSON.stringify(id)}: ${JSON.stringify(rates)},`,
  );
  return [
    "// GENERATED by buildPriceSnapshot (price-book/snapshot-generator.ts). Do not edit by hand:",
    "// regenerate from LiteLLM's table. Corrections go in price-book/overrides.ts.",
    "// Rates are dollars per 1M tokens; perRequest rates are dollars per request.",
    'import type { PriceSnapshot } from "./schema.js";',
    "",
    "/** Bundled LiteLLM price snapshot, filtered to RA's providers. */",
    "export const PRICE_SNAPSHOT: PriceSnapshot = {",
    `  sourceUrl: ${JSON.stringify(snapshot.sourceUrl)},`,
    `  asOf: ${JSON.stringify(snapshot.asOf)},`,
    "  rows: {",
    ...lines,
    "  },",
    "};",
    "",
  ].join("\n");
};
