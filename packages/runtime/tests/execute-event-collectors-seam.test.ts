// #281 — direct-import behavioral pins for engine/execute-event-collectors.ts
// (extracted verbatim from execution-engine.ts, #221). Drives a REAL EventBus
// and asserts what the debrief/telemetry accumulators receive.

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import type { Task } from "@reactive-agents/core";
import { registerExecutionEventCollectors } from "../src/engine/execute-event-collectors.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import { makeTask } from "../src/testing/index.js";

const task: Task = makeTask({ id: "t1", type: "research", agentId: "a1", input: { question: "q" } });
const config = defaultReactiveAgentsConfig("a1");

const withCollectors = <A>(
  body: (eb: EventBus["Type"], c: Effect.Effect.Success<ReturnType<typeof registerExecutionEventCollectors>>) => Effect.Effect<A>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const eb = yield* EventBus;
      const collectors = yield* registerExecutionEventCollectors({ eb, task, config });
      return yield* body(eb, collectors);
    }).pipe(Effect.provide(EventBusLive)),
  );

const sources = { token: null, structural: 0.1, semantic: null, behavioral: 0.2, contextPressure: 0.3 };

describe("registerExecutionEventCollectors", () => {
  it("tags a ToolCallCompleted with the latest ReasoningStepCompleted step and carries object args", async () => {
    const log = await withCollectors((eb, c) =>
      Effect.gen(function* () {
        yield* eb.publish({ _tag: "ReasoningStepCompleted", taskId: "t1", strategy: "reactive", step: 4, totalSteps: 9 });
        yield* eb.publish({
          _tag: "ToolCallCompleted", taskId: "t1", toolName: "web-search", callId: "c1",
          durationMs: 12, success: true, args: { q: "x" },
        });
        yield* eb.publish({
          _tag: "ToolCallCompleted", taskId: "t1", toolName: "calc", callId: "c2",
          durationMs: 3, success: false, args: ["not", "an", "object"],
        });
        return c.toolCallLog;
      }),
    );
    expect(log).toEqual([
      { toolName: "web-search", durationMs: 12, success: true, iteration: 4, arguments: { q: "x" } },
      { toolName: "calc", durationMs: 3, success: false, iteration: 4 },
    ]);
  });

  it("records a tool-selection rationale only when ToolCallStarted carries one", async () => {
    const log = await withCollectors((eb, c) =>
      Effect.gen(function* () {
        yield* eb.publish({ _tag: "ToolCallStarted", taskId: "t1", toolName: "a", callId: "1" });
        yield* eb.publish({
          _tag: "ToolCallStarted", taskId: "t1", toolName: "b", callId: "2",
          rationale: { why: "need data", refs: ["r1"], confidence: 0.8 },
        });
        return c.rationaleLog;
      }),
    );
    expect(log).toEqual([
      {
        iteration: 0,
        decision: "tool-selection",
        toolName: "b",
        rationale: { why: "need data", refs: ["r1"], confidence: 0.8 },
      },
    ]);
  });

  it("skips a StrategySwitched with a blank reason and truncates long ones to 280 chars", async () => {
    const log = await withCollectors((eb, c) =>
      Effect.gen(function* () {
        yield* eb.publish({ _tag: "StrategySwitched", taskId: "t1", from: "reactive", to: "reflexion", reason: "   ", timestamp: 1 });
        yield* eb.publish({ _tag: "StrategySwitched", taskId: "t1", from: "reactive", to: "reflexion", reason: "x".repeat(400), timestamp: 2 });
        return c.rationaleLog;
      }),
    );
    expect(log.length).toBe(1);
    expect(log[0]!.decision).toBe("strategy-switch:reactive→reflexion");
    expect(log[0]!.rationale.why.length).toBe(280);
  });

  it("dedups EntropyScored by (taskId, iteration)", async () => {
    const log = await withCollectors((eb, c) =>
      Effect.gen(function* () {
        const base = {
          _tag: "EntropyScored" as const, taskId: "t1", composite: 0.4, sources,
          trajectory: { derivative: -0.1, shape: "converging" as const, momentum: 0 },
          confidence: "high" as const, modelTier: "local" as const, iterationWeight: 1,
        };
        yield* eb.publish({ ...base, iteration: 1 });
        yield* eb.publish({ ...base, iteration: 1, composite: 0.9 });
        yield* eb.publish({ ...base, iteration: 2 });
        return c.entropyLog;
      }),
    );
    expect(log.map((e) => [e.iteration, e.composite])).toEqual([[1, 0.4], [2, 0.4]]);
  });

  it("returns empty accumulators (and registers nothing) when there is no event bus", async () => {
    const c = await Effect.runPromise(registerExecutionEventCollectors({ eb: null, task, config }));
    expect(c).toEqual({ toolCallLog: [], rationaleLog: [], entropyLog: [] });
  });
});
