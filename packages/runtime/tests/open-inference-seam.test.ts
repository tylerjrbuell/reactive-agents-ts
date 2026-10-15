// Run: bun test packages/runtime/tests/open-inference-seam.test.ts --timeout 30000
//
// Wave 6.7 — `.withOpenInference()` composes the existing
// OpenInferenceTracerLayer into the agent runtime: a run's EventBus events
// become OpenInference-attributed spans on the global tracer. Destination
// stays process-global (setupOpenInferenceExporter / OTEL env); the wither
// only provides the layer (no per-agent exporter fork — see wither JSDoc).
//
// RED-ON-CUT: drop the layer provision from withOpenInference and no spans
// are exported (the collector stays empty).
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import * as otelApi from "@opentelemetry/api";
import { ReactiveAgents } from "../src/index.js";

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
  otelApi.trace.setGlobalTracerProvider(provider);
});

afterEach(async () => {
  await provider.shutdown();
  otelApi.trace.disable();
});

describe("6.7 withOpenInference seam", () => {
  it("a run exports an OpenInference agent span", async () => {
    const agent = await ReactiveAgents.create()
      .withName("oi-seam")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withOpenInference()
      .build();
    try {
      const r = await agent.run("simple task");
      expect(r.success).toBe(true);
    } finally {
      await agent.dispose();
    }
    const spans = exporter.getFinishedSpans();
    const agentSpans = spans.filter((s) => String(s.name).startsWith("agent:"));
    expect(agentSpans.length).toBeGreaterThan(0);
    const attrs = agentSpans[0].attributes as Record<string, unknown>;
    expect(attrs["openinference.span.kind"]).toBe("AGENT");
  });

  it("without the wither, no agent spans are exported", async () => {
    const agent = await ReactiveAgents.create()
      .withName("oi-absent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();
    try {
      await agent.run("simple task");
    } finally {
      await agent.dispose();
    }
    const spans = exporter.getFinishedSpans();
    expect(spans.filter((s) => String(s.name).startsWith("agent:"))).toEqual([]);
  });
});
