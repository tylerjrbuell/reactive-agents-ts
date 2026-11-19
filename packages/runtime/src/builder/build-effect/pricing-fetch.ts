/**
 * Pricing fetch extraction for buildEffect (W26-B step 1).
 *
 * Fetches remote pricing through the configured PricingProvider and merges it
 * under the user's registry: a model the user priced with `withModelPricing`
 * keeps the user's rates; remote rows only add models the user did not price.
 *
 * Failure policy:
 * - strict (`withStrictValidation`): a fetch failure fails the build.
 * - otherwise: a pricing outage never fails `build()`. The registry stays the
 *   user's, every other model is priced from the bundled PriceBook snapshot
 *   (`priceFor` in `@reactive-agents/llm-provider`), and the failure is
 *   surfaced as a typed {@link DynamicPricingUnavailable} on the output plus a
 *   load-bearing warning (console, structured log, `ErrorSwallowed` event).
 *
 * The fallback is Effect-native: a failing fetch is an Effect failure, which a
 * `try/catch` around `yield*` never sees (audit 2026-11-19 F7).
 */
import { Cause, Effect } from "effect";
import { emitLoadBearingFailure, errorMessage, errorTag } from "@reactive-agents/core";
import { markRemotePricing, type PricingProvider, type PricingRow } from "@reactive-agents/llm-provider";

/** Pricing rows keyed by model id, $/1M tokens (cache rates optional); `origin` set = remote row. */
export type PricingRegistryRecord = Record<string, PricingRow>;

export interface PricingFetchInput {
  readonly pricingProvider?: PricingProvider;
  /** The user's `withModelPricing` rows; they win over remote rows. */
  readonly pricingRegistry: PricingRegistryRecord;
  readonly strict: boolean;
}

/**
 * Typed warning: the dynamic pricing fetch failed and the build fell back to
 * the user's registry plus the bundled PriceBook snapshot.
 */
export interface DynamicPricingUnavailable {
  readonly _tag: "DynamicPricingUnavailable";
  /** `errorTag` of the failure (or `"Defect"` for a thrown fetch). */
  readonly tag: string;
  readonly message: string;
}

export interface PricingFetchOutput {
  readonly registry: PricingRegistryRecord;
  /** Present only when the fetch failed in non-strict mode. */
  readonly fallback?: DynamicPricingUnavailable;
}

const unavailable = (cause: Cause.Cause<unknown>): DynamicPricingUnavailable => {
  const failure = Cause.failureOption(cause);
  return failure._tag === "Some"
    ? { _tag: "DynamicPricingUnavailable", tag: errorTag(failure.value), message: errorMessage(failure.value) }
    : { _tag: "DynamicPricingUnavailable", tag: "Defect", message: Cause.pretty(cause) };
};

export const fetchAndMergePricing = ({
  pricingProvider,
  pricingRegistry,
  strict,
}: PricingFetchInput): Effect.Effect<PricingFetchOutput, Error> => {
  if (!pricingProvider) return Effect.succeed({ registry: pricingRegistry });
  const merged = pricingProvider.fetchPricing().pipe(
    // User rows spread last: explicit user pricing always beats remote rows.
    // Remote rows without an `origin` are stamped, so they price as
    // "remote", never as "user".
    Effect.map((remote): PricingFetchOutput => ({
      registry: { ...markRemotePricing(remote, "pricing-provider"), ...pricingRegistry },
    })),
  );
  if (strict) return merged;
  return merged.pipe(
    Effect.catchAllCause((cause) => {
      // An interrupted build stays interrupted; only failures and defects fall back.
      if (Cause.isInterruptedOnly(cause)) return Effect.failCause(cause);
      const fallback = unavailable(cause);
      return emitLoadBearingFailure({
        capability: "dynamic-pricing",
        site: "runtime/src/builder/build-effect/pricing-fetch.ts:fallback",
        tag: fallback.tag,
        message: `${fallback.message}; using user pricing and the bundled price snapshot`,
      }).pipe(Effect.as<PricingFetchOutput>({ registry: pricingRegistry, fallback }));
    }),
  );
};
