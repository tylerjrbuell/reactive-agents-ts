/**
 * One native attempt inside a single `completeStructured()` call.
 *
 * A structured call can run several provider requests internally (the parse
 * retry loop feeds a decode error back and asks again), yet the trace records
 * ONE exchange for it. Without a per-attempt split, a thinking runaway, a parse
 * retry and real output all read as one large `tokensOut` (H3 thinking-cap
 * recheck, 2026-11-06: a 13,855-token planner exchange could not be explained).
 *
 * Lives in `core` for the same reason as `LlmCallPurpose`: `llm-provider`
 * reports it (as `attempts` on the per-call usage it leaves in
 * `StructuredUsageRef`), the reasoning kernel's observable wrapper reads it,
 * and `core`'s `LLMExchangeEmitted` plus `trace`'s `llm-exchange` record it.
 * Every field except `attempt` and `parsed` is optional: a provider reports
 * what it knows.
 */
export type StructuredAttemptReport = {
  /** 0-based attempt index within the structured call. */
  readonly attempt: number;
  /** Prompt tokens the provider reported for this attempt. */
  readonly inputTokens?: number;
  /** Output tokens the provider reported for this attempt (thinking included when the provider counts it). */
  readonly outputTokens?: number;
  /** Provider stop reason for this attempt (`end_turn`, `max_tokens`, ...). */
  readonly stopReason?: string;
  /** Characters of internal reasoning the attempt produced, when the provider surfaces it. */
  readonly thinkingChars?: number;
  /** True when this attempt's content parsed and decoded against the schema. */
  readonly parsed: boolean;
};
