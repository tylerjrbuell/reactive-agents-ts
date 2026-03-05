import { describe, it, expect } from "bun:test";
import { Effect, Stream } from "effect";
import { ExecutionEngine } from "../src/execution-engine.js";
import { createRuntime } from "../src/runtime.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

describe("ExecutionEngine.executeStream", () => {
  const runtime = createRuntime({
    agentId: "test-agent",
    provider: "test",
    testResponses: { "Hello": "FINAL ANSWER: Hi there" },
  });

  // Minimal task shape using casts (same pattern as execution-engine.test.ts)
  const makeTask = () => ({
    id: `task-${Date.now()}` as any,
    agentId: "test-agent" as any,
    type: "query" as const,
    input: { question: "Hello" },
    priority: "medium" as const,
    status: "pending" as const,
    metadata: { tags: [] },
    createdAt: new Date(),
  });

  it("returns a stream that emits StreamCompleted with the final output", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        const task = makeTask();
        const stream = yield* engine.executeStream(task);
        const all: AgentStreamEvent[] = [];
        yield* Stream.runForEach(stream, (e) =>
          Effect.sync(() => { all.push(e); }),
        );
        return all;
      }).pipe(Effect.provide(runtime)),
    );

    const tags = events.map((e) => e._tag);
    expect(tags).toContain("StreamCompleted");
    const completed = events.find((e) => e._tag === "StreamCompleted") as any;
    expect(completed.output).toContain("Hi there");
  });

  it("last event is always StreamCompleted or StreamError", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        const task = makeTask();
        const stream = yield* engine.executeStream(task);
        const all: AgentStreamEvent[] = [];
        yield* Stream.runForEach(stream, (e) =>
          Effect.sync(() => { all.push(e); }),
        );
        return all;
      }).pipe(Effect.provide(runtime)),
    );

    const last = events[events.length - 1];
    expect(["StreamCompleted", "StreamError"]).toContain(last?._tag);
  });
});
