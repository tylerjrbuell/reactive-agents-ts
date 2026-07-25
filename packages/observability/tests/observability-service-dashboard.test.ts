import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { ObservabilityService } from "../src/observability-service";
import { makeObservabilityTestLayer } from "./_observability-test-layer.js";

describe("ObservabilityService.getDashboardData", () => {
  test("builds DashboardData from buffered metrics without printing to console", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.setGauge("execution.tokens_used", 1234);
      yield* obs.setGauge("execution.success", 1);
      const data = yield* obs.getDashboardData();
      return data;
    });

    const logSpy = { calls: 0 };
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logSpy.calls++; originalLog(...args); };
    try {
      const data = await Effect.runPromise(
        Effect.provide(program, makeObservabilityTestLayer({ console: false, verbosity: "normal" })),
      );
      expect(data.tokenCount).toBe(1234);
      expect(data.status).toBe("success");
      expect(logSpy.calls).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });
});

describe("ObservabilityService live logging at minimal verbosity", () => {
  // makeLiveLogWriter writes via process.stdout.write(...), not console.log
  // -- spy on the former, matching how the live path actually emits.
  test("obs.info/debug live output is suppressed at verbosity:minimal, live:true", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.info("Execution started", { taskId: "t1" });
      yield* obs.debug("some debug detail");
    });

    const writeSpy = { calls: 0 };
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) => {
      writeSpy.calls++;
      return originalWrite(...args);
    }) as typeof process.stdout.write;
    try {
      await Effect.runPromise(
        Effect.provide(program, makeObservabilityTestLayer({ verbosity: "minimal", live: true })),
      );
      // Regression guard: makeStructuredLogger's liveWriter has no verbosity
      // concept of its own -- it prints every log entry unconditionally
      // whenever `live: true`. Without gating its construction on
      // verbosity !== "minimal", obs.info()/obs.debug() calls leak live
      // console output even at minimal, independent of ObservableLogger's
      // own (separately-gated) verbosity check.
      expect(writeSpy.calls).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("obs.info live output still prints at normal verbosity, live:true (no regression)", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.info("Execution started", { taskId: "t1" });
    });

    const writeSpy = { calls: 0 };
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) => {
      writeSpy.calls++;
      return originalWrite(...args);
    }) as typeof process.stdout.write;
    try {
      await Effect.runPromise(
        Effect.provide(program, makeObservabilityTestLayer({ verbosity: "normal", live: true })),
      );
      expect(writeSpy.calls).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});

describe("ObservabilityService.attachChildren + flush", () => {
  test("flush() prints one dashboard containing the attached child", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.setGauge("execution.tokens_used", 100);
      yield* obs.setGauge("execution.success", 1);
      yield* obs.attachChildren([
        { name: "bitcoin-price-finder", data: { status: "success", totalDuration: 500, stepCount: 1, tokenCount: 50, estimatedCost: 0, modelName: "m", provider: "test", phases: [], tools: [], alerts: [] } },
      ]);
      yield* obs.flush();
    });

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
    try {
      await Effect.runPromise(
        Effect.provide(program, makeObservabilityTestLayer({ verbosity: "normal" })),
      );
      const output = lines.join("\n");
      const boxCount = (output.match(/Agent Execution Summary/g) ?? []).length;
      expect(boxCount).toBe(1);
      expect(output).toContain("bitcoin-price-finder");
    } finally {
      console.log = originalLog;
    }
  });

  test("flush() with no attached children behaves exactly as before", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.setGauge("execution.tokens_used", 100);
      yield* obs.flush();
    });

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
    try {
      await Effect.runPromise(
        Effect.provide(program, makeObservabilityTestLayer({ verbosity: "normal" })),
      );
      const output = lines.join("\n");
      expect(output).not.toContain("Sub-agent");
    } finally {
      console.log = originalLog;
    }
  });
});
