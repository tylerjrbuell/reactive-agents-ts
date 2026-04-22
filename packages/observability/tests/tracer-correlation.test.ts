import { describe, test, expect } from "bun:test";
import { Effect, Context, Layer } from "effect";
import { makeTracer, type Tracer as TracerType } from "../src/tracing/tracer.js";

const TracerContext = Context.GenericTag<TracerType>("TracerContext");
const TestLayer = Layer.effect(TracerContext, makeTracer);

const run = <A>(effect: Effect.Effect<A, any, TracerType>) =>
  Effect.runPromise(Effect.provide(effect, TestLayer));

// ─── Phase 0.4: Correlation IDs ───

describe("Tracer — Correlation IDs (Phase 0.4)", () => {
  test("nested spans share traceId (parent-child correlation)", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan(
          "parent",
          tracer.withSpan("child", Effect.succeed(42)),
        );
        return yield* tracer.getSpans();
      }),
    );
    expect(spans).toHaveLength(2);
    const parent = spans.find((s) => s.name === "parent")!;
    const child = spans.find((s) => s.name === "child")!;
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    // child should share parent's traceId
    expect(child.traceId).toBe(parent.traceId);
  });

  test("nested spans have parentSpanId set correctly", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan(
          "root",
          tracer.withSpan("leaf", Effect.succeed("done")),
        );
        return yield* tracer.getSpans();
      }),
    );
    const root = spans.find((s) => s.name === "root")!;
    const leaf = spans.find((s) => s.name === "leaf")!;
    // leaf's parentSpanId should be root's spanId
    expect(leaf.parentSpanId).toBe(root.spanId);
    // root has no parent
    expect(root.parentSpanId).toBeUndefined();
  });

  test("sibling spans have different traceIds (no active context)", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan("sibling-1", Effect.succeed(1));
        yield* tracer.withSpan("sibling-2", Effect.succeed(2));
        return yield* tracer.getSpans();
      }),
    );
    expect(spans).toHaveLength(2);
    // Siblings don't share traceId (they're separate traces)
    expect(spans[0].traceId).not.toBe(spans[1].traceId);
  });

  test("3-level nesting maintains traceId throughout", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan(
          "level-1",
          tracer.withSpan(
            "level-2",
            tracer.withSpan("level-3", Effect.succeed("deep")),
          ),
        );
        return yield* tracer.getSpans();
      }),
    );
    expect(spans).toHaveLength(3);
    const traceIds = new Set(spans.map((s) => s.traceId));
    // All 3 spans share the same traceId
    expect(traceIds.size).toBe(1);
  });

  test("parent context restored after nested span completes", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan(
          "outer",
          Effect.gen(function* () {
            yield* tracer.withSpan("inner", Effect.succeed(1));
            yield* tracer.withSpan("after-inner", Effect.succeed(2));
          }),
        );
        return yield* tracer.getSpans();
      }),
    );
    const outer = spans.find((s) => s.name === "outer")!;
    const inner = spans.find((s) => s.name === "inner")!;
    const afterInner = spans.find((s) => s.name === "after-inner")!;
    // Both inner and after-inner should have outer as parent
    expect(inner.parentSpanId).toBe(outer.spanId);
    expect(afterInner.parentSpanId).toBe(outer.spanId);
  });

  test("getTraceContext returns active span context inside withSpan", async () => {
    const ctx = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        return yield* tracer.withSpan(
          "active-span",
          tracer.getTraceContext(),
        );
      }),
    );
    // Should return the active span's context
    expect(ctx.traceId.length).toBeGreaterThan(0);
    expect(ctx.spanId.length).toBeGreaterThan(0);
  });

  test("getTraceContext outside span generates fresh one-shot context", async () => {
    const ctx = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        return yield* tracer.getTraceContext();
      }),
    );
    expect(ctx.traceId.length).toBe(32); // 16 bytes hex
    expect(ctx.spanId.length).toBe(16); // 8 bytes hex
    expect(ctx.parentSpanId).toBeUndefined();
  });
});
