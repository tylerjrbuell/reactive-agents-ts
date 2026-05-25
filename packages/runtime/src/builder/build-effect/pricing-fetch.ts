/**
 * Pricing fetch extraction for buildEffect (W26-B step 1).
 *
 * Fetches remote pricing through the configured PricingProvider and merges
 * into the static registry. In strict mode, fetch failures propagate as Effect
 * errors; otherwise they log a console warning and the original registry is
 * returned unchanged.
 */
import { Effect } from "effect";
import type { PricingProvider } from "@reactive-agents/llm-provider";

export interface PricingFetchInput {
  readonly pricingProvider?: PricingProvider;
  readonly pricingRegistry: Record<
    string,
    { readonly input: number; readonly output: number }
  >;
  readonly strict: boolean;
}

export interface PricingFetchOutput {
  readonly registry: Record<
    string,
    { readonly input: number; readonly output: number }
  >;
}

export const fetchAndMergePricing = ({
  pricingProvider,
  pricingRegistry,
  strict,
}: PricingFetchInput): Effect.Effect<PricingFetchOutput, Error> =>
  Effect.gen(function* () {
    if (!pricingProvider) {
      return { registry: pricingRegistry };
    }
    try {
      const remotePricing = yield* pricingProvider.fetchPricing();
      return {
        registry: { ...pricingRegistry, ...remotePricing },
      };
    } catch (e) {
      if (strict) {
        return yield* Effect.fail(e as Error);
      }
      console.warn(
        `[Pricing] Failed to fetch dynamic pricing — falling back to static map. ${e}`,
      );
      return { registry: pricingRegistry };
    }
  });
