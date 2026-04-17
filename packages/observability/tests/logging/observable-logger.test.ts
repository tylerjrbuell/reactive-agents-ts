import { describe, it, expect } from "vitest";
import { Effect, Stream as EStream } from "effect";
import type { LogEvent } from "../../src/types.js";
import { makeObservableLogger } from "../../src/logging/observable-logger.js";

describe("ObservableLogger", () => {
  it("buffers emitted events", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const event: LogEvent = {
      _tag: "phase_started",
      phase: "think",
      timestamp: new Date(),
    };

    await Effect.runPromise(logger.emit(event));
    const buffer = await Effect.runPromise(logger.getBuffer());

    expect(buffer).toHaveLength(1);
    expect(buffer[0]).toEqual(event);
  });

  it("allows subscribing to events", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const received: Array<{ event: LogEvent; formatted: string }> = [];

    const unsubscribe = await Effect.runPromise(
      logger.subscribe((event, formatted) =>
        Effect.sync(() => {
          received.push({ event, formatted });
        }),
      ),
    );

    const event: LogEvent = {
      _tag: "phase_started",
      phase: "think",
      timestamp: new Date(),
    };

    await Effect.runPromise(logger.emit(event));

    expect(received).toHaveLength(1);
    expect(received[0]?.formatted).toContain("[phase:think]");

    await Effect.runPromise(Effect.sync(() => unsubscribe()));
  });

  it("formats events correctly", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));

    const event: LogEvent = {
      _tag: "phase_complete",
      phase: "think",
      duration: 32500,
      status: "success",
    };

    const formatted = logger.format(event);
    expect(formatted).toContain("✓");
    expect(formatted).toContain("[phase:think]");
    expect(formatted).toContain("32.5s");
  });

  it("flushes to RunSummary", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));

    const events: LogEvent[] = [
      {
        _tag: "phase_started",
        phase: "think",
        timestamp: new Date(),
      },
      {
        _tag: "phase_complete",
        phase: "think",
        duration: 5000,
        status: "success",
      },
      {
        _tag: "metric",
        name: "tokens_used",
        value: 12500,
        unit: "tokens",
        timestamp: new Date(),
      },
      {
        _tag: "completion",
        success: true,
        summary: "Task completed successfully",
        timestamp: new Date(),
      },
    ];

    for (const event of events) {
      await Effect.runPromise(logger.emit(event));
    }

    const summary = await Effect.runPromise(logger.flush());

    expect(summary.status).toBe("success");
    expect(summary.totalTokens).toBe(12500);
    expect(summary.phaseMetrics["think"]).toBeDefined();
    expect(summary.phaseMetrics["think"].duration).toBe(5000);
  });

  it("supports toStream for piping", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));

    const event: LogEvent = {
      _tag: "tool_call",
      tool: "web-search",
      iteration: 1,
      timestamp: new Date(),
    };

    await Effect.runPromise(logger.emit(event));

    const chunk = await Effect.runPromise(
      logger.toStream().pipe(EStream.runCollect),
    );

    // runCollect returns a Chunk
    const items = Array.from(chunk);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toBeDefined();
    expect(items[0]?.formatted).toContain("web-search");
  });

  it("can reset buffer and subscribers", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));

    const event1: LogEvent = {
      _tag: "phase_started",
      phase: "think",
      timestamp: new Date(),
    };

    await Effect.runPromise(logger.emit(event1));
    await Effect.runPromise(logger.reset());

    const buffer = await Effect.runPromise(logger.getBuffer());
    expect(buffer).toHaveLength(0);
  });
});
