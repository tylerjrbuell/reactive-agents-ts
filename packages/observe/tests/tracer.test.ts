import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import * as otelApi from "@opentelemetry/api";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { OpenInferenceTracerLayer } from "../src/tracer.js";

// ─── Test OTel setup ───

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

// ─── Helpers ───

const NOW = 1_000_000;

const runWithTracer = <A, E>(
  effect: Effect.Effect<A, E, EventBus>,
): Promise<A> => {
  const TestLayer = OpenInferenceTracerLayer.pipe(
    Layer.provide(EventBusLive),
  );
  return Effect.runPromise(
    effect.pipe(Effect.provide(Layer.merge(EventBusLive, TestLayer))),
  );
};

function getSpans() {
  return exporter.getFinishedSpans();
}

function spanByName(name: string) {
  return getSpans().find((s) => s.name === name);
}

// ─── Tests ───

describe("OpenInferenceTracerLayer", () => {
  describe("workflow spans (AgentStarted / AgentCompleted)", () => {
    it("creates and ends workflow span on agent lifecycle", async () => {
      await runWithTracer(
        Effect.gen(function* () {
          const bus = yield* EventBus;

          yield* bus.publish({
            _tag: "AgentStarted",
            taskId: "t1",
            agentId: "a1",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            timestamp: NOW,
          });

          yield* bus.publish({
            _tag: "AgentCompleted",
            taskId: "t1",
            agentId: "a1",
            success: true,
            totalIterations: 3,
            totalTokens: 500,
            durationMs: 1200,
          });
        }),
      );

      const span = spanByName("agent:a1");
      expect(span).toBeDefined();
      expect(span!.attributes["openinference.span.kind"]).toBe("AGENT");
      expect(span!.attributes["llm.model_name"]).toBe("claude-sonnet-4-6");
      expect(span!.attributes["llm.provider"]).toBe("anthropic");
      expect(span!.attributes["agent.iterations"]).toBe(3);
      expect(span!.attributes["llm.token_count.total"]).toBe(500);
      expect(span!.attributes["agent.success"]).toBe(true);
      expect(span!.status.code).toBe(otelApi.SpanStatusCode.OK);
    });

    it("marks span error when agent fails", async () => {
      await runWithTracer(
        Effect.gen(function* () {
          const bus = yield* EventBus;

          yield* bus.publish({
            _tag: "AgentStarted",
            taskId: "t2",
            agentId: "a2",
            provider: "openai",
            model: "gpt-4o-mini",
            timestamp: NOW,
          });

          yield* bus.publish({
            _tag: "AgentCompleted",
            taskId: "t2",
            agentId: "a2",
            success: false,
            totalIterations: 1,
            totalTokens: 100,
            durationMs: 200,
            error: "rate limit exceeded",
          });
        }),
      );

      const span = spanByName("agent:a2");
      expect(span).toBeDefined();
      expect(span!.status.code).toBe(otelApi.SpanStatusCode.ERROR);
      expect(span!.status.message).toBe("rate limit exceeded");
    });
  });

  describe("LLM spans (LLMRequestStarted / LLMRequestCompleted)", () => {
    it("creates LLM child span with token attributes", async () => {
      await runWithTracer(
        Effect.gen(function* () {
          const bus = yield* EventBus;

          yield* bus.publish({
            _tag: "AgentStarted",
            taskId: "t3",
            agentId: "a3",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            timestamp: NOW,
          });

          yield* bus.publish({
            _tag: "LLMRequestStarted",
            taskId: "t3",
            requestId: "req-1",
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            contextSize: 800,
          });

          yield* bus.publish({
            _tag: "LLMRequestCompleted",
            taskId: "t3",
            requestId: "req-1",
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            durationMs: 340,
            tokensUsed: 1000,
            tokensIn: 800,
            tokensOut: 200,
            estimatedCost: 0.0012,
          });

          yield* bus.publish({
            _tag: "AgentCompleted",
            taskId: "t3",
            agentId: "a3",
            success: true,
            totalIterations: 1,
            totalTokens: 1000,
            durationMs: 400,
          });
        }),
      );

      const llmSpan = spanByName("llm:anthropic/claude-sonnet-4-6");
      expect(llmSpan).toBeDefined();
      expect(llmSpan!.attributes["openinference.span.kind"]).toBe("LLM");
      expect(llmSpan!.attributes["llm.token_count.prompt"]).toBe(800);
      expect(llmSpan!.attributes["llm.token_count.completion"]).toBe(200);
      expect(llmSpan!.attributes["llm.token_count.total"]).toBe(1000);
      expect(llmSpan!.attributes["llm.estimated_cost_usd"]).toBe(0.0012);

      // LLM span should be child of workflow span
      const agentSpan = spanByName("agent:a3");
      expect(agentSpan).toBeDefined();
      expect(llmSpan!.parentSpanId).toBe(agentSpan!.spanContext().spanId);
    });

    it("estimates token split when tokensIn/tokensOut absent", async () => {
      await runWithTracer(
        Effect.gen(function* () {
          const bus = yield* EventBus;

          yield* bus.publish({
            _tag: "AgentStarted",
            taskId: "t4",
            agentId: "a4",
            provider: "ollama",
            model: "qwen3:14b",
            timestamp: NOW,
          });

          yield* bus.publish({
            _tag: "LLMRequestStarted",
            taskId: "t4",
            requestId: "req-2",
            model: "qwen3:14b",
            provider: "ollama",
            contextSize: 400,
          });

          yield* bus.publish({
            _tag: "LLMRequestCompleted",
            taskId: "t4",
            requestId: "req-2",
            model: "qwen3:14b",
            provider: "ollama",
            durationMs: 1200,
            tokensUsed: 1000,
            estimatedCost: 0,
          });

          yield* bus.publish({
            _tag: "AgentCompleted",
            taskId: "t4",
            agentId: "a4",
            success: true,
            totalIterations: 1,
            totalTokens: 1000,
            durationMs: 1300,
          });
        }),
      );

      const llmSpan = spanByName("llm:ollama/qwen3:14b");
      expect(llmSpan).toBeDefined();
      expect(llmSpan!.attributes["llm.token_count.prompt"]).toBe(700); // 70%
      expect(llmSpan!.attributes["llm.token_count.completion"]).toBe(300); // 30%
    });
  });

  describe("tool spans (ToolCallStarted / ToolCallCompleted)", () => {
    it("creates tool child span with parameters and output", async () => {
      await runWithTracer(
        Effect.gen(function* () {
          const bus = yield* EventBus;

          yield* bus.publish({
            _tag: "AgentStarted",
            taskId: "t5",
            agentId: "a5",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            timestamp: NOW,
          });

          yield* bus.publish({
            _tag: "ToolCallStarted",
            taskId: "t5",
            toolName: "file-read",
            callId: "call-1",
            iteration: 0,
            timestamp: NOW + 100,
          });

          yield* bus.publish({
            _tag: "ToolCallCompleted",
            taskId: "t5",
            toolName: "file-read",
            callId: "call-1",
            durationMs: 12,
            success: true,
            args: { path: "/tmp/foo.txt" },
            result: "file contents",
          });

          yield* bus.publish({
            _tag: "AgentCompleted",
            taskId: "t5",
            agentId: "a5",
            success: true,
            totalIterations: 1,
            totalTokens: 200,
            durationMs: 300,
          });
        }),
      );

      const toolSpan = spanByName("tool:file-read");
      expect(toolSpan).toBeDefined();
      expect(toolSpan!.attributes["openinference.span.kind"]).toBe("TOOL");
      expect(toolSpan!.attributes["tool.name"]).toBe("file-read");
      expect(toolSpan!.attributes["tool.parameters"]).toBe(
        JSON.stringify({ path: "/tmp/foo.txt" }),
      );
      expect(toolSpan!.attributes["tool.output"]).toBe(
        JSON.stringify("file contents"),
      );
      expect(toolSpan!.attributes["agent.iteration"]).toBe(0);
      expect(toolSpan!.status.code).toBe(otelApi.SpanStatusCode.OK);

      // Tool span should be child of workflow span
      const agentSpan = spanByName("agent:a5");
      expect(toolSpan!.parentSpanId).toBe(agentSpan!.spanContext().spanId);
    });

    it("marks tool span error on failure", async () => {
      await runWithTracer(
        Effect.gen(function* () {
          const bus = yield* EventBus;

          yield* bus.publish({
            _tag: "AgentStarted",
            taskId: "t6",
            agentId: "a6",
            provider: "openai",
            model: "gpt-4o-mini",
            timestamp: NOW,
          });

          yield* bus.publish({
            _tag: "ToolCallStarted",
            taskId: "t6",
            toolName: "web-search",
            callId: "call-2",
          });

          yield* bus.publish({
            _tag: "ToolCallCompleted",
            taskId: "t6",
            toolName: "web-search",
            callId: "call-2",
            durationMs: 50,
            success: false,
            error: "network timeout",
          });

          yield* bus.publish({
            _tag: "AgentCompleted",
            taskId: "t6",
            agentId: "a6",
            success: false,
            totalIterations: 1,
            totalTokens: 50,
            durationMs: 100,
          });
        }),
      );

      const toolSpan = spanByName("tool:web-search");
      expect(toolSpan).toBeDefined();
      expect(toolSpan!.status.code).toBe(otelApi.SpanStatusCode.ERROR);
      expect(toolSpan!.status.message).toBe("network timeout");
    });
  });

  describe("span hierarchy", () => {
    it("all child spans share workflow span trace ID", async () => {
      await runWithTracer(
        Effect.gen(function* () {
          const bus = yield* EventBus;

          yield* bus.publish({
            _tag: "AgentStarted",
            taskId: "t7",
            agentId: "a7",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            timestamp: NOW,
          });

          yield* bus.publish({
            _tag: "LLMRequestStarted",
            taskId: "t7",
            requestId: "req-3",
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            contextSize: 300,
          });

          yield* bus.publish({
            _tag: "LLMRequestCompleted",
            taskId: "t7",
            requestId: "req-3",
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            durationMs: 200,
            tokensUsed: 400,
            estimatedCost: 0.0005,
          });

          yield* bus.publish({
            _tag: "ToolCallStarted",
            taskId: "t7",
            toolName: "math",
            callId: "call-3",
          });

          yield* bus.publish({
            _tag: "ToolCallCompleted",
            taskId: "t7",
            toolName: "math",
            callId: "call-3",
            durationMs: 1,
            success: true,
          });

          yield* bus.publish({
            _tag: "AgentCompleted",
            taskId: "t7",
            agentId: "a7",
            success: true,
            totalIterations: 1,
            totalTokens: 400,
            durationMs: 250,
          });
        }),
      );

      const spans = getSpans().filter((s) =>
        ["agent:a7", "llm:anthropic/claude-sonnet-4-6", "tool:math"].includes(
          s.name,
        ),
      );
      expect(spans).toHaveLength(3);

      const traceIds = new Set(spans.map((s) => s.spanContext().traceId));
      expect(traceIds.size).toBe(1); // all same trace
    });

    it("ignores unknown event tags without throwing", async () => {
      await runWithTracer(
        Effect.gen(function* () {
          const bus = yield* EventBus;
          // Publish an event type the tracer doesn't handle
          yield* bus.publish({ _tag: "TaskCreated", taskId: "t8" });
        }),
      );

      expect(getSpans()).toHaveLength(0);
    });
  });
});
