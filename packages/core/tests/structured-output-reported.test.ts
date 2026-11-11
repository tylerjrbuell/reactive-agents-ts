import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import { EventBus, EventBusLive } from "../src/index.js";
import type {
  AgentEvent,
  AgentEventTag,
  StructuredOutputReport,
  StructuredOutputReportedEvent,
} from "../src/index.js";

const run = <A, E>(effect: Effect.Effect<A, E, EventBus>) =>
  Effect.runPromise(effect.pipe(Effect.provide(EventBusLive)));

const failureReport: StructuredOutputReport = {
  outcome: "failure",
  layer: null,
  native: "failed",
  attempts: 3,
  promptAttempts: 2,
  repairs: ["extract-json-block", "trailing-commas"],
  coerced: false,
  budgetEscalated: false,
  fieldErrors: [{ path: "/steps/0/title", message: "is missing" }],
  failure: { kind: "schema-mismatch", message: "steps[0].title is missing" },
};

describe("StructuredOutputReported event", () => {
  it("is an AgentEvent member (type level)", () => {
    const tag: AgentEventTag = "StructuredOutputReported";
    const event: AgentEvent = {
      _tag: "StructuredOutputReported",
      taskId: "t1",
      report: { ...failureReport, outcome: "success", layer: "native", native: "succeeded", fieldErrors: [], failure: undefined },
      timestamp: 1,
    };
    expect(event._tag).toBe(tag);
  });

  it("round-trips the report through EventBus.on with narrowing", async () => {
    const received = await run(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const seen = yield* Ref.make<StructuredOutputReportedEvent[]>([]);
        yield* bus.on("StructuredOutputReported", (e) => Ref.update(seen, (xs) => [...xs, e]));
        yield* bus.publish({ _tag: "TaskCreated", taskId: "t1" });
        yield* bus.publish({
          _tag: "StructuredOutputReported",
          taskId: "t1",
          strategy: "plan-execute",
          report: failureReport,
          timestamp: 42,
        });
        return yield* Ref.get(seen);
      }),
    );
    expect(received).toHaveLength(1);
    expect(received[0]!.strategy).toBe("plan-execute");
    expect(received[0]!.report).toEqual(failureReport);
    expect(received[0]!.report.failure?.kind).toBe("schema-mismatch");
  });
});

describe("ToolCallStarted.args", () => {
  it("carries the call arguments when the emitter has them, and stays optional", async () => {
    const received = await run(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const seen = yield* Ref.make<Extract<AgentEvent, { _tag: "ToolCallStarted" }>[]>([]);
        yield* bus.on("ToolCallStarted", (e) => Ref.update(seen, (xs) => [...xs, e]));
        yield* bus.publish({
          _tag: "ToolCallStarted",
          taskId: "t1",
          toolName: "web-search",
          callId: "c1",
          args: { query: "effect-ts" },
        });
        // Existing producers without args still compile and publish.
        yield* bus.publish({ _tag: "ToolCallStarted", taskId: "t1", toolName: "file-read", callId: "c2" });
        return yield* Ref.get(seen);
      }),
    );
    expect(received).toHaveLength(2);
    expect(received[0]!.args).toEqual({ query: "effect-ts" });
    expect(received[1]!.args).toBeUndefined();
  });
});
