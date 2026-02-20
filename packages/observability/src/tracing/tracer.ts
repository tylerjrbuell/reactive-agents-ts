import { Effect, Ref } from "effect";
import type { Span, SpanStatus } from "../types.js";

export interface Tracer {
  readonly withSpan: <A, E>(name: string, effect: Effect.Effect<A, E>, attributes?: Record<string, unknown>) => Effect.Effect<A, E>;
  readonly getTraceContext: () => Effect.Effect<{ traceId: string; spanId: string }, never>;
  readonly getSpans: (filter?: { name?: string; status?: SpanStatus }) => Effect.Effect<readonly Span[], never>;
}

const generateId = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const generateSpanId = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export const makeTracer = Effect.gen(function* () {
  const spansRef = yield* Ref.make<Span[]>([]);

  const withSpan = <A, E>(
    name: string,
    effect: Effect.Effect<A, E>,
    attributes?: Record<string, unknown>,
  ): Effect.Effect<A, E> =>
    Effect.gen(function* () {
      const traceId = generateId();
      const spanId = generateSpanId();
      const startTime = performance.now();

      const baseSpan: Span = {
        traceId,
        spanId,
        name,
        startTime: new Date(),
        status: "unset",
        attributes: { ...attributes, "service.name": "reactive-agents" },
        events: [],
      };

      const result = yield* effect.pipe(
        Effect.tap(() =>
          Ref.update(spansRef, (spans) => [
            ...spans,
            {
              ...baseSpan,
              endTime: new Date(),
              status: "ok" as const,
              attributes: { ...baseSpan.attributes, duration_ms: performance.now() - startTime },
            },
          ]),
        ),
        Effect.tapError((error) =>
          Ref.update(spansRef, (spans) => [
            ...spans,
            {
              ...baseSpan,
              endTime: new Date(),
              status: "error" as const,
              attributes: { ...baseSpan.attributes, duration_ms: performance.now() - startTime, "error.message": String(error) },
              events: [{ name: "exception", timestamp: new Date(), attributes: { message: String(error) } }],
            },
          ]),
        ),
      );

      return result;
    });

  const getTraceContext = (): Effect.Effect<{ traceId: string; spanId: string }, never> =>
    Effect.succeed({ traceId: generateId(), spanId: generateSpanId() });

  const getSpans = (filter?: { name?: string; status?: SpanStatus }): Effect.Effect<readonly Span[], never> =>
    Effect.gen(function* () {
      const spans = yield* Ref.get(spansRef);
      let filtered = spans;
      if (filter?.name) filtered = filtered.filter((s) => s.name.includes(filter.name!));
      if (filter?.status) filtered = filtered.filter((s) => s.status === filter.status);
      return filtered;
    });

  return { withSpan, getTraceContext, getSpans } satisfies Tracer;
});
