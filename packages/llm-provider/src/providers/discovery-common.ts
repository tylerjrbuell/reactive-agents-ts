// packages/llm-provider/src/providers/discovery-common.ts
//
// What every hosted capability discoverer shares (Gemini, Anthropic, LiteLLM):
//   - skip the request when the answer is known: a static row (it overrides
//     discovery) or reported metadata already registered (an earlier
//     discovery, the model listing, or a limit learned from an error);
//   - keep only answers that state a context window (the reported tier builds
//     no row without one);
//   - a JSON GET through an injectable fetch that the runner's timeout aborts.

import { Effect, Option } from "effect";
import { STATIC_CAPABILITIES } from "../capability.js";
import { reportedModelMetadataFor, type ReportedModelMetadata } from "../capability-reported.js";
import type { DiscoveredCapability } from "../capability-discovery.js";

/** The subset of `fetch` discovery uses; inject a stub in tests. */
export type DiscoveryFetch = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>>; readonly signal: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; readonly json: () => Promise<unknown> }>;

/** Positive finite integer, else undefined. */
export const positiveInt = (n: unknown): number | undefined =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;

/**
 * Answer from the existing tiers when possible, otherwise run `ask`.
 *
 * @param provider - provider id
 * @param model - model id as sent to the provider
 * @param ask - the provider request; may fail, which yields `Option.none()`
 * @returns `Reported` metadata that states a context window, or `Option.none()`
 */
export const discoverReported = (
  provider: string,
  model: string,
  ask: () => Effect.Effect<Option.Option<ReportedModelMetadata>, unknown>,
): Effect.Effect<Option.Option<DiscoveredCapability>> =>
  Effect.suspend(() => {
    if (STATIC_CAPABILITIES[`${provider}/${model}`] !== undefined) {
      return Effect.succeed(Option.none<DiscoveredCapability>());
    }
    const known = reportedModelMetadataFor(provider, model);
    if (known?.maxContextTokens !== undefined) {
      return Effect.succeed(Option.some<DiscoveredCapability>({ _tag: "Reported", metadata: known }));
    }
    return ask().pipe(
      Effect.map((found) =>
        Option.flatMap(found, (metadata): Option.Option<DiscoveredCapability> =>
          metadata.maxContextTokens === undefined
            ? Option.none()
            : Option.some({ _tag: "Reported", metadata: { ...known, ...metadata } }),
        ),
      ),
      Effect.orElseSucceed(() => Option.none<DiscoveredCapability>()),
    );
  });

/**
 * GET a JSON body. Fails on a non-2xx status or a body that is not JSON; the
 * signal is aborted when the runner's timeout interrupts the effect.
 *
 * @param fetchImpl - fetch implementation
 * @param url - absolute URL
 * @param headers - request headers (credentials for this provider only)
 */
export const getJson = (
  fetchImpl: DiscoveryFetch,
  url: string,
  headers: Readonly<Record<string, string>>,
): Effect.Effect<unknown, unknown> =>
  Effect.tryPromise({
    try: async (signal) => {
      const res = await fetchImpl(url, { headers, signal });
      if (!res.ok) return Promise.reject(`HTTP ${res.status}`);
      return res.json();
    },
    catch: (cause) => cause,
  });
