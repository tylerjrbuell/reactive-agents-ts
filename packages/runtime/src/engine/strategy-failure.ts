/**
 * Strategy-failure surfacing — the ONE place a failed strategy/LLM terminal is
 * turned into a failure message. Used by the think phase (strategy Exit
 * failure), which puts it on the result's `error`, never its `output`.
 */
import { Cause } from "effect";

/** First line of a failure value, stack frames dropped. */
function firstLine(value: unknown): string {
  const message = (value as { message?: unknown } | null | undefined)?.message;
  const text = typeof message === "string" ? message : String(value);
  return (text.split("\n")[0] ?? "").trim();
}

/**
 * Text for a failed strategy that names the strategy and carries only the
 * failure message (never a raw stack). Keeps the `Strategy execution failed`
 * prefix existing consumers match on.
 */
export function describeStrategyFailure(strategy: string, reason: unknown): string {
  const msg = firstLine(reason);
  return `Strategy execution failed (${strategy})${msg.length > 0 ? `: ${msg}` : ""}`;
}

/** {@link describeStrategyFailure} for an Effect `Cause`. */
export function describeStrategyCause(strategy: string, cause: Cause.Cause<unknown>): string {
  return describeStrategyFailure(strategy, Cause.squash(cause));
}
