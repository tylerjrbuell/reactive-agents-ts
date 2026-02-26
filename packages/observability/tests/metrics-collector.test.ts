import { describe, it, expect } from "bun:test";
import { Effect, Context, Layer } from "effect";
import { makeMetricsCollector, type MetricsCollector } from "../src/metrics/metrics-collector.js";

const MetricsContext = Context.GenericTag<MetricsCollector>("MetricsContext");
const TestLayer = Layer.effect(MetricsContext, makeMetricsCollector);

const run = <A>(effect: Effect.Effect<A, any, typeof MetricsContext>) =>
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
