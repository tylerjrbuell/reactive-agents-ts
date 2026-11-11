/**
 * Cortex wiring for LLM output speed (tokens/sec, time to first token). The
 * math is ui-core's (`throughputOf` / `throughputOfCalls`, same formula as core
 * `outputTokensPerSecond`); this module only reads stored event payloads and
 * words the result. A rate without a measured first token is a lower bound and
 * reads `~`; a live estimate always reads `~`.
 */
import {
  formatFirstToken,
  formatTokensPerSecond,
  type Throughput,
  type ThroughputSample,
} from "@reactive-agents/ui-core";

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The throughput fields of one `LLMRequestCompleted` payload, or `undefined` without a duration. */
export function throughputSampleOf(p: Record<string, unknown>): ThroughputSample | undefined {
  const durationMs = num(p.durationMs);
  if (durationMs === undefined) return undefined;
  const tokensOut = num(p.tokensOut);
  const firstTokenMs = num(p.firstTokenMs);
  return {
    durationMs,
    ...(tokensOut !== undefined ? { tokensOut } : {}),
    ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
  };
}

/** What a speed readout shows: a short label and a hover title that says how it was measured. */
export interface ThroughputView {
  /** `42 tok/s` or `~42 tok/s`. */
  readonly text: string;
  /** `TTFT 320ms`, absent when no call measured its first token. */
  readonly ttft?: string;
  readonly title: string;
}

/** Word a measured throughput. `undefined` in, `undefined` out. */
export function throughputView(t: Throughput | undefined): ThroughputView | undefined {
  if (!t) return undefined;
  const rate = formatTokensPerSecond(t.tokensPerSecond, t.lowerBound);
  const over = t.calls === 1 ? "one model call" : `${t.calls} model calls`;
  const ttftPart =
    t.firstTokenMs !== undefined
      ? ` · first token after ${formatFirstToken(t.firstTokenMs)}${t.calls > 1 ? " (mean)" : ""}`
      : "";
  const bound = t.lowerBound
    ? ". At least this fast: a call did not report when its first token came, so its time includes the wait before output"
    : "";
  return {
    text: rate,
    ...(t.firstTokenMs !== undefined ? { ttft: `TTFT ${formatFirstToken(t.firstTokenMs)}` } : {}),
    title: `Output speed ${rate} over ${over}${ttftPart}${bound}`,
  };
}

/** The live readout while a reply streams: always an estimate. */
export function liveRateText(tokensPerSecond: number | undefined): string | undefined {
  return tokensPerSecond === undefined ? undefined : formatTokensPerSecond(tokensPerSecond, true);
}
