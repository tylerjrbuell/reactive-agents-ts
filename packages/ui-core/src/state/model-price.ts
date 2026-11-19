/**
 * Model price display for model pickers and model pages. The wire shape is the
 * `price` field of Cortex `GET /api/models/:provider` rows, which a server reads
 * from the llm-provider PriceBook (`priceFor`). Rates are dollars per 1M tokens.
 */

/** Where a model price came from (llm-provider `PriceEntrySource`). */
export type ModelPriceSource = "litellm" | "official" | "proxy" | "local" | "remote" | "user";

/** A long-context price tier: rates that apply at or above `minPromptTokens`. */
export interface ModelPriceTier {
  readonly minPromptTokens: number;
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
}

/** One model's price, $/1M tokens. */
export interface ModelPrice {
  /** Uncached input, $/1M tokens. */
  readonly input: number;
  /** Output (including hidden reasoning), $/1M tokens. */
  readonly output: number;
  /** Cache hit (read), $/1M tokens; absent = billed at `input`. */
  readonly cacheRead?: number;
  /** Long-context tiers, ascending by `minPromptTokens`. */
  readonly tiers?: readonly ModelPriceTier[];
  readonly source: ModelPriceSource;
  /** Date the rates were read (`YYYY-MM-DD`); absent for user pricing. */
  readonly asOf?: string;
  /** The remote price list a `"remote"` price came from (URL or provider name). */
  readonly origin?: string;
}

/** True when the model runs locally and has no per-token bill. */
export function isLocalPrice(price: ModelPrice | undefined): boolean {
  return price?.source === "local";
}

/**
 * One rate in $/1M: `$3`, `$0.15`, `$0.075`, `$0`. Keeps up to three
 * significant decimals below a dollar and drops trailing zeros.
 */
export function formatPerMillion(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd >= 1) return `$${Number(usd.toFixed(2))}`;
  return `$${Number(usd.toPrecision(3))}`;
}

/**
 * True when a hosted (non-local) model is billed $0 for every rate: input,
 * output, cache read and every long-context tier. A real price, not missing
 * data: e.g. Gemma 4 on the Gemini API, which Google lists as free of charge
 * on the free tier with no paid-tier price.
 */
export function isFreePrice(price: ModelPrice | undefined): boolean {
  if (price === undefined || isLocalPrice(price)) return false;
  const zero = (n: number | undefined): boolean => n === undefined || n === 0;
  return (
    price.input === 0 &&
    price.output === 0 &&
    zero(price.cacheRead) &&
    (price.tiers ?? []).every((t) => zero(t.input) && zero(t.output) && zero(t.cacheRead))
  );
}

/**
 * Short price text for a model row: `$3 / $15 per 1M`, `free (local)` for
 * local inference, `free` for a hosted model billed $0 in and out (see
 * {@link isFreePrice}), `price unknown` when there is no price.
 */
export function formatModelPrice(price: ModelPrice | undefined): string {
  if (price === undefined) return "price unknown";
  if (isLocalPrice(price)) return "free (local)";
  if (isFreePrice(price)) return "free";
  return `${formatPerMillion(price.input)} / ${formatPerMillion(price.output)} per 1M`;
}

/**
 * One-sentence price detail for a tooltip beside {@link formatModelPrice}:
 * what the short label means and where the rate came from.
 */
export function modelPriceDetail(price: ModelPrice | undefined): string {
  if (price === undefined) return "Price unknown: the framework has no rate for this model.";
  if (isLocalPrice(price)) return "Free (local): local inference has no per-token bill.";
  const source = priceSourceLabel(price);
  if (isFreePrice(price)) {
    return `Free: billed $0 per 1M input and output tokens (free tier; no paid tier price). Source: ${source}`;
  }
  return `${formatModelPrice(price)}. Source: ${source}`;
}

/** Label for a price's provenance, for a price card or tooltip. */
export function priceSourceLabel(price: ModelPrice): string {
  const from =
    price.source === "litellm"
      ? "LiteLLM price list"
      : price.source === "official"
        ? "provider price page"
        : price.source === "proxy"
          ? "LiteLLM proxy"
          : price.source === "local"
            ? "local inference"
            : price.source === "remote"
              ? price.origin
                ? `remote price list (${price.origin})`
                : "remote price list"
              : "your pricing";
  return price.asOf ? `${from}, as of ${price.asOf}` : from;
}

/**
 * Order models by price, cheapest first: by input $/1M, then output $/1M.
 * Local models sort first ($0), then free hosted models ($0, see
 * {@link isFreePrice}); models with no price sort last.
 */
export function compareByPrice(a: ModelPrice | undefined, b: ModelPrice | undefined): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  const localFirst = Number(isLocalPrice(b)) - Number(isLocalPrice(a));
  return a.input - b.input || a.output - b.output || localFirst;
}
