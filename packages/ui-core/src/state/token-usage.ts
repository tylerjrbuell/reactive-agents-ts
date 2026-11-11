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
 * Script-aware token estimate for live previews (nothing is persisted from it).
 *
 * Standards: frontier tokenizers average roughly 4 chars/token for English prose
 * (OpenAI guidance), ~3.5 for Anthropic, ~3 for code, and ~1-2 chars/token for
 * CJK and other non-Latin scripts (where each character frequently is its own
 * token). We use a conservative per-script ratio so a pre-report number is
 * honest rather than a single divisor that silently undercounts non-Latin text:
 *   - CJK (Han/Hangul/Kana/fullwidth): 1.5 chars/token
 *   - other non-Latin scripts (Cyrillic, Greek, Arabic, Hebrew, Indic, Thai, emoji): 3 chars/token
 *   - Latin / digits / punctuation: 4 chars/token
 *
 * The provider's reported count always wins once it arrives.
 */
export const CJK_CHARS_PER_TOKEN = 1.5;
export const OTHER_CHARS_PER_TOKEN = 3;
export const LATIN_CHARS_PER_TOKEN = 4;

const isCjk = (cp: number): boolean =>
  (cp >= 0x3040 && cp <= 0x30ff) || // Hiragana + Katakana
  (cp >= 0x3130 && cp <= 0x318f) || // Hangul compatibility
  (cp >= 0xac00 && cp <= 0xd7af) || // Hangul syllables
  (cp >= 0x2e80 && cp <= 0x9fff) || // CJK radicals + unified ideographs
  (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
  (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
  (cp >= 0xff00 && cp <= 0xffef);   // half/fullwidth forms

const isLatin = (cp: number): boolean =>
  (cp >= 0x20 && cp <= 0x7e) || // ASCII printable (incl. space, digits, punctuation)
  (cp >= 0xa0 && cp <= 0x24f);   // Latin-1 supplement + Latin extended-A/B

export function estimateTokens(text: string): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  let cjk = 0;
  let other = 0;
  let latin = 0;
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isCjk(cp)) cjk++;
    else if (isLatin(cp)) latin++;
    else other++;
  }

  const tokens =
    cjk / CJK_CHARS_PER_TOKEN +
    latin / LATIN_CHARS_PER_TOKEN +
    other / OTHER_CHARS_PER_TOKEN;
  return Math.max(1, Math.ceil(tokens));
}

/**
 * Backward-compatible numeric shortcut for callers that only know a character
 * count. Assumes the latin ratio; prefer {@link estimateTokens} when the text
 * is available.
 */
export function charsToTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.max(1, Math.ceil(chars / LATIN_CHARS_PER_TOKEN));
}

/** Context-pressure band for a window utilisation percentage. */
export type ContextLevel = "low" | "medium" | "high" | "critical";

/**
 * The single context-pressure ladder: critical at 90%+, high at 75%+, medium at
 * 45%+, otherwise low. Every UI reading of a context window goes through this so
 * the bands cannot drift between the live stream and the gauges.
 */
export function contextLevel(pct: number): ContextLevel {
  if (pct >= 90) return "critical";
  if (pct >= 75) return "high";
  if (pct >= 45) return "medium";
  return "low";
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
  /** Cache-adjusted billed tokens, absent when the runtime did not report one. */
  readonly billedTokens?: number;
  /** Hidden-reasoning tokens, a subset of `tokensOut`; absent when unreported. */
  readonly reasoningTokens?: number;
  readonly model: string;
  readonly provider: string;
  readonly durationMs: number;
  /** Time to first token, ms, when the runtime measured it; absent otherwise. */
  readonly firstTokenMs?: number;
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
  /** Sum of reported billed tokens (cache-adjusted); 0 when none reported. */
  readonly billedTokens: number;
  /** Sum of reported hidden-reasoning tokens (a subset of `tokensOut`); 0 when none reported. */
  readonly reasoningTokens: number;
}

const toCallUsage = (event: TokenUsage): CallUsage => ({
  callId: event.callId,
  tokensTotal: event.tokensTotal,
  ...(event.tokensIn !== undefined ? { tokensIn: event.tokensIn } : {}),
  ...(event.tokensOut !== undefined ? { tokensOut: event.tokensOut } : {}),
  estimated: event.estimated,
  ...(event.cacheReadTokensIn !== undefined ? { cacheReadTokensIn: event.cacheReadTokensIn } : {}),
  ...(event.cacheCreationTokensIn !== undefined ? { cacheCreationTokensIn: event.cacheCreationTokensIn } : {}),
  ...(event.billedTokens !== undefined ? { billedTokens: event.billedTokens } : {}),
  ...(event.reasoningTokens !== undefined ? { reasoningTokens: event.reasoningTokens } : {}),
  model: event.model,
  provider: event.provider,
  durationMs: event.durationMs,
  ...(typeof event.firstTokenMs === "number" ? { firstTokenMs: event.firstTokenMs } : {}),
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
    billedTokens: calls.reduce((n, c) => n + (c.billedTokens ?? 0), 0),
    reasoningTokens: calls.reduce((n, c) => n + (c.reasoningTokens ?? 0), 0),
  };
}
