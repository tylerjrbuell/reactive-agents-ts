import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { AgentEvent } from "@reactive-agents/core";
import { createSpanMap, handleTracerEvent } from "./tracer.js";

// ─── Test OTel setup ───
//
// `handleTracerEvent` is the tracer's pure event dispatch (exported from
// tracer.ts for exactly this purpose — driving it directly, without an
// EventBus/Effect runtime, keeps this test a synchronous unit test of the
// bookend behaviour rather than an integration test of the whole publish
// pipeline).

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
});

afterEach(async () => {
  await provider.shutdown();
});

async function makeTestTracer() {
  const tracer = provider.getTracer("llm-span-test");
  const spanMap = createSpanMap();

  const handle = (event: AgentEvent) =>
    handleTracerEvent(tracer, spanMap, event);

  const spans = {
    /** Spans opened (started) but not yet ended — read from the live map. */
    open: () => spanMap.llmCalls.size,
    /** Spans that finished and were exported by the SimpleSpanProcessor. */
    ended: () => exporter.getFinishedSpans().length,
  };

  return { spans, handle };
}

// Pins the invariant D-1 broke: a COMPLETED event with no preceding STARTED
// produces no span at all, because spans.llmCalls is only ever populated by
// the started arm. If someone deletes the LLMRequestStarted producer again,
// this test goes red instead of the span tree going quietly empty.
describe("observe tracer — LLM span bookends", () => {
  it("opens a span on LLMRequestStarted and ends it on LLMRequestCompleted", async () => {
    const { spans, handle } = await makeTestTracer();
    handle({
      _tag: "LLMRequestStarted",
      taskId: "t1", requestId: "t1:0:complete",
      model: "m", provider: "p", contextSize: 100,
    });
    expect(spans.open()).toBe(1);
    handle({
      _tag: "LLMRequestCompleted",
      taskId: "t1", requestId: "t1:0:complete",
      model: "m", provider: "p",
      tokensUsed: 10, durationMs: 5, estimatedCost: 0.001,
    });
    expect(spans.open()).toBe(0);
    expect(spans.ended()).toBe(1);
  });

  it("records nothing when only the completed half arrives (the D-1 shape)", async () => {
    const { spans, handle } = await makeTestTracer();
    handle({
      _tag: "LLMRequestCompleted",
      taskId: "t1", requestId: "t1:0:complete",
      model: "m", provider: "p",
      tokensUsed: 10, durationMs: 5, estimatedCost: 0.001,
    });
    expect(spans.ended()).toBe(0);
  });
});
