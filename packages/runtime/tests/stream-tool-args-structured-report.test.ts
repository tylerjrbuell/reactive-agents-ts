/**
 * Stream projections for two core events added 2026-11-11 (core 3c76d020d):
 *  - `ToolCallStarted.args`: a UI can show a long-running call's arguments
 *    before it completes (execute-stream used to drop them).
 *  - `StructuredOutputReported`: how each structured-output extraction got its
 *    value, projected at density "full" only.
 *
 * Direct-import pin on `makeExecuteStream` (engine/execute-stream.ts); the bus
 * events are published by the fake `execute`, as the kernel will publish them.
 *
 * Run: bun test packages/runtime/tests/stream-tool-args-structured-report.test.ts --timeout 20000
 */
import { describe, test, expect } from "bun:test";
import { Effect, Stream } from "effect";
import { EventBus, EventBusLive, type AgentEvent, type StructuredOutputReport, type Task, type TaskResult } from "@reactive-agents/core";
import { makeExecuteStream } from "../src/engine/execute-stream.js";
import type { AgentStreamEvent, StreamDensity } from "../src/stream-types.js";

const TASK_ID = "t-args-report";

const report: StructuredOutputReport = {
  outcome: "success",
  layer: "repaired",
  native: "failed",
  attempts: 2,
  promptAttempts: 1,
  repairs: ["extract-json-block", "trailing-commas"],
  coerced: false,
  budgetEscalated: false,
  fieldErrors: [],
};

const collect = (density: StreamDensity): Promise<AgentStreamEvent[]> => {
  const task = { id: TASK_ID, input: "x" } as never as Task;
  const execute = (_t: Task) =>
    Effect.gen(function* () {
      const eb = yield* EventBus;
      yield* eb.publish({
        _tag: "ToolCallStarted",
        taskId: TASK_ID,
        toolName: "web-search",
        callId: "c1",
        args: { query: "bun runtime", limit: 5 },
      } as AgentEvent);
      yield* eb.publish({ _tag: "ToolCallStarted", taskId: TASK_ID, toolName: "noop", callId: "c2" } as AgentEvent);
      yield* eb.publish({
        _tag: "StructuredOutputReported",
        taskId: TASK_ID,
        strategy: "plan-execute",
        report,
        timestamp: 1,
      } as AgentEvent);
      return { output: "ok", success: true, metadata: {}, taskId: TASK_ID } as never as TaskResult;
    });
  return Effect.runPromise(
    Effect.gen(function* () {
      const stream = yield* makeExecuteStream({ config: { agentId: "a" } as never, execute: execute as never })(task, { density });
      return Array.from(yield* Stream.runCollect(stream));
    }).pipe(Effect.provide(EventBusLive)),
  );
};

describe("execute-stream projections: ToolCallStarted args + StructuredOutputReported", () => {
  test("full density: ToolCallStarted carries the call's args; absent args stay absent", async () => {
    const events = await collect("full");
    const started = events.filter((e): e is Extract<AgentStreamEvent, { _tag: "ToolCallStarted" }> => e._tag === "ToolCallStarted");
    expect(started).toHaveLength(2);
    expect(started[0]!.args).toEqual({ query: "bun runtime", limit: 5 });
    expect("args" in started[1]!).toBe(false);
  });

  test("full density: StructuredOutputReported is projected with taskId, strategy and the full report", async () => {
    const events = await collect("full");
    const reported = events.filter((e) => e._tag === "StructuredOutputReported");
    expect(reported).toEqual([{ _tag: "StructuredOutputReported", taskId: TASK_ID, strategy: "plan-execute", report }]);
  });

  test("tokens density: neither event reaches the stream", async () => {
    const events = await collect("tokens");
    expect(events.some((e) => e._tag === "ToolCallStarted" || e._tag === "StructuredOutputReported")).toBe(false);
    expect(events.at(-1)?._tag).toBe("StreamCompleted");
  });
});
