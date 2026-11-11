import type { AgentEvent } from "../types/agent-event.js";

/**
 * The `LLMRequestCompleted` fields a throughput figure reads. A `Pick` rather
 * than the whole event, so stored rows (trace records, Cortex run tables) that
 * keep only these fields can use the same helper.
 */
export type LLMThroughputFields = Pick<
  Extract<AgentEvent, { _tag: "LLMRequestCompleted" }>,
  "durationMs" | "tokensOut" | "firstTokenMs"
>;

/**
 * Output tokens per second for one LLM call:
 * `tokensOut / ((durationMs - firstTokenMs) / 1000)`.
 *
 * When `firstTokenMs` is absent (non-streamed call), the window is the whole
 * `durationMs`, so the figure includes queue and prefill time and reads lower
 * than true generation speed.
 *
 * @returns tokens/sec, or `undefined` when `tokensOut` is absent or the
 * generation window is ≤ 0 ms (no rate can be measured).
 */
export function outputTokensPerSecond(event: LLMThroughputFields): number | undefined {
  if (event.tokensOut === undefined) return undefined;
  const windowMs = event.durationMs - (event.firstTokenMs ?? 0);
  if (!(windowMs > 0)) return undefined;
  return event.tokensOut / (windowMs / 1000);
}
