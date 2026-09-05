// File: src/billed-tokens.ts
//
// The SINGLE definition of "billed input tokens" (spec §4, finding F-3).
//
// Raw `inputTokens` stopped being a cost proxy when prompt caching shipped: a
// cached prefix read is billed at roughly a tenth of a fresh one, so a
// mechanism that trades raw tokens for cache hits looks more expensive than it
// is. Every cost consumer in this repo reads THIS function; nothing recomputes
// the subtraction inline.
//
// Pure — no Effect, no I/O, no provider coupling.

/**
 * Structural subset of `TokenUsage` (see `types.ts`). Every field optional so
 * partial/streamed usage objects pass without a cast.
 */
export type UsageLike = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadInputTokens?: number;
};

export interface BilledTokens {
  /** Input tokens the provider charges at the fresh rate. Never negative. */
  readonly billedInput: number;
  /** Input tokens served from a prompt-cache hit. */
  readonly cacheRead: number;
  /** Completion tokens. Always billed in full. */
  readonly output: number;
  /** `billedInput + output` — the figure the lift gate's token leg scores. */
  readonly billedTotal: number;
}

const nonNegative = (n: number | undefined): number =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;

/**
 * Split a usage report into billed and cached halves.
 *
 * CONTRACT: `usage.inputTokens` is the TRUE prompt size, cache pools INCLUDED.
 * The subtraction below is therefore correct as written — do NOT "fix" it as a
 * double subtraction.
 *
 * This repo's Anthropic adapter guarantees that invariant: `totalInputTokens()`
 * (providers/anthropic.ts) deliberately computes
 * `input_tokens + cache_read + cache_creation` on every complete() and stream()
 * path. It used to pass the Anthropic wire value straight through — which IS
 * the uncached remainder — and that made a caching run look ~600x cheaper per
 * call than it was, confounding every token ablation (fixed in `2f97ca1e`).
 *
 * The zero clamp is NOT defending against Anthropic, then: it is unreachable on
 * that path today. It defends against a HYPOTHETICAL future provider that
 * reports `inputTokens` EXCLUSIVE of its cache pools while still reporting the
 * cache figure separately — for which `inputTokens - cacheRead` would go
 * negative. Clamping keeps such a provider from poisoning an aggregate instead
 * of silently subtracting twice. Keep the clamp; it is cheap and general.
 *
 * A provider reporting no cache figures degrades to `billedInput === inputTokens`,
 * which is exactly today's behavior.
 */
export function billedInputTokens(usage: UsageLike): BilledTokens {
  const input = nonNegative(usage.inputTokens);
  const cacheRead = nonNegative(usage.cacheReadInputTokens);
  const output = nonNegative(usage.outputTokens);
  const billedInput = Math.max(0, input - cacheRead);
  return { billedInput, cacheRead, output, billedTotal: billedInput + output };
}
