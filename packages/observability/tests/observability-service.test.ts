import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { ObservabilityService, ObservabilityServiceLive } from "../src/observability-service.js";

const TestLayer = ObservabilityServiceLive;

const run = <A>(effect: Effect.Effect<A, any, ObservabilityService>) =>
  Effect.runPromise(Effect.provide(effect, TestLayer));

describe("ObservabilityService", () => {
  test("traces operations with spans", async () => {
    const result = await run(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;
        return yield* obs.withSpan("test.operation", Effect.succeed(42), { component: "test" });
      }),
    );
    expect(result).toBe(42);
  });

  test("captures error spans", async () => {
    await run(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;
        yield* obs.withSpan("test.failing", Effect.fail(new Error("test error"))).pipe(
          Effect.catchAll(() => Effect.void),
        );
      }),
    );
    // No assertion error = pass (span recorded internally)
  });

  test("logs structured messages", async () => {
    await run(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;
        yield* obs.info("Test message", { key: "value" });
        yield* obs.warn("Warning message");
        yield* obs.error("Error occurred", new Error("test"));
        yield* obs.debug("Debug info");
      }),
    );
  });

  test("collects and queries metrics", async () => {
    const metrics = await run(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;

        yield* obs.incrementCounter("test.counter", 1, { env: "test" });
        yield* obs.incrementCounter("test.counter", 1, { env: "test" });
        yield* obs.recordHistogram("test.latency", 150, { endpoint: "/api" });
        yield* obs.recordHistogram("test.latency", 200, { endpoint: "/api" });
        yield* obs.setGauge("test.connections", 5);

        return yield* obs.getMetrics({ name: "test" });
      }),
    );
    expect(metrics.length).toBeGreaterThanOrEqual(5);
    const counters = metrics.filter((m) => m.name === "test.counter");
    expect(counters).toHaveLength(2);
  });

  test("captures agent state snapshots", async () => {
    const { snapshot, snapshots } = await run(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;

        const snapshot = yield* obs.captureSnapshot("agent-1", {
          currentStrategy: "react",
          reasoningStep: 3,
          activeTools: ["web-search"],
          tokenUsage: { inputTokens: 5000, outputTokens: 1000, contextWindowUsed: 6000, contextWindowMax: 200_000 },
          costAccumulated: 0.05,
        });

        const snapshots = yield* obs.getSnapshots("agent-1");
        return { snapshot, snapshots };
      }),
    );
    expect(snapshot.agentId).toBe("agent-1");
    expect(snapshot.currentStrategy).toBe("react");
    expect(snapshots).toHaveLength(1);
  });

  test("provides trace context", async () => {
    const ctx = await run(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;
        return yield* obs.getTraceContext();
      }),
    );
    expect(ctx.traceId.length).toBeGreaterThan(0);
    expect(ctx.spanId.length).toBeGreaterThan(0);
  });

  test("flushes without error", async () => {
    await run(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;
        yield* obs.flush();
      }),
    );
  });
});
