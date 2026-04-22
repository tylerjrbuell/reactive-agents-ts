import { describe, it, expect } from "bun:test";
import { Effect, Context, Layer } from "effect";
import { makeMetricsCollector, type MetricsCollector, MetricsCollectorLive, MetricsCollectorTag } from "../src/metrics/metrics-collector.js";
import { EventBus, EventBusLive } from "@reactive-agents/core";

// ─── EventBus-wired tests helper ──────────────────────────────────────────────
// Uses a synchronous mock EventBus so handlers fire inline during publish,
// avoiding any scheduling/timing issues with Effect fibers.

type AnyEvent = { _tag: string; [k: string]: unknown };
type HandlerFn = (event: AnyEvent) => Effect.Effect<void, never>;

function makeSyncMockBusLayer(): {
  layer: Layer.Layer<EventBus>;
  publish: (event: AnyEvent) => Effect.Effect<void, never>;
} {
  const handlers = new Map<string, HandlerFn[]>();

  const busImpl = {
    publish: (event: AnyEvent) => {
      const tag = event._tag;
      const fns = handlers.get(tag) ?? [];
      return Effect.all(fns.map((h) => h(event))).pipe(Effect.asVoid);
    },
    subscribe: () => Effect.succeed(() => {}),
    on: (_tag: string, handler: HandlerFn) => {
      const existing = handlers.get(_tag) ?? [];
      handlers.set(_tag, [...existing, handler]);
      return Effect.succeed(() => {});
    },
  } as unknown as EventBus["Type"];

  return {
    layer: Layer.succeed(EventBus, busImpl),
    publish: (event) => busImpl.publish(event as unknown as Parameters<typeof busImpl.publish>[0]),
  };
}

const MetricsContext = Context.GenericTag<MetricsCollector>("MetricsContext");
const TestLayer = Layer.effect(MetricsContext, makeMetricsCollector);

const run = <A>(effect: Effect.Effect<A, any, MetricsCollector>) =>
  Effect.runPromise(Effect.provide(effect, TestLayer));

describe("MetricsCollector - Tool Tracking", () => {
  it("recordToolExecution() records tool metrics", async () => {
    const metrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.recordToolExecution("web-search", 150, "success");
        yield* mc.recordToolExecution("web-search", 200, "success");
        yield* mc.recordToolExecution("code-execute", 500, "error");
        return yield* mc.getToolMetrics();
      }),
    );

    expect(metrics).toHaveLength(3);
    expect(metrics[0].toolName).toBe("web-search");
    expect(metrics[0].duration).toBe(150);
    expect(metrics[0].status).toBe("success");
    expect(metrics[1].toolName).toBe("web-search");
    expect(metrics[1].duration).toBe(200);
    expect(metrics[2].toolName).toBe("code-execute");
    expect(metrics[2].status).toBe("error");
  });

  it("getToolSummary() groups by tool name and computes totals/averages", async () => {
    const summary = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.recordToolExecution("web-search", 100, "success");
        yield* mc.recordToolExecution("web-search", 200, "success");
        yield* mc.recordToolExecution("web-search", 300, "error");
        yield* mc.recordToolExecution("code-execute", 500, "success");
        yield* mc.recordToolExecution("code-execute", 1000, "partial");
        return yield* mc.getToolSummary();
      }),
    );

    expect(summary.size).toBe(2);

    const webSearchSummary = summary.get("web-search");
    expect(webSearchSummary).toBeDefined();
    expect(webSearchSummary!.callCount).toBe(3);
    expect(webSearchSummary!.totalDuration).toBe(600);
    expect(webSearchSummary!.avgDuration).toBe(200);
    expect(webSearchSummary!.successCount).toBe(2);
    expect(webSearchSummary!.errorCount).toBe(1);

    const codeExecuteSummary = summary.get("code-execute");
    expect(codeExecuteSummary).toBeDefined();
    expect(codeExecuteSummary!.callCount).toBe(2);
    expect(codeExecuteSummary!.totalDuration).toBe(1500);
    expect(codeExecuteSummary!.avgDuration).toBe(750);
    expect(codeExecuteSummary!.successCount).toBe(1);
    expect(codeExecuteSummary!.errorCount).toBe(0);
  });
});

describe("MetricsCollector - EventBus Integration", () => {
  it("verifies MetricsCollectorLive subscribes to EventBus on initialization", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const collector = yield* MetricsCollectorTag;

        // Publish ToolCallCompleted events
        // The subscription should already be wired in MetricsCollectorLive
        yield* bus.publish({
          _tag: "ToolCallCompleted",
          taskId: "task-1",
          toolName: "web-search",
          callId: "call-1",
          durationMs: 150,
          success: true,
        });

        yield* bus.publish({
          _tag: "ToolCallCompleted",
          taskId: "task-1",
          toolName: "web-search",
          callId: "call-2",
          durationMs: 200,
          success: true,
        });

        yield* bus.publish({
          _tag: "ToolCallCompleted",
          taskId: "task-2",
          toolName: "code-execute",
          callId: "call-3",
          durationMs: 500,
          success: false,
        });

        // Metrics should be auto-recorded via EventBus subscription in MetricsCollectorLive
        return yield* collector.getToolMetrics();
      }).pipe(
        Effect.provide(MetricsCollectorLive),
        Effect.provide(EventBusLive),
      ),
    );

    expect(result).toHaveLength(3);
    expect(result[0].toolName).toBe("web-search");
    expect(result[0].duration).toBe(150);
    expect(result[0].status).toBe("success");
    expect(result[1].toolName).toBe("web-search");
    expect(result[1].duration).toBe(200);
    expect(result[1].status).toBe("success");
    expect(result[2].toolName).toBe("code-execute");
    expect(result[2].duration).toBe(500);
    expect(result[2].status).toBe("error");
  });

  it("recordToolExecution() adds metrics to metrics array for dashboard export", async () => {
    const allMetrics = await run(
      Effect.gen(function* () {
        const mc = yield* MetricsContext;
        yield* mc.recordToolExecution("web-search", 150, "success");
        yield* mc.recordToolExecution("code-execute", 500, "error");
        return yield* mc.getMetrics();
      }),
    );

    // Should have tool execution metrics in the metrics array
    const toolMetrics = allMetrics.filter(
      (m) => m.name === "execution.tool.execution" && m.type === "histogram",
    );
    expect(toolMetrics).toHaveLength(2);
    expect(toolMetrics[0].labels?.tool).toBe("web-search");
    expect(toolMetrics[0].labels?.status).toBe("success");
    expect(toolMetrics[0].value).toBe(150);
    expect(toolMetrics[1].labels?.tool).toBe("code-execute");
    expect(toolMetrics[1].labels?.status).toBe("error");
    expect(toolMetrics[1].value).toBe(500);
  });
});

// ─── ToolCallCompleted EventBus filtering ─────────────────────────────────────

describe("MetricsCollector — unknown tool name filtering via EventBus", () => {
  function makeTestLayer() {
    const { layer: busLayer, publish } = makeSyncMockBusLayer();
    const metricsLayer = MetricsCollectorLive.pipe(Layer.provide(busLayer));
    return { metricsLayer, publish };
  }

  it("does not record a ToolCallCompleted event with toolName 'unknown'", async () => {
    const { metricsLayer, publish } = makeTestLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        const mc = yield* MetricsCollectorTag;

        yield* publish({
          _tag: "ToolCallCompleted",
          taskId: "test-task",
          toolName: "unknown",
          callId: "call-1",
          durationMs: 0,
          success: true,
          kernelPass: "reactive:main",
        });

        const toolMetrics = yield* mc.getToolMetrics();
        expect(toolMetrics.filter((m) => m.toolName === "unknown")).toHaveLength(0);
      }).pipe(Effect.provide(metricsLayer)),
    );
  });

  it("does not record a ToolCallCompleted event with empty toolName", async () => {
    const { metricsLayer, publish } = makeTestLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        const mc = yield* MetricsCollectorTag;

        yield* publish({
          _tag: "ToolCallCompleted",
          taskId: "test-task",
          toolName: "",
          callId: "call-2",
          durationMs: 0,
          success: true,
          kernelPass: "reactive:main",
        });

        const toolMetrics = yield* mc.getToolMetrics();
        expect(toolMetrics.filter((m) => m.toolName === "")).toHaveLength(0);
      }).pipe(Effect.provide(metricsLayer)),
    );
  });

  it("records a ToolCallCompleted event with a valid tool name", async () => {
    const { metricsLayer, publish } = makeTestLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        const mc = yield* MetricsCollectorTag;

        yield* publish({
          _tag: "ToolCallCompleted",
          taskId: "test-task",
          toolName: "web-search",
          callId: "call-3",
          durationMs: 250,
          success: true,
          kernelPass: "reactive:main",
        });

        const toolMetrics = yield* mc.getToolMetrics();
        const webSearchEntries = toolMetrics.filter((m) => m.toolName === "web-search");
        expect(webSearchEntries).toHaveLength(1);
        expect(webSearchEntries[0].duration).toBe(250);
        expect(webSearchEntries[0].status).toBe("success");
      }).pipe(Effect.provide(metricsLayer)),
    );
  });
});
