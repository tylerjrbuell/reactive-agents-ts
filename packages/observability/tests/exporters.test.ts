import { describe, test, expect, mock } from "bun:test";
import { Effect, Layer } from "effect";
import { makeConsoleExporter, formatMetricsDashboard, formatDuration, type DashboardData } from "../src/exporters/console-exporter.js";
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

  test("exportMetrics uses formatMetricsDashboard for professional output", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      const metrics: Metric[] = [
        { name: "execution.phase.duration_ms", type: "histogram", value: 100, timestamp: new Date(), labels: { phase: "bootstrap" } },
        { name: "execution.phase.duration_ms", type: "histogram", value: 5000, timestamp: new Date(), labels: { phase: "think" } },
        { name: "execution.phase.duration_ms", type: "histogram", value: 1000, timestamp: new Date(), labels: { phase: "act" } },
        { name: "execution.iteration", type: "gauge", value: 3, timestamp: new Date(), labels: {} },
        { name: "execution.tokens_used", type: "gauge", value: 1500, timestamp: new Date(), labels: {} },
      ];
      exporter.exportMetrics(metrics);

      const combined = output.join("\n");
      // Verify dashboard header is present
      expect(combined).toContain("Agent Execution Summary");
      expect(combined).toContain("Success");
      expect(combined).toContain("Metrics Summary");
      // Verify phases are shown in timeline
      expect(combined).toContain("Execution Timeline");
      expect(combined).toContain("bootstrap");
      expect(combined).toContain("think");
      expect(combined).toContain("act");
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

  test("writes valid JSONL log entries", async () => {
    if (existsSync(testFile)) unlinkSync(testFile);
    const exporter = makeFileExporter({ filePath: testFile, mode: "overwrite" });
    const logs: LogEntry[] = [
      { timestamp: new Date("2024-01-01T10:00:00Z"), level: "info", message: "Hello from agent" },
      { timestamp: new Date("2024-01-01T10:00:01Z"), level: "error", message: "Something failed", metadata: { code: 42 } },
    ];
    await exporter.exportLogs(logs);

    const content = readFileSync(testFile, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first._type).toBe("log");
    expect(first.level).toBe("info");
    expect(first.message).toBe("Hello from agent");
  });

  test("writes valid JSONL span entries with parentSpanId", async () => {
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
    await exporter.exportSpans(spans);

    const content = readFileSync(testFile, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed._type).toBe("span");
    expect(parsed.traceId).toBe("trace-abc");
    expect(parsed.parentSpanId).toBe("span-000");
    expect(parsed.name).toBe("execution.phase.think");
  });

  test("writes valid JSONL metric entries", async () => {
    if (existsSync(testFile)) unlinkSync(testFile);
    const exporter = makeFileExporter({ filePath: testFile, mode: "overwrite" });
    const metrics: Metric[] = [
      { name: "execution.phase.count", type: "counter", value: 5, timestamp: new Date(), labels: { phase: "think" } },
    ];
    await exporter.exportMetrics(metrics);

    const content = readFileSync(testFile, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed._type).toBe("metric");
    expect(parsed.name).toBe("execution.phase.count");
    expect(parsed.type).toBe("counter");
    expect(parsed.value).toBe(5);
    expect(parsed.labels.phase).toBe("think");
  });

  test("appends in append mode", async () => {
    if (existsSync(testFile)) unlinkSync(testFile);
    const exporter = makeFileExporter({ filePath: testFile, mode: "append" });
    const log: LogEntry = { timestamp: new Date(), level: "info", message: "First" };
    await exporter.exportLogs([log]);
    await exporter.exportLogs([{ ...log, message: "Second" }]);

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

// ─── Dashboard Formatter ───

describe("DashboardFormatter (Task 2)", () => {
  test("formatDuration() converts milliseconds correctly", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(13900)).toBe("13.9s");
    expect(formatDuration(60000)).toBe("60.0s");
  });

  test("formatMetricsDashboard() formats all sections correctly", () => {
    const data: DashboardData = {
      status: "success",
      totalDuration: 13900,
      stepCount: 7,
      tokenCount: 1963,
      estimatedCost: 0.003,
      modelName: "claude-3.5",
      phases: [
        { name: "bootstrap", duration: 100, status: "ok" },
        { name: "think", duration: 10001, status: "warning", details: "7 iter, 72% of time" },
        { name: "act", duration: 1000, status: "ok", details: "2 tools" },
        { name: "complete", duration: 28, status: "ok" },
      ],
      tools: [
        { name: "file-write", callCount: 3, successCount: 3, errorCount: 0, avgDuration: 450 },
        { name: "web-search", callCount: 2, successCount: 2, errorCount: 0, avgDuration: 280 },
      ],
      alerts: [
        { level: "warning", message: "think phase blocked ≥10s (LLM latency)" },
        { level: "info", message: "7 iterations needed (complex reasoning)" },
        { level: "info", message: "Consider: Simpler task prompt or shorter context" },
      ],
    };

    const output = formatMetricsDashboard(data);

    // Verify header sections exist
    expect(output).toContain("Agent Execution Summary");
    expect(output).toContain("✅");
    expect(output).toContain("Success");
    expect(output).toContain("13.9s");
    expect(output).toContain("1,963");
    expect(output).toContain("claude-3.5");

    // Verify timeline section
    expect(output).toContain("📊 Execution Timeline");
    expect(output).toContain("[bootstrap]");
    expect(output).toContain("[think]");
    expect(output).toContain("7 iter, 72% of time");

    // Verify tools section
    expect(output).toContain("🔧 Tool Execution");
    expect(output).toContain("file-write");
    expect(output).toContain("web-search");

    // Verify alerts section
    expect(output).toContain("⚠️  Alerts & Insights");
    expect(output).toContain("think phase blocked ≥10s");
  });

  test("formatMetricsDashboard() shows warning icon for phases > 10s", () => {
    const data: DashboardData = {
      status: "success",
      totalDuration: 15000,
      stepCount: 5,
      tokenCount: 1500,
      estimatedCost: 0.002,
      modelName: "claude-3",
      phases: [
        { name: "think", duration: 11000, status: "warning" },
      ],
      tools: [],
      alerts: [],
    };

    const output = formatMetricsDashboard(data);

    // Find the think phase line and verify it has warning status
    const lines = output.split("\n");
    const thinkLine = lines.find(l => l.includes("[think]"));
    expect(thinkLine).toBeDefined();
    expect(thinkLine).toContain("⚠️");
  });

  test("formatMetricsDashboard() omits empty sections", () => {
    const data: DashboardData = {
      status: "success",
      totalDuration: 5000,
      stepCount: 3,
      tokenCount: 800,
      estimatedCost: 0.001,
      modelName: "claude-3",
      phases: [],
      tools: [],
      alerts: [],
    };

    const output = formatMetricsDashboard(data);

    // Header should always be present
    expect(output).toContain("Agent Execution Summary");

    // But sections for empty data should not appear
    expect(output).not.toContain("📊 Execution Timeline");
    expect(output).not.toContain("🔧 Tool Execution");
    expect(output).not.toContain("⚠️  Alerts & Insights");
  });

  test("formatMetricsDashboard() formats error status correctly", () => {
    const data: DashboardData = {
      status: "error",
      totalDuration: 2000,
      stepCount: 1,
      tokenCount: 500,
      estimatedCost: 0.001,
      modelName: "claude-3",
      phases: [
        { name: "bootstrap", duration: 100, status: "error" },
      ],
      tools: [],
      alerts: [
        { level: "error", message: "Agent execution failed" },
      ],
    };

    const output = formatMetricsDashboard(data);

    expect(output).toContain("Agent Execution Summary");
    expect(output).toContain("Error");
    expect(output).toContain("❌");
  });

  test("formatMetricsDashboard() includes tool error indicators", () => {
    const data: DashboardData = {
      status: "partial",
      totalDuration: 5000,
      stepCount: 4,
      tokenCount: 1000,
      estimatedCost: 0.001,
      modelName: "claude-3",
      phases: [],
      tools: [
        { name: "file-write", callCount: 3, successCount: 2, errorCount: 1, avgDuration: 400 },
      ],
      alerts: [],
    };

    const output = formatMetricsDashboard(data);

    expect(output).toContain("🔧 Tool Execution");
    expect(output).toContain("file-write");
    // Tool with errors should show warning
    expect(output).toContain("⚠️");
  });
});

// ─── Task 4: exportMetrics() Dashboard Integration ───

describe("Task 4: exportMetrics() Dashboard Integration", () => {
  test("exportMetrics builds DashboardData from histogram phase metrics", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      const metrics: Metric[] = [
        { name: "execution.phase.duration_ms", type: "histogram", value: 150, timestamp: new Date(), labels: { phase: "bootstrap" } },
        { name: "execution.phase.duration_ms", type: "histogram", value: 8500, timestamp: new Date(), labels: { phase: "think" } },
        { name: "execution.phase.duration_ms", type: "histogram", value: 2000, timestamp: new Date(), labels: { phase: "act" } },
      ];
      exporter.exportMetrics(metrics);

      const combined = output.join("\n");
      // Verify timeline section exists with all phases
      expect(combined).toContain("Execution Timeline");
      expect(combined).toContain("bootstrap");
      expect(combined).toContain("think");
      expect(combined).toContain("act");
    } finally {
      console.log = origLog;
    }
  });

  test("exportMetrics extracts stepCount and tokenCount from gauges", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      const metrics: Metric[] = [
        { name: "execution.iteration", type: "gauge", value: 5, timestamp: new Date(), labels: {} },
        { name: "execution.tokens_used", type: "gauge", value: 2000, timestamp: new Date(), labels: {} },
      ];
      exporter.exportMetrics(metrics);

      const combined = output.join("\n");
      // Verify header contains step and token counts
      expect(combined).toContain("Steps: 5");
      expect(combined).toContain("2,000"); // tokens formatted with commas
    } finally {
      console.log = origLog;
    }
  });

  test("exportMetrics generates alerts for slow phases (>= 10s)", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      const metrics: Metric[] = [
        { name: "execution.phase.duration_ms", type: "histogram", value: 11500, timestamp: new Date(), labels: { phase: "think" } },
      ];
      exporter.exportMetrics(metrics);

      const combined = output.join("\n");
      // Verify alert section appears with warning
      expect(combined).toContain("Alerts & Insights");
      expect(combined).toContain("think phase blocked ≥10s");
    } finally {
      console.log = origLog;
    }
  });

  test("exportMetrics generates alerts for high iteration count", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      const metrics: Metric[] = [
        { name: "execution.iteration", type: "gauge", value: 9, timestamp: new Date(), labels: {} },
      ];
      exporter.exportMetrics(metrics);

      const combined = output.join("\n");
      // Verify alerts show high iteration warnings
      expect(combined).toContain("Alerts & Insights");
      expect(combined).toContain("9 iterations needed");
      expect(combined).toContain("High iteration count");
    } finally {
      console.log = origLog;
    }
  });

  test("exportMetrics calculates estimated cost correctly", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      const metrics: Metric[] = [
        { name: "execution.tokens_used", type: "gauge", value: 1000, timestamp: new Date(), labels: {} },
      ];
      exporter.exportMetrics(metrics);

      const combined = output.join("\n");
      // At ~$0.0015 per 1K tokens, 1000 tokens should cost ~$0.0015
      // But due to rounding in the display, it shows as $0.002 (rounded up)
      expect(combined).toContain("Cost: ~$0.002");
    } finally {
      console.log = origLog;
    }
  });

  test("exportMetrics extracts model name from metrics", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      const metrics: Metric[] = [
        { name: "execution.model_name", type: "counter", value: 0, timestamp: new Date(), labels: { model: "claude-3.5" } },
      ];
      exporter.exportMetrics(metrics);

      const combined = output.join("\n");
      // Verify model name appears in header
      expect(combined).toContain("claude-3.5");
    } finally {
      console.log = origLog;
    }
  });

  test("exportMetrics shows success for slow phases (timing warnings are informational)", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      // Slow phase should NOT demote overall status — only errors do
      const metrics: Metric[] = [
        { name: "execution.phase.duration_ms", type: "histogram", value: 12000, timestamp: new Date(), labels: { phase: "think" } },
      ];
      exporter.exportMetrics(metrics);

      const combined = output.join("\n");
      // Overall status is success; phase timeline still shows ⚠️ for slow phases
      expect(combined).toContain("Success");
      expect(combined).toContain("⚠️");
    } finally {
      console.log = origLog;
    }
  });

  test("exportMetrics estimates token count from iteration when not provided", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      // Only iteration count, no explicit tokens
      const metrics: Metric[] = [
        { name: "execution.iteration", type: "gauge", value: 3, timestamp: new Date(), labels: {} },
      ];
      exporter.exportMetrics(metrics);

      const combined = output.join("\n");
      // 3 iterations * 300 tokens = ~900 tokens
      expect(combined).toContain("Tokens:");
      expect(combined).toMatch(/900|1,000/); // fuzzy match due to rounding
    } finally {
      console.log = origLog;
    }
  });

  test("exportMetrics displays tool execution section when tools are present", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      const metrics: Metric[] = [
        { name: "execution.phase.duration_ms", type: "histogram", value: 100, timestamp: new Date(), labels: { phase: "bootstrap" } },
        { name: "execution.phase.duration_ms", type: "histogram", value: 500, timestamp: new Date(), labels: { phase: "think" } },
        { name: "execution.tool.execution", type: "histogram", value: 150, timestamp: new Date(), labels: { tool: "file-write", status: "success" } },
        { name: "execution.tool.execution", type: "histogram", value: 200, timestamp: new Date(), labels: { tool: "file-write", status: "success" } },
        { name: "execution.tool.execution", type: "histogram", value: 100, timestamp: new Date(), labels: { tool: "web-search", status: "error" } },
      ];
      exporter.exportMetrics(metrics);

      const combined = output.join("\n");
      // Verify tool section appears
      expect(combined).toContain("Tool Execution");
      expect(combined).toContain("file-write");
      expect(combined).toContain("web-search");
      // Verify call counts and status
      expect(combined).toContain("2 calls"); // file-write had 2 calls
      expect(combined).toContain("1 calls"); // web-search had 1 call
    } finally {
      console.log = origLog;
    }
  });

  test("exportMetrics handles empty metrics gracefully", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false });
      exporter.exportMetrics([]);

      // Should not output anything when no metrics
      expect(output.length).toBe(0);
    } finally {
      console.log = origLog;
    }
  });

  test("exportMetrics respects showMetrics option", () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      const exporter = makeConsoleExporter({ showLogs: false, showSpans: false, showMetrics: false });
      const metrics: Metric[] = [
        { name: "execution.iteration", type: "gauge", value: 5, timestamp: new Date(), labels: {} },
      ];
      exporter.exportMetrics(metrics);

      expect(output.length).toBe(0);
    } finally {
      console.log = origLog;
    }
  });
});
