import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import type { LogEvent } from "../../src/types.js";
import { makeObservableLogger } from "../../src/logging/observable-logger.js";

describe("ObservableLogger — live vs buffered modes", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  const phaseEvent: LogEvent = {
    _tag: "phase_started",
    phase: "think",
    timestamp: new Date(),
  };

  it("live mode: prints to console immediately on emit", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: true }));
    await Effect.runPromise(logger.emit(phaseEvent));
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0]?.[0]).toContain("[phase:think]");
  });

  it("buffered mode: does not print to console on emit", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    await Effect.runPromise(logger.emit(phaseEvent));
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("buffered mode: buffer accumulates all events silently", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));

    const events: LogEvent[] = [
      { _tag: "phase_started", phase: "think", timestamp: new Date() },
      { _tag: "tool_call", tool: "web-search", iteration: 1, timestamp: new Date() },
      { _tag: "metric", name: "tokens_used", value: 500, unit: "tokens", timestamp: new Date() },
    ];

    for (const event of events) {
      await Effect.runPromise(logger.emit(event));
    }

    expect(consoleSpy).not.toHaveBeenCalled();
    const buffer = await Effect.runPromise(logger.getBuffer());
    expect(buffer).toHaveLength(3);
  });

  it("buffered mode: flush returns summary and clears buffer", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));

    await Effect.runPromise(logger.emit({
      _tag: "metric",
      name: "tokens_used",
      value: 1000,
      unit: "tokens",
      timestamp: new Date(),
    }));
    await Effect.runPromise(logger.emit({
      _tag: "completion",
      success: true,
      summary: "Done",
      timestamp: new Date(),
    }));

    const summary = await Effect.runPromise(logger.flush());
    expect(summary.totalTokens).toBe(1000);
    expect(summary.status).toBe("success");

    // flush() reads without clearing; use reset() to clear the buffer
    const bufferAfterFlush = await Effect.runPromise(logger.getBuffer());
    expect(bufferAfterFlush).toHaveLength(2);
  });

  it("both modes: subscribers receive events regardless of live setting", async () => {
    for (const live of [true, false]) {
      consoleSpy.mockClear();
      const logger = await Effect.runPromise(makeObservableLogger({ live }));
      const received: LogEvent[] = [];

      const unsubscribe = await Effect.runPromise(
        logger.subscribe((event) => Effect.sync(() => received.push(event))),
      );

      await Effect.runPromise(logger.emit(phaseEvent));
      expect(received).toHaveLength(1);

      await Effect.runPromise(Effect.sync(() => unsubscribe()));
    }
  });

  it("live mode: multiple events each trigger a console.log", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: true }));

    await Effect.runPromise(logger.emit({ _tag: "phase_started", phase: "think", timestamp: new Date() }));
    await Effect.runPromise(logger.emit({ _tag: "phase_complete", phase: "think", duration: 500, status: "success" }));
    await Effect.runPromise(logger.emit({ _tag: "tool_call", tool: "calc", iteration: 1, timestamp: new Date() }));

    expect(consoleSpy).toHaveBeenCalledTimes(3);
  });

  it("minLevel:warn suppresses debug and info events", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false, minLevel: "warn" }));

    await Effect.runPromise(logger.emit({ _tag: "metric", name: "entropy", value: 0.5, unit: "composite", timestamp: new Date() }));     // debug — suppressed
    await Effect.runPromise(logger.emit({ _tag: "iteration", iteration: 1, phase: "thought", timestamp: new Date() }));                  // debug — suppressed
    await Effect.runPromise(logger.emit({ _tag: "phase_started", phase: "think", timestamp: new Date() }));                             // info — suppressed
    await Effect.runPromise(logger.emit({ _tag: "warning", message: "High entropy", timestamp: new Date() }));                          // warn — passes
    await Effect.runPromise(logger.emit({ _tag: "error", message: "Failure", timestamp: new Date() }));                                 // error — passes

    const buffer = await Effect.runPromise(logger.getBuffer());
    expect(buffer).toHaveLength(2);
    expect(buffer[0]?._tag).toBe("warning");
    expect(buffer[1]?._tag).toBe("error");
  });

  it("minLevel:info passes info,warn,error but suppresses debug", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false, minLevel: "info" }));

    await Effect.runPromise(logger.emit({ _tag: "metric", name: "tokens", value: 100, unit: "tokens", timestamp: new Date() }));        // debug — suppressed
    await Effect.runPromise(logger.emit({ _tag: "completion", success: true, summary: "Done", timestamp: new Date() }));                // info — passes
    await Effect.runPromise(logger.emit({ _tag: "warning", message: "High latency", timestamp: new Date() }));                         // warn — passes

    const buffer = await Effect.runPromise(logger.getBuffer());
    expect(buffer).toHaveLength(2);
    expect(buffer[0]?._tag).toBe("completion");
    expect(buffer[1]?._tag).toBe("warning");
  });

  it("default minLevel:debug passes all events", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));

    await Effect.runPromise(logger.emit({ _tag: "metric", name: "entropy", value: 0.3, unit: "composite", timestamp: new Date() }));
    await Effect.runPromise(logger.emit({ _tag: "phase_started", phase: "think", timestamp: new Date() }));
    await Effect.runPromise(logger.emit({ _tag: "warning", message: "warn", timestamp: new Date() }));
    await Effect.runPromise(logger.emit({ _tag: "error", message: "err", timestamp: new Date() }));

    const buffer = await Effect.runPromise(logger.getBuffer());
    expect(buffer).toHaveLength(4);
  });
});
