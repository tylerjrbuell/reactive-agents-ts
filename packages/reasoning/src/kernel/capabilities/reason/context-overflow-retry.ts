/**
 * Think phase — context-overflow facts for the `shrink` recovery (Plan 9 Phase
 * 2, item 2d).
 *
 * A provider that rejects the prompt as too long (`LLMContextOverflowError`:
 * `context_overflow` or `request_too_large`) cannot succeed on a re-send, but a
 * smaller request can. The recovery itself lives in the one recoverable-failure
 * seam (`think-call-recovery.ts`): on a `shrink` failure it re-projects the
 * conversation through the canonical `project()` compaction (deterministic, no
 * LLM summary) at the window computed here and retries. This module only reads
 * the overflow facts off the provider error and computes that window.
 */
import { resolveEffectiveNumCtx, type ContextProfile } from "../../../context/context-profile.js";

/** The provider's typed overflow error tag (`@reactive-agents/llm-provider` errors.ts). */
export const CONTEXT_OVERFLOW_ERROR_TAG = "LLMContextOverflowError";

/** The retry projects at this fraction of the prompt size the provider reported. */
export const OVERFLOW_RETRY_WINDOW_FRACTION = 0.7;

/** Window the projection assumes when the profile states none (from-kernel-state.ts). */
const DEFAULT_PROJECTION_WINDOW = 32_768;

/** Overflow facts read off the provider error. Zero = the provider did not state it. */
export interface ContextOverflowFacts {
  readonly tokenCount: number;
  readonly maxTokens: number;
}

/** Facts for an overflow-class failure whose error stated no token counts. */
export const UNSTATED_OVERFLOW: ContextOverflowFacts = { tokenCount: 0, maxTokens: 0 };

const numberField = (rec: Record<string, unknown>, key: string): number => {
  const v = rec[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
};

/**
 * Read a context-overflow failure off the raw stream failure value, or
 * `undefined` for any other failure. Structural (reads `_tag`), like
 * `describeLlmFailure`: the kernel never depends on a provider class identity.
 */
export function contextOverflowOf(cause: unknown): ContextOverflowFacts | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const rec = cause as Record<string, unknown>;
  if (rec["_tag"] !== CONTEXT_OVERFLOW_ERROR_TAG) return undefined;
  return { tokenCount: numberField(rec, "tokenCount"), maxTokens: numberField(rec, "maxTokens") };
}

/** The provider class of an input-side per-minute token budget failure (TPM / ITPM). */
export const TOKEN_RATE_EXCEEDED_CLASS = "token_rate_exceeded";

/**
 * The window the retry re-projects at: 0.7x the prompt size the provider
 * reported (`tokenCount`), or 0.7x the projected window when the provider did
 * not state it. Never wider than 0.7x the projected window, so the retry always
 * compacts below what overflowed. For a per-minute token budget failure
 * (`token_rate_exceeded`), `maxTokens` is the budget, so the base is also
 * capped by it: the retry must fit the budget, not just shrink. Deterministic.
 */
export function overflowRetryWindow(
  profile: ContextProfile,
  overflow: ContextOverflowFacts,
  errorClass?: string,
): number {
  const projected = resolveEffectiveNumCtx(profile) ?? DEFAULT_PROJECTION_WINDOW;
  const stated = overflow.tokenCount > 0 ? Math.min(overflow.tokenCount, projected) : projected;
  const base =
    errorClass === TOKEN_RATE_EXCEEDED_CLASS && overflow.maxTokens > 0 ? Math.min(stated, overflow.maxTokens) : stated;
  return Math.max(1, Math.floor(base * OVERFLOW_RETRY_WINDOW_FRACTION));
}
