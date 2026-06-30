import { Effect, Schedule, Duration, Context } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";

/** Transient-failure retry policy for LLM calls. */
export interface LlmRetryPolicy {
  readonly maxRetries: number;
  readonly backoffMs: number;
}

/**
 * Wrap every LLM call site (`complete`, `stream`, `completeStructured`) with an
 * `Effect.retry` so transient provider failures (rate limits, network blips)
 * back off and retry.
 *
 * IMPORTANT — wrap ALL call sites, not just `complete()`. The reactive kernel
 * drives runs through `stream()` (see reasoning `.../reason/think.ts`), and
 * structured output goes through `completeStructured()`. Wrapping only
 * `complete()` left `withRetryPolicy` dead for the primary run path.
 *
 * For `stream()`, retry re-runs the Effect that ESTABLISHES the stream, so a
 * transient failure at connect-time is retried; an error surfaced mid-stream is
 * not replayed (you cannot safely re-consume a partially-read stream), which is
 * the correct, safe boundary for retry.
 */
export function applyRetryToLlmService(
  svc: Context.Tag.Service<LLMService>,
  policy: LlmRetryPolicy,
): Context.Tag.Service<LLMService> {
  const schedule = Schedule.recurs(policy.maxRetries).pipe(
    Schedule.intersect(Schedule.spaced(Duration.millis(policy.backoffMs))),
  );
  return {
    ...svc,
    complete: (req: Parameters<typeof svc.complete>[0]) =>
      svc.complete(req).pipe(Effect.retry(schedule)),
    stream: (req: Parameters<typeof svc.stream>[0]) =>
      svc.stream(req).pipe(Effect.retry(schedule)),
    completeStructured: (<A>(req: Parameters<typeof svc.completeStructured<A>>[0]) =>
      svc.completeStructured(req).pipe(Effect.retry(schedule))) as typeof svc.completeStructured,
  } as Context.Tag.Service<LLMService>;
}
