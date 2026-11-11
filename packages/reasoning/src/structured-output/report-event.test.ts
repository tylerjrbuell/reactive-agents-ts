// Run: bun test packages/reasoning/src/structured-output/report-event.test.ts
//
// Every extractStructuredOutput() call publishes exactly one
// StructuredOutputReported event carrying its provenance report, the task id
// from traceContext and the calling strategy — on success and on the tagged
// extraction failure.
import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, type AgentEvent } from "@reactive-agents/core";
import { extractStructuredOutput } from "./pipeline.js";

const Item = Schema.Struct({ name: Schema.String, count: Schema.Number });

type Reported = Extract<AgentEvent, { _tag: "StructuredOutputReported" }>;

const recordingBus = (sink: AgentEvent[]) =>
  ({ publish: (event: AgentEvent) => Effect.sync(() => { sink.push(event); }) }) as never;

const reportedOf = (sink: readonly AgentEvent[]): Reported[] =>
  sink.filter((e): e is Reported => e._tag === "StructuredOutputReported");

describe("StructuredOutputReported event", () => {
  it("success: one event with taskId, strategy and the result's report", async () => {
    const sink: AgentEvent[] = [];
    const out = await Effect.runPromise(
      extractStructuredOutput({
        schema: Item,
        prompt: "extract",
        traceContext: { taskId: "task-42" },
        strategy: "plan-execute",
      }).pipe(
        Effect.provideService(EventBus, recordingBus(sink)),
        Effect.provide(TestLLMServiceLayer([{ json: { name: "n", count: 1 } }])),
      ),
    );
    const reported = reportedOf(sink);
    expect(reported).toHaveLength(1);
    expect(reported[0]!.taskId).toBe("task-42");
    expect(reported[0]!.strategy).toBe("plan-execute");
    expect(reported[0]!.report).toEqual(out.report);
    expect(typeof reported[0]!.timestamp).toBe("number");
  });

  it("tagged failure: one event with taskId and the failure report", async () => {
    const sink: AgentEvent[] = [];
    const result = await Effect.runPromise(
      Effect.either(
        extractStructuredOutput({
          schema: Item,
          prompt: "extract",
          forcePromptMode: true,
          maxRetries: 0,
          traceContext: { taskId: "task-43" },
        }).pipe(
          Effect.provideService(EventBus, recordingBus(sink)),
          Effect.provide(TestLLMServiceLayer([{ text: "not json at all" }])),
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    const reported = reportedOf(sink);
    expect(reported).toHaveLength(1);
    expect(reported[0]!.taskId).toBe("task-43");
    expect(reported[0]!.strategy).toBeUndefined();
    expect(reported[0]!.report.outcome).toBe("failure");
    expect(reported[0]!.report.failure?.kind).toBeDefined();
  });
});
