import { Effect, Ref, Context, Layer, Option } from "effect";
import type { Metric, ToolMetric, ToolMetricStatus } from "../types.js";
import { EventBus } from "@reactive-agents/core";

export interface ToolSummary {
  readonly callCount: number;
  readonly totalDuration: number;
  readonly avgDuration: number;
  readonly successCount: number;
  readonly errorCount: number;
}

export interface MetricsCollector {
  readonly incrementCounter: (name: string, value?: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  readonly recordHistogram: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  readonly setGauge: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  readonly getMetrics: (filter?: { name?: string; startTime?: Date; endTime?: Date }) => Effect.Effect<readonly Metric[], never>;
  readonly recordToolExecution: (toolName: string, duration: number, status: ToolMetricStatus) => Effect.Effect<void, never>;
  readonly getToolMetrics: () => Effect.Effect<readonly ToolMetric[], never>;
  readonly getToolSummary: () => Effect.Effect<Map<string, ToolSummary>, never>;
}

// ─── Context Tag and Layer ───

export class MetricsCollectorTag extends Context.Tag("MetricsCollector")<MetricsCollectorTag, MetricsCollector>() {}

export const makeMetricsCollector = Effect.gen(function* () {
  const metricsRef = yield* Ref.make<Metric[]>([]);
  const toolMetricsRef = yield* Ref.make<ToolMetric[]>([]);

  const incrementCounter = (
    name: string,
    value: number = 1,
    labels: Record<string, string> = {},
  ): Effect.Effect<void, never> =>
    Ref.update(metricsRef, (metrics) => [
      ...metrics,
      { name, type: "counter" as const, value, timestamp: new Date(), labels },
    ]);

  const recordHistogram = (
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): Effect.Effect<void, never> =>
    Ref.update(metricsRef, (metrics) => [
      ...metrics,
      { name, type: "histogram" as const, value, timestamp: new Date(), labels },
    ]);

  const setGauge = (
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): Effect.Effect<void, never> =>
    Ref.update(metricsRef, (metrics) => [
      ...metrics,
      { name, type: "gauge" as const, value, timestamp: new Date(), labels },
    ]);

  const getMetrics = (filter?: { name?: string; startTime?: Date; endTime?: Date }): Effect.Effect<readonly Metric[], never> =>
    Effect.gen(function* () {
      const metrics = yield* Ref.get(metricsRef);
      let filtered = metrics;
      if (filter?.name) filtered = filtered.filter((m) => m.name === filter.name || m.name.startsWith(filter.name!));
      if (filter?.startTime) filtered = filtered.filter((m) => m.timestamp >= filter.startTime!);
      if (filter?.endTime) filtered = filtered.filter((m) => m.timestamp <= filter.endTime!);
      return filtered;
    });

  const recordToolExecution = (
    toolName: string,
    duration: number,
    status: ToolMetricStatus,
  ): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      // Record in tool-specific tracker
      yield* Ref.update(toolMetricsRef, (metrics) => [
        ...metrics,
        { toolName, duration, status, callCount: 1, timestamp: new Date() },
      ]);

      // Also add to metrics array for dashboard export
      // Record as gauge metrics for tool call aggregation
      yield* Ref.update(metricsRef, (metrics) => [
        ...metrics,
        { name: "execution.tool.execution", type: "histogram" as const, value: duration, timestamp: new Date(), labels: { tool: toolName, status } },
      ]);
    });

  const getToolMetrics = (): Effect.Effect<readonly ToolMetric[], never> =>
    Ref.get(toolMetricsRef);

  const getToolSummary = (): Effect.Effect<Map<string, ToolSummary>, never> =>
    Effect.gen(function* () {
      const toolMetrics = yield* Ref.get(toolMetricsRef);
      const summary = new Map<string, ToolSummary>();

      for (const metric of toolMetrics) {
        const existing = summary.get(metric.toolName);
        if (existing) {
          summary.set(metric.toolName, {
            callCount: existing.callCount + 1,
            totalDuration: existing.totalDuration + metric.duration,
            avgDuration: (existing.totalDuration + metric.duration) / (existing.callCount + 1),
            successCount: metric.status === "success" ? existing.successCount + 1 : existing.successCount,
            errorCount: metric.status === "error" ? existing.errorCount + 1 : existing.errorCount,
          });
        } else {
          summary.set(metric.toolName, {
            callCount: 1,
            totalDuration: metric.duration,
            avgDuration: metric.duration,
            successCount: metric.status === "success" ? 1 : 0,
            errorCount: metric.status === "error" ? 1 : 0,
          });
        }
      }

      return summary;
    });

  return { incrementCounter, recordHistogram, setGauge, getMetrics, recordToolExecution, getToolMetrics, getToolSummary } satisfies MetricsCollector;
});

export const MetricsCollectorLive: Layer.Layer<MetricsCollectorTag, never> = Layer.effect(
  MetricsCollectorTag,
  Effect.gen(function* () {
    const collector = yield* makeMetricsCollector;

    // Subscribe to EventBus for automatic metrics collection
    const ebOpt = yield* Effect.serviceOption(EventBus);
    if (Option.isSome(ebOpt)) {
      const eb = ebOpt.value;

      // ── Tool execution tracking ──
      yield* eb.on("ToolCallCompleted", (event) =>
        collector
          .recordToolExecution(
            event.toolName,
            event.durationMs,
            event.success ? "success" : "error",
          )
          .pipe(Effect.catchAll(() => Effect.void)),
      );

      // ── LLM call tracking: latency, tokens, cost ──
      yield* eb.on("LLMRequestCompleted", (event) =>
        Effect.all([
          collector.recordHistogram("llm.latency_ms", event.durationMs, {
            model: event.model,
            provider: event.provider,
          }),
          collector.setGauge("llm.tokens_used", event.tokensUsed, {
            model: event.model,
            provider: event.provider,
            taskId: event.taskId,
          }),
          collector.incrementCounter("llm.cost_usd", event.estimatedCost, {
            model: event.model,
            provider: event.provider,
          }),
          collector.incrementCounter("llm.requests", 1, {
            model: event.model,
            provider: event.provider,
          }),
        ], { concurrency: "unbounded" }).pipe(Effect.asVoid, Effect.catchAll(() => Effect.void)),
      );

      // ── Execution phase durations ──
      yield* eb.on("ExecutionPhaseCompleted", (event) =>
        collector
          .recordHistogram("execution.phase_duration_ms", event.durationMs, {
            phase: event.phase,
          })
          .pipe(Effect.catchAll(() => Effect.void)),
      );

      // ── Agent completion: success/fail rate ──
      yield* eb.on("AgentCompleted", (event) =>
        Effect.all([
          collector.incrementCounter("agent.completions", 1, {
            success: String(event.success),
            agentId: event.agentId,
          }),
          collector.recordHistogram("agent.duration_ms", event.durationMs, {
            agentId: event.agentId,
          }),
          collector.setGauge("agent.total_tokens", event.totalTokens, {
            agentId: event.agentId,
            taskId: event.taskId,
          }),
          collector.setGauge("agent.iterations", event.totalIterations, {
            agentId: event.agentId,
            taskId: event.taskId,
          }),
        ], { concurrency: "unbounded" }).pipe(Effect.asVoid, Effect.catchAll(() => Effect.void)),
      );

      // ── Guardrail violations ──
      yield* eb.on("GuardrailViolationDetected", (event) =>
        Effect.all([
          collector.incrementCounter("guardrail.violations", 1, {
            blocked: String(event.blocked),
          }),
          ...event.violations.map((v) =>
            collector.incrementCounter("guardrail.violation_type", 1, { type: v }),
          ),
        ], { concurrency: "unbounded" }).pipe(Effect.asVoid, Effect.catchAll(() => Effect.void)),
      );

      // ── Reasoning step tracking ──
      yield* eb.on("ReasoningStepCompleted", (event) =>
        collector
          .incrementCounter("reasoning.steps", 1, {
            strategy: event.strategy,
            ...(event.kernelPass ? { kernelPass: event.kernelPass } : {}),
          })
          .pipe(Effect.catchAll(() => Effect.void)),
      );

      // ── Final answer produced ──
      yield* eb.on("FinalAnswerProduced", (event) =>
        Effect.all([
          collector.incrementCounter("reasoning.final_answers", 1, {
            strategy: event.strategy,
          }),
          collector.setGauge("reasoning.answer_iteration", event.iteration, {
            strategy: event.strategy,
            taskId: event.taskId,
          }),
        ], { concurrency: "unbounded" }).pipe(Effect.asVoid, Effect.catchAll(() => Effect.void)),
      );

      // ── Streaming metrics: TTFT proxy ──
      yield* eb.on("AgentStreamStarted", (event) =>
        collector
          .incrementCounter("stream.started", 1, { agentId: event.agentId })
          .pipe(Effect.catchAll(() => Effect.void)),
      );

      yield* eb.on("AgentStreamCompleted", (event) =>
        Effect.all([
          collector.incrementCounter("stream.completed", 1, {
            success: String(event.success),
            agentId: event.agentId,
          }),
          collector.recordHistogram("stream.duration_ms", event.durationMs, {
            agentId: event.agentId,
          }),
        ], { concurrency: "unbounded" }).pipe(Effect.asVoid, Effect.catchAll(() => Effect.void)),
      );

      // ── Gateway events ──
      yield* eb.on("ProactiveActionCompleted", (event) =>
        Effect.all([
          collector.incrementCounter("gateway.actions", 1, {
            source: event.source,
            success: String(event.success),
          }),
          collector.recordHistogram("gateway.action_duration_ms", event.durationMs, {
            source: event.source,
          }),
          collector.setGauge("gateway.action_tokens", event.tokensUsed, {
            source: event.source,
          }),
        ], { concurrency: "unbounded" }).pipe(Effect.asVoid, Effect.catchAll(() => Effect.void)),
      );

      yield* eb.on("ProactiveActionSuppressed", (event) =>
        collector
          .incrementCounter("gateway.suppressions", 1, {
            policy: event.policy,
            source: event.source,
          })
          .pipe(Effect.catchAll(() => Effect.void)),
      );

      yield* eb.on("BudgetExhausted", (event) =>
        collector
          .incrementCounter("budget.exhausted", 1, {
            budgetType: event.budgetType,
          })
          .pipe(Effect.catchAll(() => Effect.void)),
      );
    }

    return collector;
  }),
);
