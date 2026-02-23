import { Effect, Ref } from "effect";
import type { Span, SpanStatus } from "../types.js";

export interface Tracer {
  readonly withSpan: <A, E>(name: string, effect: Effect.Effect<A, E>, attributes?: Record<string, unknown>) => Effect.Effect<A, E>;
  readonly getTraceContext: () => Effect.Effect<{ traceId: string; spanId: string; parentSpanId?: string }, never>;
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

// ─── Current Trace Context ───
// Shared Ref for the active span context so nested withSpan() calls
// can inherit the parent's traceId and set parentSpanId correctly.

type TraceContext = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
} | null;

export const makeTracer = Effect.gen(function* () {
  const spansRef = yield* Ref.make<Span[]>([]);
  // Tracks the currently active span context for correlation
  const activeContextRef = yield* Ref.make<TraceContext>(null);

  const withSpan = <A, E>(
    name: string,
    effect: Effect.Effect<A, E>,
    attributes?: Record<string, unknown>,
  ): Effect.Effect<A, E> =>
    Effect.gen(function* () {
      const parentContext = yield* Ref.get(activeContextRef);

      // Inherit traceId from parent span, or start a new trace
      const traceId = parentContext?.traceId ?? generateId();
      const spanId = generateSpanId();
      const parentSpanId = parentContext?.spanId;
      const startTime = performance.now();

      const baseSpan: Span = {
        traceId,
        spanId,
        parentSpanId,
        name,
        startTime: new Date(),
        status: "unset",
        attributes: { ...attributes, "service.name": "reactive-agents" },
        events: [],
      };

      // Push this span as the active context before running the effect
      yield* Ref.set(activeContextRef, { traceId, spanId, parentSpanId });

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
        // Always restore parent context when this span completes
        Effect.ensuring(Ref.set(activeContextRef, parentContext)),
      );

      return result;
    });

  const getTraceContext = (): Effect.Effect<{ traceId: string; spanId: string; parentSpanId?: string }, never> =>
    Effect.gen(function* () {
      const ctx = yield* Ref.get(activeContextRef);
      if (ctx) return ctx;
      // Outside of any span — generate a one-shot context
      return { traceId: generateId(), spanId: generateSpanId() };
    });

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
