import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import {
  TelemetryCollectorLive,
  TelemetryCollectorTag,
  preservePrivacy,
  TelemetryAggregatorLive,
  TelemetryAggregatorTag,
  type RawRunData,
  type TelemetryRecord,
} from "../src/telemetry/index.js";

const llmCompleted = (estimatedCost: number | undefined): AgentEvent => ({
  _tag: "LLMRequestCompleted",
  taskId: "t1",
  requestId: "r1",
  model: "m",
  provider: "p",
  tokensUsed: 10,
  durationMs: 5,
  ...(estimatedCost !== undefined ? { estimatedCost } : {}),
});

const agentCompleted: AgentEvent = {
  _tag: "AgentCompleted",
  taskId: "t1",
  agentId: "a1",
  success: true,
  totalIterations: 1,
  totalTokens: 20,
  durationMs: 100,
};

// Real EventBus: publish awaits every handler, so records exist on return.
const runCollector = (costs: readonly (number | undefined)[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      const collector = yield* TelemetryCollectorTag;
      for (const c of costs) yield* bus.publish(llmCompleted(c));
      yield* bus.publish(agentCompleted);
      return yield* collector.aggregator.getRecords();
    }).pipe(
      Effect.provide(TelemetryCollectorLive({ privacy: { epsilon: 1e9 } }).pipe(Layer.provideMerge(EventBusLive))),
    ),
  );

describe("TelemetryCollector — cost completeness", () => {
  it("marks a run with an unpriced call as a partial cost total", async () => {
    const [record] = await runCollector([0.01, undefined]);
    expect(record!.costComplete).toBe(false);
  });

  it("marks a fully priced run complete", async () => {
    const [record] = await runCollector([0.01, 0.02]);
    expect(record!.costComplete).toBe(true);
  });
});

describe("telemetry cost completeness — record and aggregate", () => {
  const raw: RawRunData = {
    strategy: "reactive",
    model: "m",
    tokensIn: 1,
    tokensOut: 1,
    latencyMs: 1,
    success: true,
    toolNames: [],
    iterationCount: 1,
    costUsd: 0.01,
    cacheHitRate: 0,
    timestamp: new Date("2026-03-06T14:32:17Z"),
  };

  it("preservePrivacy carries costComplete through and omits it when unknown", () => {
    expect(preservePrivacy({ ...raw, costComplete: false }).costComplete).toBe(false);
    expect("costComplete" in preservePrivacy(raw)).toBe(false);
  });

  it("the aggregate counts partial-cost runs", async () => {
    const rec = (costComplete: boolean | undefined): TelemetryRecord => ({
      ...preservePrivacy(raw),
      ...(costComplete !== undefined ? { costComplete } : {}),
    });
    const agg = await Effect.runPromise(
      Effect.gen(function* () {
        const a = yield* TelemetryAggregatorTag;
        yield* a.record(rec(false));
        yield* a.record(rec(true));
        yield* a.record(rec(undefined));
        return yield* a.getAggregate();
      }).pipe(Effect.provide(TelemetryAggregatorLive)),
    );
    expect(agg.partialCostRuns).toBe(1);
  });
});
