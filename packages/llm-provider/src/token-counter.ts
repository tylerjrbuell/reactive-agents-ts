import { Effect } from "effect";
import type { LLMMessage } from "./types.js";

/**
 * Estimate the chars-per-token ratio based on content characteristics.
 * Code and JSON are denser (~3 chars/token) while natural language is ~4.
 */
function charsPerToken(text: string): number {
  if (text.length === 0) return 4;
  // Sample first 2000 chars for classification
  const sample = text.slice(0, 2000);
  const codeSignals = (sample.match(/[{}();=<>\[\]]/g) ?? []).length;
  const jsonSignals = (sample.match(/"\w+"\s*:/g) ?? []).length;
  const ratio = (codeSignals + jsonSignals) / sample.length;
  // High density of code/JSON markers → lower chars-per-token
  if (ratio > 0.08) return 3;    // Mostly code/JSON
  if (ratio > 0.04) return 3.5;  // Mixed
  return 4;                       // Natural language
}

/**
 * Estimate token count for messages.
 * Uses content-aware heuristics: ~3 chars/token for code/JSON, ~4 for English text.
 * This is used as a fallback when the provider's token counting API is unavailable.
 */
export const estimateTokenCount = (
  messages: readonly LLMMessage[],
): Effect.Effect<number, never> =>
  Effect.sync(() => {
    let totalTokens = 0;

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        totalTokens += Math.ceil(msg.content.length / charsPerToken(msg.content));
      } else {
        // Content blocks
        for (const block of msg.content) {
          if (block.type === "text") {
            totalTokens += Math.ceil(block.text.length / charsPerToken(block.text));
          } else if (block.type === "tool_result") {
            totalTokens += Math.ceil(block.content.length / charsPerToken(block.content));
          } else if (block.type === "tool_use") {
            const json = JSON.stringify(block.input);
            totalTokens += Math.ceil(json.length / 3); // Tool input is always JSON
          }
          // Images not counted in token estimation
        }
      }
      // Add overhead for role/message framing (~4 tokens per message)
      totalTokens += 4;
    }

    return totalTokens;
  });

/**
 * Get pricing per 1M tokens for a given model.
 * Uses injected pricing, then user registry, then static map, then heuristics.
 */
function getPricing(
  model: string,
  registry?: Record<string, { input: number; output: number }>,
  pricing?: { input?: number; output?: number },
): { input: number; output: number } {
  // 1. Injected pricing (Highest Priority — e.g. from LiteLLM response)
  if (pricing?.input !== undefined && pricing?.output !== undefined) {
    return { input: pricing.input, output: pricing.output };
  }

  // 2. User-provided registry (Priority — e.g. from builder config)
  if (registry && registry[model]) return registry[model];

  // 3. Exact match for known models (comprehensive list)
  const costMap: Record<string, { input: number; output: number }> = {
    // ── Anthropic ──
    "claude-3-5-haiku-20241022":    { input: 0.8,  output: 4.0 },
    "claude-3-haiku-20240307":      { input: 0.25, output: 1.25 },
    "claude-sonnet-4-20250514":     { input: 3.0,  output: 15.0 },
    "claude-sonnet-4-5-20250929":   { input: 3.0,  output: 15.0 },
    "claude-opus-4-20250514":       { input: 15.0, output: 75.0 },
    "claude-3-5-sonnet-20241022":   { input: 3.0,  output: 15.0 },
    "claude-3-5-sonnet-20240620":   { input: 3.0,  output: 15.0 },
    "claude-3-opus-20240229":       { input: 15.0, output: 75.0 },
    "claude-3-sonnet-20240229":     { input: 3.0,  output: 15.0 },

    // ── OpenAI ──
    "gpt-4o":                       { input: 2.5,  output: 10.0 },
    "gpt-4o-2024-11-20":            { input: 2.5,  output: 10.0 },
    "gpt-4o-2024-08-06":            { input: 2.5,  output: 10.0 },
    "gpt-4o-2024-05-13":            { input: 5.0,  output: 15.0 },
    "gpt-4o-mini":                  { input: 0.15, output: 0.6 },
    "gpt-4o-mini-2024-07-18":       { input: 0.15, output: 0.6 },
    "gpt-4-turbo":                  { input: 10.0, output: 30.0 },
    "gpt-4-turbo-2024-04-09":       { input: 10.0, output: 30.0 },
    "gpt-4":                        { input: 30.0, output: 60.0 },
    "gpt-4-0613":                   { input: 30.0, output: 60.0 },
    "gpt-3.5-turbo":                { input: 0.5,  output: 1.5 },
    "o1":                           { input: 15.0, output: 60.0 },
    "o1-mini":                      { input: 3.0,  output: 12.0 },
    "o1-preview":                   { input: 15.0, output: 60.0 },
    "o3":                           { input: 10.0, output: 40.0 },
    "o3-mini":                      { input: 1.1,  output: 4.4 },
    "o4-mini":                      { input: 1.1,  output: 4.4 },

    // ── Google Gemini ──
    "gemini-2.0-flash":             { input: 0.1,  output: 0.4 },
    "gemini-2.5-flash":             { input: 0.15, output: 0.6 },
    "gemini-2.5-flash-preview-05-20": { input: 0.15, output: 0.6 },
    "gemini-2.5-pro":               { input: 1.25, output: 10.0 },
    "gemini-2.5-pro-preview-03-25": { input: 1.25, output: 10.0 },
    "gemini-2.5-pro-preview-05-06": { input: 1.25, output: 10.0 },
    "gemini-1.5-pro":               { input: 1.25, output: 5.0 },
    "gemini-1.5-flash":             { input: 0.075, output: 0.3 },
    "gemini-embedding-001":         { input: 0.0,  output: 0.0 },

    // ── Meta Llama (via LiteLLM / cloud providers) ──
    "llama-3.1-405b":               { input: 3.0,  output: 3.0 },
    "llama-3.1-70b":                { input: 0.88, output: 0.88 },
    "llama-3.1-8b":                 { input: 0.18, output: 0.18 },
    "llama-3.3-70b":                { input: 0.88, output: 0.88 },

    // ── Mistral ──
    "mistral-large-latest":         { input: 2.0,  output: 6.0 },
    "mistral-small-latest":         { input: 0.2,  output: 0.6 },
    "codestral-latest":             { input: 0.3,  output: 0.9 },
  };

  if (costMap[model]) return costMap[model];

  // 4. Keyword-based heuristics for unknown/local/proxy models
  const m = model.toLowerCase();

  // Tier 1: Cheap / "Flash" / "Mini" (e.g. gpt-4o-mini, gemini-flash, haiku, llama-3-8b)
  if (
    m.includes("haiku") ||
    m.includes("flash") ||
    m.includes("mini") ||
    m.includes("small") ||
    m.includes("8b") ||
    m.includes("7b") ||
    m.includes("lite")
  ) {
    return { input: 0.15, output: 0.6 };
  }

  // Tier 3: Premium / "Opus" / "Large" (e.g. opus, gpt-4, llama-3-405b)
  if (
    m.includes("opus") ||
    m.includes("large") ||
    m.includes("405b") ||
    (m.includes("gpt-4") && !m.includes("turbo") && !m.includes("o-") && !m.includes("mini"))
  ) {
    return { input: 15.0, output: 75.0 };
  }

  // Tier 2: Mid / "Sonnet" / "Turbo" / "Pro" (Default for most models)
  return { input: 3.0, output: 15.0 };
}

/**
 * Provider-specific caching discount information.
 * Each provider handles cached tokens differently:
 * - Anthropic: cache_read = 0.1× base, cache_write = 1.25× base
 * - OpenAI: cached = 0.5× base (automatic for >1024 token prompts)
 * - Gemini: cached = ~0.25× base (context caching)
 */
export interface CacheUsage {
  // ── Anthropic ──
  /** Tokens read from Anthropic prompt cache (billed at 10% of base input price) */
  readonly cache_read_input_tokens?: number;
  /** Tokens written to Anthropic prompt cache (billed at 125% of base input price) */
  readonly cache_creation_input_tokens?: number;

  // ── OpenAI ──
  /** Tokens served from OpenAI's automatic prompt cache (billed at 50% of base input price) */
  readonly cached_tokens?: number;

  // ── Gemini ──
  /** Tokens served from Gemini context cache (billed at ~25% of base input price) */
  readonly cached_content_token_count?: number;
}

/**
 * Calculate cost in USD given token counts and model name.
 * Supports provider-specific caching discounts:
 * - Anthropic: prompt caching (10% read cost, 125% write cost)
 * - OpenAI: automatic caching (50% cost for cached tokens)
 * - Gemini: context caching (~25% cost for cached tokens)
 *
 * @param inputTokens - Total input tokens from provider response
 * @param outputTokens - Total output tokens from provider response
 * @param model - Model identifier for pricing lookup
 * @param usage - Provider-specific cache token breakdown
 * @param registry - Custom pricing overrides
 * @param pricing - Direct per-1M pricing (e.g. from LiteLLM proxy)
 */
export const calculateCost = (
  inputTokens: number,
  outputTokens: number,
  model: string,
  usage?: CacheUsage,
  registry?: Record<string, { input: number; output: number }>,
  pricing?: { input?: number; output?: number },
): number => {
  const costs = getPricing(model, registry, pricing);

  // Identify all cached/special token counts
  const anthropicCacheRead = usage?.cache_read_input_tokens ?? 0;
  const anthropicCacheWrite = usage?.cache_creation_input_tokens ?? 0;
  const openaiCached = usage?.cached_tokens ?? 0;
  const geminiCached = usage?.cached_content_token_count ?? 0;

  // Base input tokens = total minus all cached/special tokens
  const baseInputTokens = inputTokens - anthropicCacheRead - anthropicCacheWrite - openaiCached - geminiCached;

  const inputCost = (baseInputTokens / 1_000_000) * costs.input;
  const outputCost = (outputTokens / 1_000_000) * costs.output;

  // ── Anthropic prompt caching ──
  // Cache Write (Creation): 1.25x base price
  // Cache Read (Hit): 0.10x base price (90% discount)
  const anthropicCacheWriteCost = (anthropicCacheWrite / 1_000_000) * costs.input * 1.25;
  const anthropicCacheReadCost = (anthropicCacheRead / 1_000_000) * costs.input * 0.1;

  // ── OpenAI automatic caching ──
  // Cached tokens: 0.50x base price (50% discount)
  const openaiCachedCost = (openaiCached / 1_000_000) * costs.input * 0.5;

  // ── Gemini context caching ──
  // Cached tokens: ~0.25x base price (75% discount)
  const geminiCachedCost = (geminiCached / 1_000_000) * costs.input * 0.25;

  return (
    inputCost +
    outputCost +
    anthropicCacheWriteCost +
    anthropicCacheReadCost +
    openaiCachedCost +
    geminiCachedCost
  );
};
