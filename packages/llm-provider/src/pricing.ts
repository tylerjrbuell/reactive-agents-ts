import { Effect } from "effect";
import type { ModelPricing, PricingRow } from "./price-book/schema.js";

export type { ModelPricing, PricingRow } from "./price-book/schema.js";

/** OpenRouter's model list, the `origin` of {@link openRouterPricingProvider} rows. */
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Per-token decimal string -> $/1M tokens, or undefined when absent/invalid. */
const perMillion = (perToken: string | undefined): number | undefined => {
  if (perToken === undefined) return undefined;
  const n = parseFloat(perToken);
  return Number.isFinite(n) && n >= 0 ? Number((n * 1_000_000).toPrecision(12)) : undefined;
};

/**
 * Normalized interface for dynamic LLM pricing providers.
 * Implement this interface to fetch live pricing from APIs or custom sources.
 */
export interface PricingProvider {
  /**
   * Fetch and return a pricing registry for all available models.
   * Maps model identifiers (e.g. "gpt-4o", "anthropic/claude-3-opus") to their USD cost per 1M tokens.
   * Set each row's `origin` to the price list's URL or name so the PriceBook
   * labels it `"remote"`, not `"user"` (see `markRemotePricing`).
   */
  fetchPricing(): Effect.Effect<Record<string, PricingRow>, Error, never>;
}

/**
 * OpenRouter Pricing Provider.
 * Fetches the latest live pricing for all 100+ models available on OpenRouter.
 * OpenRouter model IDs look like: "openai/gpt-4o", "meta-llama/llama-3-70b-instruct"
 */
export const openRouterPricingProvider: PricingProvider = {
  fetchPricing: () =>
    Effect.gen(function* () {
      const res = yield* Effect.tryPromise({
        try: () => fetch(OPENROUTER_MODELS_URL),
        catch: (e) => new Error(`Fetch failed: ${e}`),
      });

      if (!res.ok) {
        return yield* Effect.fail(new Error(`OpenRouter API returned ${res.status}`));
      }

      const json = (yield* Effect.tryPromise({
        try: () => res.json(),
        catch: (e) => new Error(`JSON parse failed: ${e}`),
      })) as {
        data: Array<{
          id: string;
          pricing: {
            prompt: string;
            completion: string;
            input_cache_read?: string;
            input_cache_write?: string;
            input_cache_write_1h?: string;
          };
        }>;
      };

      const registry: Record<string, PricingRow> = {};
      for (const model of json.data) {
        // OpenRouter pricing is per token; the registry is $/1M tokens.
        const input = perMillion(model.pricing.prompt);
        const output = perMillion(model.pricing.completion);
        if (input === undefined || output === undefined) continue;
        const cacheRead = perMillion(model.pricing.input_cache_read);
        const cacheWrite5m = perMillion(model.pricing.input_cache_write);
        const cacheWrite1h = perMillion(model.pricing.input_cache_write_1h);
        const row: PricingRow = {
          input,
          output,
          ...(cacheRead !== undefined ? { cacheRead } : {}),
          ...(cacheWrite5m !== undefined ? { cacheWrite5m } : {}),
          ...(cacheWrite1h !== undefined ? { cacheWrite1h } : {}),
          origin: OPENROUTER_MODELS_URL,
        };
        registry[model.id] = row;
        // Short and native aliases: "gpt-4o" for "openai/gpt-4o"; Anthropic API
        // ids dash the version OpenRouter dots ("claude-sonnet-4.6" -> "-4-6").
        const shortName = model.id.split("/").pop();
        const aliases = [shortName];
        if (model.id.startsWith("anthropic/") && shortName) {
          aliases.push(shortName.replace(/(\d)\.(\d)/g, "$1-$2"));
        }
        for (const alias of aliases) {
          if (alias && !registry[alias]) registry[alias] = row;
        }
      }

      return registry;
    }),
};

/**
 * Custom URL Pricing Provider.
 * Fetches pricing from a custom HTTP endpoint (like a GitHub Gist) that returns a JSON record.
 * 
 * @example
 * ```json
 * {
 *   "my-fine-tuned-model": { "input": 0.5, "output": 1.5 },
 *   "another-model": { "input": 2.0, "output": 4.0 }
 * }
 * ```
 */
export const urlPricingProvider = (url: string): PricingProvider => ({
  fetchPricing: () =>
    Effect.gen(function* () {
      const res = yield* Effect.tryPromise({
        try: () => fetch(url),
        catch: (e) => new Error(`Fetch failed: ${e}`),
      });

      if (!res.ok) {
        return yield* Effect.fail(new Error(`Custom pricing URL returned ${res.status}`));
      }

      const json = (yield* Effect.tryPromise({
        try: () => res.json(),
        catch: (e) => new Error(`JSON parse failed: ${e}`),
      })) as Record<string, ModelPricing>;

      const registry: Record<string, PricingRow> = {};
      for (const [key, value] of Object.entries(json)) {
        // Optional cache rates ($/1M) pass through when numeric.
        const extra: Record<string, number> = {};
        for (const field of ["cacheRead", "cacheWrite5m", "cacheWrite1h"] as const) {
          if (typeof value[field] === "number") extra[field] = value[field];
        }
        registry[key] = {
          input: Number(value.input),
          output: Number(value.output),
          ...extra,
          origin: url,
        };
      }

      return registry;
    }),
});
