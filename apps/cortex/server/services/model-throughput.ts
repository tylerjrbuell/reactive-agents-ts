/**
 * Model page speed figures: median output tokens/sec and median time to first
 * token over a model's recent runs, from the stored `LLMRequestCompleted`
 * events. Per-call rates come from core `outputTokensPerSecond`.
 *
 * Honesty rule: a call without `firstTokenMs` gives only a lower-bound rate
 * (its window includes queue and prefill time). Exact and lower-bound rates are
 * never mixed in one median: the median is over the exact calls, and only when
 * there are none is a lower-bound median reported, marked `lowerBound`.
 */
import { outputTokensPerSecond } from "@reactive-agents/core";
import { medianOf } from "@reactive-agents/ui-core";
import type { StoredLlmCall } from "../db/model-throughput-queries.js";

/** Response of `GET /api/model-throughput`. */
export interface ModelThroughput {
  readonly provider: string;
  readonly model: string;
  /** Runs whose calls were read. */
  readonly runs: number;
  /** Median output tokens/sec; absent when no call gave a rate. */
  readonly tokensPerSecond?: {
    readonly median: number;
    /** True when no call reported `firstTokenMs`, so the median is over lower-bound rates. */
    readonly lowerBound: boolean;
    /** Calls in the median. */
    readonly calls: number;
  };
  /** Median time to first token, ms, over calls that reported it; absent when none did. */
  readonly firstTokenMs?: { readonly median: number; readonly calls: number };
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Fold stored calls into the model's medians. Calls on another provider/model (a fallback) are skipped. */
export function modelThroughputOf(
  provider: string,
  model: string,
  calls: readonly StoredLlmCall[],
): ModelThroughput {
  const exact: number[] = [];
  const lower: number[] = [];
  const ttft: number[] = [];
  const runs = new Set<string>();
  for (const c of calls) {
    runs.add(c.runId);
    let p: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(c.payload);
      if (typeof parsed !== "object" || parsed === null) continue;
      p = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof p.provider === "string" && p.provider !== provider) continue;
    if (typeof p.model === "string" && p.model !== model) continue;
    const durationMs = num(p.durationMs);
    if (durationMs === undefined) continue;
    const tokensOut = num(p.tokensOut);
    const firstTokenMs = num(p.firstTokenMs);
    const rate = outputTokensPerSecond({
      durationMs,
      ...(tokensOut !== undefined ? { tokensOut } : {}),
      ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
    });
    if (firstTokenMs !== undefined) ttft.push(firstTokenMs);
    if (rate === undefined) continue;
    (firstTokenMs !== undefined ? exact : lower).push(rate);
  }
  const rates = exact.length > 0 ? exact : lower;
  const rateMedian = medianOf(rates);
  const ttftMedian = medianOf(ttft);
  return {
    provider,
    model,
    runs: runs.size,
    ...(rateMedian !== undefined
      ? { tokensPerSecond: { median: rateMedian, lowerBound: exact.length === 0, calls: rates.length } }
      : {}),
    ...(ttftMedian !== undefined ? { firstTokenMs: { median: ttftMedian, calls: ttft.length } } : {}),
  };
}
