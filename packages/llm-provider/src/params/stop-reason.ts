// packages/llm-provider/src/params/stop-reason.ts
//
// Consolidation (architecture sweep 2026-07-07, 03-provider-model-params) —
// stopReason mapping was hand-rolled per provider as five near-identical
// ternary ladders (local complete + stream, anthropic, openai-compat,
// gemini, litellm). One table per provider dialect replaces them; the
// per-provider mappings below are transcribed EXACTLY from the original
// ladders (pinned by tests/params-stop-reason.test.ts) so no wire behavior
// changes.

import type { StopReason } from "../types.js";

/**
 * OpenAI Chat Completions `finish_reason` dialect — shared verbatim by
 * openai, groq, xai (all via makeOpenAICompatProvider) and litellm (proxies
 * the same dialect).
 */
const OPENAI_COMPAT_TOKENS: Readonly<Record<string, StopReason>> = {
  tool_calls: "tool_use",
  stop: "end_turn",
  length: "max_tokens",
};

const TOKEN_TABLES: Readonly<
  Record<string, Readonly<Record<string, StopReason>>>
> = {
  // Anthropic `stop_reason` is already canonical for the four values we map.
  anthropic: {
    end_turn: "end_turn",
    max_tokens: "max_tokens",
    stop_sequence: "stop_sequence",
    tool_use: "tool_use",
  },
  // Ollama `done_reason`.
  ollama: {
    stop: "end_turn",
    length: "max_tokens",
  },
  // Gemini deliberately maps NO tokens: the pre-consolidation mapper ignored
  // `finishReason` entirely — tool_use is decided from functionCalls at the
  // call site, and non-OK finishReasons (MAX_TOKENS, SAFETY,
  // UNEXPECTED_TOOL_CALL, …) surface as explicit errors via the W22 guard
  // before mapping — so every token degrades to "end_turn" exactly as before.
  gemini: {},
  openai: OPENAI_COMPAT_TOKENS,
  groq: OPENAI_COMPAT_TOKENS,
  xai: OPENAI_COMPAT_TOKENS,
  litellm: OPENAI_COMPAT_TOKENS,
};

/**
 * Map a provider-native stop/finish token to the canonical {@link StopReason}.
 *
 * Constraint enforced: one table-driven mapping shared by every provider,
 * preserving each provider's exact pre-consolidation ladder. Unknown tokens,
 * unknown providers, and null/undefined tokens all degrade to `"end_turn"` —
 * the shared default of all five original ladders. Callers still own the
 * `hasToolCalls → "tool_use"` override where the original ladder had one
 * (local, openai-compat, gemini, litellm); Anthropic's ladder never had it.
 */
export function mapStopReason(
  providerToken: string | null | undefined,
  provider: string,
): StopReason {
  if (providerToken == null) return "end_turn";
  return TOKEN_TABLES[provider]?.[providerToken] ?? "end_turn";
}
