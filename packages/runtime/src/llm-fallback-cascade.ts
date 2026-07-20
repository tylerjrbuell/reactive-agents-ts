import { Effect } from "effect";

/**
 * A single provider switch that occurred while cascading through the configured
 * fallback chain. Consumed downstream (inline-think.ts / verification-think-
 * retry.ts) to emit `ProviderFallbackActivated` events.
 */
export interface FallbackTransition {
  readonly fromProvider: string;
  readonly toProvider: string;
  readonly reason: string;
  readonly attemptNumber: number;
}

/**
 * Build an IMMEDIATE provider cascade for one LLM operation.
 *
 * Tries `primary`, and on ANY error falls through to each effect in `fallbacks`
 * in order until one succeeds or all are exhausted. Each real switch records a
 * transition; if any switch occurred, the transitions are attached to the
 * successful response as `fallbackTransitions`.
 *
 * There is no consecutive-error threshold and no per-model chain — the first
 * error on a provider moves to the next provider (P0-3: those knobs were removed
 * because they were never wired).
 *
 * `providerNames` is the ordered list `[primary, ...fallbacks]`; the transition
 * for `fallbacks[i]` is `providerNames[i] → providerNames[i + 1]`.
 *
 * @param providerNames - Ordered provider names, primary first.
 * @param primary - The primary provider's operation effect.
 * @param fallbacks - The fallback providers' operation effects, in order.
 * @returns An effect that yields the first successful response (with
 *   `fallbackTransitions` attached iff a switch happened), or fails if all fail.
 */
export function cascadeWithTransitions<A extends object, E, R>(
  providerNames: readonly string[],
  primary: Effect.Effect<A, E, R>,
  fallbacks: readonly Effect.Effect<A, E, R>[],
): Effect.Effect<A, E, R> {
  const transitions: FallbackTransition[] = [];
  let effect = primary;
  fallbacks.forEach((fb, i) => {
    const fromProvider = String(providerNames[i] ?? "unknown");
    const toProvider = String(providerNames[i + 1] ?? "unknown");
    const attemptNumber = i + 1;
    effect = effect.pipe(
      Effect.catchAllCause(() =>
        Effect.sync(() => {
          transitions.push({ fromProvider, toProvider, reason: "provider_error", attemptNumber });
        }).pipe(Effect.zipRight(fb)),
      ),
    );
  });
  return effect.pipe(
    Effect.map((response) =>
      transitions.length > 0
        ? ({ ...response, fallbackTransitions: [...transitions] } as A)
        : response,
    ),
  );
}
