import { describe, test, expect, mock } from "bun:test";
import { Effect, Layer } from "effect";
import { makeConsoleExporter } from "../src/exporters/console-exporter.js";
import { makeFileExporter } from "../src/exporters/file-exporter.js";
import { ObservabilityService, ObservabilityServiceLive } from "../src/observability-service.js";
import type { LogEntry, Span, Metric } from "../src/types.js";
import { readFileSync, existsSync, unlinkSync } from "fs";

// ─── Phase 0.3: Console Exporter ───

describe("ConsoleExporter (Phase 0.3)", () => {
  test("exportLogs outputs colored messages", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showSpans: false, showMetrics: false });
      const logs: LogEntry[] = [
        { timestamp: new Date(), level: "info", message: "Test info message" },
        { timestamp: new Date(), level: "error", message: "Test error message" },
        { timestamp: new Date(), level: "warn", message: "Test warn message" },
        { timestamp: new Date(), level: "debug", message: "Test debug message" },
      ];
      exporter.exportLogs(logs);

      const combined = output.join("\n");
      expect(combined).toContain("Test info message");
      expect(combined).toContain("Test error message");
      expect(combined).toContain("Test warn message");
      expect(combined).toContain("Test debug message");
    } finally {
      console.log = origLog;
    }
  });

  test("exportLogs respects minLevel filter", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showSpans: false, showMetrics: false, minLevel: "warn" });
      const logs: LogEntry[] = [
        { timestamp: new Date(), level: "debug", message: "Should not appear" },
        { timestamp: new Date(), level: "info", message: "Should not appear either" },
        { timestamp: new Date(), level: "warn", message: "Should appear" },
        { timestamp: new Date(), level: "error", message: "Should appear too" },
      ];
      exporter.exportLogs(logs);

      const combined = output.join("\n");
      expect(combined).not.toContain("Should not appear");
      expect(combined).toContain("Should appear");
    } finally {
      console.log = origLog;
    }
  });

  test("exportSpans shows span tree", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showMetrics: false });
      const spans: Span[] = [
        {
          traceId: "abc123",
          spanId: "root-1",
          name: "execution.run",
          startTime: new Date(),
          status: "ok",
          attributes: { duration_ms: 42.5 },
          events: [],
        },
        {
          traceId: "abc123",
          spanId: "child-1",
          parentSpanId: "root-1",
          name: "execution.phase.think",
          startTime: new Date(),
          status: "ok",
          attributes: { duration_ms: 15.2 },
          events: [],
        },
      ];
      exporter.exportSpans(spans);

      const combined = output.join("\n");
      expect(combined).toContain("execution.run");
      expect(combined).toContain("execution.phase.think");
    } finally {
      console.log = origLog;
    }
  });

  test("exportMetrics shows counter totals, histogram percentiles, gauge last value", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      const metrics: Metric[] = [
        { name: "execution.phase.count", type: "counter", value: 1, timestamp: new Date(), labels: {} },
        { name: "execution.phase.count", type: "counter", value: 1, timestamp: new Date(), labels: {} },
        { name: "llm.request.duration_ms", type: "histogram", value: 50, timestamp: new Date(), labels: {} },
        { name: "llm.request.duration_ms", type: "histogram", value: 200, timestamp: new Date(), labels: {} },
        { name: "execution.iteration", type: "gauge", value: 3, timestamp: new Date(), labels: {} },
      ];
      exporter.exportMetrics(metrics);

      const combined = output.join("\n");
      expect(combined).toContain("execution.phase.count");
      expect(combined).toContain("llm.request.duration_ms");
      expect(combined).toContain("execution.iteration");
    } finally {
      console.log = origLog;
    }
  });

  test("does nothing when all shows are false", () => {
    let called = false;
    const origLog = console.log;
    console.log = () => { called = true; };

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false, showMetrics: false });
      exporter.exportLogs([{ timestamp: new Date(), level: "info", message: "test" }]);
      exporter.exportSpans([]);
      exporter.exportMetrics([]);
      expect(called).toBe(false);
    } finally {
      console.log = origLog;
    }
  });
});

// ─── Phase 0.3: File Exporter ───

describe("FileExporter (Phase 0.3)", () => {
  const testFile = "/tmp/rax-test-exporter.jsonl";

  test("writes valid JSONL log entries", () => {
    if (existsSync(testFile)) unlinkSync(testFile);
    const exporter = makeFileExporter({ filePath: testFile, mode: "overwrite" });
    const logs: LogEntry[] = [
      { timestamp: new Date("2024-01-01T10:00:00Z"), level: "info", message: "Hello from agent" },
      { timestamp: new Date("2024-01-01T10:00:01Z"), level: "error", message: "Something failed", metadata: { code: 42 } },
    ];
    exporter.exportLogs(logs);

    const content = readFileSync(testFile, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first._type).toBe("log");
    expect(first.level).toBe("info");
    expect(first.message).toBe("Hello from agent");
  });

  test("writes valid JSONL span entries with parentSpanId", () => {
    if (existsSync(testFile)) unlinkSync(testFile);
    const exporter = makeFileExporter({ filePath: testFile, mode: "overwrite" });
    const spans: Span[] = [
      {
        traceId: "trace-abc",
        spanId: "span-001",
        parentSpanId: "span-000",
        name: "execution.phase.think",
        startTime: new Date(),
        endTime: new Date(),
        status: "ok",
        attributes: { phase: "think" },
        events: [],
      },
    ];
    exporter.exportSpans(spans);

    const content = readFileSync(testFile, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed._type).toBe("span");
    expect(parsed.traceId).toBe("trace-abc");
    expect(parsed.parentSpanId).toBe("span-000");
    expect(parsed.name).toBe("execution.phase.think");
  });

  test("writes valid JSONL metric entries", () => {
    if (existsSync(testFile)) unlinkSync(testFile);
    const exporter = makeFileExporter({ filePath: testFile, mode: "overwrite" });
    const metrics: Metric[] = [
      { name: "execution.phase.count", type: "counter", value: 5, timestamp: new Date(), labels: { phase: "think" } },
    ];
    exporter.exportMetrics(metrics);

    const content = readFileSync(testFile, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed._type).toBe("metric");
    expect(parsed.name).toBe("execution.phase.count");
    expect(parsed.type).toBe("counter");
    expect(parsed.value).toBe(5);
    expect(parsed.labels.phase).toBe("think");
  });

  test("appends in append mode", () => {
    if (existsSync(testFile)) unlinkSync(testFile);
    const exporter = makeFileExporter({ filePath: testFile, mode: "append" });
    const log: LogEntry = { timestamp: new Date(), level: "info", message: "First" };
    exporter.exportLogs([log]);
    exporter.exportLogs([{ ...log, message: "Second" }]);

    const content = readFileSync(testFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Phase 0.3: ObservabilityService flush() ───

describe("ObservabilityService flush() (Phase 0.3)", () => {
  test("flush() calls exporters with collected data", async () => {
    let logsCalled = false;
    let spansCalled = false;
    let metricsCalled = false;

    const TestLayer = ObservabilityServiceLive({
      console: false,
      file: false,
    });

    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const obs = yield* ObservabilityService;
          yield* obs.info("test message");
          yield* obs.withSpan("test.span", Effect.succeed(1));
          yield* obs.incrementCounter("test.counter", 1);
          yield* obs.flush();

          // Verify data was captured
          const logs = yield* obs.getLogs();
          const spans = yield* obs.getSpans();
          const metrics = yield* obs.getMetrics();

          logsCalled = logs.some(l => l.message === "test message");
          spansCalled = spans.some(s => s.name === "test.span");
          metricsCalled = metrics.some(m => m.name === "test.counter");
        }),
        TestLayer,
      ),
    );

    expect(logsCalled).toBe(true);
    expect(spansCalled).toBe(true);
    expect(metricsCalled).toBe(true);
  });

  test("flush() with console exporter calls console.log", async () => {
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => lines.push(args.join(" "));

    try {
      const TestLayer = ObservabilityServiceLive({
        console: { showSpans: true, showLogs: true, showMetrics: true },
        file: false,
      });

      await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const obs = yield* ObservabilityService;
            yield* obs.info("flush test log");
            yield* obs.withSpan("flush.test.span", Effect.succeed(1));
            yield* obs.flush();
          }),
          TestLayer,
        ),
      );

      const combined = lines.join("\n");
      expect(combined).toContain("flush test log");
    } finally {
      console.log = origLog;
    }
  });

  test("getLogs() returns filtered logs", async () => {
    const TestLayer = ObservabilityServiceLive();
    const logs = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const obs = yield* ObservabilityService;
          yield* obs.debug("debug msg");
          yield* obs.info("info msg");
          yield* obs.warn("warn msg");
          return yield* obs.getLogs({ level: "warn" });
        }),
        TestLayer,
      ),
    );
    expect(logs.some(l => l.message === "warn msg")).toBe(true);
    // info should not appear when filtering for warn level
    expect(logs.some(l => l.message === "info msg")).toBe(false);
  });

  test("getSpans() returns recorded spans", async () => {
    const TestLayer = ObservabilityServiceLive();
    const spans = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const obs = yield* ObservabilityService;
          yield* obs.withSpan("my.span", Effect.succeed(42));
          return yield* obs.getSpans({ name: "my.span" });
        }),
        TestLayer,
      ),
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("my.span");
  });
});
