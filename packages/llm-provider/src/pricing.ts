import { Effect } from "effect";

/**
 * Token costs per 1 million tokens in USD.
 */
export interface ModelPricing {
  readonly input: number;
  readonly output: number;
}

/**
 * Normalized interface for dynamic LLM pricing providers.
 * Implement this interface to fetch live pricing from APIs or custom sources.
 */
export interface PricingProvider {
  /**
   * Fetch and return a pricing registry for all available models.
   * Maps model identifiers (e.g. "gpt-4o", "anthropic/claude-3-opus") to their USD cost per 1M tokens.
   */
  fetchPricing(): Effect.Effect<Record<string, ModelPricing>, Error, never>;
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
        try: () => fetch("https://openrouter.ai/api/v1/models"),
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
          pricing: { prompt: string; completion: string };
        }>;
      };

      const registry: Record<string, ModelPricing> = {};
      for (const model of json.data) {
        // OpenRouter pricing is per-1-token. Multiply by 1M to get per-1M cost.
        // Some free models list "0", which is handled fine by parseFloat.
        registry[model.id] = {
          input: parseFloat(model.pricing.prompt) * 1_000_000,
          output: parseFloat(model.pricing.completion) * 1_000_000,
        };
        // Also add the shortest name since users might just say "gpt-4o"
        const shortName = model.id.split("/").pop();
        if (shortName && !registry[shortName]) {
          registry[shortName] = registry[model.id];
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
      })) as Record<string, { input: number; output: number }>;

      const registry: Record<string, ModelPricing> = {};
      for (const [key, value] of Object.entries(json)) {
        registry[key] = {
          input: Number(value.input),
          output: Number(value.output),
        };
      }

      return registry;
    }),
});
