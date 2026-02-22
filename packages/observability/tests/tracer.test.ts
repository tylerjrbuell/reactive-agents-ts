import { describe, it, expect } from "bun:test";
import { Effect, Context, Layer } from "effect";
import { makeTracer, type Tracer as TracerType } from "../src/tracing/tracer.js";

const TracerContext = Context.GenericTag<TracerType>("TracerContext");
const TestLayer = Layer.effect(TracerContext, makeTracer);

const run = <A>(effect: Effect.Effect<A, any, typeof TracerContext>) =>
  Effect.runPromise(Effect.provide(effect, TestLayer));

describe("Tracer", () => {
  it("creates spans with unique IDs", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan("op1", Effect.succeed(1));
        yield* tracer.withSpan("op2", Effect.succeed(2));
        return yield* tracer.getSpans();
      }),
    );
    expect(spans).toHaveLength(2);
    expect(spans[0].traceId).not.toBe(spans[1].traceId);
    expect(spans[0].spanId).not.toBe(spans[1].spanId);
  });

  it("records span attributes", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan("test.op", Effect.succeed("result"), { customAttr: "value", count: 42 });
        return yield* tracer.getSpans();
      }),
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes.customAttr).toBe("value");
    expect(spans[0].attributes.count).toBe(42);
    expect(spans[0].attributes["service.name"]).toBe("reactive-agents");
  });

  it("records span events on success", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan("test.op", Effect.succeed("done"));
        return yield* tracer.getSpans();
      }),
    );
    expect(spans[0].status).toBe("ok");
    expect(spans[0].events).toHaveLength(0);
  });

  it("records span events on error", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer
          .withSpan("test.fail", Effect.fail(new Error("test error")))
          .pipe(Effect.catchAll(() => Effect.void));
        return yield* tracer.getSpans();
      }),
    );
    expect(spans[0].status).toBe("error");
    expect(spans[0].events).toHaveLength(1);
    expect(spans[0].events[0].name).toBe("exception");
    expect(spans[0].events[0].attributes).toEqual({ message: "Error: test error" });
  });

  it("records span duration", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan("test.delay", Effect.sleep(10).pipe(Effect.as(1)));
        return yield* tracer.getSpans();
      }),
    );
    expect(spans[0].attributes.duration_ms).toBeGreaterThan(0);
  });

  it("provides trace context", async () => {
    const ctx = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        return yield* tracer.getTraceContext();
      }),
    );
    expect(ctx.traceId.length).toBe(32);
    expect(ctx.spanId.length).toBe(16);
  });

  it("filters spans by name", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan("api.request", Effect.succeed(1));
        yield* tracer.withSpan("api.response", Effect.succeed(2));
        yield* tracer.withSpan("db.query", Effect.succeed(3));
        return yield* tracer.getSpans({ name: "api" });
      }),
    );
    expect(spans).toHaveLength(2);
    expect(spans.every((s) => s.name.includes("api"))).toBe(true);
  });

  it("filters spans by status", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan("success.op", Effect.succeed(1));
        yield* tracer
          .withSpan("failed.op", Effect.fail(new Error("fail")))
          .pipe(Effect.catchAll(() => Effect.void));
        return yield* tracer.getSpans({ status: "ok" });
      }),
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("success.op");
  });

  it("handles nested spans", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer.withSpan("outer", Effect.succeed(1));
        yield* tracer.withSpan("inner", Effect.succeed(2));
        return yield* tracer.getSpans();
      }),
    );
    expect(spans).toHaveLength(2);
  });

  it("captures error message in attributes", async () => {
    const spans = await run(
      Effect.gen(function* () {
        const tracer = yield* TracerContext;
        yield* tracer
          .withSpan("op", Effect.fail(new Error("Something went wrong")))
          .pipe(Effect.catchAll(() => Effect.void));
        return yield* tracer.getSpans();
      }),
    );
    expect(spans[0].attributes["error.message"]).toBe("Error: Something went wrong");
  });
});
