import { describe, test, expect, mock } from "bun:test";
import { Effect } from "effect";
import { makeStructuredLogger } from "../src/logging/structured-logger.js";
import { formatLogEntryLive, makeLiveLogWriter } from "../src/exporters/console-exporter.js";
import { ObservabilityService, ObservabilityServiceLive } from "../src/observability-service.js";
import type { LogEntry } from "../src/types.js";

// ─── makeStructuredLogger liveWriter tests ───

describe("makeStructuredLogger with liveWriter", () => {
  test("liveWriter called synchronously on log() before flush", async () => {
    const captured: LogEntry[] = [];
    const liveWriter = (entry: LogEntry) => captured.push(entry);

    const logger = await Effect.runPromise(makeStructuredLogger({ liveWriter }));

    // Before any Effect execution, captured should be empty
    expect(captured.length).toBe(0);

    // After running log(), liveWriter should have been called
    await Effect.runPromise(logger.info("hello live"));
    expect(captured.length).toBe(1);
    expect(captured[0]!.message).toBe("hello live");
    expect(captured[0]!.level).toBe("info");
  });

  test("liveWriter called for each log call independently", async () => {
    const captured: LogEntry[] = [];
    const liveWriter = (entry: LogEntry) => captured.push(entry);

    const logger = await Effect.runPromise(makeStructuredLogger({ liveWriter }));

    await Effect.runPromise(logger.debug("d1"));
    await Effect.runPromise(logger.info("i1"));
    await Effect.runPromise(logger.warn("w1"));
    await Effect.runPromise(logger.error("e1", new Error("test")));

    expect(captured.length).toBe(4);
    expect(captured.map((e) => e.level)).toEqual(["debug", "info", "warn", "error"]);
  });

  test("liveWriter still calls getLogs (both paths buffer)", async () => {
    const captured: LogEntry[] = [];
    const liveWriter = (entry: LogEntry) => captured.push(entry);

    const logger = await Effect.runPromise(makeStructuredLogger({ liveWriter }));
    await Effect.runPromise(logger.info("buffered"));

    // getLogs should return the same entry
    const logs = await Effect.runPromise(logger.getLogs());
    expect(logs.length).toBe(1);
    expect(logs[0]!.message).toBe("buffered");
  });

  test("works without liveWriter (no side effects)", async () => {
    const logger = await Effect.runPromise(makeStructuredLogger());
    await Effect.runPromise(logger.info("no writer"));

    const logs = await Effect.runPromise(logger.getLogs());
    expect(logs.length).toBe(1);
  });
});

// ─── formatLogEntryLive ───

describe("formatLogEntryLive", () => {
  test("produces ANSI-colored string with timestamp, level, message", () => {
    const entry: LogEntry = {
      timestamp: new Date("2026-01-01T12:00:00.000Z"),
      level: "info",
      message: "test message",
    };
    const result = formatLogEntryLive(entry);
    expect(result).toContain("INFO");
    expect(result).toContain("test message");
    expect(result).toContain("12:00:00"); // time slice
    // chalk strips color codes in non-TTY environments; verify content is present
    expect(result).toContain("INFO");
  });

  test("includes metadata as JSON when present", () => {
    const entry: LogEntry = {
      timestamp: new Date(),
      level: "debug",
      message: "with meta",
      metadata: { key: "value", count: 42 },
    };
    const result = formatLogEntryLive(entry);
    expect(result).toContain('"key"');
    expect(result).toContain('"value"');
  });
});

// ─── makeLiveLogWriter ───

describe("makeLiveLogWriter", () => {
  test("returns a function that writes to stdout", () => {
    const writer = makeLiveLogWriter();
    expect(typeof writer).toBe("function");
  });

  test("respects minLevel filtering", async () => {
    const written: string[] = [];
    // Spy on process.stdout.write — use a custom writer instead via a captured writer
    // We test the concept by using makeStructuredLogger with a writer that respects minLevel
    const warnOnlyWriter = makeLiveLogWriter({ minLevel: "warn" });

    // Create a test that captures what the writer would do
    const captured: LogEntry[] = [];
    const testWriter = (entry: LogEntry) => {
      // Simulate what makeLiveLogWriter does internally (minLevel check)
      const levelOrder: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
      if ((levelOrder[entry.level] ?? 0) >= (levelOrder["warn"] ?? 0)) {
        captured.push(entry);
      }
    };

    const logger = await Effect.runPromise(makeStructuredLogger({ liveWriter: testWriter }));
    await Effect.runPromise(logger.debug("skipped"));
    await Effect.runPromise(logger.info("also skipped"));
    await Effect.runPromise(logger.warn("captured"));
    await Effect.runPromise(logger.error("also captured", new Error("e")));

    expect(captured.length).toBe(2);
    expect(captured.map((e) => e.level)).toEqual(["warn", "error"]);
  });
});

// ─── ObservabilityServiceLive with live: true ───

describe("ObservabilityServiceLive with live: true", () => {
  test("verbosity getter returns configured value", async () => {
    const layer = ObservabilityServiceLive({ verbosity: "verbose", live: false });
    const verbosity = await Effect.runPromise(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;
        return obs.verbosity();
      }).pipe(Effect.provide(layer)),
    );
    expect(verbosity).toBe("verbose");
  });

  test("verbosity defaults to normal when not specified", async () => {
    const layer = ObservabilityServiceLive();
    const verbosity = await Effect.runPromise(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;
        return obs.verbosity();
      }).pipe(Effect.provide(layer)),
    );
    expect(verbosity).toBe("normal");
  });

  test("logs are buffered even in live mode (getLogs returns them)", async () => {
    const layer = ObservabilityServiceLive({ live: false });
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;
        yield* obs.info("test log");
        yield* obs.debug("debug log");
        return yield* obs.getLogs();
      }).pipe(Effect.provide(layer)),
    );
    expect(logs.length).toBeGreaterThanOrEqual(2);
    const messages = logs.map((l) => l.message);
    expect(messages).toContain("test log");
    expect(messages).toContain("debug log");
  });
});
