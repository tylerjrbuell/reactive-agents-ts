import { describe, it, expect } from "bun:test";
import { Effect, Context, Layer } from "effect";
import { makeMetricsCollector, type MetricsCollector } from "../src/metrics/metrics-collector.js";

const MetricsContext = Context.GenericTag<MetricsCollector>("MetricsContext");
const TestLayer = Layer.effect(MetricsContext, makeMetricsCollector);

const run = <A>(effect: Effect.Effect<A, any, typeof MetricsContext>) =>
  Effect.runPromise(Effect.provide(effect, TestLayer));

describe("MetricsCollector", () => {
  it("increments counter", async () => {
    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.incrementCounter("requests", 1);
        yield* mc.incrementCounter("requests", 1);
        return yield* mc.getMetrics();
      }),
    );
    const counters = metrics.filter((m) => m.name === "requests");
    expect(counters).toHaveLength(2);
    expect(counters[0].type).toBe("counter");
    expect(counters[0].value).toBe(1);
  });

  it("increments counter with custom value", async () => {
    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.incrementCounter("items", 5);
        return yield* mc.getMetrics();
      }),
    );
    expect(metrics[0].value).toBe(5);
  });

  it("records histogram values", async () => {
    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.recordHistogram("latency_ms", 100);
        yield* mc.recordHistogram("latency_ms", 200);
        yield* mc.recordHistogram("latency_ms", 300);
        return yield* mc.getMetrics();
      }),
    );
    const histograms = metrics.filter((m) => m.name === "latency_ms");
    expect(histograms).toHaveLength(3);
    expect(histograms.every((m) => m.type === "histogram")).toBe(true);
  });

  it("sets gauge values", async () => {
    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.setGauge("connections", 10);
        yield* mc.setGauge("memory_mb", 256);
        return yield* mc.getMetrics();
      }),
    );
    const gauges = metrics.filter((m) => m.type === "gauge");
    expect(gauges).toHaveLength(2);
    expect(gauges[0].name).toBe("connections");
    expect(gauges[0].value).toBe(10);
    expect(gauges[1].name).toBe("memory_mb");
    expect(gauges[1].value).toBe(256);
  });

  it("applies labels to metrics", async () => {
    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.incrementCounter("api_calls", 1, { endpoint: "/users", method: "GET" });
        yield* mc.incrementCounter("api_calls", 1, { endpoint: "/users", method: "POST" });
        return yield* mc.getMetrics();
      }),
    );
    const apiCalls = metrics.filter((m) => m.name === "api_calls");
    expect(apiCalls[0].labels.endpoint).toBe("/users");
    expect(apiCalls[0].labels.method).toBe("GET");
    expect(apiCalls[1].labels.method).toBe("POST");
  });

  it("filters metrics by name", async () => {
    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.incrementCounter("http_requests", 1);
        yield* mc.setGauge("memory_usage", 50);
        yield* mc.recordHistogram("query_time", 100);
        return yield* mc.getMetrics({ name: "http" });
      }),
    );
    expect(metrics.length).toBe(1);
    expect(metrics[0].name).toBe("http_requests");
  });

  it("filters metrics by time range", async () => {
    const now = new Date();
    const recentTime = new Date(now.getTime() - 1000);

    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.incrementCounter("recent_metric", 1);
        return yield* mc.getMetrics({ startTime: recentTime });
      }),
    );
    expect(metrics.length).toBe(1);
    expect(metrics[0].name).toBe("recent_metric");
  });

  it("defaults counter value to 1", async () => {
    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.incrementCounter("hits");
        return yield* mc.getMetrics();
      }),
    );
    expect(metrics[0].value).toBe(1);
  });

  it("defaults labels to empty object", async () => {
    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.incrementCounter("test");
        return yield* mc.getMetrics();
      }),
    );
    expect(metrics[0].labels).toEqual({});
  });

  it("records metric timestamp", async () => {
    const before = new Date();
    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.setGauge("value", 42);
        return yield* mc.getMetrics();
      }),
    );
    const after = new Date();
    expect(metrics[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(metrics[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("supports multiple metric types together", async () => {
    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.incrementCounter("requests_total", 1);
        yield* mc.recordHistogram("request_duration", 150);
        yield* mc.setGauge("active_connections", 5);
        return yield* mc.getMetrics();
      }),
    );
    expect(metrics).toHaveLength(3);
    const types = new Set(metrics.map((m) => m.type));
    expect(types).toEqual(new Set(["counter", "histogram", "gauge"]));
  });
});
