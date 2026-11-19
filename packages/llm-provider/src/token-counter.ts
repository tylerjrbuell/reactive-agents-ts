import { Effect, Option } from "effect";
import type { LLMMessage } from "./types.js";
import type { TokenizerFamily } from "./capability.js";
import { getTokenizerDenseFactor } from "./tokenizer-factors.js";
import { priceFor } from "./price-book/price-book.js";
import { priceUsage } from "./price-book/price-usage.js";
import type { PricingRegistry } from "./price-book/schema.js";

/** Cost fields of local inference (re-exported for the pinned local.ts shell). */
export { LOCAL_COST_FIELDS } from "./price-book/price-usage.js";

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
 * W2c (plan 2.3): per-family DENSE-regime divisor. The base heuristic gives
 * structural JSON 3 chars/token; measured `prompt_eval_count` on llama-family
 * BPE vocabularies says real dense JSON costs 1.03–1.16× that (live) and
 * 1.245× on committed FC traffic (per-tool template wrap). The correction is
 * applied ONLY to the dense branch (3/factor → 2.4 chars/token at 1.25):
 * prose/mixed measured the heuristic OVER-counting (0.77–0.89×), so touching
 * them would push budget gates the wrong way.
 */
function denseCharsPerToken(family: TokenizerFamily | undefined): number {
  return 3 / getTokenizerDenseFactor(family);
}

/**
 * Estimate token count for messages.
 * Uses content-aware heuristics: ~3 chars/token for code/JSON, ~4 for English text.
 * This is used as a fallback when the provider's token counting API is unavailable.
 *
 * W2c: optional `tokenizerFamily` (the Capability registry field — zero
 * consumers since S1.1, this is its first) applies the measured per-family
 * dense-JSON correction. Omitted / "unknown" / unmeasured family ⇒ factor
 * 1.0 ⇒ byte-identical legacy behavior at every existing call site.
 */
export const estimateTokenCount = (
  messages: readonly LLMMessage[],
  tokenizerFamily?: TokenizerFamily,
): Effect.Effect<number, never> =>
  Effect.sync(() => {
    let totalTokens = 0;
    const denseCpt = denseCharsPerToken(tokenizerFamily);

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        const cpt = charsPerToken(msg.content);
        totalTokens += Math.ceil(msg.content.length / (cpt === 3 ? denseCpt : cpt));
      } else {
        // Content blocks
        for (const block of msg.content) {
          if (block.type === "text") {
            const cpt = charsPerToken(block.text);
            totalTokens += Math.ceil(block.text.length / (cpt === 3 ? denseCpt : cpt));
          } else if (block.type === "tool_result") {
            const cpt = charsPerToken(block.content);
            totalTokens += Math.ceil(block.content.length / (cpt === 3 ? denseCpt : cpt));
          } else if (block.type === "tool_use") {
            const json = JSON.stringify(block.input);
            // Tool input is always JSON — dense regime, corrected.
            totalTokens += Math.ceil(json.length / denseCpt);
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
 * Cache pools of one call, for {@link calculateCost}. Each pool is a SUBSET of
 * the `inputTokens` passed alongside it.
 */
export interface CacheUsage {
  /** Anthropic cache reads. */
  readonly cache_read_input_tokens?: number;
  /** Anthropic cache writes (priced at the 5-minute TTL rate). */
  readonly cache_creation_input_tokens?: number;
  /** OpenAI-compatible cached prompt tokens. */
  readonly cached_tokens?: number;
  /** Gemini cached content tokens. */
  readonly cached_content_token_count?: number;
}

/**
 * Cost in USD of one call, from the PriceBook (any provider's row matches) or
 * `registry`. Prefer `priceFor` + `priceUsage` (price-book/), which take the
 * provider and the full usage (long-context tiers, 1h cache writes, audio, web
 * search).
 *
 * @deprecated Use `priceFor` + `priceUsage`. Kept for callers of the 0.18 API.
 * @param inputTokens - total prompt tokens, cache pools INCLUDED
 * @param outputTokens - output tokens, reasoning included
 * @param model - model id
 * @param usage - cache pools (subsets of `inputTokens`)
 * @param registry - user pricing (wins)
 * @returns USD, or `undefined` when the model's price is unknown (never a guess)
 */
export const calculateCost = (
  inputTokens: number,
  outputTokens: number,
  model: string,
  usage?: CacheUsage,
  registry?: PricingRegistry,
): number | undefined => {
  const cacheRead =
    (usage?.cache_read_input_tokens ?? 0) +
    (usage?.cached_tokens ?? 0) +
    (usage?.cached_content_token_count ?? 0);
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  return priceUsage(
    {
      inputUncached: Math.max(0, inputTokens - cacheRead - cacheWrite),
      cacheRead,
      cacheWrite5m: cacheWrite,
      cacheWrite1h: 0,
      inputAudio: 0,
      output: outputTokens,
      outputAudio: 0,
      promptTokensForTier: inputTokens,
      webSearchRequests: 0,
    },
    // "litellm" resolves bare and provider-prefixed ids across every provider.
    Option.getOrUndefined(priceFor("litellm", model, registry)),
  ).usd;
};
