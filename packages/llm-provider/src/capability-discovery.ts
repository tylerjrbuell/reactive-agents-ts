// packages/llm-provider/src/capability-discovery.ts
//
// Per-provider capability discovery: the general way an unknown model id gets
// its real limits instead of the 2048-token fallback.
//
// Providers ship model ids faster than this package ships static rows. Most of
// them can state a model's limits on request (Ollama /api/show, Gemini
// models.get). A provider that can registers a `CapabilityDiscoverer` here;
// `discoverCapability` runs it once, early, in the async build path
// (`primeCapability`), and writes the answer through to the registries the
// synchronous resolver already reads:
//
//   - `Reported` -> provider-reported tier (capability-reported.ts), which ranks
//     BELOW cache, probe, static-table and user rows: a static row overrides
//     discovery, it is no longer a requirement.
//   - `Probed`   -> probed registry (capability-resolver.ts), for probes that
//     measure a full Capability (Ollama).
//
// Contract every discoverer keeps:
//   - never fails: anything it cannot learn is `Option.none()`;
//   - asks the provider at most once per (provider, model) per process for an
//     answer it already has (Gemini checks the reported registry, Ollama its
//     endpoint-scoped probe cache), so the cache is the existing tier rows,
//     not a second store.
// The runner adds what every provider needs: a timeout, defect absorption, the
// write-through, and the one-time fallback warning when nothing was learned.
//
// Shipped discoverers: ollama (/api/show probe), gemini (models.get).
// Not yet: anthropic (GET /v1/models/{id}: max_input_tokens, max_tokens,
// capabilities.thinking), openai (its /v1/models reports no limits), litellm
// (/model/info, unverified). Each is one `CapabilityDiscoverer` returning
// `Reported` metadata, registered in DEFAULT_DISCOVERERS.

import { Duration, Effect, Option } from "effect";
import type { Capability } from "./capability.js";
import { registerReportedModelMetadata, type ReportedModelMetadata } from "./capability-reported.js";
import {
  registerProbedCapability,
  resolveCapability,
  warnCapabilityFallback,
} from "./capability-resolver.js";
import { probeOllamaCapability } from "./providers/local-probe.js";
import { resolveOllamaTarget } from "./ollama-endpoint.js";
import { makeGeminiCapabilityDiscoverer } from "./providers/gemini-discovery.js";

/** What a discoverer learned about one model. */
export type DiscoveredCapability =
  /** Limits the provider stated; fed to the provider-reported tier. */
  | { readonly _tag: "Reported"; readonly metadata: ReportedModelMetadata }
  /** A full measured Capability (live probe); fed to the probed registry. */
  | { readonly _tag: "Probed"; readonly capability: Capability };

/** Connection details a discoverer may need. */
export interface CapabilityDiscoveryContext {
  /** Provider base URL, when the caller configured one. */
  readonly endpoint?: string;
  /** Credential the caller configured; discoverers fall back to their env var. */
  readonly apiKey?: string;
}

/**
 * Provider hook: learn a model's capability from the provider itself.
 * Must not fail; return `Option.none()` when nothing could be learned.
 * Interruption (the runner's timeout) must be safe.
 */
export type CapabilityDiscoverer = (
  model: string,
  ctx: CapabilityDiscoveryContext,
) => Effect.Effect<Option.Option<DiscoveredCapability>>;

/** Options for {@link discoverCapability}. */
export interface DiscoverCapabilityOptions extends CapabilityDiscoveryContext {
  /** Upper bound on one discovery, in ms. Default 5000. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/** Ollama: the existing /api/show probe (endpoint-scoped, store-backed). */
const ollamaDiscoverer: CapabilityDiscoverer = (model, ctx) =>
  Effect.promise(() => {
    const { endpoint, apiKey } = resolveOllamaTarget({ baseUrl: ctx.endpoint, apiKey: ctx.apiKey });
    return probeOllamaCapability(model, endpoint, apiKey);
  }).pipe(
    Effect.map((cap) =>
      cap === null ? Option.none() : Option.some({ _tag: "Probed" as const, capability: cap }),
    ),
  );

const defaultDiscoverers = (): Map<string, CapabilityDiscoverer> =>
  new Map<string, CapabilityDiscoverer>([
    ["ollama", ollamaDiscoverer],
    ["gemini", makeGeminiCapabilityDiscoverer()],
  ]);

let discoverers = defaultDiscoverers();

/**
 * Install (or replace) the discoverer for a provider. Use it to add discovery
 * for a provider this package does not cover, or to point one at a proxy.
 *
 * @param provider — provider id as passed to `withProvider()`
 * @param discoverer — the hook to run for that provider's unknown models
 */
export function registerCapabilityDiscoverer(provider: string, discoverer: CapabilityDiscoverer): void {
  discoverers.set(provider, discoverer);
}

/** The discoverer registered for a provider, if any. */
export function capabilityDiscovererFor(provider: string): CapabilityDiscoverer | undefined {
  return discoverers.get(provider);
}

/** Test seam: restores the shipped discoverers. */
export function _resetCapabilityDiscoverersForTesting(): void {
  discoverers = defaultDiscoverers();
}

const writeThrough = (provider: string, model: string, found: DiscoveredCapability): void => {
  if (found._tag === "Probed") registerProbedCapability(found.capability);
  else registerReportedModelMetadata(provider, model, found.metadata);
};

/**
 * Run the provider's discoverer for `model`, bounded by a timeout, and write
 * what it learned through to the resolver's tiers. Never fails. When nothing
 * was learned and the model still resolves to the fallback, the one-time
 * fallback warning fires.
 *
 * @param provider — provider id
 * @param model — model id as sent to the provider
 * @param opts — endpoint, credential, timeout
 * @returns what was learned, or `Option.none()`
 */
export function discoverCapability(
  provider: string,
  model: string,
  opts: DiscoverCapabilityOptions = {},
): Effect.Effect<Option.Option<DiscoveredCapability>> {
  return Effect.suspend(() => {
    const discoverer = discoverers.get(provider);
    if (discoverer === undefined || model.length === 0) {
      return Effect.succeed(Option.none<DiscoveredCapability>());
    }
    return discoverer(model, { endpoint: opts.endpoint, apiKey: opts.apiKey }).pipe(
      Effect.timeoutTo({
        duration: Duration.millis(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        onSuccess: (found) => found,
        onTimeout: () => Option.none<DiscoveredCapability>(),
      }),
      Effect.catchAllCause(() => Effect.succeed(Option.none<DiscoveredCapability>())),
      Effect.tap((found) =>
        Effect.sync(() => {
          if (Option.isSome(found)) writeThrough(provider, model, found.value);
          else if (resolveCapability(provider, model).source === "fallback") {
            warnCapabilityFallback(provider, model);
          }
        }),
      ),
    );
  });
}
