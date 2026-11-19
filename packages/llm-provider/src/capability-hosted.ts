// packages/llm-provider/src/capability-hosted.ts
//
// Older-but-still-selectable hosted models (OpenAI 4.1 family + o4-mini,
// Gemini 2.0 Flash), plus the Gemini 4 ids (rows below, API-reported limits). Kept out of capability.ts (near the 1,000-LOC bar);
// spread back into STATIC_CAPABILITIES. Without a row `resolveCapability`
// falls back to a made-up 4096 window, which UIs (Cortex context meter)
// rightly refuse to display.
//
// Window/output values are owner-supplied from public model docs and are NOT
// verifiable from anything in-repo (2026-11-16). Tier/flags mirror the
// neighboring gpt-4o / gpt-4o-mini / gemini-2.5-flash / o5-reasoning rows.

import type { Capability } from "./capability.js";

/** Static capability rows for the legacy hosted models above. */
export const HOSTED_STATIC_CAPABILITIES: Readonly<Record<string, Capability>> = {
  "openai/gpt-4.1": {
    provider: "openai",
    model: "gpt-4.1",
    tier: "large",
    maxContextTokens: 1_047_576,
    recommendedNumCtx: 1_047_576,
    maxOutputTokens: 32_768,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "openai/gpt-4.1-mini": {
    provider: "openai",
    model: "gpt-4.1-mini",
    tier: "mid",
    maxContextTokens: 1_047_576,
    recommendedNumCtx: 1_047_576,
    maxOutputTokens: 32_768,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "openai/gpt-4.1-nano": {
    provider: "openai",
    model: "gpt-4.1-nano",
    tier: "mid",
    maxContextTokens: 1_047_576,
    recommendedNumCtx: 1_047_576,
    maxOutputTokens: 32_768,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // Reasoning model: max_completion_tokens + reasoning_effort, like o5-reasoning.
  "openai/o4-mini": {
    provider: "openai",
    model: "o4-mini",
    tier: "mid",
    maxContextTokens: 200_000,
    recommendedNumCtx: 200_000,
    maxOutputTokens: 100_000,
    tokenizerFamily: "tiktoken-cl100k",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    requiresMaxCompletionTokens: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // Google announced 2.0 Flash shutdown 2026-06-01 (see capability.ts Gemini
  // note); row kept so any still-served id gets a real window, not the fallback.
  "gemini/gemini-2.0-flash": {
    provider: "gemini",
    model: "gemini-2.0-flash",
    supportsAudioIn: true,
    tier: "mid",
    maxContextTokens: 1_048_576,
    recommendedNumCtx: 1_048_576,
    maxOutputTokens: 8_192,
    tokenizerFamily: "gemini",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // Gemini 4 ids carry no pro/flash variant, so the family rule cannot place
  // them. Window, output limit and thinking are the Gemini API's own models.get
  // report (inputTokenLimit 1048576, outputTokenLimit 32768, thinking true;
  // fetched 2026-11-19). Not reported, so kept conservative: vision and prompt
  // caching off. Tier is not reported either: "frontier" is the owner's
  // classification of these models (2026-11-19).
  "gemini/gemini-4-carbon": {
    provider: "gemini",
    model: "gemini-4-carbon",
    tier: "frontier",
    maxContextTokens: 1_048_576,
    recommendedNumCtx: 1_048_576,
    maxOutputTokens: 32_768,
    tokenizerFamily: "gemini",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "gemini/gemini-4-argon": {
    provider: "gemini",
    model: "gemini-4-argon",
    tier: "frontier",
    maxContextTokens: 1_048_576,
    recommendedNumCtx: 1_048_576,
    maxOutputTokens: 32_768,
    tokenizerFamily: "gemini",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
};
