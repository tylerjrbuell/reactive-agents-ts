import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { ObservabilityService } from "@reactive-agents/observability";
import { createLightRuntime } from "../src/runtime";

describe("emitConsole: false", () => {
  test("suppresses console dashboard while still recording metrics", async () => {
    const runtime = createLightRuntime({
      agentId: "test-agent",
      provider: "test",
      model: "test-model",
      enableObservability: true,
      observabilityOptions: { verbosity: "normal", emitConsole: false },
    });

    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.setGauge("execution.tokens_used", 42);
      const data = yield* obs.getDashboardData();
      // Flush actually triggers console.exportMetrics() — this is where suppression is tested
      yield* obs.flush();
      return data;
    });

    const logSpy = { calls: 0 };
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logSpy.calls++; originalLog(...args); };
    try {
      const data = await Effect.runPromise(Effect.provide(program, runtime));
      expect(data.tokenCount).toBe(42);
      expect(logSpy.calls).toBe(0); // Assertion covers flush() suppression path
    } finally {
      console.log = originalLog;
    }
  });

  test("emitConsole: true (control) prints dashboard to console", async () => {
    const runtime = createLightRuntime({
      agentId: "test-agent",
      provider: "test",
      model: "test-model",
      enableObservability: true,
      observabilityOptions: { verbosity: "normal" }, // No emitConsole: false — flag defaults to true
    });

    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.setGauge("execution.tokens_used", 123);
      // flush() should trigger console.exportMetrics() — proving flag actually controls output
      yield* obs.flush();
    });

    const logSpy = { calls: 0 };
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logSpy.calls++; originalLog(...args); };
    try {
      await Effect.runPromise(Effect.provide(program, runtime));
      // With emitConsole enabled (default), flush() prints dashboard lines to console
      expect(logSpy.calls).toBeGreaterThan(0);
    } finally {
      console.log = originalLog;
    }
  });
});
