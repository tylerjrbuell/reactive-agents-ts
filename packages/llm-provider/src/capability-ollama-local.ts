// packages/llm-provider/src/capability-ollama-local.ts
//
// Local-model campaign roster rows of STATIC_CAPABILITIES (Ollama). Kept out of
// capability.ts (that file sits near the 1,000-LOC bar); spread back into the
// table, so lookup is unchanged. Add a new Ollama roster model here, not there.
//
// Facts from Ollama /api/show (2026-11-13). maxContextTokens = native window;
// recommendedNumCtx = min(native, 32K) (VRAM-safe on a 16GB GPU).
// toolCallDialect "native-fc" = what the card ADVERTISES (`tools`), not a
// measured behavior, unless a calibrations/*.json says otherwise.

import type { Capability } from "./capability.js";

/** Static capability rows for the local-model campaign roster, keyed `ollama/<tag>`. */
export const OLLAMA_LOCAL_STATIC_CAPABILITIES: Readonly<Record<string, Capability>> = {
  "ollama/llama3.1:latest": {
    provider: "ollama",
    model: "llama3.1:latest",
    tier: "local",
    maxContextTokens: 131_072,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "ollama/llama3.2:3b": {
    provider: "ollama",
    model: "llama3.2:3b",
    tier: "local",
    maxContextTokens: 131_072,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    // Matches calibrations/llama3.2-3b.json (native-fc, 5 runs).
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // gemma4: the template is a 13-char stub, so tool emission is advertised
  // by the card but NOT behaviorally measured here (except e4b, below).
  "ollama/gemma4:e4b": {
    provider: "ollama",
    model: "gemma4:e4b",
    tier: "local",
    maxContextTokens: 131_072,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "unknown",
    supportsPromptCaching: false,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    // Matches calibrations/gemma4-e4b.json (native-fc, GH #243).
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "ollama/gemma4:12b": {
    provider: "ollama",
    model: "gemma4:12b",
    tier: "local",
    maxContextTokens: 262_144,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "unknown",
    supportsPromptCaching: false,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    // Advertised only (13-char stub template); no calibration file.
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // granite4:tiny-h is a hybrid mamba/MoE; template (6842 chars) carries tool markers.
  "ollama/granite4:tiny-h": {
    provider: "ollama",
    model: "granite4:tiny-h",
    tier: "local",
    maxContextTokens: 1_048_576,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "unknown",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "ollama/granite3.3:latest": {
    provider: "ollama",
    model: "granite3.3:latest",
    tier: "local",
    maxContextTokens: 131_072,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "unknown",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "ollama/qwen2.5:14b": {
    provider: "ollama",
    model: "qwen2.5:14b",
    tier: "local",
    maxContextTokens: 32_768,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // deepseek-r1:14b advertises `tools`+`thinking`, but a 2026-11-13 smoke run
  // made no tool call: dialect is ADVERTISED, not behaviorally proven. Run the
  // calibration probe before trusting native-fc.
  "ollama/deepseek-r1:14b": {
    provider: "ollama",
    model: "deepseek-r1:14b",
    tier: "local",
    maxContextTokens: 131_072,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // mimo-v2.6 / ornith: 13-char stub templates; tool emission unmeasured.
  "ollama/mimo-v2.6:latest": {
    provider: "ollama",
    model: "mimo-v2.6:latest",
    tier: "local",
    maxContextTokens: 262_144,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  "ollama/ornith:latest": {
    provider: "ollama",
    model: "ornith:latest",
    tier: "local",
    maxContextTokens: 262_144,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
  // phi4-mini-reasoning advertises `tools`; the 2026-11-13 smoke failed
  // (budget-cap). No thinking capability listed by the card.
  "ollama/phi4-mini-reasoning:latest": {
    provider: "ollama",
    model: "phi4-mini-reasoning:latest",
    tier: "local",
    maxContextTokens: 131_072,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "unknown",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "static-table",
  },
};
