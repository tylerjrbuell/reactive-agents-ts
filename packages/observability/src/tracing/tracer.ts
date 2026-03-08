import { Effect, Ref } from "effect";
import type { Span, SpanStatus } from "../types.js";
import * as otelApi from "@opentelemetry/api";

export interface Tracer {
  readonly withSpan: <A, E>(name: string, effect: Effect.Effect<A, E>, attributes?: Record<string, unknown>) => Effect.Effect<A, E>;
  readonly getTraceContext: () => Effect.Effect<{ traceId: string; spanId: string; parentSpanId?: string }, never>;
  readonly getSpans: (filter?: { name?: string; status?: SpanStatus }) => Effect.Effect<readonly Span[], never>;
}

/**
 * Generates a W3C-compliant 32-hex-char trace ID.
 * Used as fallback when no OTel context is active.
 */
const generateTraceId = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * Generates a W3C-compliant 16-hex-char span ID.
 * Used as fallback when no OTel context is active.
 */
const generateSpanId = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

// ─── OTel Span Context Helpers ───

/** Extract hex trace ID from OTel span context, null if invalid/noop. */
function otelTraceId(span: otelApi.Span): string | null {
  const id = span.spanContext().traceId;
  // NoopSpan returns all-zero IDs — treat as invalid
  return id && !/^0+$/.test(id) ? id : null;
}

/** Extract hex span ID from OTel span context, null if invalid/noop. */
function otelSpanId(span: otelApi.Span): string | null {
  const id = span.spanContext().spanId;
  return id && !/^0+$/.test(id) ? id : null;
}

// ─── Current Trace Context ───
// Shared Ref for the active span context so nested withSpan() calls
// can inherit the parent's traceId and set parentSpanId correctly.

type TraceContext = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
} | null;

/**
 * Creates a tracer that delegates to the global OpenTelemetry TracerProvider.
 * Spans are created via `@opentelemetry/api` and also mirrored into a local
 * `Ref<Span[]>` for backward-compatible dashboard/exporter consumption.
 *
 * When no TracerProvider is configured (default NoopTracerProvider), the
 * local Ref still captures spans — so existing tests and the console
 * exporter continue to work unchanged.
 */
export const makeTracer = Effect.gen(function* () {
  const spansRef = yield* Ref.make<Span[]>([]);
  const activeContextRef = yield* Ref.make<TraceContext>(null);

  // Obtain the OTel tracer from the global provider
  const otelTracer = otelApi.trace.getTracer("reactive-agents", "0.6.3");

  const withSpan = <A, E>(
    name: string,
    effect: Effect.Effect<A, E>,
    attributes?: Record<string, unknown>,
  ): Effect.Effect<A, E> =>
    Effect.gen(function* () {
      const parentContext = yield* Ref.get(activeContextRef);

      // Start an OTel span — inherits from active OTel context automatically
      const otelSpan = otelTracer.startSpan(name, {
        attributes: {
          "service.name": "reactive-agents",
          ...(attributes
            ? Object.fromEntries(
                Object.entries(attributes).filter(
                  ([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
                ),
              )
            : {}),
        },
      });

      const traceId = otelTraceId(otelSpan) ?? parentContext?.traceId ?? generateTraceId();
      const spanId = otelSpanId(otelSpan) ?? generateSpanId();
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
        Effect.tap(() => {
          otelSpan.setStatus({ code: otelApi.SpanStatusCode.OK });
          otelSpan.end();
          return Ref.update(spansRef, (spans) => [
            ...spans,
            {
              ...baseSpan,
              endTime: new Date(),
              status: "ok" as const,
              attributes: { ...baseSpan.attributes, duration_ms: performance.now() - startTime },
            },
          ]);
        }),
        Effect.tapError((error) => {
          otelSpan.setStatus({ code: otelApi.SpanStatusCode.ERROR, message: String(error) });
          otelSpan.recordException(typeof error === "object" && error !== null ? error as unknown as Error : new Error(String(error)));
          otelSpan.end();
          return Ref.update(spansRef, (spans) => [
            ...spans,
            {
              ...baseSpan,
              endTime: new Date(),
              status: "error" as const,
              attributes: { ...baseSpan.attributes, duration_ms: performance.now() - startTime, "error.message": String(error) },
              events: [{ name: "exception", timestamp: new Date(), attributes: { message: String(error) } }],
            },
          ]);
        }),
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
      return { traceId: generateTraceId(), spanId: generateSpanId() };
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
