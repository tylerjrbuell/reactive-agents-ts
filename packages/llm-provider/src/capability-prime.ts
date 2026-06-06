// packages/llm-provider/src/capability-prime.ts
//
// Eager capability priming — runs a provider-specific live probe BEFORE the
// synchronous `resolveCapability` / `resolveCanonical` calls that happen at
// build-validation (the PreFlight honesty gate) and at every reasoning
// iteration (context-budget / ContextPressure denominator).
//
// The probe (`providers/local-probe.ts`) is async and provider-specific, so it
// historically only ran lazily inside the first `complete()` call. That left
// build-validation and the first iteration resolving the conservative 2048-ctx
// `source: "fallback"` for any model not in the static table — under-sizing the
// context budget and dropping the tool-call dialect to "none".
//
// `probedRegistry` (capability-resolver.ts) is process-wide and persistent, so a
// single eager prime at build time backfills build-validation AND every later
// synchronous resolve for the same (provider, model). This is the "dynamic
// capabilities without manually editing STATIC_CAPABILITIES" path: any model a
// user has pulled gets its real window/dialect from the provider's own report.

import { registerProbedCapability } from "./capability-resolver.js";
import { probeOllamaCapability } from "./providers/local-probe.js";

const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";

export interface PrimeCapabilityOptions {
  /** Provider base URL. Defaults to `OLLAMA_ENDPOINT` env then localhost. */
  readonly endpoint?: string;
  /** Optional bearer token for authenticated local gateways. */
  readonly apiKey?: string;
}

/**
 * Best-effort capability prime for providers that expose a live discovery probe.
 *
 * - **Idempotent + never throws.** The underlying probe is 5s-bounded and returns
 *   `null` on any failure (offline endpoint, model not pulled, malformed
 *   response), so a failed prime simply leaves the existing fallback in place.
 * - **No-op for providers without a probe** (anthropic / openai / gemini / …),
 *   which keep resolving from the static table.
 * - Endpoint resolution mirrors `validateProviderConnection`:
 *   explicit `opts.endpoint` → `OLLAMA_ENDPOINT` env → localhost.
 *
 * Call this once, as early as possible in the async build/start path, before the
 * first synchronous capability resolve.
 */
export async function primeCapability(
  provider: string,
  model: string | undefined,
  opts: PrimeCapabilityOptions = {},
): Promise<void> {
  if (provider !== "ollama" || !model) return;
  const endpoint =
    opts.endpoint ?? process.env.OLLAMA_ENDPOINT ?? DEFAULT_OLLAMA_ENDPOINT;
  const cap = await probeOllamaCapability(model, endpoint, opts.apiKey);
  if (cap) registerProbedCapability(cap);
}
