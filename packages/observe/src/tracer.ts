import { Effect, Layer } from "effect";
import * as otelApi from "@opentelemetry/api";
import { EventBus } from "@reactive-agents/core";

// ─── OpenInference semantic attribute keys ───

const OI = {
  SPAN_KIND: "openinference.span.kind",
  INPUT_VALUE: "input.value",
  OUTPUT_VALUE: "output.value",
  LLM_MODEL_NAME: "llm.model_name",
  LLM_PROVIDER: "llm.provider",
  LLM_TOKEN_COUNT_PROMPT: "llm.token_count.prompt",
  LLM_TOKEN_COUNT_COMPLETION: "llm.token_count.completion",
  LLM_TOKEN_COUNT_TOTAL: "llm.token_count.total",
  TOOL_NAME: "tool.name",
  TOOL_PARAMETERS: "tool.parameters",
  TOOL_OUTPUT: "tool.output",
} as const;

// ─── Span kinds ───

const SpanKind = {
  AGENT: "AGENT",
  LLM: "LLM",
  TOOL: "TOOL",
} as const;

// ─── State ───

interface SpanMap {
  /** taskId → root workflow span */
  workflows: Map<string, otelApi.Span>;
  /** requestId → LLM child span */
  llmCalls: Map<string, otelApi.Span>;
  /** callId → tool child span */
  toolCalls: Map<string, otelApi.Span>;
}

function createSpanMap(): SpanMap {
  return {
    workflows: new Map(),
    llmCalls: new Map(),
    toolCalls: new Map(),
  };
}

// ─── Layer ───

export const OpenInferenceTracerLayer = Layer.scopedDiscard(
  Effect.gen(function* () {
    const bus = yield* EventBus;
    const tracer = otelApi.trace.getTracer("reactive-agents", "0.11.0");
    const spans = createSpanMap();

    const unsub = yield* bus.subscribe((event) =>
      Effect.sync(() => {
        switch (event._tag) {
          case "AgentStarted": {
            const span = tracer.startSpan(`agent:${event.agentId}`, {
              kind: otelApi.SpanKind.INTERNAL,
              attributes: {
                [OI.SPAN_KIND]: SpanKind.AGENT,
                [OI.LLM_MODEL_NAME]: event.model,
                [OI.LLM_PROVIDER]: event.provider,
                "agent.id": event.agentId,
                "task.id": event.taskId,
              },
              startTime: event.timestamp,
            });
            spans.workflows.set(event.taskId, span);
            break;
          }

          case "AgentCompleted": {
            const span = spans.workflows.get(event.taskId);
            if (!span) break;
            span.setAttributes({
              "agent.iterations": event.totalIterations,
              [OI.LLM_TOKEN_COUNT_TOTAL]: event.totalTokens,
              "agent.success": event.success,
            });
            if (event.error) {
              span.setStatus({
                code: otelApi.SpanStatusCode.ERROR,
                message: event.error,
              });
              span.recordException(new Error(event.error));
            } else {
              span.setStatus({ code: otelApi.SpanStatusCode.OK });
            }
            span.end();
            spans.workflows.delete(event.taskId);
            break;
          }

          case "LLMRequestStarted": {
            const parentSpan = spans.workflows.get(event.taskId);
            const ctx = parentSpan
              ? otelApi.trace.setSpan(otelApi.ROOT_CONTEXT, parentSpan)
              : otelApi.ROOT_CONTEXT;
            const span = tracer.startSpan(
              `llm:${event.provider}/${event.model}`,
              {
                kind: otelApi.SpanKind.CLIENT,
                attributes: {
                  [OI.SPAN_KIND]: SpanKind.LLM,
                  [OI.LLM_MODEL_NAME]: event.model,
                  [OI.LLM_PROVIDER]: event.provider,
                  [OI.LLM_TOKEN_COUNT_PROMPT]: event.contextSize,
                  "task.id": event.taskId,
                  "request.id": event.requestId,
                },
              },
              ctx,
            );
            spans.llmCalls.set(event.requestId, span);
            break;
          }

          case "LLMRequestCompleted": {
            const span = spans.llmCalls.get(event.requestId);
            if (!span) break;
            const tokensIn =
              event.tokensIn ?? Math.round(event.tokensUsed * 0.7);
            const tokensOut =
              event.tokensOut ?? Math.round(event.tokensUsed * 0.3);
            span.setAttributes({
              [OI.LLM_TOKEN_COUNT_PROMPT]: tokensIn,
              [OI.LLM_TOKEN_COUNT_COMPLETION]: tokensOut,
              [OI.LLM_TOKEN_COUNT_TOTAL]: event.tokensUsed,
              "llm.duration_ms": event.durationMs,
              "llm.estimated_cost_usd": event.estimatedCost,
            });
            if (event.cached) {
              span.setAttribute("llm.cached", true);
            }
            span.setStatus({ code: otelApi.SpanStatusCode.OK });
            span.end();
            spans.llmCalls.delete(event.requestId);
            break;
          }

          case "ToolCallStarted": {
            const parentSpan = spans.workflows.get(event.taskId);
            const ctx = parentSpan
              ? otelApi.trace.setSpan(otelApi.ROOT_CONTEXT, parentSpan)
              : otelApi.ROOT_CONTEXT;
            const span = tracer.startSpan(
              `tool:${event.toolName}`,
              {
                kind: otelApi.SpanKind.INTERNAL,
                attributes: {
                  [OI.SPAN_KIND]: SpanKind.TOOL,
                  [OI.TOOL_NAME]: event.toolName,
                  "task.id": event.taskId,
                  "tool.call_id": event.callId,
                },
                startTime: event.timestamp ?? Date.now(),
              },
              ctx,
            );
            if (event.iteration !== undefined) {
              span.setAttribute("agent.iteration", event.iteration);
            }
            spans.toolCalls.set(event.callId, span);
            break;
          }

          case "ToolCallCompleted": {
            const span = spans.toolCalls.get(event.callId);
            if (!span) break;
            span.setAttributes({
              "tool.duration_ms": event.durationMs,
              "tool.success": event.success,
            });
            if (event.args !== undefined) {
              span.setAttribute(
                OI.TOOL_PARAMETERS,
                JSON.stringify(event.args),
              );
            }
            if (event.result !== undefined) {
              span.setAttribute(OI.TOOL_OUTPUT, JSON.stringify(event.result));
            }
            if (!event.success && event.error) {
              span.setStatus({
                code: otelApi.SpanStatusCode.ERROR,
                message: event.error,
              });
              span.recordException(new Error(event.error));
            } else {
              span.setStatus({ code: otelApi.SpanStatusCode.OK });
            }
            span.end();
            spans.toolCalls.delete(event.callId);
            break;
          }

          default:
            break;
        }
      }),
    );

    // Clean up subscription when layer is released
    return yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsub();
        // End any leaked spans
        for (const span of spans.workflows.values()) span.end();
        for (const span of spans.llmCalls.values()) span.end();
        for (const span of spans.toolCalls.values()) span.end();
        spans.workflows.clear();
        spans.llmCalls.clear();
        spans.toolCalls.clear();
      }),
    );
  }),
);
