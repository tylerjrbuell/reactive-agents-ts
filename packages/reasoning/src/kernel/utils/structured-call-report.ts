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
import { StructuredUsageRef, type TokenUsage } from "@reactive-agents/llm-provider";
import type { StructuredAttemptReport } from "@reactive-agents/core";
import type { RunBudgetSpend } from "../run-budget.js";

/** The usage and per-attempt detail one structured call left on the fiber. */
export type StructuredCallReport = {
  readonly usage: TokenUsage | null;
  readonly attempts: readonly StructuredAttemptReport[] | null;
};

const isOptionalNumber = (v: unknown): boolean => v === undefined || typeof v === "number";

/** Runtime guard: the provider's `attempts` entries cross a package boundary untyped-at-rest. */
export function isStructuredAttemptReport(v: unknown): v is StructuredAttemptReport {
  if (typeof v !== "object" || v === null) return false;
  const r: { readonly [k: string]: unknown } = { ...v };
  return (
    typeof r.attempt === "number" &&
    typeof r.parsed === "boolean" &&
    isOptionalNumber(r.inputTokens) &&
    isOptionalNumber(r.outputTokens) &&
    isOptionalNumber(r.thinkingChars) &&
    (r.stopReason === undefined || typeof r.stopReason === "string")
  );
}

/**
 * The per-attempt reports a provider attached to the call's usage, or `null`.
 * Read structurally: `StructuredUsageRef` is typed `TokenUsage` until the
 * provider widens it, and a malformed list is dropped whole, never half-read.
 */
export function attemptsOf(usage: TokenUsage | null): readonly StructuredAttemptReport[] | null {
  if (usage === null || !("attempts" in usage)) return null;
  const raw: unknown = usage.attempts;
  return Array.isArray(raw) && raw.length > 0 && raw.every(isStructuredAttemptReport) ? raw : null;
}

/** Shape a raw ref value into a report. */
export const toStructuredCallReport = (usage: TokenUsage | null): StructuredCallReport => ({
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

/**
 * Run-meter spend for one structured call. A successful call always counts as
 * one call. A failed call counts only when the provider reported tokens for it
 * (the attempts ran and were billed even though no schema-valid value came back).
 */
export function structuredRunSpend(usage: TokenUsage | null, succeeded: boolean): RunBudgetSpend | null {
  const hasUsage = usage !== null && usage.totalTokens > 0;
  if (!succeeded && !hasUsage) return null;
  return {
    tokens: hasUsage ? usage.totalTokens : 0,
    cost: hasUsage ? usage.estimatedCost : 0,
    inputTokens: hasUsage ? usage.inputTokens : 0,
    outputTokens: hasUsage ? usage.outputTokens : 0,
    llmCalls: 1,
  };
}
