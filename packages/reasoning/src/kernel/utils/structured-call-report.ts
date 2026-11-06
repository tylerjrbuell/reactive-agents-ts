/**
 * What one `completeStructured()` call reported about itself.
 *
 * `completeStructured()` returns only the parsed value (public contract). The
 * provider's structured retry loop leaves the rest on the per-call
 * `StructuredUsageRef` (llm-provider): the usage summed over every attempt and,
 * when the provider reports it, `attempts` — one `StructuredAttemptReport` per
 * native attempt. This module is the one place the reasoning package reads and
 * shapes it, so the observable LLM wrapper (trace + run meter) and the
 * structured-output pipeline (strategy spend) agree on a call's cost.
 *
 * Binding rule (scripts/check-run-scope.sh): only the observable wrapper may
 * set the ref. It resets it BEFORE each call and never clears it after, so a
 * path that never sets it (the replay layer, a test double) reads `null` for
 * its own call, and an outer reader (the pipeline above the wrapper) still sees
 * the value the wrapper accounted.
 */
import { Effect, FiberRef } from "effect";
import { StructuredUsageRef, type StructuredCallUsage, type TokenUsage } from "@reactive-agents/llm-provider";
import type { StructuredAttemptReport } from "@reactive-agents/core";
import type { RunBudgetSpend } from "../run-budget.js";

/** The usage and per-attempt detail one structured call left on the fiber. */
export type StructuredCallReport = {
  readonly usage: TokenUsage | null;
  readonly attempts: readonly StructuredAttemptReport[] | null;
};

/** The per-attempt reports a provider attached to the call's usage, or `null` when there are none. */
export function attemptsOf(usage: StructuredCallUsage | null): readonly StructuredAttemptReport[] | null {
  const attempts = usage?.attempts;
  return attempts !== undefined && attempts.length > 0 ? attempts : null;
}

/** Shape a raw ref value into a report. */
export const toStructuredCallReport = (usage: StructuredCallUsage | null): StructuredCallReport => ({
  usage,
  attempts: attemptsOf(usage),
});

/** Read what the most recent structured call on this fiber reported. */
export const readStructuredCallReport: Effect.Effect<StructuredCallReport> = FiberRef.get(StructuredUsageRef).pipe(
  Effect.map(toStructuredCallReport),
);

/** Exchange-record fields derived from a structured call report. */
export type StructuredExchangeFields = {
  readonly usage?: TokenUsage;
  /** The final attempt's stop reason (the one that ended the call). */
  readonly stopReason?: string;
  /** Thinking characters summed over every attempt that reported it. */
  readonly thinkingChars?: number;
  readonly attempts?: readonly StructuredAttemptReport[];
};

/**
 * Shape a report for the `llm-exchange` record. Absent inputs stay absent, so
 * a provider that reports nothing produces the same exchange as before.
 */
export function structuredExchangeFields(report: StructuredCallReport): StructuredExchangeFields {
  const attempts = report.attempts ?? undefined;
  const stopReason = attempts?.[attempts.length - 1]?.stopReason;
  const thinkingChars = attempts?.reduce((sum, a) => sum + (a.thinkingChars ?? 0), 0) ?? 0;
  return {
    ...(report.usage !== null ? { usage: report.usage } : {}),
    ...(stopReason !== undefined ? { stopReason } : {}),
    ...(thinkingChars > 0 ? { thinkingChars } : {}),
    ...(attempts !== undefined ? { attempts } : {}),
  };
}

/** True when the provider reported tokens for the call (`totalTokens === 0` means "unknown"). */
export function hasReportedUsage(usage: TokenUsage | null): usage is TokenUsage {
  return usage !== null && usage.totalTokens > 0;
}

/** Text of a structured call, for a spend estimate when the provider reported no usage. */
export type StructuredSpendEstimate = { readonly prompt: string; readonly raw: string };

/**
 * The one spend rule for a structured call, used by the run meter (observable
 * wrapper) and by strategy spend alike. Counts as one LLM call. Tokens and cost
 * are the provider-reported usage when there is any; otherwise the explicit
 * `estimate` fallback (chars / 4 of the prompt and the raw output, no cost);
 * otherwise zero. The meter passes no estimate: it records only what was billed.
 * The wrapper meters a FAILED call only when {@link hasReportedUsage} (its
 * attempts ran and were billed even though no schema-valid value came back).
 */
export function structuredCallSpend(usage: TokenUsage | null, estimate?: StructuredSpendEstimate): RunBudgetSpend {
  if (hasReportedUsage(usage)) {
    return {
      tokens: usage.totalTokens,
      cost: usage.estimatedCost,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      llmCalls: 1,
    };
  }
  const inputTokens = estimate === undefined ? 0 : Math.ceil(estimate.prompt.length / 4);
  const outputTokens = estimate === undefined ? 0 : Math.ceil(estimate.raw.length / 4);
  return { tokens: inputTokens + outputTokens, cost: 0, inputTokens, outputTokens, llmCalls: 1 };
}
