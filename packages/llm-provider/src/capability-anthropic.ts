// packages/llm-provider/src/capability-anthropic.ts
//
// Anthropic rows of STATIC_CAPABILITIES. Kept out of capability.ts (that file
// sits near the 1,000-LOC bar); spread back into the table in place, so key
// order and lookup are unchanged. Add a Claude model here, not there.

import type { Capability } from "./capability.js";

/** Static capability rows for Anthropic models, keyed `anthropic/<model>`. */
export const ANTHROPIC_STATIC_CAPABILITIES: Readonly<Record<string, Capability>> = {
  // ── Claude 5 family (added 2026-11-05) ───────────────────────────────────
  // Ids are current per the Cortex model list. Window/output values are NOT
  // verified against Anthropic docs (none in-repo): each row mirrors its 4.x
  // predecessor (Opus/Sonnet 1M, Haiku 200K); Fable has no predecessor and
  // takes the conservative 200K/64K. Correct them from the model docs.
  // `rejectsTemperature` is set ONLY where a live 400 confirmed it:
  // claude-haiku-5-5 → "temperature is deprecated for this model" (Cortex,
  // 2026-11-05). The other Claude 5 ids are unconfirmed either way.
  "anthropic/claude-fable-5-1": {
    provider: "anthropic",
    model: "claude-fable-5-1",
    tier: "frontier",
    maxContextTokens: 200_000,
    recommendedNumCtx: 200_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "anthropic/claude-opus-5-5": {
    provider: "anthropic",
    model: "claude-opus-5-5",
    tier: "frontier",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 128_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "anthropic/claude-sonnet-5-5": {
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    tier: "large",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "anthropic/claude-haiku-5-5": {
    provider: "anthropic",
    model: "claude-haiku-5-5",
    tier: "mid",
    maxContextTokens: 200_000,
    recommendedNumCtx: 200_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    rejectsTemperature: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },

  // ── Claude 4.x ───────────────────────────────────────────────────────────
  // Context windows and output caps per Anthropic model docs (2026-06):
  // Opus/Sonnet 4.x = 1M context; Opus output 128K, Sonnet/Haiku output 64K;
  // Haiku 4.5 = 200K context.
  "anthropic/claude-opus-4-8": {
    provider: "anthropic",
    model: "claude-opus-4-8",
    tier: "frontier",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 128_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "anthropic/claude-opus-4-7": {
    provider: "anthropic",
    model: "claude-opus-4-7",
    tier: "frontier",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 128_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "anthropic/claude-sonnet-4-6": {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    tier: "large",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "anthropic/claude-sonnet-4-5-20250929": {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    tier: "large",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // Suffix-less alias: callers using the marketing name `claude-sonnet-4-5`
  // (without the 20250929 date suffix) previously fell to the 2048 conservative
  // fallback — which the bench honesty guard marks inconclusive and refuses to
  // score. Mirrors the `claude-haiku-4-5` alias below; same capability as the
  // dated entry.
  "anthropic/claude-sonnet-4-5": {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    tier: "large",
    maxContextTokens: 1_000_000,
    recommendedNumCtx: 1_000_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "anthropic/claude-haiku-4-5-20251001": {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    tier: "mid",
    maxContextTokens: 200_000,
    recommendedNumCtx: 200_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // Suffix-less alias: callers using `claude-haiku-4-5` (the marketing name
  // without the 20251001 date suffix) previously fell through to the 2048
  // conservative fallback, which under-sized the recencyBudgetChars gate in
  // assembly and triggered preview+ref on a 28K-char tool result — haiku
  // then read the structural-preview heading skeleton, perceived it as a
  // truncation marker ("file-read is truncating at 29487 chars"), and
  // narrated honest failure instead of summarizing. Phase-A 2026-06-02
  // bench cells used `claude-haiku-4-5` (suffix-less); this entry collapses
  // the resolution to the same capability as the dated alias.
  "anthropic/claude-haiku-4-5": {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    tier: "mid",
    maxContextTokens: 200_000,
    recommendedNumCtx: 200_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: true,
    supportsVision: true,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
};
