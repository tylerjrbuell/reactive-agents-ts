type TaggedError = { readonly _tag: string };

/**
 * Tags that map to the Transient and Capacity kinds. Retry rules may
 * still short-circuit these (e.g. non-idempotent tool + LLMTimeout), but
 * the baseline classification is "retryable".
 */
const RETRYABLE_TAGS: ReadonlySet<string> = new Set([
  "TransientError",
  "CapacityError",
  "LLMTimeoutError",
  "LLMRateLimitError",
]);

/**
 * Classify a framework error for retry eligibility.
 *
 * Transient + Capacity kinds (and their subtypes) return `true`.
 * Capability, Contract, Task, and Security kinds return `false`.
 * Non-FrameworkError inputs return `false`.
 *
 * @example
 * ```ts
 * if (isRetryable(err)) {
 *   // apply retry rule pipeline
 * }
 * ```
 */
export function isRetryable(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("_tag" in err)) {
    return false;
  }
  return RETRYABLE_TAGS.has((err as TaggedError)._tag);
}
