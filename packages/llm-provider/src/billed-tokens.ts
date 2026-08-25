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
 * Providers disagree about whether `inputTokens` already excludes cache reads.
 * Anthropic reports the UNCACHED remainder, so `inputTokens - cacheRead` can go
 * negative; that is clamped to 0 rather than allowed to poison an aggregate.
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
