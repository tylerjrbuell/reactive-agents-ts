/**
 * Strategy-failure surfacing — the ONE place a failed strategy/LLM terminal is
 * turned into user-visible text. Used by the think phase (strategy Exit
 * failure) and the streaming terminal (silent empty-output failure).
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

/**
 * Terminal output for a FAILED run: an empty output gets a named failure
 * message; non-empty output is untouched (strategies may carry a real
 * explanation). Successful runs must not call this.
 */
export function surfaceFailedOutput(strategy: string, output: string, terminatedBy: string | undefined): string {
  if (output.trim().length > 0) return output;
  return describeStrategyFailure(strategy, terminatedBy ?? "run failed with no output");
}
