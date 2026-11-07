import type { CallUsage, TurnUsage } from "@reactive-agents/ui-core";

export const MAX_BARS = 24;

export interface TokenBar {
  /** Provider-reported (or total) tokens for this call. */
  readonly total: number;
  readonly in: number;
  readonly out: number;
  /** Fraction of the widest bar (0..1). */
  readonly width: number;
  /** Input segment fraction of THIS bar (0..1). */
  readonly inShare: number;
  /** Output segment fraction of THIS bar (0..1). */
  readonly outShare: number;
}

export interface TokenBarsResult {
  readonly bars: readonly TokenBar[];
  /** Number of calls collapsed because they exceeded MAX_BARS. */
  readonly overflow: number;
}

const safe = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * One stacked bar per call. Widths are proportional to `total / maxTotal`; calls
 * beyond {@link MAX_BARS} (oldest first) collapse into `overflow`. A zero-total
 * call yields a zero-width bar rather than NaN.
 */
export function tokenBars(calls: readonly (CallUsage | { tokensTotal: number; tokensIn?: number; tokensOut?: number })[]): TokenBarsResult {
  const list = calls ?? [];
  const overflow = Math.max(0, list.length - MAX_BARS);
  const visible = list.slice(-MAX_BARS);
  const maxTotal = visible.reduce((m, c) => Math.max(m, safe(c.tokensTotal)), 0);
  const bars: TokenBar[] = visible.map((c) => {
    const total = safe(c.tokensTotal);
    const inTok = safe(c.tokensIn ?? 0);
    const outTok = safe(c.tokensOut ?? 0);
    const width = maxTotal > 0 ? total / maxTotal : 0;
    const inShare = total > 0 ? inTok / total : 0;
    const outShare = total > 0 ? outTok / total : 0;
    return { total, in: inTok, out: outTok, width, inShare, outShare };
  });
  return { bars, overflow };
}

const fmt = (n: number): string => {
  const v = Math.max(0, Math.round(n));
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return String(v);
};

/**
 * Compact "1.2k in · 340 out" label. Prefixed with `~` when the usage is estimated.
 */
export function tokenRangeLabel(usage: Pick<TurnUsage, "tokensIn" | "tokensOut" | "estimated"> | { tokensIn: number; tokensOut: number; estimated?: boolean }): string {
  const estimated = "estimated" in usage ? usage.estimated === true : false;
  const prefix = estimated ? "~" : "";
  return `${prefix}${fmt(usage.tokensIn)} in · ${fmt(usage.tokensOut)} out`;
}
