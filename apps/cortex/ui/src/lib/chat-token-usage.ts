import type { CallUsage, TurnUsage } from "@reactive-agents/ui-core";
import { formatTokens, splitTokens } from "@reactive-agents/ui-core";
import type { ChatContext, ChatTurn, LiveTokenSplit } from "$lib/stores/chat-store.js";
import { sessionCostSummary, type ChatTotals } from "$lib/stores/chat-cost.js";
import { latestContext } from "$lib/chat-context.js";

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

/** Minimum call duration before a throughput figure is meaningful (ms). */
export const MIN_THROUGHPUT_MS = 50;

/**
 * Tokens per second for one completed call, or `undefined` when the call is
 * too short, reported no tokens, or reported no duration. Stays honest: no
 * figure is fabricated from a zero-duration call.
 */
export function callThroughput(call: { tokensTotal?: number; durationMs?: number }): number | undefined {
  const total = call?.tokensTotal;
  const dur = call?.durationMs;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return undefined;
  if (typeof dur !== "number" || !Number.isFinite(dur) || dur < MIN_THROUGHPUT_MS) return undefined;
  return Math.round((total / dur) * 1000);
}

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

/** Compact token count: "340", "1.2k", "10k". Negatives clamp to zero. */
export function formatTokenCount(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return String(v);
}

/**
 * Compact "1.2k in · 340 out" label. Prefixed with `~` when the usage is estimated.
 */
export function tokenRangeLabel(usage: Pick<TurnUsage, "tokensIn" | "tokensOut" | "estimated"> | { tokensIn: number; tokensOut: number; estimated?: boolean }): string {
  const estimated = "estimated" in usage ? usage.estimated === true : false;
  const prefix = estimated ? "~" : "";
  return `${prefix}${formatTokenCount(usage.tokensIn)} in · ${formatTokenCount(usage.tokensOut)} out`;
}

/**
 * Hover title for one half of a token split. An estimate says "while streaming"
 * only while the turn streams: a finished turn whose provider reported just the
 * total is "estimated", never "estimated while streaming" (Bench spec 3.4).
 */
export function tokenHalfTitle(direction: "in" | "out", value: number, estimated: boolean, streaming: boolean): string {
  const base = `${direction === "in" ? "Input" : "Output"} tokens`;
  if (!estimated || value <= 0) return base;
  return `${base} (${streaming ? "estimated while streaming" : "estimated: the provider reported only the total"})`;
}

/**
 * The turn header's usage line, `2.8k in · 560 out` (ui-core `formatTokens`),
 * with `~` on an estimated half and a title that spells both halves out.
 */
export function turnUsageLabel(split: LiveTokenSplit, streaming: boolean): { text: string; title: string } {
  const half = (n: number, est: boolean) => `${est && n > 0 ? "~" : ""}${formatTokens(n)}`;
  return {
    text: `${half(split.tokensIn, split.estimatedIn)} in · ${half(split.tokensOut, split.estimatedOut)} out`,
    title: `${tokenHalfTitle("in", split.tokensIn, split.estimatedIn, streaming)}: ${split.tokensIn.toLocaleString()} · ${tokenHalfTitle("out", split.tokensOut, split.estimatedOut, streaming)}: ${split.tokensOut.toLocaleString()}`,
  };
}

/** The per-call fields the bar tooltip reads. */
export interface BarCall {
  readonly tokensTotal?: number;
  readonly durationMs?: number;
  readonly billedTokens?: number;
  readonly reasoningTokens?: number;
}

/**
 * Hover title for one per-call bar: the call's ordinal (1-based), its split, and
 * the billed / reasoning / throughput figures that were reported. Throughput is
 * computed once here, and omitted when the call is too short to measure.
 */
export function barTitle(bar: TokenBar, call: BarCall | undefined, ordinal: number): string {
  const throughput = callThroughput(call ?? {});
  const parts = [`call ${ordinal}: ${bar.total} tok${bar.total === 0 ? "" : ` (${bar.in} in / ${bar.out} out)`}`];
  if ((call?.billedTokens ?? 0) > 0) parts.push(`${call?.billedTokens} billed`);
  if ((call?.reasoningTokens ?? 0) > 0) parts.push(`${call?.reasoningTokens} reasoning`);
  if (throughput !== undefined) parts.push(`${throughput} tok/s`);
  return parts.join(" · ");
}

/** Everything the session token meter (`ChatContextMeter`) shows for a conversation. */
export interface ContextMeterState {
  readonly context: ChatContext | undefined;
  readonly sessionTokens: number;
  readonly sessionTokensIn: number;
  readonly sessionTokensOut: number;
  readonly splitComplete: boolean;
  /** Per-half estimation flags for the turn still streaming. */
  readonly sessionInEstimated: boolean;
  readonly sessionOutEstimated: boolean;
  readonly streaming: boolean;
  readonly sessionCost: number;
  readonly costKnown: boolean;
  /** The most recent settled assistant reply, for the "last reply" rows. */
  readonly last: { tokens: number; tokensIn?: number; tokensOut?: number; steps?: number; toolCalls: number } | undefined;
}

/**
 * Derive the session token meter from a conversation's turns and server totals.
 * Pure: the live counters of a streaming turn are added on top of the settled totals.
 */
export function contextMeterOf(turns: readonly ChatTurn[], totals: ChatTotals | undefined): ContextMeterState {
  const usage = sessionCostSummary(totals, turns);
  const streamingTurn = turns.find((t) => t.streaming);
  const liveSplit = streamingTurn ? splitOfTurn(streamingTurn) : undefined;
  const lastTurn = [...turns].reverse().find((t) => t.role === "assistant" && !t.streaming);
  return {
    context: latestContext(turns),
    sessionTokens: usage.tokens,
    sessionTokensIn: (totals?.tokensIn ?? 0) + (liveSplit?.tokensIn ?? 0),
    sessionTokensOut: (totals?.tokensOut ?? 0) + (liveSplit?.tokensOut ?? 0),
    splitComplete: totals?.splitComplete ?? true,
    sessionInEstimated: liveSplit?.estimatedIn ?? false,
    sessionOutEstimated: liveSplit?.estimatedOut ?? false,
    streaming: streamingTurn !== undefined,
    sessionCost: usage.costUsd,
    costKnown: usage.costKnown,
    last: lastTurn
      ? {
          tokens: lastTurn.tokensUsed,
          tokensIn: lastTurn.tokensIn,
          tokensOut: lastTurn.tokensOut,
          ...(lastTurn.steps ? { steps: lastTurn.steps } : {}),
          toolCalls: lastTurn.toolCalls?.length ?? 0,
        }
      : undefined,
  };
}

/**
 * Resolve the split a turn should display, live or finished.
 *
 * Order of authority: the streaming turn's live split (reported calls + an
 * in-flight estimate) → the provider split on the finished reply → the folded
 * per-call usage → a marked fallback split of the total. Nothing is invented
 * without `estimatedIn` / `estimatedOut` saying so.
 */
export function splitOfTurn(turn: Pick<ChatTurn, "tokensUsed" | "tokensIn" | "tokensOut" | "liveTokens" | "liveUsage" | "usage" | "streaming">): LiveTokenSplit {
  // The live split survives only while a turn is streaming or after a stream
  // aborted without a terminal event; a completed turn clears it.
  if (turn.liveUsage) return turn.liveUsage;

  const usage = turn.usage;
  const total = turn.tokensUsed > 0 ? turn.tokensUsed : (usage?.tokensTotal ?? turn.liveTokens ?? 0);
  const split = splitTokens(turn.tokensIn ?? usage?.tokensIn, turn.tokensOut ?? usage?.tokensOut, total);

  const calls = usage?.calls ?? [];
  const inputReported = turn.tokensIn !== undefined || (calls.length > 0 && calls.every((c) => c.tokensIn !== undefined));
  const outputReported = turn.tokensOut !== undefined || (calls.length > 0 && calls.every((c) => c.tokensOut !== undefined));

  return {
    tokensIn: split.tokensIn,
    tokensOut: split.tokensOut,
    estimatedIn: !inputReported,
    estimatedOut: !outputReported,
  };
}
