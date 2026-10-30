// packages/llm-provider/src/capability-reported.ts
//
// Provider-REPORTED metadata tier - the dynamic capability source for hosted
// models that have no probe, cache, or static-table row.
//
// Why: providers ship new model ids faster than this package ships rows, and
// several of them state each model's limits in their live model-listing
// response. Model discovery (model-discovery.ts) already fetches that response;
// it writes the reported fields through here, and `resolveCapability` consumes
// them synchronously (same write-through pattern as the probed registry). No
// I/O happens in this module or in the resolver.
//
// Verified reported fields (official docs, fetched 2026-10-29):
//   - Gemini  models.list  https://ai.google.dev/api/models
//       inputTokenLimit, outputTokenLimit, thinking (boolean)
//   - Anthropic GET /v1/models  https://platform.claude.com/docs/en/api/models/list
//       max_input_tokens, max_tokens, capabilities.image_input.supported,
//       capabilities.thinking.supported
//   - Groq GET /openai/v1/models  https://console.groq.com/docs/api-reference
//       context_window, max_completion_tokens
// NOT reported (so nothing is parsed): OpenAI /v1/models (id/created/owned_by
// only). Unverified, therefore not parsed: xAI /v1/models, LiteLLM /model/info.
//
// Honesty rules:
//   - a row is built ONLY when the provider reported a context window; no
//     reported window -> the loud fallback still fires
//   - tier, tokenizer family, caching, and every unreported flag are NOT
//     guessed from the model id: tier is the conservative "mid" placeholder,
//     the rest are the fallback's values
//   - the single non-reported fact is `toolCallDialect: "native-fc"`, which holds
//     for every chat model on these five hosted providers (their adapters always
//     send tools natively)
//   - source is "inferred": ceilings are advisory and never clamp a request
//     (params/output-budget.ts)

import { fallbackCapability, type Capability } from "./capability.js";

/** Fields a provider reported for one model. Every field is optional. */
export interface ReportedModelMetadata {
  /** Reported input/context limit, in tokens. */
  readonly maxContextTokens?: number;
  /** Reported maximum completion tokens. */
  readonly maxOutputTokens?: number;
  /** Reported image-input support. */
  readonly supportsVision?: boolean;
  /** Reported thinking/reasoning support. */
  readonly supportsThinkingMode?: boolean;
}

/** Hosted providers whose chat models are always driven with native tool calling. */
const HOSTED_NATIVE_FC_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
  "openai",
  "gemini",
  "groq",
  "xai",
]);

const registry = new Map<string, ReportedModelMetadata>();

const keyOf = (provider: string, model: string): string => `${provider}/${model}`;

const hasAnyField = (meta: ReportedModelMetadata): boolean =>
  meta.maxContextTokens !== undefined ||
  meta.maxOutputTokens !== undefined ||
  meta.supportsVision !== undefined ||
  meta.supportsThinkingMode !== undefined;

/**
 * Record what a provider reported for a model (called by model discovery after
 * it parsed a live listing). Empty metadata is ignored.
 */
export function registerReportedModelMetadata(
  provider: string,
  model: string,
  meta: ReportedModelMetadata,
): void {
  if (!hasAnyField(meta)) return;
  registry.set(keyOf(provider, model), meta);
}

/** Reported metadata previously registered for `(provider, model)`, if any. */
export function reportedModelMetadataFor(
  provider: string,
  model: string,
): ReportedModelMetadata | undefined {
  return registry.get(keyOf(provider, model));
}

/** Test seam - clears the reported-metadata registry. */
export function _resetReportedMetadataForTesting(): void {
  registry.clear();
}

/**
 * Build a `source: "inferred"` Capability from provider-reported metadata.
 *
 * @returns `null` unless the provider is a hosted native-FC provider AND it
 *   reported a context window (the resolver then continues to the loud fallback).
 */
export function capabilityFromReported(
  provider: string,
  model: string,
  meta: ReportedModelMetadata,
): Capability | null {
  if (!HOSTED_NATIVE_FC_PROVIDERS.has(provider)) return null;
  if (meta.maxContextTokens === undefined) return null;

  const base = fallbackCapability(provider, model);
  return {
    ...base,
    tier: "mid",
    maxContextTokens: meta.maxContextTokens,
    recommendedNumCtx: meta.maxContextTokens,
    // Reported when available; otherwise the fallback's number, advisory only.
    maxOutputTokens: meta.maxOutputTokens ?? base.maxOutputTokens,
    supportsVision: meta.supportsVision ?? false,
    supportsThinkingMode: meta.supportsThinkingMode ?? false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "inferred",
  };
}
