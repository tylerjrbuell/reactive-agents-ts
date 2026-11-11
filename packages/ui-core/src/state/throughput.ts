/**
 * LLM output speed for chat and run UIs: tokens per second and time to first
 * token (TTFT), from the fields a completed call reports (`LLMRequestCompleted`
 * / the `TokenUsage` stream event: `tokensOut`, `durationMs`, `firstTokenMs`).
 *
 * The per-call formula is the same as `outputTokensPerSecond` in
 * `@reactive-agents/core` (ui-core has no dependencies, so it carries its own
 * copy; Cortex pins the two against each other):
 * `tokensOut / ((durationMs - firstTokenMs) / 1000)`. Without `firstTokenMs`
 * (a non-streamed call, or a producer that did not report it) the window is the
 * whole `durationMs`, which includes queue and prefill time, so the figure is a
 * lower bound and `lowerBound` says so. UIs mark it `~`.
 */

/** The fields of one completed LLM call that a throughput figure reads. */
export interface ThroughputSample {
  /** Output tokens the provider reported; a call without them gives no rate. */
  readonly tokensOut?: number;
  /** Request round-trip time, ms. */
  readonly durationMs: number;
  /** Time from request to the first streamed token, ms; absent when not measured. */
  readonly firstTokenMs?: number;
}

/** Output speed of one call or a group of calls. */
export interface Throughput {
  /** Output tokens per second over the generation window. */
  readonly tokensPerSecond: number;
  /**
   * Time to first token, ms: the call's own, or the mean over the calls that
   * reported one. Absent when no call reported it.
   */
  readonly firstTokenMs?: number;
  /**
   * True when at least one call had no `firstTokenMs`, so its window included
   * queue and prefill time and the rate reads lower than true generation speed.
   */
  readonly lowerBound: boolean;
  /** Calls that contributed a rate. */
  readonly calls: number;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The generation window of one call in ms, or `undefined` when none can be measured. */
function windowOf(s: ThroughputSample): number | undefined {
  if (!finite(s.tokensOut) || !finite(s.durationMs)) return undefined;
  const ttft = finite(s.firstTokenMs) ? s.firstTokenMs : 0;
  const w = s.durationMs - ttft;
  return w > 0 ? w : undefined;
}

/**
 * Output speed of one completed call. Same result as core's
 * `outputTokensPerSecond`.
 *
 * @returns `undefined` when `tokensOut` is absent or the window is ≤ 0 ms.
 */
export function throughputOf(sample: ThroughputSample): Throughput | undefined {
  const w = windowOf(sample);
  if (w === undefined || !finite(sample.tokensOut)) return undefined;
  const hasTtft = finite(sample.firstTokenMs);
  return {
    tokensPerSecond: sample.tokensOut / (w / 1000),
    ...(hasTtft ? { firstTokenMs: sample.firstTokenMs } : {}),
    lowerBound: !hasTtft,
    calls: 1,
  };
}

/**
 * Output speed across several calls (one loop, one turn, one run): total output
 * tokens over total generation time, so a long call weighs more than a short
 * one. TTFT is the mean over the calls that reported one.
 *
 * @returns `undefined` when no call gives a rate.
 */
export function throughputOfCalls(samples: readonly ThroughputSample[]): Throughput | undefined {
  let out = 0;
  let windowMs = 0;
  let calls = 0;
  let lowerBound = false;
  let ttftSum = 0;
  let ttftCalls = 0;
  for (const s of samples) {
    const w = windowOf(s);
    if (w === undefined || !finite(s.tokensOut)) continue;
    out += s.tokensOut;
    windowMs += w;
    calls++;
    if (finite(s.firstTokenMs)) {
      ttftSum += s.firstTokenMs;
      ttftCalls++;
    } else lowerBound = true;
  }
  if (calls === 0) return undefined;
  return {
    tokensPerSecond: out / (windowMs / 1000),
    ...(ttftCalls > 0 ? { firstTokenMs: ttftSum / ttftCalls } : {}),
    lowerBound,
    calls,
  };
}

/** Shortest elapsed time, ms, before a live rate is shown: earlier figures swing wildly. */
export const MIN_LIVE_RATE_MS = 250;

/**
 * Live estimate while a reply streams: tokens seen so far (an estimate, e.g.
 * `estimateTokens` over the streamed text) over the time since the first token
 * arrived. Always an estimate; the exact rate comes when the call completes.
 *
 * @returns `undefined` before {@link MIN_LIVE_RATE_MS} or with no tokens.
 */
export function liveTokensPerSecond(tokens: number, elapsedMs: number): number | undefined {
  if (!finite(tokens) || tokens <= 0 || !finite(elapsedMs) || elapsedMs < MIN_LIVE_RATE_MS) return undefined;
  return tokens / (elapsedMs / 1000);
}

/**
 * `42 tok/s`, `7.5 tok/s`, `~42 tok/s` when `estimated` (a live estimate or a
 * lower bound). One decimal under 10, whole numbers above.
 */
export function formatTokensPerSecond(tokensPerSecond: number, estimated = false): string {
  const v = Math.max(0, tokensPerSecond);
  const n = v < 10 ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString();
  return `${estimated ? "~" : ""}${n} tok/s`;
}

/** Time to first token for display: `320ms`, `1.4s`, `12s`. */
export function formatFirstToken(ms: number): string {
  const v = Math.max(0, ms);
  if (v < 1000) return `${Math.round(v)}ms`;
  if (v < 10_000) return `${(Math.round(v / 100) / 10).toString()}s`;
  return `${Math.round(v / 1000)}s`;
}

/** Median of a list, or `undefined` when it is empty. */
export function medianOf(values: readonly number[]): number | undefined {
  const v = values.filter(finite).slice().sort((a, b) => a - b);
  if (v.length === 0) return undefined;
  const mid = Math.floor(v.length / 2);
  const hi = v[mid] ?? 0;
  return v.length % 2 === 1 ? hi : ((v[mid - 1] ?? hi) + hi) / 2;
}
