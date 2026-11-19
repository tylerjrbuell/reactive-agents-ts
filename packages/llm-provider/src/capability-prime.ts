// packages/llm-provider/src/capability-prime.ts
//
// Eager capability priming — runs the provider's capability discoverer
// (capability-discovery.ts) BEFORE the synchronous `resolveCapability` /
// `resolveCanonical` calls that happen at build-validation (the PreFlight
// honesty gate) and at every reasoning iteration (context-budget /
// ContextPressure denominator).
//
// Discovery is async and provider-specific, so it historically only ran lazily
// inside the first `complete()` call. That left build-validation and the first
// iteration resolving the conservative 2048-ctx `source: "fallback"` for any
// model not in the static table — under-sizing the context budget and dropping
// the tool-call dialect to "none".
//
// The registries discovery writes to are process-wide and persistent, so a
// single eager prime at build time backfills build-validation AND every later
// synchronous resolve for the same (provider, model). This is the "dynamic
// capabilities without manually editing STATIC_CAPABILITIES" path: a model the
// provider can describe (Ollama /api/show, Gemini models.get) gets its real
// window from the provider's own report.

import { Effect } from "effect";
import { discoverCapability } from "./capability-discovery.js";

export interface PrimeCapabilityOptions {
  /**
   * Provider base URL. Ollama falls back to the OLLAMA_* env vars, then
   * localhost; hosted providers use their public API.
   */
  readonly endpoint?: string;
  /**
   * Credential for the discovery request (Ollama gateway bearer token, Gemini
   * API key). Discoverers fall back to their provider's env var.
   */
  readonly apiKey?: string;
  /** Upper bound on the discovery request, in ms. Default 5000. */
  readonly timeoutMs?: number;
}

/**
 * Best-effort capability prime for providers that register a discoverer.
 *
 * - **Never throws.** Discovery is timeout-bounded and any failure (offline
 *   endpoint, model not pulled, unknown id, missing key) leaves the existing
 *   fallback in place, with its one-time warning.
 * - **No-op for providers without a discoverer** (openai, groq, xai, …),
 *   which keep resolving from the static table, then the provisional hosted
 *   window (capability-provisional.ts).
 * - Ollama endpoint resolution mirrors `validateProviderConnection`:
 *   explicit `opts.endpoint` → `OLLAMA_ENDPOINT` → `OLLAMA_HOST` → `OLLAMA_BASE`
 *   → localhost (see `resolveOllamaEndpoint`).
 *
 * Call this once, as early as possible in the async build/start path, before the
 * first synchronous capability resolve.
 */
export async function primeCapability(
  provider: string,
  model: string | undefined,
  opts: PrimeCapabilityOptions = {},
): Promise<void> {
  if (!model) return;
  await Effect.runPromise(discoverCapability(provider, model, opts));
}
