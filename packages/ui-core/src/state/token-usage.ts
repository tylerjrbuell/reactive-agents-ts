import type { TokenUsage } from "../protocol/events.js";

/**
 * Per-turn token accounting shared by the live chat UI and by servers that
 * persist a turn. Evidence only: the provider's split wins, an absent half is
 * an estimate (and `estimated` says so), and nothing here pretends to know a
 * figure the provider never reported.
 */

/** One provider split, resolved for display. */
export interface TokenSplit {
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** True when at least one half was derived rather than provider-reported. */
  readonly estimated: boolean;
}

/**
 * Resolve an input/output split from whatever the provider reported.
 *
 * - both halves known → unchanged
 * - one half known → the other is `total - known`, marked estimated
 * - neither → a 70/30 split of the total, marked estimated
 * - total 0 → zeros
 */
export function splitTokens(
  tokensIn: number | undefined,
  tokensOut: number | undefined,
  total: number,
): TokenSplit {
  const t = Number.isFinite(total) ? Math.max(0, total) : 0;
  const hasIn = typeof tokensIn === "number" && Number.isFinite(tokensIn);
  const hasOut = typeof tokensOut === "number" && Number.isFinite(tokensOut);
  if (hasIn && hasOut) return { tokensIn: Math.max(0, tokensIn), tokensOut: Math.max(0, tokensOut), estimated: false };
  if (hasIn) return { tokensIn: Math.max(0, tokensIn), tokensOut: Math.max(0, t - tokensIn), estimated: true };
  if (hasOut) return { tokensIn: Math.max(0, t - tokensOut), tokensOut: Math.max(0, tokensOut), estimated: true };
  if (t === 0) return { tokensIn: 0, tokensOut: 0, estimated: true };
  const estimatedIn = Math.round(t * 0.7);
  return { tokensIn: estimatedIn, tokensOut: t - estimatedIn, estimated: true };
}

/**
 * Rough character-to-token ratio used ONLY for live previews (nothing is
 * persisted from it). Providers tokenize differently; a 4-char/token rule with
 * a floor of 1 keeps small strings from reading as zero.
 */
export function charsToTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.max(1, Math.ceil(chars / 4));
}

/** One completed LLM call inside a turn. */
export interface CallUsage {
  readonly callId: string;
  readonly tokensTotal: number;
  /** Provider-reported halves; absent when the provider reported no split. */
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly estimated: boolean;
  /** Provider-reported cache read/write tokens, absent when the provider reported none. */
  readonly cacheReadTokensIn?: number;
  readonly cacheCreationTokensIn?: number;
  readonly model: string;
  readonly provider: string;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly iteration?: number;
}

/** Summed usage for a whole turn. */
export interface TurnUsage {
  readonly calls: readonly CallUsage[];
  /** Sum of REPORTED input halves (estimated calls contribute 0 here). */
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensTotal: number;
  /** True when any call lacks a provider split. */
  readonly estimated: boolean;
  readonly costUsd: number;
  /** Sums of provider-reported cache figures across the turn's calls. */
  readonly cacheReadTokensIn: number;
  readonly cacheCreationTokensIn: number;
}

const toCallUsage = (event: TokenUsage): CallUsage => ({
  callId: event.callId,
  tokensTotal: event.tokensTotal,
  ...(event.tokensIn !== undefined ? { tokensIn: event.tokensIn } : {}),
  ...(event.tokensOut !== undefined ? { tokensOut: event.tokensOut } : {}),
  estimated: event.estimated,
  ...(event.cacheReadTokensIn !== undefined ? { cacheReadTokensIn: event.cacheReadTokensIn } : {}),
  ...(event.cacheCreationTokensIn !== undefined ? { cacheCreationTokensIn: event.cacheCreationTokensIn } : {}),
  model: event.model,
  provider: event.provider,
  durationMs: event.durationMs,
  costUsd: event.costUsd,
  ...(event.iteration !== undefined ? { iteration: event.iteration } : {}),
});

/** Fold one more call into a turn's usage. A repeated `callId` replaces, never duplicates. */
export function summarizeUsage(previous: TurnUsage | undefined, event: TokenUsage): TurnUsage {
  const call = toCallUsage(event);
  const calls = previous === undefined
    ? [call]
    : previous.calls.some((c) => c.callId === call.callId)
      ? previous.calls.map((c) => (c.callId === call.callId ? call : c))
      : [...previous.calls, call];
  return {
    calls,
    tokensIn: calls.reduce((n, c) => n + (c.tokensIn ?? 0), 0),
    tokensOut: calls.reduce((n, c) => n + (c.tokensOut ?? 0), 0),
    tokensTotal: calls.reduce((n, c) => n + c.tokensTotal, 0),
    estimated: calls.some((c) => c.estimated),
    costUsd: calls.reduce((n, c) => n + c.costUsd, 0),
    cacheReadTokensIn: calls.reduce((n, c) => n + (c.cacheReadTokensIn ?? 0), 0),
    cacheCreationTokensIn: calls.reduce((n, c) => n + (c.cacheCreationTokensIn ?? 0), 0),
  };
}
