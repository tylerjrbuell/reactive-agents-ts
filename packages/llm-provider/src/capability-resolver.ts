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
  // Tier 1 — cached probe
  if (opts.cache) {
    const cached = opts.cache.loadCapability(provider, model);
    if (cached !== null) return cached;
  }

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
