// packages/llm-provider/src/capability-resolver.ts
//
// Phase 1 Sprint 1 S1.3 — Capability resolver.
// Spec: docs/spec/docs/15-design-north-star.md §3.
//
// Three-tier resolution at builder-time. The resolved Capability flows into
// `createRuntime(config, capability)` (S1.4) and from there into provider
// adapters that consume capability fields (e.g. Ollama uses
// `recommendedNumCtx` to set `options.num_ctx`).
//
//   1. Cached probe — `cache.loadCapability(provider, model)` if present.
//      Caches are populated externally (probe a model on first use, write
//      through with `source: "probe"`). The resolver only READS the cache;
//      probing logic lives in builder/runtime code that owns the LLM call.
//
//   2. Static table — `STATIC_CAPABILITIES[<provider>/<model>]`. Built-in
//      defaults for known models. Source: provider docs as of 2026-04.
//
//   3. Fallback — `fallbackCapability(provider, model)`. Conservative
//      values that won't crash any modern provider. Emits the optional
//      `onProbeFailed` callback so callers can surface a
//      `CapabilityProbeFailed` event in their observability layer.
//
// Architecture note: the resolver does NOT depend on
// `@reactive-agents/reactive-intelligence` (where CalibrationStore lives) —
// it accepts a duck-typed `CapabilityCache` interface that CalibrationStore
// satisfies structurally. This avoids a circular package dep.

import {
  STATIC_CAPABILITIES,
  fallbackCapability,
  type Capability,
} from "./capability.js";

/**
 * One-shot tracker so the fallback warning fires at most once per
 * (provider, model) pair per process. Repeated agent runs in a long-lived
 * process don't spam the console; the user sees the message once and
 * either ignores it or fixes their config.
 */
const warnedFallbacks = new Set<string>();

/**
 * Process-wide registry of capabilities resolved by a live probe (e.g. the
 * Ollama `/api/show` probe in `providers/local.ts`). The probe is async and
 * provider-specific, so it can't run inside the synchronous `resolveCapability`.
 * Instead the probe writes through here once it succeeds, and every subsequent
 * synchronous `resolveCapability(provider, model)` — including the cache-less
 * calls in the execution engine that compute the ContextPressure denominator and
 * the context budget — picks up the real numCtx instead of the 2048 fallback.
 *
 * Keyed by `provider/model`: a model's context window is intrinsic to the model,
 * independent of which base URL served it. Without this, the value the actual
 * LLM call used (probed) and the value the rest of the engine saw (fallback)
 * silently disagreed.
 */
const probedRegistry = new Map<string, Capability>();

/**
 * Write through a probed capability so synchronous resolvers can read it.
 * Called by provider probe code after a successful live probe.
 */
export function registerProbedCapability(cap: Capability): void {
  probedRegistry.set(`${cap.provider}/${cap.model}`, cap);
}

/** Test seam — clears the probed-capability registry between tests. */
export function _resetProbedRegistryForTesting(): void {
  probedRegistry.clear();
}

function warnFallbackOnce(provider: string, model: string): void {
  const key = `${provider}/${model}`;
  if (warnedFallbacks.has(key)) return;
  warnedFallbacks.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[reactive-agents] Capability fallback fired for ${provider}/${model}: ` +
      `using conservative defaults (recommendedNumCtx=2048, toolCallDialect="none"). ` +
      `Local models with 2048 num_ctx commonly fail to call tools because the ` +
      `system prompt + tool schema overflows the context window. Either: ` +
      `(a) add ${model} to STATIC_CAPABILITIES in @reactive-agents/llm-provider/capability.ts, ` +
      `(b) override at request-time via { numCtx: 8192 } on agent.run options, or ` +
      `(c) wait for builder probe-on-first-use (Phase 1 Sprint 2 S2.4).`,
  );
}

/**
 * Minimal contract a Capability cache must satisfy. Implemented structurally
 * by `CalibrationStore` in `@reactive-agents/reactive-intelligence` —
 * declared here so `llm-provider` doesn't import from RI (would be a
 * circular package dependency).
 *
 * The resolver only ever calls `loadCapability`. `saveCapability` is on the
 * interface so callers (builder/probe code) can write through using the
 * same cache reference.
 */
export interface CapabilityCache {
  readonly loadCapability: (provider: string, model: string) => Capability | null;
  readonly saveCapability: (cap: Capability) => void;
}

/**
 * Optional knobs for the resolver. All fields are optional; calling
 * `resolveCapability(provider, model)` with nothing else returns the
 * static-table entry or the fallback.
 */
export interface ResolveCapabilityOptions {
  /**
   * Cache for previously-probed capabilities. Pass a `CalibrationStore` here
   * once the framework boots its reactive-intelligence layer; the resolver
   * checks this first before falling through to the static table.
   */
  readonly cache?: CapabilityCache;

  /**
   * Called when the resolver hits the fallback path (no cache hit, no
   * static-table entry). Wire this to your event bus to publish a
   * `CapabilityProbeFailed` event for telemetry. The resolver itself
   * has no dependency on EventBus to keep the package surface minimal.
   */
  readonly onProbeFailed?: (args: { provider: string; model: string }) => void;
}

/**
 * Resolve the Capability for a (provider, model) pair using the three-tier
 * lookup. Pure / synchronous — caches are SQLite-backed which Bun handles
 * synchronously.
 *
 * The resolver does NOT write to the cache. `source: "probe"` entries
 * arrive there via the builder's probe-on-first-use path (S1.4).
 *
 * @param provider — provider identifier (matches `withProvider()` argument)
 * @param model — exact model identifier as it appears in API requests
 * @param opts — optional cache + onProbeFailed callback
 * @returns Capability with `source` reflecting which tier resolved it
 */
export function resolveCapability(
  provider: string,
  model: string,
  opts: ResolveCapabilityOptions = {},
): Capability {
  // Tier 0 — explicit cache (e.g. a CalibrationStore passed by the caller).
  if (opts.cache) {
    const cached = opts.cache.loadCapability(provider, model);
    if (cached !== null) return cached;
  }

  // Tier 1 — process-wide probed registry. Populated by provider probe code
  // (write-through) so cache-less callers still see the real, live-probed numCtx.
  const probed = probedRegistry.get(`${provider}/${model}`);
  if (probed !== undefined) return probed;

  // Tier 2 — static table
  const key = `${provider}/${model}`;
  const fromTable = STATIC_CAPABILITIES[key];
  if (fromTable !== undefined) return fromTable;

  // Tier 3 — conservative fallback. Fires the user-supplied onProbeFailed
  // for telemetry. The console warning is NOT emitted here because callers
  // (e.g. local.ts) typically attempt a runtime probe AFTER this fallback
  // and only need the warning when probe ALSO fails. They invoke
  // `warnFallbackOnce` directly when truly using the fallback.
  if (opts.onProbeFailed) {
    opts.onProbeFailed({ provider, model });
  }
  return fallbackCapability(provider, model);
}

/**
 * Public version of the one-shot fallback warning so callers that probe
 * after `resolveCapability` returns the fallback can emit the warning only
 * when their probe ALSO fails. This prevents the warning from misleading
 * users when the dynamic probe ultimately succeeds.
 */
export function warnCapabilityFallback(provider: string, model: string): void {
  warnFallbackOnce(provider, model);
}
