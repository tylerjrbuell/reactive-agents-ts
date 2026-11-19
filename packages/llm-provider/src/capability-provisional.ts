// packages/llm-provider/src/capability-provisional.ts
//
// Provisional capability for an unknown model on a HOSTED provider.
//
// The generic fallback (`fallbackCapability`) is sized for an unknown LOCAL
// model: a 2048-token window and no tool calling. A hosted provider never
// serves a chat model that small, and its adapter always sends tools natively,
// so that fallback starved every new hosted model id: the kernel budgeted 2048
// tokens and dropped tools. OpenAI states no limits anywhere (its /v1/models
// carries none), so for OpenAI this row is the steady state until a context-
// length error states the real window (capability-learned.ts).
//
// The row stays `source: "fallback"`: it is still a guess, so the PreFlight
// gate, the output-budget clamp and the tier lookup treat it as one. The typed
// `provisional: true` marker tells traces and UIs which guess it is: a hosted
// lower bound, replaced as soon as discovery or an error states a real limit.
//
// Window choice: 128,000 tokens = the smallest window among current hosted
// static rows (openai gpt-4o / gpt-4o-mini / gpt-4o-audio-preview / gpt-audio).
// Every Anthropic row is >= 200K and every Gemini row >= 1M, so 128K
// under-states those, never over-states them. Output 8,192 = the existing
// groq/xai provisional output; it never clamps a request (fallback source).

import type { Capability, TokenizerFamily } from "./capability.js";

/**
 * Providers whose models are driven with native tool calling, so a REPORTED
 * window builds an inferred row for them (capability-reported.ts). LiteLLM is
 * included: it relays the OpenAI tools schema. Not every member gets the
 * provisional row (see PROVISIONAL_PROVIDERS).
 */
export const HOSTED_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
  "openai",
  "gemini",
  "groq",
  "xai",
  "litellm",
]);

/**
 * Hosted providers that get the provisional row. LiteLLM is NOT one of them: a
 * LiteLLM proxy often fronts a local model (e.g. Ollama) that silently
 * truncates at its num_ctx with no error, so an over-stated window would never
 * be corrected by an error (capability-learned.ts) and context would be lost
 * silently. An unknown LiteLLM model keeps the conservative local fallback
 * until /model/info reports its limits (litellm-discovery.ts).
 */
const PROVISIONAL_PROVIDERS: ReadonlySet<string> = new Set(
  [...HOSTED_PROVIDERS].filter((p) => p !== "litellm"),
);

/** Provisional window for an unknown hosted model, in tokens (see module note). */
export const HOSTED_PROVISIONAL_CONTEXT_TOKENS = 128_000;

/** Provisional output ceiling for an unknown hosted model. Advisory only. */
export const HOSTED_PROVISIONAL_OUTPUT_TOKENS = 8_192;

/**
 * Groq and xAI keep the 131,072 window they had before this module (their
 * current lineups are all at least that large).
 */
const OPENAI_COMPAT_WINDOW = 131_072;

const TOKENIZER: Readonly<Record<string, TokenizerFamily>> = {
  anthropic: "claude",
  openai: "tiktoken-cl100k",
  xai: "tiktoken-cl100k",
  gemini: "gemini",
  groq: "llama",
};

/**
 * The provisional capability for an unknown model on a hosted provider.
 *
 * @param provider - provider id
 * @param model - model id as sent to the provider
 * @returns a `source: "fallback"`, `provisional: true` row, or `undefined` when
 *   the provider is not hosted or is LiteLLM (the local fallback then applies)
 */
export function hostedProvisionalCapability(provider: string, model: string): Capability | undefined {
  if (!PROVISIONAL_PROVIDERS.has(provider)) return undefined;
  const openaiCompat = provider === "groq" || provider === "xai";
  const window = openaiCompat ? OPENAI_COMPAT_WINDOW : HOSTED_PROVISIONAL_CONTEXT_TOKENS;
  return {
    provider,
    model,
    tier: openaiCompat ? "large" : "mid",
    maxContextTokens: window,
    recommendedNumCtx: window,
    maxOutputTokens: HOSTED_PROVISIONAL_OUTPUT_TOKENS,
    tokenizerFamily: TOKENIZER[provider] ?? "unknown",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    provisional: true,
    source: "fallback",
  };
}

/**
 * Drop the provisional marker from a row built on top of the fallback (a
 * provider-reported or user-declared row is no longer the hosted guess).
 *
 * @param cap - a capability that may carry `provisional`
 * @returns the same fields without `provisional`
 */
export function withoutProvisional(cap: Capability): Capability {
  if (cap.provisional === undefined) return cap;
  const { provisional: _provisional, ...rest } = cap;
  return rest;
}
