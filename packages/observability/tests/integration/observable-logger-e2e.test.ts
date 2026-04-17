import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import type { LogEvent } from "../../src/types.js";
import { makeObservableLogger } from "../../src/logging/observable-logger.js";

describe("ObservableLogger E2E — full run lifecycle", () => {
  it("captures a complete run lifecycle across all event types", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));

    const events: LogEvent[] = [
      { _tag: "notice", level: "info", title: "Reactive Intelligence", message: "Telemetry enabled", dismissible: true, timestamp: new Date() },
      { _tag: "phase_started", phase: "execution", timestamp: new Date() },
      { _tag: "iteration", iteration: 1, phase: "thought", timestamp: new Date() },
      { _tag: "phase_started", phase: "think", timestamp: new Date() },
      { _tag: "phase_complete", phase: "think", duration: 1200, status: "success" },
      { _tag: "tool_call", tool: "web-search", iteration: 1, timestamp: new Date() },
      { _tag: "tool_result", tool: "web-search", duration: 800, status: "success" as const, timestamp: new Date() },
      { _tag: "metric", name: "entropy", value: 0.42, unit: "composite", timestamp: new Date() },
      { _tag: "iteration", iteration: 2, phase: "thought", timestamp: new Date() },
      { _tag: "metric", name: "tokens_used", value: 4200, unit: "tokens", timestamp: new Date() },
      { _tag: "warning", message: "High context pressure", context: "entropy=0.85", timestamp: new Date() },
      { _tag: "completion", success: true, summary: "Task completed", timestamp: new Date() },
    ];

    for (const event of events) {
      await Effect.runPromise(logger.emit(event));
    }

    const buffer = await Effect.runPromise(logger.getBuffer());
    expect(buffer).toHaveLength(events.length);

    const summary = await Effect.runPromise(logger.flush());
    expect(summary.status).toBe("success");
    expect(summary.totalTokens).toBe(4200);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toContain("High context pressure");
    expect(summary.phaseMetrics["think"]).toBeDefined();
    expect(summary.phaseMetrics["think"].duration).toBe(1200);
  });

  it("collects tool metrics across multiple tool calls", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));

    const toolEvents: LogEvent[] = [
      { _tag: "tool_call", tool: "web-search", iteration: 1, timestamp: new Date() },
      { _tag: "tool_result", tool: "web-search", duration: 500, status: "success" as const, timestamp: new Date() },
      { _tag: "tool_call", tool: "web-search", iteration: 2, timestamp: new Date() },
      { _tag: "tool_result", tool: "web-search", duration: 700, status: "success" as const, timestamp: new Date() },
      { _tag: "tool_call", tool: "calculator", iteration: 2, timestamp: new Date() },
      { _tag: "tool_result", tool: "calculator", duration: 50, status: "error" as const, timestamp: new Date() },
      { _tag: "completion", success: true, summary: "Done", timestamp: new Date() },
    ];

    for (const event of toolEvents) {
      await Effect.runPromise(logger.emit(event));
    }

    const summary = await Effect.runPromise(logger.flush());
    expect(summary.toolMetrics["web-search"]).toBeDefined();
    expect(summary.toolMetrics["web-search"].calls).toBe(2);
    expect(summary.toolMetrics["calculator"]).toBeDefined();
    expect(summary.toolMetrics["calculator"].calls).toBe(1);
  });

  it("records errors in summary", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));

    await Effect.runPromise(logger.emit({
      _tag: "error",
      message: "Max iterations exceeded",
      timestamp: new Date(),
    }));
    await Effect.runPromise(logger.emit({
      _tag: "completion",
      success: false,
      summary: "Task failed",
      timestamp: new Date(),
    }));

    const summary = await Effect.runPromise(logger.flush());
    expect(summary.status).toBe("error");
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain("Max iterations exceeded");
  });

  it("delivers events to subscribers in real-time", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const received: Array<{ event: LogEvent; formatted: string }> = [];

    const unsubscribe = await Effect.runPromise(
      logger.subscribe((event, formatted) =>
        Effect.sync(() => received.push({ event, formatted })),
      ),
    );

    const eventsToEmit: LogEvent[] = [
      { _tag: "phase_started", phase: "think", timestamp: new Date() },
      { _tag: "tool_call", tool: "calculator", iteration: 1, timestamp: new Date() },
      { _tag: "metric", name: "entropy", value: 0.3, unit: "composite", timestamp: new Date() },
    ];

    for (const event of eventsToEmit) {
      await Effect.runPromise(logger.emit(event));
    }

    expect(received).toHaveLength(3);
    expect(received[0]?.formatted).toContain("[phase:think]");
    expect(received[1]?.formatted).toContain("calculator");

    await Effect.runPromise(Effect.sync(() => unsubscribe()));
  });
});
